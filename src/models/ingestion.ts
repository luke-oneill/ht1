export type JsonObject = Record<string, unknown>;

export interface ReceivedIngestion {
	id: string;
	payload: JsonObject;
	status: "received";
}

export interface IngestionReceipt {
	ingestionId: string;
	status: "received";
}
