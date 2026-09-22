import { hashPayload } from "../src/forms/ingestion/hash-payload";

describe("hashPayload", () => {
	it("ignores object key order, including in nested objects", () => {
		expect(hashPayload({ name: "Test Person", address: { postcode: "AA1", line: 1 } }))
			.toBe(hashPayload({ address: { line: 1, postcode: "AA1" }, name: "Test Person" }));
	});

	it("preserves meaningful JSON differences", () => {
		expect(hashPayload({ value: null })).not.toBe(hashPayload({ value: 0 }));
		expect(hashPayload({ values: [1, 2] })).not.toBe(hashPayload({ values: [2, 1] }));
	});
});
