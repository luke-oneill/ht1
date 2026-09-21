import { Router } from "express";
import { Pool } from "pg";
import { inspectIngestion, retryIngestion } from "../forms/inspection/ingestion-status";

type Database = Pick<Pool, "query">;

export const createIngestionsRouter = (database: Database): Router => {
	const router = Router();

	router.get("/:id", async (req, res) => {
		try {
			const inspection = await inspectIngestion(database, req.params.id);
			if (!inspection) {
				res.status(404).json({ error: "Ingestion not found" });
				return;
			}
			res.json(inspection);
		} catch (error) {
			console.error("Failed to inspect ingestion", { ingestionId: req.params.id, error });
			res.status(503).json({ error: "Ingestion status temporarily unavailable" });
		}
	});

	router.post("/:id/retry", async (req, res) => {
		try {
			const result = await retryIngestion(database, req.params.id);
			if (result.outcome === "not-found") {
				res.status(404).json({ error: "Ingestion not found" });
				return;
			}
			if (result.outcome === "not-failed") {
				res.status(409).json({ error: "Only failed ingestions can be retried" });
				return;
			}

			console.info("Ingestion replay requested", {
				ingestionId: req.params.id,
				failedStep: result.failedStep,
			});
			res.status(202).json({ ingestionId: req.params.id, status: result.status });
		} catch (error) {
			console.error("Failed to replay ingestion", { ingestionId: req.params.id, error });
			res.status(503).json({ error: "Ingestion retry temporarily unavailable" });
		}
	});

	return router;
};
