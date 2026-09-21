import { Pool } from "pg";
import personOne from "../src/supplied/examples/person_one.json";
import { createFormWorker } from "../src/workers/form-worker";

const rawForm = {
	rows: [{ id: "181d95f1-3277-41c4-a28f-8fc3800b94bd", payload: personOne }],
	rowCount: 1,
};

const ingestedForm = {
	rows: [{
		session_id: personOne.session_id,
		application_reference: personOne.application_reference,
		name: personOne.name,
		email: personOne.email,
		gender: personOne.gender,
		date_of_birth: personOne.date_of_birth,
		phone_number: personOne.phone_number,
		mobile_number: personOne.mobile_number,
		address_line_1: personOne.address.address_line_1,
		address_line_2: personOne.address.address_line_2,
		address_line_3: personOne.address.address_line_3,
		postcode: personOne.address.postcode,
		country: personOne.address.country,
	}],
	rowCount: 1,
};

const noRows = { rows: [], rowCount: 0 };

const createDatabase = (...results: unknown[]) => {
	const query = jest.fn();
	for (const result of results) query.mockResolvedValueOnce(result);
	return {
		database: { query } as unknown as Pick<Pool, "query">,
		query,
	};
};

describe("form worker", () => {
	it("returns idle when there is no work", async () => {
		const { database } = createDatabase(noRows, noRows);
		const geocode = jest.fn();

		await expect(createFormWorker(database, geocode).nextTick()).resolves.toEqual({
			status: "idle",
		});
		expect(geocode).not.toHaveBeenCalled();
	});

	it("validates a raw form into an ingested form", async () => {
		const { database } = createDatabase(rawForm, { rows: [{ status: "ingested" }], rowCount: 1 });
		const geocode = jest.fn();

		await expect(createFormWorker(database, geocode).nextTick()).resolves.toEqual({
			status: "ingested",
			rawFormId: rawForm.rows[0].id,
			applicationReference: personOne.application_reference,
		});
		expect(geocode).not.toHaveBeenCalled();
	});

	it("parks a schema-invalid raw form", async () => {
		const invalidRaw = {
			rows: [{ id: rawForm.rows[0].id, payload: { unexpected_schema: true } }],
			rowCount: 1,
		};
		const { database, query } = createDatabase(invalidRaw, { rows: [], rowCount: 1 });

		await expect(createFormWorker(database, jest.fn()).nextTick()).resolves.toEqual({
			status: "invalid",
			rawFormId: rawForm.rows[0].id,
		});
		expect(query.mock.calls[1][1][1]).toBe("address must be an object");
	});

	it("transforms persisted ingested fields rather than the raw payload", async () => {
		const { database, query } = createDatabase(noRows, ingestedForm, { rows: [], rowCount: 1 });
		const geocode = jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 });

		await expect(createFormWorker(database, geocode).nextTick()).resolves.toEqual({
			status: "transformed",
			applicationReference: personOne.application_reference,
		});
		expect(geocode).toHaveBeenCalledWith(personOne.address.postcode);
		expect(query.mock.calls[2][1][0]).toBe(personOne.application_reference);
	});

	it("delays retry after a postcode lookup failure", async () => {
		const { database, query } = createDatabase(noRows, ingestedForm, { rows: [], rowCount: 1 });
		const geocode = jest.fn().mockRejectedValue(new Error("postcode service unavailable"));

		await expect(createFormWorker(database, geocode).nextTick()).resolves.toEqual({
			status: "retry-scheduled",
			applicationReference: personOne.application_reference,
		});
		expect(query.mock.calls[2][1]).toEqual([
			personOne.application_reference,
			"postcode service unavailable",
		]);
	});
});
