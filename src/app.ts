import express, { NextFunction, Request, Response } from "express";
import { createIngestController } from "./api/ingest-controller";
import { AppServices } from "./services";

interface BodyParserError extends Error {
	status?: number;
	type?: string;
}

const isBodyParserError = (error: unknown): error is BodyParserError => {
	if (!(error instanceof Error) || !("type" in error)) return false;
	return error.type === "entity.too.large" || error.type === "entity.parse.failed";
};

export const createApp = (services: AppServices) => {
	const app = express();

	app.use(express.json({ limit: "100kb" }));
	app.use("/ingest", createIngestController(services.ingestion));

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
