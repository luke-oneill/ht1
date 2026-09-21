import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { databaseConfig } from "../src/infrastructure/database";
import { runMigrations } from "../src/infrastructure/migrations";

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
