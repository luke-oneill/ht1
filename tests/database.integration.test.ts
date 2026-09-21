import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../src/app";
import personOne from "../src/forms/examples/person_one.json";
import { databaseConfig } from "../src/infrastructure/database";
import { runMigrations } from "../src/infrastructure/migrations";
import { createServices } from "../src/services";

const describeDatabase = process.env.RUN_DATABASE_TESTS === "true" ? describe : describe.skip;

describeDatabase("database migrations", () => {
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

	it("applies to an empty database and is safe to rerun", async () => {
		await expect(runMigrations(testPool)).resolves.toEqual([
			"001_create_pipeline_tables.sql",
		]);
		await expect(runMigrations(testPool)).resolves.toEqual([]);

		const rawColumns = await testPool.query<{ column_name: string }>(`
			SELECT column_name
			FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = 'raw'
			ORDER BY ordinal_position
		`);
		expect(rawColumns.rows.map(({ column_name }) => column_name)).toEqual([
			"id",
			"payload",
			"created_at",
		]);
	});

	it.each([
		["the supplied valid fixture", personOne],
		["a schema-invalid object", { unexpected_field: true, nested: { value: "preserved" } }],
	])("durably creates both rows for %s", async (_description, payload) => {
		const app = createApp(createServices(testPool));
		const response = await request(app).post("/ingest").send(payload);

		expect(response.status).toBe(202);
		expect(response.body).toMatchObject({ status: "received" });
		const result = await testPool.query<{
			payload: Record<string, unknown>;
			status: string;
		}>(`
			SELECT raw.payload, ingestions.status
			FROM raw
			JOIN ingestions ON ingestions.raw_id = raw.id
			WHERE raw.id = $1
		`, [response.body.ingestionId]);

		expect(result.rows).toEqual([{ payload, status: "received" }]);
	});

	it("rolls back raw storage and returns 503 when ingestion state cannot be stored", async () => {
		await testPool.query(`
			CREATE FUNCTION reject_ingestion_insert() RETURNS trigger AS $$
			BEGIN
				RAISE EXCEPTION 'forced ingestion insert failure';
			END;
			$$ LANGUAGE plpgsql
		`);
		await testPool.query(`
			CREATE TRIGGER reject_ingestion_insert
			BEFORE INSERT ON ingestions
			FOR EACH ROW EXECUTE FUNCTION reject_ingestion_insert()
		`);
		const rawCountBefore = await testPool.query<{ count: string }>("SELECT count(*) FROM raw");
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

		try {
			const app = createApp(createServices(testPool));
			const response = await request(app).post("/ingest").send({ data: true });
			const rawCountAfter = await testPool.query<{ count: string }>("SELECT count(*) FROM raw");

			expect(response.status).toBe(503);
			expect(rawCountAfter.rows[0].count).toBe(rawCountBefore.rows[0].count);
		} finally {
			consoleError.mockRestore();
			await testPool.query("DROP TRIGGER reject_ingestion_insert ON ingestions");
			await testPool.query("DROP FUNCTION reject_ingestion_insert()");
		}
	});

	it("enforces one intermediate and primary row per application reference", async () => {
		const firstRawId = randomUUID();
		const secondRawId = randomUUID();
		await testPool.query("INSERT INTO raw (id, payload) VALUES ($1, $2), ($3, $4)", [
			firstRawId,
			{},
			secondRawId,
			{},
		]);

		const intermediateValues = [
			"REF-1", firstRawId, "SESSION-1", "Example Person", "person@example.com",
			"other", "1990-01-01", null, "07123456789", "1 Example Street",
			"London", null, "SW1A 1AA", "United Kingdom",
		];
		const insertIntermediate = `
			INSERT INTO intermediate (
				application_reference, raw_id, session_id, name, email, gender,
				date_of_birth, phone_number, mobile_number, address_line_1,
				address_line_2, address_line_3, postcode, country
			) VALUES (${Array.from({ length: 14 }, (_, index) => `$${index + 1}`).join(", ")})
		`;
		await testPool.query(insertIntermediate, intermediateValues);
		await expect(
			testPool.query(insertIntermediate, ["REF-1", secondRawId, ...intermediateValues.slice(2)]),
		).rejects.toMatchObject({ code: "23505" });

		const primaryValues = [
			"REF-1", firstRawId, "SESSION-1", "Example", "Person", "person@example.com",
			"prefer-not-to-say", "1990-01-01", null, "07123456789", "1 Example Street",
			"London", null, "SW1A 1AA", "United Kingdom", -0.1, 51.5,
		];
		const insertPrimary = `
			INSERT INTO "primary" (
				application_reference, intermediate_raw_id, session_id, first_name,
				last_name, email, gender, date_of_birth, phone_number, mobile_number,
				address_line_1, address_line_2, address_line_3, postcode, country,
				longitude, latitude
			) VALUES (${Array.from({ length: 17 }, (_, index) => `$${index + 1}`).join(", ")})
		`;
		await testPool.query(insertPrimary, primaryValues);
		await expect(testPool.query(insertPrimary, primaryValues)).rejects.toMatchObject({
			code: "23505",
		});
	});
});
