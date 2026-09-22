import type { Pool } from "pg";
import { processNextRawForm } from "../src/forms/ingestion/process-next-raw-form";
import personOne from "../src/supplied/examples/person_one.json";

const databaseWithPayload = (payload: unknown): Pool => ({
	query: jest.fn()
		.mockResolvedValueOnce({
			rowCount: 1,
			rows: [{ id: "raw-form-1", payload }],
		})
		.mockResolvedValueOnce({
			rowCount: 1,
			rows: [{ status: "ingested", accepted_raw_form_id: null }],
		}),
} as unknown as Pool);

describe("raw form schema drift", () => {
	it("fails ingestion and warns once without logging unexpected field values", async () => {
		const privateValue = "must-not-appear-in-the-log";
		const database = databaseWithPayload({
			...personOne,
			provider_added_field: privateValue,
			address: {
				...personOne.address,
				county: privateValue,
			},
		});

		await expect(processNextRawForm(database)).resolves.toEqual({
			status: "invalid",
			rawFormId: "raw-form-1",
		});

		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(console.warn).toHaveBeenCalledWith("Provider schema drift prevented ingestion", {
			rawFormId: "raw-form-1",
			unexpectedFieldPaths: ["address.county", "provider_added_field"],
		});
		expect(JSON.stringify((console.warn as jest.Mock).mock.calls)).not.toContain(privateValue);
	});

	it("does not warn when the form contains only understood fields", async () => {
		await processNextRawForm(databaseWithPayload(personOne));

		expect(console.warn).not.toHaveBeenCalled();
	});

	it("uses the existing validation warning instead of a second drift warning for invalid forms", async () => {
		await processNextRawForm(databaseWithPayload({ changed_provider_schema: true }));

		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(console.warn).toHaveBeenCalledWith("Raw form failed validation", {
			rawFormId: "raw-form-1",
			error: "address must be an object",
		});
	});
});
