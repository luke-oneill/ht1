import { Router } from "express";
import { Pool } from "pg";
import { ingestForm } from "../forms/ingest";
import { InvalidFormError, parseIngestedForm } from "../forms/schemas/ingested_schema";

export const createIngestRouter = (database: Pick<Pool, "query">): Router => {
	const router = Router();

	router.post("/", async (req, res) => {
		try {
			const form = parseIngestedForm(req.body);
			const result = await ingestForm(database, req.body, form);
			const status = result.created ? "ingested" : "duplicate";
			console.info("Form ingestion completed", {
				applicationReference: result.applicationReference,
				status,
			});

			res.status(result.created ? 201 : 200).json({
				applicationReference: result.applicationReference,
				status,
			});
		} catch (error) {
			if (error instanceof InvalidFormError) {
				console.warn("Form ingestion rejected", { error: error.message });
				res.status(400).json({ error: error.message });
				return;
			}

			console.error("Failed to ingest form", error);
			res.status(503).json({ error: "Ingestion temporarily unavailable" });
		}
	});

	return router;
};
