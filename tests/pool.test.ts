import { Pool } from "pg";
import { databaseConfig, verifyDatabaseConnection } from "../src/database/pool";

describe("database configuration", () => {
	it("prefers DATABASE_URL when supplied", () => {
		expect(databaseConfig({ DATABASE_URL: "postgresql://example.test/app" })).toEqual({
			connectionString: "postgresql://example.test/app",
		});
	});

	it("rejects an invalid database port", () => {
		expect(() => databaseConfig({ DB_PORT: "not-a-port" })).toThrow(
			"DB_PORT must be a valid TCP port",
		);
	});
});

describe("database startup check", () => {
	it("reports a clear error when PostgreSQL cannot be reached", async () => {
		const pool = {
			query: jest.fn().mockRejectedValue(new Error("connection refused")),
		} as unknown as Pick<Pool, "query">;

		await expect(verifyDatabaseConnection(pool)).rejects.toThrow(
			"Database connection failed: connection refused",
		);
	});

	it("includes connection details from an aggregate driver error", async () => {
		const pool = {
			query: jest.fn().mockRejectedValue(
				new AggregateError([new Error("connect ECONNREFUSED 127.0.0.1:5432")]),
			),
		} as unknown as Pick<Pool, "query">;

		await expect(verifyDatabaseConnection(pool)).rejects.toThrow(
			"Database connection failed: connect ECONNREFUSED 127.0.0.1:5432",
		);
	});
});
