import { Pool } from "pg";

type Database = Pick<Pool, "query">;

type IngestionRow = {
	raw_form_id: string;
	raw_status: "received" | "ingested" | "duplicate" | "invalid";
	raw_error_message: string | null;
	processing_status: "pending" | "transformed" | "complete" | "invalid" | "failed" | null;
	processing_error: string | null;
	updated_at: Date | string;
};

export type FailedStep = "raw_to_ingested" | "ingested_to_transformed" | "send_notification";
export type IngestionStatus = "received" | "ingested" | "transformed" | "complete" | "duplicate" | "failed";

export type IngestionInspection = {
	ingestionId: string;
	status: IngestionStatus;
	failedStep: FailedStep | null;
	errorMessage: string | null;
	updatedAt: Date | string;
};

export type RetryIngestionResult =
	| { outcome: "not-found" }
	| { outcome: "not-failed" }
	| {
		outcome: "retried";
		status: "received" | "ingested" | "transformed";
		failedStep: FailedStep;
	};

const selectIngestion = async (
	database: Database,
	ingestionId: string,
): Promise<IngestionRow | undefined> => {
	const result = await database.query<IngestionRow>(`
		SELECT
			raw.id::text AS raw_form_id,
			raw.status AS raw_status,
			raw.error_message AS raw_error_message,
			ingested.processing_status,
			ingested.processing_error,
			GREATEST(
				raw.created_at,
				COALESCE(raw.last_attempted_at, raw.created_at),
				COALESCE(ingested.created_at, raw.created_at),
				COALESCE(ingested.last_attempted_at, raw.created_at)
			) AS updated_at
		FROM raw_forms AS raw
		LEFT JOIN ingested_forms AS ingested ON ingested.raw_form_id = raw.id
		WHERE raw.id::text = $1
	`, [ingestionId]);
	return result.rows[0];
};

const toInspection = (row: IngestionRow): IngestionInspection => {
	if (row.raw_status === "invalid") {
		return {
			ingestionId: row.raw_form_id,
			status: "failed",
			failedStep: "raw_to_ingested",
			errorMessage: row.raw_error_message,
			updatedAt: row.updated_at,
		};
	}

	if (row.raw_status === "received" || row.raw_status === "duplicate") {
		return {
			ingestionId: row.raw_form_id,
			status: row.raw_status,
			failedStep: null,
			errorMessage: row.raw_error_message,
			updatedAt: row.updated_at,
		};
	}

	if (row.processing_status === "invalid") {
		return {
			ingestionId: row.raw_form_id,
			status: "failed",
			failedStep: "ingested_to_transformed",
			errorMessage: row.processing_error,
			updatedAt: row.updated_at,
		};
	}

	if (row.processing_status === "failed") {
		return {
			ingestionId: row.raw_form_id,
			status: "failed",
			failedStep: "send_notification",
			errorMessage: row.processing_error,
			updatedAt: row.updated_at,
		};
	}

	const status = row.processing_status === "pending"
		? "ingested"
		: row.processing_status ?? "ingested";
	const failedStep = row.processing_error === null
		? null
		: row.processing_status === "transformed"
			? "send_notification"
			: "ingested_to_transformed";

	return {
		ingestionId: row.raw_form_id,
		status,
		failedStep,
		errorMessage: row.processing_error,
		updatedAt: row.updated_at,
	};
};

export const inspectIngestion = async (
	database: Database,
	ingestionId: string,
): Promise<IngestionInspection | undefined> => {
	const row = await selectIngestion(database, ingestionId);
	return row && toInspection(row);
};

const resetFailedIngestion = async (
	database: Database,
	ingestionId: string,
	failedStep: FailedStep,
): Promise<"received" | "ingested" | "transformed" | undefined> => {
	switch (failedStep) {
		case "raw_to_ingested": {
			const updated = await database.query(`
				UPDATE raw_forms
				SET status = 'received', error_message = NULL, last_attempted_at = now()
				WHERE id::text = $1 AND status = 'invalid'
			`, [ingestionId]);
			return updated.rowCount === 0 ? undefined : "received";
		}
		case "ingested_to_transformed": {
			const updated = await database.query(`
				UPDATE ingested_forms
				SET processing_status = 'pending', processing_error = NULL,
					next_attempt_at = now(), last_attempted_at = now()
				WHERE raw_form_id::text = $1 AND processing_status = 'invalid'
			`, [ingestionId]);
			return updated.rowCount === 0 ? undefined : "ingested";
		}
		case "send_notification": {
			const updated = await database.query(`
				UPDATE ingested_forms
				SET processing_status = 'transformed', processing_error = NULL,
					next_attempt_at = now(), last_attempted_at = now()
				WHERE raw_form_id::text = $1 AND processing_status = 'failed'
			`, [ingestionId]);
			return updated.rowCount === 0 ? undefined : "transformed";
		}
	}
};

export const retryIngestion = async (
	database: Database,
	ingestionId: string,
): Promise<RetryIngestionResult> => {
	const inspection = await inspectIngestion(database, ingestionId);
	if (!inspection) return { outcome: "not-found" };
	if (inspection.status !== "failed" || inspection.failedStep === null) {
		return { outcome: "not-failed" };
	}

	const status = await resetFailedIngestion(database, ingestionId, inspection.failedStep);
	if (!status) return { outcome: "not-failed" };

	return {
		outcome: "retried",
		status,
		failedStep: inspection.failedStep,
	};
};
