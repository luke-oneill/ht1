import { randomUUID } from "node:crypto";
import { IngestionReceipt, JsonObject, ReceivedIngestion } from "../models/ingestion";

export interface IngestionRepository {
	createReceived(ingestion: ReceivedIngestion): Promise<void>;
}

export class IngestionService {
	constructor(private readonly repository: IngestionRepository) {}

	async receive(payload: JsonObject): Promise<IngestionReceipt> {
		const ingestion: ReceivedIngestion = {
			id: randomUUID(),
			payload,
			status: "received",
		};

		await this.repository.createReceived(ingestion);

		return {
			ingestionId: ingestion.id,
			status: ingestion.status,
		};
	}
}
