import { Pool, PoolClient } from "pg";
import { PostgresIngestionRepository } from "../src/infrastructure/postgres-ingestion-repository";
import { ReceivedIngestion } from "../src/models/ingestion";

const ingestion: ReceivedIngestion = {
	id: "181d95f1-3277-41c4-a28f-8fc3800b94bd",
	payload: { unexpected: "data" },
	status: "received",
};

const createDatabaseDouble = () => {
	const query = jest.fn<Promise<unknown>, [string, unknown[]?]>()
		.mockResolvedValue({ rows: [], rowCount: 0 });
	const release = jest.fn();
	const client = { query, release } as unknown as PoolClient;
	const pool = {
		connect: jest.fn().mockResolvedValue(client),
	} as unknown as Pick<Pool, "connect">;

	return { pool, query, release };
};

describe("PostgresIngestionRepository", () => {
	it("inserts raw data and pipeline state in one transaction", async () => {
		const { pool, query, release } = createDatabaseDouble();
		const repository = new PostgresIngestionRepository(pool);

		await repository.createReceived(ingestion);

		expect(query).toHaveBeenNthCalledWith(1, "BEGIN");
		expect(query).toHaveBeenNthCalledWith(
			2,
			"INSERT INTO raw (id, payload) VALUES ($1, $2)",
			[ingestion.id, ingestion.payload],
		);
		expect(query).toHaveBeenNthCalledWith(
			3,
			"INSERT INTO ingestions (raw_id, status) VALUES ($1, $2)",
			[ingestion.id, ingestion.status],
		);
		expect(query).toHaveBeenNthCalledWith(4, "COMMIT");
		expect(release).toHaveBeenCalledTimes(1);
	});

	it.each([
		["raw insert", 2],
		["ingestion insert", 3],
	])("rolls back when the %s fails", async (_description, failingCall) => {
		const { pool, query, release } = createDatabaseDouble();
		query.mockImplementation(async () => {
			if (query.mock.calls.length === failingCall) throw new Error("insert failed");
			return { rows: [], rowCount: 0 };
		});
		const repository = new PostgresIngestionRepository(pool);

		await expect(repository.createReceived(ingestion)).rejects.toThrow("insert failed");

		expect(query).toHaveBeenLastCalledWith("ROLLBACK");
		expect(query).not.toHaveBeenCalledWith("COMMIT");
		expect(release).toHaveBeenCalledTimes(1);
	});
});
