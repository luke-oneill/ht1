import type { Coordinates } from "../forms/transformation/transform-form";
import { lookupPostcode } from "../supplied/providers/idealpostcodes";

export class InvalidCoordinatesError extends Error {}

export const parseCoordinates = (value: unknown): Coordinates => {
	if (typeof value !== "object" || value === null) {
		throw new InvalidCoordinatesError("Postcode lookup returned no coordinates");
	}

	const { longitude, latitude } = value as Record<string, unknown>;
	if (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
		throw new InvalidCoordinatesError("Postcode lookup returned an invalid longitude");
	}
	if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
		throw new InvalidCoordinatesError("Postcode lookup returned an invalid latitude");
	}

	return { longitude, latitude };
};

export const geocodePostcode = async (postcode: string): Promise<Coordinates> => {
	const response = await lookupPostcode(postcode);
	if (response.statusCode !== 200 || !response.body) {
		throw new Error(`Postcode lookup failed with status ${response.statusCode}`);
	}

	return parseCoordinates(response.body);
};
