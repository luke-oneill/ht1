import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../src/app";
import personOne from "../src/forms/examples/person_one.json";
import { databaseConfig } from "../src/infrastructure/database";
import { runMigrations } from "../src/infrastructure/migrations";

const describeDatabase = process.env.RUN_DATABASE_TESTS === "true" ? describe : describe.skip;

describeDatabase("ingested forms", () => {
	const schema = `test_${randomUUID().replaceAll("-", "")}`;
	const adminPool = new Pool(databaseConfig());
	const testPool = new Pool({
		...databaseConfig(),
		options: `-c search_path=${schema}`,
	});

	beforeAll(async () => {
		await adminPool.query(`CREATE SCHEMA "${schema}"`);
	});

	afterAll(async () => {
		await testPool.end();
		await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
		await adminPool.end();
	});

	it("creates the database schema and can safely rerun migrations", async () => {
		await expect(runMigrations(testPool)).resolves.toEqual([
			"001_create_ingested_forms.sql",
		]);
		await expect(runMigrations(testPool)).resolves.toEqual([]);

		const tables = await testPool.query<{ table_name: string }>(`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = current_schema() AND table_name <> 'schema_migrations'
		`);
		expect(tables.rows).toEqual([{ table_name: "ingested_forms" }]);
	});

	it("stores the raw payload and extracted fields in one row", async () => {
		const response = await request(createApp(testPool)).post("/ingest").send(personOne);

		expect(response.status).toBe(201);
		const result = await testPool.query(`
			SELECT * FROM ingested_forms WHERE application_reference = $1
		`, [personOne.application_reference]);
		expect(result.rows[0]).toMatchObject({
			application_reference: personOne.application_reference,
			raw_payload: personOne,
			session_id: personOne.session_id,
			name: personOne.name,
			date_of_birth: new Date("1990-01-01T00:00:00.000Z"),
			postcode: personOne.address.postcode,
		});
	});

	it("deduplicates solely by application reference", async () => {
		const applicationReference = `DEDUP-${randomUUID()}`;
		const first = {
			...personOne,
			application_reference: applicationReference,
		};
		const changedDuplicate = {
			...first,
			session_id: "a-different-session",
			name: "Changed Name",
		};

		const firstResponse = await request(createApp(testPool)).post("/ingest").send(first);
		const duplicateResponse = await request(createApp(testPool))
			.post("/ingest")
			.send(changedDuplicate);

		expect(firstResponse.status).toBe(201);
		expect(duplicateResponse.status).toBe(200);
		expect(duplicateResponse.body.status).toBe("duplicate");
		const result = await testPool.query(
			"SELECT count(*), min(name) AS name FROM ingested_forms WHERE application_reference = $1",
			[applicationReference],
		);
		expect(result.rows[0]).toEqual({ count: "1", name: personOne.name });
	});

	it("does not store a form that fails the provider contract", async () => {
		const invalidReference = `INVALID-${randomUUID()}`;
		const response = await request(createApp(testPool)).post("/ingest").send({
			...personOne,
			application_reference: invalidReference,
			date_of_birth: "1990-02-30",
		});

		expect(response.status).toBe(400);
		const result = await testPool.query(
			"SELECT count(*) FROM ingested_forms WHERE application_reference = $1",
			[invalidReference],
		);
		expect(result.rows[0].count).toBe("0");
	});
});
