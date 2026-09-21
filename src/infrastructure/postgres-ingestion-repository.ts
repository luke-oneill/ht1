import { Pool } from "pg";
import { IngestionRepository } from "../application/ingestion-service";
import { ReceivedIngestion } from "../models/ingestion";

export class PostgresIngestionRepository implements IngestionRepository {
	constructor(private readonly pool: Pick<Pool, "connect">) {}

	async createReceived(ingestion: ReceivedIngestion): Promise<void> {
		const client = await this.pool.connect();

		try {
			await client.query("BEGIN");
			await client.query("INSERT INTO raw (id, payload) VALUES ($1, $2)", [
				ingestion.id,
				ingestion.payload,
			]);
			await client.query("INSERT INTO ingestions (raw_id, status) VALUES ($1, $2)", [
				ingestion.id,
				ingestion.status,
			]);
			await client.query("COMMIT");
		} catch (error) {
			try {
				await client.query("ROLLBACK");
			} catch {
				// Preserve the operation failure if the connection also fails during rollback.
			}
			throw error;
		} finally {
			client.release();
		}
	}
}
