import { Pool } from "pg";
import request from "supertest";
import { createApp } from "../src/app";
import personOne from "../src/forms/examples/person_one.json";

const createDatabase = (rowCount = 1) => {
	const query = jest.fn().mockResolvedValue({ rows: [], rowCount });
	return {
		database: { query } as unknown as Pick<Pool, "query">,
		query,
	};
};

describe("POST /ingest", () => {
	it("validates and stores a form", async () => {
		const { database, query } = createDatabase();

		const response = await request(createApp(database)).post("/ingest").send(personOne);

		expect(response.status).toBe(201);
		expect(response.body).toEqual({
			applicationReference: personOne.application_reference,
			status: "ingested",
		});
		expect(query).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0][1][0]).toBe(personOne.application_reference);
		expect(query.mock.calls[0][1][1]).toEqual(personOne);
	});

	it("acknowledges a duplicate without inserting another row", async () => {
		const { database } = createDatabase(0);

		const response = await request(createApp(database)).post("/ingest").send(personOne);

		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			applicationReference: personOne.application_reference,
			status: "duplicate",
		});
	});

	it.each([
		["a missing field", { ...personOne, email: undefined }, "email must be a string"],
		["a mistyped field", { ...personOne, mobile_number: 123 }, "mobile_number must be a string"],
		["an invalid date", { ...personOne, date_of_birth: "1990-02-30" }, "date_of_birth must be a valid YYYY-MM-DD date"],
	])("rejects %s before writing", async (_description, payload, error) => {
		const { database, query } = createDatabase();

		const response = await request(createApp(database)).post("/ingest").send(payload);

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error });
		expect(query).not.toHaveBeenCalled();
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

	it("returns 503 when the database write fails", async () => {
		const { database, query } = createDatabase();
		query.mockRejectedValue(new Error("database unavailable"));
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

		const response = await request(createApp(database)).post("/ingest").send(personOne);

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "Ingestion temporarily unavailable" });
		consoleError.mockRestore();
	});
});
