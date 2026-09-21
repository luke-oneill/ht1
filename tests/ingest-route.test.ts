import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../src/app";
import personOne from "../src/supplied/examples/person_one.json";

const createDatabase = () => {
	const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
	return {
		database: { query } as unknown as Pick<Pool, "query">,
		query,
	};
};

describe("POST /ingest", () => {
	it.each([
		["a valid form", personOne],
		["a schema-invalid form", { unexpected_new_schema: true }],
	])("durably receives %s without interpreting it", async (_description, payload) => {
		const { database, query } = createDatabase();

		const response = await request(createApp(database)).post("/ingest").send(payload);

		expect(response.status).toBe(202);
		expect(response.body).toEqual({
			rawFormId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			status: "received",
		});
		expect(query).toHaveBeenCalledWith(
			"INSERT INTO raw_forms (id, payload) VALUES ($1, $2)",
			[response.body.rawFormId, payload],
		);
	});

	it.each([
		["an array", [1, 2, 3]],
		["null", null],
	])("rejects %s", async (_description, payload) => {
		const { database, query } = createDatabase();

		const response = await request(createApp(database))
			.post("/ingest")
			.set("Content-Type", "application/json")
			.send(JSON.stringify(payload));

		expect(response.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON", async () => {
		const { database, query } = createDatabase();

		const response = await request(createApp(database))
			.post("/ingest")
			.set("Content-Type", "application/json")
			.send('{"broken":');

		expect(response.status).toBe(400);
		expect(query).not.toHaveBeenCalled();
	});

	it("rejects a request over the body limit", async () => {
		const { database, query } = createDatabase();

		const response = await request(createApp(database))
			.post("/ingest")
			.send({ value: "x".repeat(101 * 1024) });

		expect(response.status).toBe(413);
		expect(query).not.toHaveBeenCalled();
	});

	it("does not acknowledge a failed database write", async () => {
		const { database, query } = createDatabase();
		query.mockRejectedValue(new Error("database unavailable"));
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

		const response = await request(createApp(database)).post("/ingest").send(personOne);

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "Ingestion temporarily unavailable" });
		consoleError.mockRestore();
	});
});
