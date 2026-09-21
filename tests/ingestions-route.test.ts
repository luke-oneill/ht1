import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../src/app";

const ingestionId = "181d95f1-3277-41c4-a28f-8fc3800b94bd";
const updatedAt = "2026-09-21T10:00:00.000Z";

const row = (overrides: Record<string, unknown> = {}) => ({
	raw_form_id: ingestionId,
	raw_status: "ingested",
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
		["transformed", row({ processing_status: "transformed" })],
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

describe("ingestion replay", () => {
	it.each([
		["validation", row({ raw_status: "invalid", processing_status: null }), "received"],
		["transformation", row({ processing_status: "invalid" }), "ingested"],
		["notification", row({ processing_status: "failed" }), "transformed"],
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
