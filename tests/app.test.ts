import request from "supertest";
import { createApp } from "../src/app";
import { AppServices } from "../src/services";

const ingestionId = "181d95f1-3277-41c4-a28f-8fc3800b94bd";

const createServiceDouble = () => {
	const receive = jest.fn().mockResolvedValue({ ingestionId, status: "received" as const });
	const services: AppServices = { ingestion: { receive } };
	return { receive, services };
};

describe("POST /ingest", () => {
	it("accepts an object and acknowledges it after storage", async () => {
		const { receive, services } = createServiceDouble();
		const payload = { application_reference: "APP-1", unexpected_field: true };

		const response = await request(createApp(services))
			.post("/ingest")
			.send(payload);

		expect(response.status).toBe(202);
		expect(response.body).toEqual({ ingestionId, status: "received" });
		expect(receive).toHaveBeenCalledWith(payload);
	});

	it("accepts an object that does not conform to the healthcare schema", async () => {
		const { receive, services } = createServiceDouble();

		const response = await request(createApp(services))
			.post("/ingest")
			.send({ not_a_registration_form: true });

		expect(response.status).toBe(202);
		expect(receive).toHaveBeenCalledTimes(1);
	});

	it.each([
		["an array", [1, 2, 3]],
		["null", null],
	])("rejects %s", async (_description, payload) => {
		const { receive, services } = createServiceDouble();

		const response = await request(createApp(services))
			.post("/ingest")
			.set("Content-Type", "application/json")
			.send(JSON.stringify(payload));

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Request body must be a JSON object" });
		expect(receive).not.toHaveBeenCalled();
	});

	it.each(["true", "42", '"text"'])("rejects the JSON scalar %s", async (payload) => {
		const { receive, services } = createServiceDouble();

		const response = await request(createApp(services))
			.post("/ingest")
			.set("Content-Type", "application/json")
			.send(payload);

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Request body must be a JSON object" });
		expect(receive).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON", async () => {
		const { receive, services } = createServiceDouble();

		const response = await request(createApp(services))
			.post("/ingest")
			.set("Content-Type", "application/json")
			.send('{"broken":');

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: "Request body must be a JSON object" });
		expect(receive).not.toHaveBeenCalled();
	});

	it("rejects a request over the configured body limit", async () => {
		const { receive, services } = createServiceDouble();

		const response = await request(createApp(services))
			.post("/ingest")
			.send({ value: "x".repeat(101 * 1024) });

		expect(response.status).toBe(413);
		expect(response.body).toEqual({ error: "Request body is too large" });
		expect(receive).not.toHaveBeenCalled();
	});

	it("does not acknowledge a failed storage transaction", async () => {
		const { receive, services } = createServiceDouble();
		receive.mockRejectedValue(new Error("database unavailable"));
		const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);

		const response = await request(createApp(services))
			.post("/ingest")
			.send({ application_reference: "APP-1" });

		expect(response.status).toBe(503);
		expect(response.body).toEqual({ error: "Ingestion temporarily unavailable" });
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to receive ingestion",
			expect.any(Error),
		);
		consoleError.mockRestore();
	});
});
