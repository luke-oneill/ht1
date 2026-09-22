import { Pool } from "pg";
import type { SendNotification } from "../forms/contracts/notification-message";
import { processNextRawForm } from "../forms/ingestion/process-next-raw-form";
import type { ProcessRawFormResult } from "../forms/ingestion/process-next-raw-form";
import { processNextTransformedForm } from "../forms/notification/process-next-transformed-form";
import type { ProcessTransformedFormResult } from "../forms/notification/process-next-transformed-form";
import { processNextIngestedForm } from "../forms/transformation/process-next-ingested-form";
import type { ProcessIngestedFormResult } from "../forms/transformation/process-next-ingested-form";
import type { Coordinates } from "../forms/transformation/transform-form";

type Database = Pick<Pool, "query">;
type Geocode = (postcode: string) => Promise<Coordinates>;

export type WorkerResult =
	| { status: "idle" }
	| ProcessRawFormResult
	| ProcessIngestedFormResult
	| ProcessTransformedFormResult;

export const createFormWorker = (
	database: Database,
	geocode: Geocode,
	sendNotification: SendNotification,
) => {
	const stages = [
		() => processNextTransformedForm(database, sendNotification),
		() => processNextRawForm(database),
		() => processNextIngestedForm(database, geocode),
	];
	let nextStageIndex = 0;

	return {
		async nextTick(): Promise<WorkerResult> {
			for (let offset = 0; offset < stages.length; offset += 1) {
				const stageIndex = (nextStageIndex + offset) % stages.length;
				const result = await stages[stageIndex]();
				if (result) {
					nextStageIndex = (stageIndex + 1) % stages.length;
					return result;
				}
			}

			return { status: "idle" };
		},
	};
};

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
