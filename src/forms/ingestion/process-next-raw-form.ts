import { Pool } from "pg";
import type { IngestedForm } from "../contracts/ingested-form";
import { InvalidFormError, parseIngestedForm } from "./parse-ingested-form";

type Database = Pick<Pool, "query">;

export type ProcessRawFormResult =
	| { status: "ingested" | "duplicate"; rawFormId: string; applicationReference: string }
	| { status: "invalid"; rawFormId: string };

export const processNextRawForm = async (
	database: Database,
): Promise<ProcessRawFormResult | undefined> => {
	const selected = await database.query<{ id: string; payload: unknown }>(`
		SELECT id, payload
		FROM raw_forms
		WHERE status = 'received'
		ORDER BY created_at, id
		LIMIT 1
	`);
	if (selected.rowCount === 0) return undefined;

	const rawForm = selected.rows[0];
	console.info("Worker picked up raw form", { rawFormId: rawForm.id });

	let form: IngestedForm;
	try {
		form = parseIngestedForm(rawForm.payload);
	} catch (error) {
		if (!(error instanceof InvalidFormError)) throw error;
		await database.query(`
			UPDATE raw_forms
			SET status = 'invalid', error_message = $2, last_attempted_at = now()
			WHERE id = $1
		`, [rawForm.id, error.message]);
		console.warn("Raw form failed validation", {
			rawFormId: rawForm.id,
			error: error.message,
		});
		return { status: "invalid", rawFormId: rawForm.id };
	}

	const saved = await database.query<{ status: "ingested" | "duplicate" }>(`
		WITH inserted AS (
			INSERT INTO ingested_forms (
				application_reference, raw_form_id, session_id, name, email, gender,
				date_of_birth, phone_number, mobile_number, address_line_1,
				address_line_2, address_line_3, postcode, country
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
			)
			ON CONFLICT (application_reference) DO NOTHING
			RETURNING raw_form_id
		), existing_owner AS (
			SELECT raw_form_id
			FROM ingested_forms
			WHERE application_reference = $1
		)
		UPDATE raw_forms
		SET status = CASE
				WHEN EXISTS (SELECT 1 FROM inserted) THEN 'ingested'
				WHEN EXISTS (SELECT 1 FROM existing_owner WHERE raw_form_id = $2) THEN 'ingested'
				ELSE 'duplicate'
			END,
			error_message = NULL,
			last_attempted_at = now()
		WHERE id = $2
		RETURNING status
	`, [
		form.application_reference,
		rawForm.id,
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
	const status = saved.rows[0].status;
	console.info("Worker processed raw form", {
		rawFormId: rawForm.id,
		applicationReference: form.application_reference,
		status,
	});
	return {
		status,
		rawFormId: rawForm.id,
		applicationReference: form.application_reference,
	};
};
