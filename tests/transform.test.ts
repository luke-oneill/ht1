import personOne from "../src/forms/examples/person_one.json";
import personTwo from "../src/forms/examples/person_two.json";
import { parseIngestedForm } from "../src/forms/schemas/ingested_schema";
import { transformForm } from "../src/forms/transform";

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
});
