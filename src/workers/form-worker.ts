import { Pool } from "pg";
import { processNextRawForm } from "../forms/ingestion/process-next-raw-form";
import type { ProcessRawFormResult } from "../forms/ingestion/process-next-raw-form";
import { processNextIngestedForm } from "../forms/transformation/process-next-ingested-form";
import type { ProcessIngestedFormResult } from "../forms/transformation/process-next-ingested-form";
import type { Coordinates } from "../forms/transformation/transform-form";

type Database = Pick<Pool, "query">;
type Geocode = (postcode: string) => Promise<Coordinates>;

export type WorkerResult =
	| { status: "idle" }
	| ProcessRawFormResult
	| ProcessIngestedFormResult;

export const createFormWorker = (database: Database, geocode: Geocode) => ({
	async nextTick(): Promise<WorkerResult> {
		return await processNextRawForm(database)
			?? await processNextIngestedForm(database, geocode)
			?? { status: "idle" };
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
