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

			res.status(result.created ? 201 : 200).json({
				applicationReference: result.applicationReference,
				status: result.created ? "ingested" : "duplicate",
			});
		} catch (error) {
			if (error instanceof InvalidFormError) {
				res.status(400).json({ error: error.message });
				return;
			}

			console.error("Failed to ingest form", error);
			res.status(503).json({ error: "Ingestion temporarily unavailable" });
		}
	});

	return router;
};
