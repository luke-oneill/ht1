import type { IngestedForm } from "../contracts/ingested-form";

export class InvalidFormError extends Error {}

export class SchemaDriftError extends InvalidFormError {
	constructor(public readonly unexpectedFieldPaths: string[]) {
		super(`unexpected field${unexpectedFieldPaths.length === 1 ? "" : "s"}: ${unexpectedFieldPaths.join(", ")}`);
	}
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const findUnexpectedFormFieldPaths = (
	value: unknown,
	parsed: IngestedForm,
): string[] => {
	if (!isObject(value)) return [];

	const paths = Object.keys(value)
		.filter((key) => !Object.hasOwn(parsed, key));
	if (isObject(value.address)) {
		paths.push(...Object.keys(value.address)
			.filter((key) => !Object.hasOwn(parsed.address, key))
			.map((key) => `address.${key}`));
	}

	return paths.sort();
};

const object = (value: unknown, field: string): Record<string, unknown> => {
	if (!isObject(value)) {
		throw new InvalidFormError(`${field} must be an object`);
	}
	return value;
};

const requiredString = (value: unknown, field: string): string => {
	if (typeof value !== "string" || value.trim() === "") {
		throw new InvalidFormError(`${field} must be a non-empty string`);
	}
	return value.trim();
};

const optionalString = (value: unknown, field: string): string | undefined => {
	if (value === undefined || value === null) return undefined;
	return requiredString(value, field);
};

const fullName = (value: unknown): string => {
	const parts = requiredString(value, "name").split(/\s+/);
	if (parts.length < 2) {
		throw new InvalidFormError("name must include a first name and last name");
	}
	return parts.join(" ");
};

const date = (value: unknown): string => {
	const dateOfBirth = requiredString(value, "date_of_birth");
	const parsedDate = new Date(`${dateOfBirth}T00:00:00.000Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
		|| Number.isNaN(parsedDate.getTime())
		|| parsedDate.toISOString().slice(0, 10) !== dateOfBirth
	) {
		throw new InvalidFormError("date_of_birth must be a valid YYYY-MM-DD date");
	}
	return dateOfBirth;
};

export const parseIngestedForm = (value: unknown): IngestedForm => {
	const form = object(value, "form");
	const address = object(form.address, "address");
	const email = requiredString(form.email, "email");

	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new InvalidFormError("email must be a valid email address");
	}
	if (form.gender !== "male" && form.gender !== "female" && form.gender !== "other") {
		throw new InvalidFormError("gender must be male, female or other");
	}

	const parsed: IngestedForm = {
		session_id: requiredString(form.session_id, "session_id"),
		application_reference: requiredString(form.application_reference, "application_reference"),
		name: fullName(form.name),
		email,
		gender: form.gender,
		date_of_birth: date(form.date_of_birth),
		phone_number: optionalString(form.phone_number, "phone_number"),
		mobile_number: requiredString(form.mobile_number, "mobile_number"),
		address: {
			address_line_1: requiredString(address.address_line_1, "address.address_line_1"),
			address_line_2: requiredString(address.address_line_2, "address.address_line_2"),
			address_line_3: optionalString(address.address_line_3, "address.address_line_3"),
			postcode: requiredString(address.postcode, "address.postcode"),
			country: requiredString(address.country, "address.country"),
		},
	};

	const unexpectedFieldPaths = findUnexpectedFormFieldPaths(value, parsed);
	if (unexpectedFieldPaths.length > 0) {
		throw new SchemaDriftError(unexpectedFieldPaths);
	}
	return parsed;
};
