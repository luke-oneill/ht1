import { parseCoordinates } from "../src/integrations/postcode-geocoder";

describe("coordinate validation", () => {
	it("accepts valid coordinates", () => {
		expect(parseCoordinates({ longitude: -0.1, latitude: 51.5 })).toEqual({
			longitude: -0.1,
			latitude: 51.5,
		});
	});

	it.each([
		[{ longitude: Number.NaN, latitude: 51.5 }, "invalid longitude"],
		[{ longitude: 181, latitude: 51.5 }, "invalid longitude"],
		[{ longitude: -0.1, latitude: -91 }, "invalid latitude"],
		[undefined, "no coordinates"],
	])("rejects invalid coordinates %#", (value, message) => {
		expect(() => parseCoordinates(value)).toThrow(message);
	});
});
