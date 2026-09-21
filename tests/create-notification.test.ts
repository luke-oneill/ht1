import { createNotification } from "../src/forms/notification/create-notification";

describe("notification message", () => {
	it("contains the application reference without exposing healthcare data", () => {
		const transformedForm = {
			applicationReference: "FORM-123",
			firstName: "Jane",
			email: "jane@example.com",
			dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
		};
		const message = createNotification(transformedForm);

		expect(message).toEqual({
			to: "happyforms@bots.com",
			from: "no-reply@healthtech1.com",
			subject: "Form ingested: FORM-123",
			body: "Form FORM-123 has been ingested and is ready for FORM-BOT.",
		});
		expect(JSON.stringify(message)).not.toContain("Jane");
		expect(JSON.stringify(message)).not.toContain("jane@example.com");
		expect(JSON.stringify(message)).not.toContain("1990-01-01");
	});
});
