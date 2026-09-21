import express, { NextFunction, Request, Response } from "express";
import { Pool } from "pg";
import { ingestForm } from "./forms/ingest";
import { InvalidFormError, parseIngestedForm } from "./forms/schemas/ingested_schema";

interface BodyParserError extends Error {
	status?: number;
	type?: string;
}

const isBodyParserError = (error: unknown): error is BodyParserError => {
	if (!(error instanceof Error) || !("type" in error)) return false;
	return error.type === "entity.too.large" || error.type === "entity.parse.failed";
};

export const createApp = (database: Pick<Pool, "query">) => {
	const app = express();

	app.use(express.json({ limit: "100kb" }));
	app.post("/ingest", async (req, res) => {
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

	app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
		if (!isBodyParserError(error)) {
			next(error);
			return;
		}

		if (error.type === "entity.too.large") {
			res.status(413).json({ error: "Request body is too large" });
			return;
		}

		if (error.type === "entity.parse.failed") {
			res.status(400).json({ error: "Request body must be a JSON object" });
			return;
		}

		next(error);
	});

	return app;
};
