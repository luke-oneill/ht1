import { parseIngestedForm } from "../src/forms/ingestion/parse-ingested-form";
import personOne from "../src/supplied/examples/person_one.json";

describe("form validation", () => {
	it("accepts unknown fields and normalises surrounding whitespace", () => {
		const parsed = parseIngestedForm({
			...personOne,
			name: "  John \t  Doe  ",
			provider_added_field: true,
		});

		expect(parsed.name).toBe("John Doe");
	});

	it.each([
		["blank application_reference", { ...personOne, application_reference: "  " }, "application_reference must be a non-empty string"],
		["blank name", { ...personOne, name: " \t " }, "name must be a non-empty string"],
		["a single-token name", { ...personOne, name: "Madonna" }, "name must include a first name and last name"],
		["invalid email", { ...personOne, email: "not-an-email" }, "email must be a valid email address"],
		["invalid date", { ...personOne, date_of_birth: "1990-02-30" }, "date_of_birth must be a valid YYYY-MM-DD date"],
	])("rejects %s", (_description, value, message) => {
		expect(() => parseIngestedForm(value)).toThrow(message);
	});

	it("treats null optional fields as absent", () => {
		expect(parseIngestedForm({ ...personOne, phone_number: null }).phone_number).toBeUndefined();
	});
});
