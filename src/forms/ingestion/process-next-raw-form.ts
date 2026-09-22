import { Pool } from "pg";
import type { IngestedForm } from "../contracts/ingested-form";
import {
	InvalidFormError,
	parseIngestedFormWithDrift,
} from "./parse-ingested-form";

type Database = Pick<Pool, "query">;

export type ProcessRawFormResult =
	| { status: "ingested" | "duplicate" | "conflict"; rawFormId: string; applicationReference: string }
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
	let unexpectedFieldPaths: string[];
	try {
		({ form, unexpectedFieldPaths } = parseIngestedFormWithDrift(rawForm.payload));
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

	if (unexpectedFieldPaths.length > 0) {
		console.warn("Provider schema drift detected", {
			rawFormId: rawForm.id,
			applicationReference: form.application_reference,
			unexpectedFieldPaths,
		});
	}

	const saved = await database.query<{
		status: "ingested" | "duplicate" | "conflict";
		accepted_raw_form_id: string | null;
	}>(`
		WITH owner AS (
			INSERT INTO ingested_forms (
				application_reference, raw_form_id, session_id, name, email, gender,
				date_of_birth, phone_number, mobile_number, address_line_1,
				address_line_2, address_line_3, postcode, country
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
			)
			-- The no-op update returns and locks the existing owner when two first
			-- deliveries race; it never replaces accepted form data.
			ON CONFLICT (application_reference) DO UPDATE
			SET raw_form_id = ingested_forms.raw_form_id
			RETURNING raw_form_id
		)
		UPDATE raw_forms
		SET status = CASE
				WHEN (SELECT raw_form_id FROM owner) = $2 THEN 'ingested'
				WHEN payload_hash = (
					SELECT original.payload_hash
					FROM raw_forms AS original
					WHERE original.id = (SELECT raw_form_id FROM owner)
				) THEN 'duplicate'
				ELSE 'conflict'
			END,
			accepted_raw_form_id = CASE
				WHEN (SELECT raw_form_id FROM owner) = $2 THEN NULL
				ELSE (SELECT raw_form_id FROM owner)
			END,
			error_message = NULL,
			last_attempted_at = now()
		WHERE id = $2
		RETURNING status, accepted_raw_form_id
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
		acceptedRawFormId: saved.rows[0].accepted_raw_form_id,
	});
	return {
		status,
		rawFormId: rawForm.id,
		applicationReference: form.application_reference,
	};
};
