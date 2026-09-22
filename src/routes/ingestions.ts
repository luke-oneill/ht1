import { Router } from "express";
import { Pool } from "pg";
import {
	inspectIngestion,
	listConflictingIngestions,
	retryIngestion,
} from "../forms/inspection/ingestion-status";

type Database = Pick<Pool, "query">;

export const createIngestionsRouter = (database: Database): Router => {
	const router = Router();

	router.get("/", async (req, res) => {
		if (req.query.status !== "conflict") {
			res.status(400).json({ error: "status must be conflict" });
			return;
		}

		const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
			res.status(400).json({ error: "limit must be an integer between 1 and 100" });
			return;
		}

		try {
			res.json(await listConflictingIngestions(database, limit));
		} catch (error) {
			console.error("Failed to list conflicting ingestions", { error });
			res.status(503).json({ error: "Ingestion list temporarily unavailable" });
		}
	});

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
