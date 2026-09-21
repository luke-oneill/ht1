import { Router } from "express";
import { IngestionService } from "../application/ingestion-service";
import { JsonObject } from "../models/ingestion";

const isJsonObject = (value: unknown): value is JsonObject =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const createIngestController = (
	ingestionService: Pick<IngestionService, "receive">,
): Router => {
	const router = Router();

	router.post("/", async (req, res) => {
		if (!isJsonObject(req.body)) {
			res.status(400).json({ error: "Request body must be a JSON object" });
			return;
		}

		try {
			const receipt = await ingestionService.receive(req.body);
			res.status(202).json(receipt);
		} catch (error) {
			console.error("Failed to receive ingestion", error);
			res.status(503).json({ error: "Ingestion temporarily unavailable" });
		}
	});

	return router;
};
