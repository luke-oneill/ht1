import { Router } from "express";
import { Pool } from "pg";
import { storeRawForm } from "../forms/ingestion/store-raw-form";

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const createIngestRouter = (database: Pick<Pool, "query">): Router => {
	const router = Router();

	router.post("/", async (req, res) => {
		if (!isJsonObject(req.body)) {
			res.status(400).json({ error: "Request body must be a JSON object" });
			return;
		}

		try {
			const receipt = await storeRawForm(database, req.body);
			console.info("Raw form received", { rawFormId: receipt.rawFormId });
			res.status(202).json(receipt);
		} catch (error) {
			console.error("Failed to receive raw form", error);
			res.status(503).json({ error: "Ingestion temporarily unavailable" });
		}
	});

	return router;
};
