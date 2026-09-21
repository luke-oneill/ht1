import express, { NextFunction, Request, Response } from "express";
import { Pool } from "pg";
import { createIngestRouter } from "./routes/ingest";

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

	app.use((req, _res, next) => {
		console.info("Request received", { method: req.method, path: req.path });
		next();
	});
	app.use(express.json({ limit: "100kb" }));
	app.use("/ingest", createIngestRouter(database));

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
