import { createApp } from "./app";
import { createDatabasePool, verifyDatabaseConnection } from "./database/pool";
import { geocodePostcode } from "./integrations/postcode-geocoder";
import { createFormWorker, startFormWorker } from "./workers/form-worker";

const PORT = process.env.PORT || 3000;

const start = async (): Promise<void> => {
	const pool = createDatabasePool();

	try {
		await verifyDatabaseConnection(pool);
	} catch (error) {
		await pool.end();
		throw error;
	}

	const app = createApp(pool);
	const stopWorker = startFormWorker(createFormWorker(pool, geocodePostcode));
	const server = app.listen(PORT, () => {
		console.log(`Server is running on http://localhost:${PORT}`);
	});

	let shuttingDown = false;
	const shutdown = (signal: NodeJS.Signals): void => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`${signal} received; shutting down`);
		void stopWorker()
			.then(() => server.close(() => {
				pool.end()
					.then(() => process.exit(0))
					.catch((error: unknown) => {
						console.error("Failed to close the database pool", error);
						process.exit(1);
					});
			}))
			.catch((error: unknown) => {
				console.error("Failed to stop the form worker", error);
				process.exit(1);
			});
	};

	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
};

start().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Unable to start application: ${message}`);
	process.exitCode = 1;
});
