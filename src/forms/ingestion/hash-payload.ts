import { createHash } from "node:crypto";

const canonicalize = (value: unknown): string => {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
		.join(",")}}`;
};

export const hashPayload = (payload: Record<string, unknown>): string =>
	createHash("sha256").update(canonicalize(payload)).digest("hex");
