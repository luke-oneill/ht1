import { createDatabasePool, verifyDatabaseConnection } from "./database";
import { runMigrations } from "./migrations";

const migrate = async (): Promise<void> => {
	const pool = createDatabasePool();
	try {
		await verifyDatabaseConnection(pool);
		const applied = await runMigrations(pool);
		console.log(applied.length === 0 ? "Database is up to date" : `Applied: ${applied.join(", ")}`);
	} finally {
		await pool.end();
	}
};

migrate().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Migration failed: ${message}`);
	process.exitCode = 1;
});
