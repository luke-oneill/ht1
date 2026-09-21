import { Pool } from "pg";
import { parseIngestedForm } from "./schemas/ingested_schema";
import { transformForm } from "./transform";
import type { Coordinates } from "./transform";

type Database = Pick<Pool, "query">;
type Geocode = (postcode: string) => Promise<Coordinates>;

export type WorkerResult =
	| { status: "idle" }
	| { status: "transformed" | "failed"; applicationReference: string };

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const createFormWorker = (database: Database, geocode: Geocode) => ({
	async nextTick(): Promise<WorkerResult> {
		const selected = await database.query<{
			application_reference: string;
			raw_payload: unknown;
		}>(`
			SELECT application_reference, raw_payload
			FROM ingested_forms AS ingested
			WHERE NOT EXISTS (
				SELECT 1 FROM transformed_forms AS transformed
				WHERE transformed.application_reference = ingested.application_reference
			)
			ORDER BY last_attempted_at ASC NULLS FIRST, created_at ASC, application_reference ASC
			LIMIT 1
		`);

		if (selected.rowCount === 0) return { status: "idle" };

		const row = selected.rows[0];
		console.info("Worker picked up form", {
			applicationReference: row.application_reference,
		});
		try {
			const form = parseIngestedForm(row.raw_payload);
			const coordinates = await geocode(form.address.postcode);
			const transformed = transformForm(form, coordinates);

			await database.query(`
				WITH transformed AS (
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
				SET processing_error = NULL, last_attempted_at = now()
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
				applicationReference: row.application_reference,
			});
			return { status: "transformed", applicationReference: row.application_reference };
		} catch (error) {
			const message = errorMessage(error);
			await database.query(`
				UPDATE ingested_forms
				SET processing_error = $2, last_attempted_at = now()
				WHERE application_reference = $1
			`, [row.application_reference, message]);
			console.warn("Worker failed to transform form", {
				applicationReference: row.application_reference,
				error: message,
			});
			return { status: "failed", applicationReference: row.application_reference };
		}
	},
});

export type FormWorker = ReturnType<typeof createFormWorker>;

export const startFormWorker = (
	worker: FormWorker,
	pollIntervalMs = 1_000,
): (() => Promise<void>) => {
	let stopped = false;
	let timer: NodeJS.Timeout | undefined;
	let currentTick = Promise.resolve<WorkerResult>({ status: "idle" });

	const run = (): void => {
		currentTick = worker.nextTick();
		void currentTick
			.catch((error: unknown) => console.error("Form worker failed", error))
			.finally(() => {
				if (!stopped) timer = setTimeout(run, pollIntervalMs);
			});
	};

	console.info("Form worker started", { pollIntervalMs });
	run();

	return async () => {
		stopped = true;
		if (timer) clearTimeout(timer);
		await currentTick.catch(() => undefined);
		console.info("Form worker stopped");
	};
};
