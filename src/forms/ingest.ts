import { Pool } from "pg";
import { IngestedFormSchema } from "./schemas/ingested_schema";

export interface IngestResult {
	applicationReference: string;
	created: boolean;
}

export const ingestForm = async (
	database: Pick<Pool, "query">,
	rawPayload: Record<string, unknown>,
	form: IngestedFormSchema,
): Promise<IngestResult> => {
	const result = await database.query<{ application_reference: string }>(`
		INSERT INTO ingested_forms (
			application_reference, raw_payload, session_id, name, email, gender,
			date_of_birth, phone_number, mobile_number, address_line_1,
			address_line_2, address_line_3, postcode, country
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
		)
		ON CONFLICT (application_reference) DO NOTHING
		RETURNING application_reference
	`, [
		form.application_reference,
		rawPayload,
		form.session_id,
		form.name,
		form.email,
		form.gender,
		form.date_of_birth,
		form.phone_number ?? null,
		form.mobile_number,
		form.address.address_line_1,
		form.address.address_line_2,
		form.address.address_line_3 ?? null,
		form.address.postcode,
		form.address.country,
	]);

	return {
		applicationReference: form.application_reference,
		created: result.rowCount === 1,
	};
};
