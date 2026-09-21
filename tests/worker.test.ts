import { Pool } from "pg";
import personOne from "../src/forms/examples/person_one.json";
import { createFormWorker } from "../src/forms/worker";

const selectedForm = {
	rows: [{
		application_reference: personOne.application_reference,
		raw_payload: personOne,
	}],
	rowCount: 1,
};

const createDatabase = (...results: unknown[]) => {
	const query = jest.fn();
	for (const result of results) query.mockResolvedValueOnce(result);
	return {
		database: { query } as unknown as Pick<Pool, "query">,
		query,
	};
};

describe("form worker", () => {
	it("returns idle when every form is already transformed", async () => {
		const { database, query } = createDatabase({ rows: [], rowCount: 0 });
		const geocode = jest.fn();

		await expect(createFormWorker(database, geocode).nextTick()).resolves.toEqual({
			status: "idle",
		});
		expect(query).toHaveBeenCalledTimes(1);
		expect(geocode).not.toHaveBeenCalled();
	});

	it("enriches and stores one form", async () => {
		const { database, query } = createDatabase(selectedForm, { rows: [], rowCount: 1 });
		const geocode = jest.fn().mockResolvedValue({ longitude: -0.1, latitude: 51.5 });

		await expect(createFormWorker(database, geocode).nextTick()).resolves.toEqual({
			status: "transformed",
			applicationReference: personOne.application_reference,
		});
		expect(geocode).toHaveBeenCalledWith(personOne.address.postcode);
		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[1][1]).toEqual([
			personOne.application_reference,
			personOne.session_id,
			"John",
			"Doe",
			personOne.email,
			"male",
			new Date("1990-01-01T00:00:00.000Z"),
			personOne.phone_number,
			personOne.mobile_number,
			personOne.address.address_line_1,
			personOne.address.address_line_2,
			personOne.address.address_line_3,
			personOne.address.postcode,
			personOne.address.country,
			-0.1,
			51.5,
		]);
	});

	it("records a provider failure so another form can be selected next", async () => {
		const { database, query } = createDatabase(selectedForm, { rows: [], rowCount: 1 });
		const geocode = jest.fn().mockRejectedValue(new Error("postcode service unavailable"));

		await expect(createFormWorker(database, geocode).nextTick()).resolves.toEqual({
			status: "failed",
			applicationReference: personOne.application_reference,
		});
		expect(query.mock.calls[1][1]).toEqual([
			personOne.application_reference,
			"postcode service unavailable",
		]);
	});
});
