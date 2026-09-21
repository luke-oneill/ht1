import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

export const defaultMigrationsDirectory = path.resolve(
	process.cwd(),
	"src/database/migrations",
);

export const runMigrations = async (
	pool: Pool,
	directory: string = defaultMigrationsDirectory,
): Promise<string[]> => {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`);

	const migrationNames = (await fs.readdir(directory))
		.filter((name) => name.endsWith(".sql"))
		.sort();
	const applied: string[] = [];

	for (const name of migrationNames) {
		const existing = await pool.query<{ name: string }>(
			"SELECT name FROM schema_migrations WHERE name = $1",
			[name],
		);
		if (existing.rowCount !== 0) continue;

		const sql = await fs.readFile(path.join(directory, name), "utf8");
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(sql);
			await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
			await client.query("COMMIT");
			applied.push(name);
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	return applied;
};
