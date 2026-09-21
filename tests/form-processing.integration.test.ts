import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../src/app";
import { databaseConfig } from "../src/database/pool";
import { runMigrations } from "../src/database/migration-runner";
import personOne from "../src/supplied/examples/person_one.json";
import { createFormWorker } from "../src/workers/form-worker";

const describeDatabase = process.env.RUN_DATABASE_TESTS === "true" ? describe : describe.skip;

describeDatabase("form processing", () => {
	const schema = `test_${randomUUID().replaceAll("-", "")}`;
	const adminPool = new Pool(databaseConfig());
	const testPool = new Pool({
		...databaseConfig(),
		options: `-c search_path=${schema}`,
	});

	beforeAll(async () => {
		await adminPool.query(`CREATE SCHEMA "${schema}"`);
	});

	afterEach(async () => {
		await testPool.query("TRUNCATE transformed_forms, ingested_forms, raw_forms CASCADE");
	});

	afterAll(async () => {
		await testPool.end();
		await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
		await adminPool.end();
	});

	it("creates the three form tables and can safely rerun migrations", async () => {
		await expect(runMigrations(testPool)).resolves.toEqual([
			"001_create_form_tables.sql",
			"002_add_notification_status.sql",
		]);
		await expect(runMigrations(testPool)).resolves.toEqual([]);

		const tables = await testPool.query<{ table_name: string }>(`
			SELECT table_name
			FROM information_schema.tables
			WHERE table_schema = current_schema() AND table_name <> 'schema_migrations'
		`);
		expect(tables.rows.map(({ table_name }) => table_name).sort()).toEqual([
			"ingested_forms",
			"raw_forms",
			"transformed_forms",
		]);
	});

	it("retains invalid forms with a useful validation error", async () => {
		const payload = { changed_provider_schema: true };
		const response = await request(createApp(testPool)).post("/ingest").send(payload);
		const worker = createFormWorker(
			testPool,
			jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 }),
			jest.fn().mockResolvedValue(undefined),
		);

		expect(response.status).toBe(202);
		await expect(worker.nextTick()).resolves.toEqual({
			status: "invalid",
			rawFormId: response.body.rawFormId,
		});
		const result = await testPool.query(
			"SELECT payload, status, error_message FROM raw_forms WHERE id = $1",
			[response.body.rawFormId],
		);
		expect(result.rows).toEqual([{
			payload,
			status: "invalid",
			error_message: "address must be an object",
		}]);
	});

	it("moves a valid raw form through ingestion and transformation", async () => {
		const applicationReference = `PIPELINE-${randomUUID()}`;
		const response = await request(createApp(testPool)).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
		});
		const geocode = jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 });
		const worker = createFormWorker(testPool, geocode, jest.fn().mockResolvedValue(undefined));

		await expect(worker.nextTick()).resolves.toEqual({
			status: "ingested",
			rawFormId: response.body.rawFormId,
			applicationReference,
		});
		await expect(worker.nextTick()).resolves.toEqual({
			status: "transformed",
			applicationReference,
		});

		const result = await testPool.query(`
			SELECT raw.status AS raw_status, ingested.processing_status, ingested.name, transformed.first_name,
				transformed.last_name, transformed.longitude, transformed.latitude
			FROM raw_forms AS raw
			JOIN ingested_forms AS ingested ON ingested.raw_form_id = raw.id
			JOIN transformed_forms AS transformed USING (application_reference)
			WHERE raw.id = $1
		`, [response.body.rawFormId]);
		expect(result.rows).toEqual([{
			raw_status: "ingested",
			processing_status: "transformed",
			name: personOne.name,
			first_name: "John",
			last_name: "Doe",
			longitude: -0.1,
			latitude: 51.5,
		}]);
	});

	it("retains changed duplicate deliveries without replacing the first valid form", async () => {
		const applicationReference = `DUPLICATE-${randomUUID()}`;
		const app = createApp(testPool);
		const first = await request(app).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
		});
		const changed = await request(app).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
			name: "Changed Name",
		});
		const worker = createFormWorker(
			testPool,
			jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 }),
			jest.fn().mockResolvedValue(undefined),
		);

		await expect(worker.nextTick()).resolves.toMatchObject({ status: "ingested" });
		await expect(worker.nextTick()).resolves.toEqual({
			status: "duplicate",
			rawFormId: changed.body.rawFormId,
			applicationReference,
		});
		await expect(worker.nextTick()).resolves.toEqual({
			status: "transformed",
			applicationReference,
		});
		const raw = await testPool.query(
			"SELECT id, payload, status FROM raw_forms WHERE id IN ($1, $2) ORDER BY created_at, id",
			[first.body.rawFormId, changed.body.rawFormId],
		);
		expect(raw.rows).toHaveLength(2);
		expect(raw.rows.find(({ id }) => id === changed.body.rawFormId)).toMatchObject({
			payload: expect.objectContaining({ name: "Changed Name" }),
			status: "duplicate",
		});
		const ingested = await testPool.query(
			"SELECT name FROM ingested_forms WHERE application_reference = $1",
			[applicationReference],
		);
		expect(ingested.rows).toEqual([{ name: personOne.name }]);
	});

	it("delays a transient provider retry without blocking another form", async () => {
		const firstReference = `RETRY-A-${randomUUID()}`;
		const secondReference = `RETRY-B-${randomUUID()}`;
		const app = createApp(testPool);
		await request(app).post("/ingest").send({ ...personOne, application_reference: firstReference });
		await request(app).post("/ingest").send({ ...personOne, application_reference: secondReference });
		const geocode = jest.fn().mockRejectedValue(new Error("postcode service unavailable"));
		const worker = createFormWorker(testPool, geocode, jest.fn().mockResolvedValue(undefined));

		await expect(worker.nextTick()).resolves.toMatchObject({ status: "ingested" });
		await expect(worker.nextTick()).resolves.toMatchObject({ status: "ingested" });
		await expect(worker.nextTick()).resolves.toEqual({
			status: "retry-scheduled",
			applicationReference: firstReference,
		});
		await expect(worker.nextTick()).resolves.toEqual({
			status: "retry-scheduled",
			applicationReference: secondReference,
		});
		expect(geocode).toHaveBeenCalledTimes(2);
	});

	it("retries notification work after failures and a simulated restart", async () => {
		const applicationReference = `NOTIFICATION-${randomUUID()}`;
		const response = await request(createApp(testPool)).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
		});
		const geocode = jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 });
		const failingSender = jest.fn().mockRejectedValue(new Error("email service unavailable"));
		const firstWorker = createFormWorker(testPool, geocode, failingSender);

		await expect(firstWorker.nextTick()).resolves.toMatchObject({ status: "ingested" });
		await expect(firstWorker.nextTick()).resolves.toMatchObject({ status: "transformed" });
		await expect(firstWorker.nextTick()).resolves.toEqual({
			status: "retry-scheduled",
			applicationReference,
		});

		let state = await testPool.query(`
			SELECT processing_status, processing_error
			FROM ingested_forms
			WHERE application_reference = $1
		`, [applicationReference]);
		expect(state.rows).toEqual([{
			processing_status: "transformed",
			processing_error: "email service unavailable",
		}]);

		await testPool.query(`
			UPDATE ingested_forms
			SET next_attempt_at = now()
			WHERE application_reference = $1
		`, [applicationReference]);
		const restartedFailingSender = jest.fn().mockRejectedValue(new Error("email service unavailable"));
		const restartedWorker = createFormWorker(testPool, geocode, restartedFailingSender);
		await expect(restartedWorker.nextTick()).resolves.toEqual({
			status: "retry-scheduled",
			applicationReference,
		});
		expect(restartedFailingSender).toHaveBeenCalledTimes(1);

		await testPool.query(`
			UPDATE ingested_forms
			SET next_attempt_at = now()
			WHERE application_reference = $1
		`, [applicationReference]);
		const successfulSender = jest.fn().mockResolvedValue(undefined);
		const recoveredWorker = createFormWorker(testPool, geocode, successfulSender);

		await expect(recoveredWorker.nextTick()).resolves.toEqual({
			status: "complete",
			applicationReference,
		});
		expect(successfulSender).toHaveBeenCalledTimes(1);

		state = await testPool.query(`
			SELECT processing_status, processing_error
			FROM ingested_forms
			WHERE application_reference = $1
		`, [applicationReference]);
		expect(state.rows).toEqual([{
			processing_status: "complete",
			processing_error: null,
		}]);
		await expect(recoveredWorker.nextTick()).resolves.toEqual({ status: "idle" });
		expect(successfulSender).toHaveBeenCalledTimes(1);

		const raw = await testPool.query("SELECT status FROM raw_forms WHERE id = $1", [response.body.rawFormId]);
		expect(raw.rows).toEqual([{ status: "ingested" }]);
	});
});
