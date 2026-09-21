import { Pool } from "pg";
import type { IngestedForm } from "../contracts/ingested-form";
import type { TransformedForm } from "../contracts/transformed-form";
import { transformForm } from "./transform-form";
import type { Coordinates } from "./transform-form";

type Database = Pick<Pool, "query">;
type Geocode = (postcode: string) => Promise<Coordinates>;

type IngestedFormRow = Omit<IngestedForm, "address"> & {
	address_line_1: string;
	address_line_2: string;
	address_line_3: string | undefined;
	postcode: string;
	country: string;
};

export type ProcessIngestedFormResult = {
	status: "awaiting-notification" | "retry-scheduled" | "invalid";
	applicationReference: string;
};

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const toIngestedForm = (row: IngestedFormRow): IngestedForm => ({
	session_id: row.session_id,
	application_reference: row.application_reference,
	name: row.name,
	email: row.email,
	gender: row.gender,
	date_of_birth: row.date_of_birth,
	phone_number: row.phone_number,
	mobile_number: row.mobile_number,
	address: {
		address_line_1: row.address_line_1,
		address_line_2: row.address_line_2,
		address_line_3: row.address_line_3,
		postcode: row.postcode,
		country: row.country,
	},
});

export const processNextIngestedForm = async (
	database: Database,
	geocode: Geocode,
): Promise<ProcessIngestedFormResult | undefined> => {
	const selected = await database.query<IngestedFormRow>(`
		SELECT
			application_reference, session_id, name, email, gender,
			date_of_birth::text, phone_number, mobile_number, address_line_1,
			address_line_2, address_line_3, postcode, country
		FROM ingested_forms AS ingested
		WHERE processing_status = 'pending'
			AND next_attempt_at <= now()
			AND NOT EXISTS (
				SELECT 1 FROM transformed_forms AS transformed
				WHERE transformed.application_reference = ingested.application_reference
			)
		ORDER BY next_attempt_at, created_at, application_reference
		LIMIT 1
	`);
	if (selected.rowCount === 0) return undefined;

	const form = toIngestedForm(selected.rows[0]);
	console.info("Worker picked up ingested form", {
		applicationReference: form.application_reference,
	});

	let coordinates: Coordinates;
	try {
		coordinates = await geocode(form.address.postcode);
	} catch (error) {
		const message = errorMessage(error);
		await database.query(`
			UPDATE ingested_forms
			SET processing_error = $2,
				last_attempted_at = now(),
				next_attempt_at = now() + interval '5 seconds'
			WHERE application_reference = $1
		`, [form.application_reference, message]);
		console.warn("Postcode lookup will be retried", {
			applicationReference: form.application_reference,
			error: message,
		});
		return { status: "retry-scheduled", applicationReference: form.application_reference };
	}

	let transformed: TransformedForm;
	try {
		transformed = transformForm(form, coordinates);
	} catch (error) {
		const message = errorMessage(error);
		await database.query(`
			UPDATE ingested_forms
			SET processing_status = 'invalid', processing_error = $2, last_attempted_at = now()
			WHERE application_reference = $1
		`, [form.application_reference, message]);
		console.warn("Ingested form failed transformation", {
			applicationReference: form.application_reference,
			error: message,
		});
		return { status: "invalid", applicationReference: form.application_reference };
	}

	await database.query(`
		WITH inserted AS (
			INSERT INTO transformed_forms (
				application_reference, session_id, first_name, last_name, email,
				gender, date_of_birth, phone_number, mobile_number, address_line_1,
				address_line_2, address_line_3, postcode, country, longitude, latitude
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8,
				$9, $10, $11, $12, $13, $14, $15, $16
			)
			ON CONFLICT (application_reference) DO NOTHING
		)
		UPDATE ingested_forms
		SET processing_status = 'awaiting_notification', processing_error = NULL,
			last_attempted_at = now()
		WHERE application_reference = $1
	`, [
		transformed.applicationReference,
		transformed.sessionId,
		transformed.firstName,
		transformed.lastName,
		transformed.email,
		transformed.gender,
		transformed.dateOfBirth,
		transformed.phoneNumber ?? null,
		transformed.mobileNumber,
		transformed.addressLine1,
		transformed.addressLine2,
		transformed.addressLine3 ?? null,
		transformed.postcode,
		transformed.country,
		transformed.longitude,
		transformed.latitude,
	]);
	console.info("Worker transformed form", {
		applicationReference: form.application_reference,
	});
	return { status: "awaiting-notification", applicationReference: form.application_reference };
};
