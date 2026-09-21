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
		await runMigrations(testPool);
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
		await expect(runMigrations(testPool)).resolves.toEqual([]);
		const migrations = await testPool.query<{ name: string }>(
			"SELECT name FROM schema_migrations ORDER BY name",
		);
		expect(migrations.rows).toEqual([{ name: "001_create_form_tables.sql" }]);

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

	it("accepts every processing status and rejects unknown values", async () => {
		const rawFormId = randomUUID();
		const applicationReference = `STATUSES-${randomUUID()}`;
		await testPool.query(
			"INSERT INTO raw_forms (id, payload, status) VALUES ($1, $2, 'ingested')",
			[rawFormId, {}],
		);
		await testPool.query(`
			INSERT INTO ingested_forms (
				application_reference, raw_form_id, session_id, name, email, gender,
				date_of_birth, mobile_number, address_line_1, address_line_2, postcode, country
			) VALUES ($1, $2, 'session', 'Test Person', 'test@example.com', 'other',
				'2000-01-01', '07000000000', '1 Test Street', 'Test Town', 'TE1 1ST', 'UK')
		`, [applicationReference, rawFormId]);

		for (const status of [
			"pending",
			"awaiting_notification",
			"complete",
			"invalid",
			"failed",
		]) {
			await expect(testPool.query(`
				UPDATE ingested_forms SET processing_status = $2
				WHERE application_reference = $1
			`, [applicationReference, status])).resolves.toMatchObject({ rowCount: 1 });
		}

		await expect(testPool.query(`
			UPDATE ingested_forms SET processing_status = 'transformed'
			WHERE application_reference = $1
		`, [applicationReference])).rejects.toThrow(/processing_status_check/);
	});

	it("enforces required first and last names at both storage boundaries", async () => {
		const rawFormId = randomUUID();
		const applicationReference = `NAME-CONSTRAINTS-${randomUUID()}`;
		await testPool.query(
			"INSERT INTO raw_forms (id, payload, status) VALUES ($1, $2, 'ingested')",
			[rawFormId, {}],
		);

		await expect(testPool.query(`
			INSERT INTO ingested_forms (
				application_reference, raw_form_id, session_id, name, email, gender,
				date_of_birth, mobile_number, address_line_1, address_line_2, postcode, country
			) VALUES ($1, $2, 'session', 'Madonna', 'test@example.com', 'other',
				'2000-01-01', '07000000000', '1 Test Street', 'Test Town', 'TE1 1ST', 'UK')
		`, [applicationReference, rawFormId])).rejects.toThrow(/ingested_forms_name_check/);

		await testPool.query(`
			INSERT INTO ingested_forms (
				application_reference, raw_form_id, session_id, name, email, gender,
				date_of_birth, mobile_number, address_line_1, address_line_2, postcode, country
			) VALUES ($1, $2, 'session', 'Test Example Person', 'test@example.com', 'other',
				'2000-01-01', '07000000000', '1 Test Street', 'Test Town', 'TE1 1ST', 'UK')
		`, [applicationReference, rawFormId]);

		const insertTransformedName = (firstName: string, lastName: string) => testPool.query(`
			INSERT INTO transformed_forms (
				application_reference, session_id, first_name, last_name, email, gender,
				date_of_birth, mobile_number, address_line_1, address_line_2, postcode,
				country, longitude, latitude
			) VALUES ($1, 'session', $2, $3, 'test@example.com', 'prefer-not-to-say',
				'2000-01-01', '07000000000', '1 Test Street', 'Test Town', 'TE1 1ST',
				'UK', 0, 0)
		`, [applicationReference, firstName, lastName]);

		await expect(insertTransformedName("", "Example Person"))
			.rejects.toThrow(/transformed_forms_first_name_check/);
		await expect(insertTransformedName("Test", ""))
			.rejects.toThrow(/transformed_forms_last_name_check/);
		await expect(insertTransformedName("Test", "Example Person"))
			.resolves.toMatchObject({ rowCount: 1 });
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

	it("retains a single-token name as an invalid raw form", async () => {
		const payload = { ...personOne, name: "  Madonna  " };
		const response = await request(createApp(testPool)).post("/ingest").send(payload);
		const worker = createFormWorker(testPool, jest.fn(), jest.fn());

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
			error_message: "name must include a first name and last name",
		}]);
	});

	it("moves a valid raw form from receipt to complete", async () => {
		const applicationReference = `PIPELINE-${randomUUID()}`;
		const response = await request(createApp(testPool)).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
		});
		const geocode = jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 });
		const sendNotification = jest.fn().mockResolvedValue(undefined);
		const worker = createFormWorker(testPool, geocode, sendNotification);

		await expect(worker.nextTick()).resolves.toEqual({
			status: "ingested",
			rawFormId: response.body.rawFormId,
			applicationReference,
		});
		await expect(worker.nextTick()).resolves.toEqual({
			status: "awaiting-notification",
			applicationReference,
		});
		await expect(worker.nextTick()).resolves.toEqual({
			status: "complete",
			applicationReference,
		});
		expect(sendNotification).toHaveBeenCalledTimes(1);

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
			processing_status: "complete",
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
			session_id: "a-new-provider-session",
			name: "Changed Name",
		});
		const worker = createFormWorker(
			testPool,
			jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 }),
			jest.fn().mockResolvedValue(undefined),
		);

		await expect(worker.nextTick()).resolves.toMatchObject({ status: "ingested" });
		await expect(worker.nextTick()).resolves.toEqual({
			status: "awaiting-notification",
			applicationReference,
		});
		await expect(worker.nextTick()).resolves.toMatchObject({ status: "complete" });
		await expect(worker.nextTick()).resolves.toEqual({
			status: "duplicate",
			rawFormId: changed.body.rawFormId,
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
			"SELECT session_id, name FROM ingested_forms WHERE application_reference = $1",
			[applicationReference],
		);
		expect(ingested.rows).toEqual([{
			session_id: personOne.session_id,
			name: personOne.name,
		}]);
	});

	it("rotates stages so new deliveries do not starve an ingested form", async () => {
		const firstReference = `FAIRNESS-A-${randomUUID()}`;
		const secondReference = `FAIRNESS-B-${randomUUID()}`;
		const app = createApp(testPool);
		await request(app).post("/ingest").send({
			...personOne,
			application_reference: firstReference,
		});
		const worker = createFormWorker(
			testPool,
			jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 }),
			jest.fn().mockResolvedValue(undefined),
		);

		await expect(worker.nextTick()).resolves.toMatchObject({
			status: "ingested",
			applicationReference: firstReference,
		});
		const second = await request(app).post("/ingest").send({
			...personOne,
			application_reference: secondReference,
		});

		await expect(worker.nextTick()).resolves.toEqual({
			status: "awaiting-notification",
			applicationReference: firstReference,
		});
		const unprocessed = await testPool.query(
			"SELECT status FROM raw_forms WHERE id = $1",
			[second.body.rawFormId],
		);
		expect(unprocessed.rows).toEqual([{ status: "received" }]);
	});

	it("treats raw-form re-entry as ingested when it already owns the reference", async () => {
		const applicationReference = `REENTRY-${randomUUID()}`;
		const received = await request(createApp(testPool)).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
		});
		const createWorker = () => createFormWorker(
			testPool,
			jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 }),
			jest.fn().mockResolvedValue(undefined),
		);

		await expect(createWorker().nextTick()).resolves.toMatchObject({ status: "ingested" });
		await testPool.query(
			"UPDATE raw_forms SET status = 'received' WHERE id = $1",
			[received.body.rawFormId],
		);

		await expect(createWorker().nextTick()).resolves.toEqual({
			status: "ingested",
			rawFormId: received.body.rawFormId,
			applicationReference,
		});
		const state = await testPool.query(`
			SELECT raw.status, count(ingested.application_reference)::int AS ingested_count
			FROM raw_forms AS raw
			LEFT JOIN ingested_forms AS ingested ON ingested.raw_form_id = raw.id
			WHERE raw.id = $1
			GROUP BY raw.status
		`, [received.body.rawFormId]);
		expect(state.rows).toEqual([{ status: "ingested", ingested_count: 1 }]);
	});

	it("retries a geocoder failure and later transforms the form", async () => {
		const applicationReference = `GEOCODER-RETRY-${randomUUID()}`;
		const app = createApp(testPool);
		await request(app).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
		});
		const geocode = jest.fn()
			.mockRejectedValueOnce(new Error("postcode service unavailable"))
			.mockResolvedValueOnce({ longitude: -0.1, latitude: 51.5 });
		const worker = createFormWorker(testPool, geocode, jest.fn().mockResolvedValue(undefined));

		await expect(worker.nextTick()).resolves.toMatchObject({ status: "ingested" });
		await expect(worker.nextTick()).resolves.toEqual({
			status: "retry-scheduled",
			applicationReference,
		});
		await testPool.query(`
			UPDATE ingested_forms
			SET next_attempt_at = now()
			WHERE application_reference = $1
		`, [applicationReference]);
		await expect(worker.nextTick()).resolves.toEqual({
			status: "awaiting-notification",
			applicationReference,
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
		await expect(firstWorker.nextTick()).resolves.toMatchObject({ status: "awaiting-notification" });
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
			processing_status: "awaiting_notification",
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

	it("replays failed validation from the unchanged raw form", async () => {
		const applicationReference = `REPLAY-RAW-${randomUUID()}`;
		const payload = { ...personOne, application_reference: applicationReference };
		const app = createApp(testPool);
		const received = await request(app).post("/ingest").send(payload);
		await testPool.query(`
			UPDATE raw_forms
			SET status = 'invalid', error_message = 'rejected by the previous validator'
			WHERE id = $1
		`, [received.body.rawFormId]);

		const beforeReplay = await request(app).get(`/ingestions/${received.body.rawFormId}`);
		expect(beforeReplay.body).toMatchObject({
			status: "failed",
			failedStep: "raw_to_ingested",
			errorMessage: "rejected by the previous validator",
		});

		const replay = await request(app).post(`/ingestions/${received.body.rawFormId}/retry`);
		expect(replay.status).toBe(202);
		expect(replay.body).toEqual({
			ingestionId: received.body.rawFormId,
			status: "received",
		});

		const worker = createFormWorker(testPool, jest.fn(), jest.fn());
		await expect(worker.nextTick()).resolves.toMatchObject({
			status: "ingested",
			applicationReference,
		});
		const stored = await testPool.query(
			"SELECT payload, error_message FROM raw_forms WHERE id = $1",
			[received.body.rawFormId],
		);
		expect(stored.rows).toEqual([{ payload, error_message: null }]);
	});

	it("replays failed transformation from the ingested form", async () => {
		const applicationReference = `REPLAY-TRANSFORM-${randomUUID()}`;
		const app = createApp(testPool);
		const received = await request(app).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
		});
		const geocode = jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 });
		const worker = createFormWorker(testPool, geocode, jest.fn());
		await expect(worker.nextTick()).resolves.toMatchObject({ status: "ingested" });
		await testPool.query(`
			UPDATE ingested_forms
			SET processing_status = 'invalid', processing_error = 'previous transform rejected the form'
			WHERE raw_form_id = $1
		`, [received.body.rawFormId]);

		const replay = await request(app).post(`/ingestions/${received.body.rawFormId}/retry`);
		expect(replay.status).toBe(202);
		expect(replay.body.status).toBe("ingested");
		await expect(worker.nextTick()).resolves.toEqual({
			status: "awaiting-notification",
			applicationReference,
		});
		expect(geocode).toHaveBeenCalledTimes(1);

		const state = await testPool.query(`
			SELECT raw.status AS raw_status, ingested.processing_status, ingested.processing_error
			FROM raw_forms AS raw
			JOIN ingested_forms AS ingested ON ingested.raw_form_id = raw.id
			WHERE raw.id = $1
		`, [received.body.rawFormId]);
		expect(state.rows).toEqual([{
			raw_status: "ingested",
			processing_status: "awaiting_notification",
			processing_error: null,
		}]);
	});

	it("replays failed notification work from the transformed form", async () => {
		const applicationReference = `REPLAY-NOTIFICATION-${randomUUID()}`;
		const app = createApp(testPool);
		const received = await request(app).post("/ingest").send({
			...personOne,
			application_reference: applicationReference,
		});
		const worker = createFormWorker(
			testPool,
			jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 }),
			jest.fn(),
		);
		await expect(worker.nextTick()).resolves.toMatchObject({ status: "ingested" });
		await expect(worker.nextTick()).resolves.toMatchObject({ status: "awaiting-notification" });
		await testPool.query(`
			UPDATE ingested_forms
			SET processing_status = 'failed', processing_error = 'message construction failed'
			WHERE raw_form_id = $1
		`, [received.body.rawFormId]);

		const replay = await request(app).post(`/ingestions/${received.body.rawFormId}/retry`);
		expect(replay.status).toBe(202);
		expect(replay.body.status).toBe("awaiting-notification");

		const state = await testPool.query(`
			SELECT processing_status, processing_error
			FROM ingested_forms
			WHERE raw_form_id = $1
		`, [received.body.rawFormId]);
		expect(state.rows).toEqual([{
			processing_status: "awaiting_notification",
			processing_error: null,
		}]);
	});

	it("rejects replay for a non-failed ingestion without changing it", async () => {
		const app = createApp(testPool);
		const received = await request(app).post("/ingest").send(personOne);
		const before = await testPool.query(`
			SELECT payload, status, error_message, last_attempted_at
			FROM raw_forms
			WHERE id = $1
		`, [received.body.rawFormId]);

		const replay = await request(app).post(`/ingestions/${received.body.rawFormId}/retry`);

		expect(replay.status).toBe(409);
		const after = await testPool.query(`
			SELECT payload, status, error_message, last_attempted_at
			FROM raw_forms
			WHERE id = $1
		`, [received.body.rawFormId]);
		expect(after.rows).toEqual(before.rows);
	});
});
