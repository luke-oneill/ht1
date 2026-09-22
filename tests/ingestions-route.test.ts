import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../src/app";

const ingestionId = "181d95f1-3277-41c4-a28f-8fc3800b94bd";
const updatedAt = "2026-09-21T10:00:00.000Z";

const row = (overrides: Record<string, unknown> = {}) => ({
	raw_form_id: ingestionId,
	raw_status: "ingested",
	accepted_raw_form_id: null,
	raw_error_message: null,
	processing_status: "complete",
	processing_error: null,
	updated_at: updatedAt,
	...overrides,
});

const createDatabase = (...results: unknown[]) => {
	const query = jest.fn();
	for (const result of results) query.mockResolvedValueOnce(result);
	return {
		database: { query } as unknown as Pick<Pool, "query">,
		query,
	};
};

describe("ingestion inspection", () => {
	it.each([
		["received", row({ raw_status: "received", processing_status: null })],
		["ingested", row({ processing_status: "pending" })],
		["awaiting-notification", row({ processing_status: "awaiting_notification" })],
		["duplicate", row({ raw_status: "duplicate", processing_status: null })],
		["complete", row()],
	])("returns the %s state without form data", async (status, ingestion) => {
		const { database } = createDatabase({ rows: [ingestion], rowCount: 1 });

		const response = await request(createApp(database)).get(`/ingestions/${ingestionId}`);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			ingestionId,
			status,
			failedStep: null,
			errorMessage: null,
			updatedAt,
		});
		expect(response.body).not.toHaveProperty("payload");
	});

	it("links a conflict to the accepted ingestion without exposing either payload", async () => {
		const acceptedId = "70f74dbe-a196-440b-9702-c7688d06054b";
		const { database } = createDatabase({
			rows: [row({
				raw_status: "conflict",
				accepted_raw_form_id: acceptedId,
				processing_status: null,
			})],
			rowCount: 1,
		});

		const response = await request(createApp(database)).get(`/ingestions/${ingestionId}`);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			ingestionId,
			status: "conflict",
			failedStep: null,
			errorMessage: null,
			updatedAt,
			acceptedIngestionId: acceptedId,
		});
		expect(response.body).not.toHaveProperty("payload");
	});

	it.each([
		["raw_to_ingested", row({
			raw_status: "invalid",
			raw_error_message: "date_of_birth must be a valid YYYY-MM-DD date",
			processing_status: null,
		})],
		["ingested_to_transformed", row({
			processing_status: "invalid",
			processing_error: "name cannot be transformed",
		})],
		["send_notification", row({
			processing_status: "failed",
			processing_error: "notification could not be created",
		})],
	])("reports a %s failure", async (failedStep, ingestion) => {
		const { database } = createDatabase({ rows: [ingestion], rowCount: 1 });

		const response = await request(createApp(database)).get(`/ingestions/${ingestionId}`);

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ status: "failed", failedStep });
	});

	it("returns 404 for an unknown ingestion", async () => {
		const { database } = createDatabase({ rows: [], rowCount: 0 });

		const response = await request(createApp(database)).get(`/ingestions/${ingestionId}`);

		expect(response.status).toBe(404);
	});
});

describe("conflict listing", () => {
	it("returns bounded conflict metadata without form payloads", async () => {
		const createdAt = "2026-09-22T09:00:00.000Z";
		const acceptedId = "70f74dbe-a196-440b-9702-c7688d06054b";
		const { database, query } = createDatabase({
			rows: [{
				conflict_raw_form_id: ingestionId,
				accepted_raw_form_id: acceptedId,
				created_at: createdAt,
			}],
			rowCount: 1,
		});

		const response = await request(createApp(database))
			.get("/ingestions?status=conflict&limit=10");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			ingestions: [{
				ingestionId,
				acceptedIngestionId: acceptedId,
				createdAt,
			}],
			hasMore: false,
		});
		expect(response.body.ingestions[0]).not.toHaveProperty("payload");
		expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE status = 'conflict'"), [11]);
	});

	it.each([
		["a missing status", "/ingestions"],
		["an unsupported status", "/ingestions?status=duplicate"],
		["an invalid limit", "/ingestions?status=conflict&limit=101"],
	])("rejects %s without querying the database", async (_description, path) => {
		const { database, query } = createDatabase();

		const response = await request(createApp(database)).get(path);

		expect(response.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});
});

describe("ingestion replay", () => {
	it.each([
		["validation", row({ raw_status: "invalid", processing_status: null }), "received"],
		["transformation", row({ processing_status: "invalid" }), "ingested"],
		["notification", row({ processing_status: "failed" }), "awaiting-notification"],
	])("resets a failed %s from its last valid layer", async (
		_stage,
		ingestion,
		status,
	) => {
		const { database } = createDatabase(
			{ rows: [ingestion], rowCount: 1 },
			{ rows: [], rowCount: 1 },
		);

		const response = await request(createApp(database)).post(`/ingestions/${ingestionId}/retry`);

		expect(response.status).toBe(202);
		expect(response.body).toEqual({ ingestionId, status });
	});

	it("returns 409 without updating a non-failed ingestion", async () => {
		const { database, query } = createDatabase({ rows: [row()], rowCount: 1 });

		const response = await request(createApp(database)).post(`/ingestions/${ingestionId}/retry`);

		expect(response.status).toBe(409);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("returns 404 for an unknown ingestion", async () => {
		const { database, query } = createDatabase({ rows: [], rowCount: 0 });

		const response = await request(createApp(database)).post(`/ingestions/${ingestionId}/retry`);

		expect(response.status).toBe(404);
		expect(query).toHaveBeenCalledTimes(1);
	});
});
