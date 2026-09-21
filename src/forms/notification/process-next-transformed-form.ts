import { Pool } from "pg";
import type { NotificationMessage, SendNotification } from "../contracts/notification-message";
import { createNotification } from "./create-notification";

type Database = Pick<Pool, "query">;

type TransformedFormRow = {
	application_reference: string;
};

export type ProcessTransformedFormResult = {
	status: "complete" | "retry-scheduled" | "failed";
	applicationReference: string;
};

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const processNextTransformedForm = async (
	database: Database,
	sendNotification: SendNotification,
): Promise<ProcessTransformedFormResult | undefined> => {
	const selected = await database.query<TransformedFormRow>(`
		SELECT transformed.application_reference
		FROM transformed_forms AS transformed
		JOIN ingested_forms AS ingested USING (application_reference)
		WHERE ingested.processing_status = 'transformed'
			AND ingested.next_attempt_at <= now()
		ORDER BY ingested.next_attempt_at, ingested.created_at, transformed.application_reference
		LIMIT 1
	`);
	if (selected.rowCount === 0) return undefined;

	const applicationReference = selected.rows[0].application_reference;
	console.info("Worker picked up transformed form", { applicationReference });

	let message: NotificationMessage;
	try {
		message = createNotification({ applicationReference });
	} catch (error) {
		const detail = errorMessage(error);
		await database.query(`
			UPDATE ingested_forms
			SET processing_status = 'failed', processing_error = $2, last_attempted_at = now()
			WHERE application_reference = $1
		`, [applicationReference, detail]);
		console.warn("Notification message could not be created", {
			applicationReference,
			error: detail,
		});
		return { status: "failed", applicationReference };
	}

	try {
		await sendNotification(message);
	} catch (error) {
		const detail = errorMessage(error);
		await database.query(`
			UPDATE ingested_forms
			SET processing_error = $2,
				last_attempted_at = now(),
				next_attempt_at = now() + interval '5 seconds'
			WHERE application_reference = $1
		`, [applicationReference, detail]);
		console.warn("Notification will be retried", {
			applicationReference,
			error: detail,
		});
		return { status: "retry-scheduled", applicationReference };
	}

	await database.query(`
		UPDATE ingested_forms
		SET processing_status = 'complete',
			processing_error = NULL,
			last_attempted_at = now()
		WHERE application_reference = $1
	`, [applicationReference]);
	console.info("Worker sent form notification", { applicationReference });
	return { status: "complete", applicationReference };
};
