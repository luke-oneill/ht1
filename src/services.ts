import { Pool } from "pg";
import { IngestionService } from "./application/ingestion-service";
import { PostgresIngestionRepository } from "./infrastructure/postgres-ingestion-repository";

export interface AppServices {
	ingestion: Pick<IngestionService, "receive">;
}

export const createServices = (pool: Pool): AppServices => ({
	ingestion: new IngestionService(new PostgresIngestionRepository(pool)),
});
