import type { IngestedFormSchema } from "./schemas/ingested_schema";
import type { TransformedFormSchema } from "./schemas/transformed_schema";

export interface Coordinates {
	longitude: number;
	latitude: number;
}

export const transformForm = (
	form: IngestedFormSchema,
	coordinates: Coordinates,
): TransformedFormSchema => {
	const [firstName, ...remainingNames] = form.name.trim().split(/\s+/);

	return {
		sessionId: form.session_id,
		applicationReference: form.application_reference,
		firstName,
		lastName: remainingNames.join(" "),
		email: form.email,
		gender: form.gender === "other" ? "prefer-not-to-say" : form.gender,
		dateOfBirth: new Date(`${form.date_of_birth}T00:00:00.000Z`),
		phoneNumber: form.phone_number,
		mobileNumber: form.mobile_number,
		addressLine1: form.address.address_line_1,
		addressLine2: form.address.address_line_2,
		addressLine3: form.address.address_line_3,
		postcode: form.address.postcode,
		country: form.address.country,
		...coordinates,
	};
};
