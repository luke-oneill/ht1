import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPayload } from "./hash-payload";

export interface RawFormReceipt {
	rawFormId: string;
	status: "received";
}

export const storeRawForm = async (
	database: Pick<Pool, "query">,
	payload: Record<string, unknown>,
): Promise<RawFormReceipt> => {
	const rawFormId = randomUUID();
	await database.query("INSERT INTO raw_forms (id, payload, payload_hash) VALUES ($1, $2, $3)", [
		rawFormId,
		payload,
		hashPayload(payload),
	]);
	return { rawFormId, status: "received" };
};
