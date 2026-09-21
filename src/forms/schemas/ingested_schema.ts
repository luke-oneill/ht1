export type IngestedFormSchema = {
	session_id: string;
	application_reference: string;
	name: string;
	email: string;
	gender: "male" | "female" | "other";
	date_of_birth: string;
	phone_number: string | undefined;
	mobile_number: string;
	address: {
		address_line_1: string;
		address_line_2: string;
		address_line_3: string | undefined;
		postcode: string;
		country: string;
	};
};

export class InvalidFormError extends Error {}

const object = (value: unknown, field: string): Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new InvalidFormError(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
};

const string = (value: unknown, field: string): string => {
	if (typeof value !== "string") throw new InvalidFormError(`${field} must be a string`);
	return value;
};

const optionalString = (value: unknown, field: string): string | undefined =>
	value === undefined ? undefined : string(value, field);

export const parseIngestedForm = (value: unknown): IngestedFormSchema => {
	const form = object(value, "request body");
	const address = object(form.address, "address");
	const dateOfBirth = string(form.date_of_birth, "date_of_birth");
	const parsedDate = new Date(`${dateOfBirth}T00:00:00.000Z`);

	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
		|| Number.isNaN(parsedDate.getTime())
		|| parsedDate.toISOString().slice(0, 10) !== dateOfBirth
	) {
		throw new InvalidFormError("date_of_birth must be a valid YYYY-MM-DD date");
	}

	if (form.gender !== "male" && form.gender !== "female" && form.gender !== "other") {
		throw new InvalidFormError("gender must be male, female or other");
	}

	return {
		session_id: string(form.session_id, "session_id"),
		application_reference: string(form.application_reference, "application_reference"),
		name: string(form.name, "name"),
		email: string(form.email, "email"),
		gender: form.gender,
		date_of_birth: dateOfBirth,
		phone_number: optionalString(form.phone_number, "phone_number"),
		mobile_number: string(form.mobile_number, "mobile_number"),
		address: {
			address_line_1: string(address.address_line_1, "address.address_line_1"),
			address_line_2: string(address.address_line_2, "address.address_line_2"),
			address_line_3: optionalString(address.address_line_3, "address.address_line_3"),
			postcode: string(address.postcode, "address.postcode"),
			country: string(address.country, "address.country"),
		},
	};
};
