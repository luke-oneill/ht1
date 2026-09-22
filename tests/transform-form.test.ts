import { parseIngestedForm } from "../src/forms/ingestion/parse-ingested-form";
import { transformForm } from "../src/forms/transformation/transform-form";
import personOne from "../src/supplied/examples/person_one.json";
import personTwo from "../src/supplied/examples/person_two.json";

describe("transformForm", () => {
	it("maps every field and adds coordinates", () => {
		const transformed = transformForm(parseIngestedForm(personOne), {
			longitude: -0.1,
			latitude: 51.5,
		});

		expect(transformed).toEqual({
			sessionId: personOne.session_id,
			applicationReference: personOne.application_reference,
			firstName: "John",
			lastName: "Doe",
			email: personOne.email,
			gender: "male",
			dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
			phoneNumber: personOne.phone_number,
			mobileNumber: personOne.mobile_number,
			addressLine1: personOne.address.address_line_1,
			addressLine2: personOne.address.address_line_2,
			addressLine3: personOne.address.address_line_3,
			postcode: personOne.address.postcode,
			country: personOne.address.country,
			longitude: -0.1,
			latitude: 51.5,
		});
	});

	it("uses the first name token and preserves the rest as the last name", () => {
		const transformed = transformForm(parseIngestedForm(personTwo), {
			longitude: 0,
			latitude: 0,
		});

		expect(transformed.firstName).toBe("Andy");
		expect(transformed.lastName).toBe("James Smith-Jones");
		expect(transformed.gender).toBe("prefer-not-to-say");
	});

	it("defensively rejects an ingested form without a last name", () => {
		const form = { ...parseIngestedForm(personOne), name: "Madonna" };

		expect(() => transformForm(form, { longitude: 0, latitude: 0 }))
			.toThrow("name must include a first name and last name");
	});
});
