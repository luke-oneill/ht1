import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export interface RawFormReceipt {
	rawFormId: string;
	status: "received";
}

export const storeRawForm = async (
	database: Pick<Pool, "query">,
	payload: Record<string, unknown>,
): Promise<RawFormReceipt> => {
	const rawFormId = randomUUID();
	await database.query("INSERT INTO raw_forms (id, payload) VALUES ($1, $2)", [
		rawFormId,
		payload,
	]);
	return { rawFormId, status: "received" };
};
