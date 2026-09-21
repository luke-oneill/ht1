import { Pool, PoolConfig } from "pg";

export type DatabaseEnvironment = NodeJS.ProcessEnv;

const parsePort = (value: string | undefined): number => {
	const port = Number(value ?? "5432");
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`DB_PORT must be a valid TCP port; received ${value}`);
	}
	return port;
};

export const databaseConfig = (environment: DatabaseEnvironment = process.env): PoolConfig => {
	if (environment.DATABASE_URL) {
		return { connectionString: environment.DATABASE_URL };
	}

	return {
		host: environment.DB_HOST ?? "localhost",
		port: parsePort(environment.DB_PORT),
		user: environment.DB_USER ?? "healthtech",
		password: environment.DB_PASSWORD ?? "healthtech",
		database: environment.DB_NAME ?? "healthtech",
	};
};

export const createDatabasePool = (config: PoolConfig = databaseConfig()): Pool => new Pool(config);

const describeConnectionError = (error: unknown): string => {
	if (error instanceof AggregateError) {
		const details = error.errors.map(describeConnectionError).filter(Boolean);
		if (details.length > 0) return details.join("; ");
	}
	if (error instanceof Error) return error.message.trim() || error.name;
	return String(error);
};

export const verifyDatabaseConnection = async (pool: Pick<Pool, "query">): Promise<void> => {
	try {
		await pool.query("SELECT 1");
	} catch (error) {
		const detail = describeConnectionError(error);
		throw new Error(`Database connection failed: ${detail}`, { cause: error });
	}
};
