import { sendNotificationEmail } from "../src/integrations/email-sender";
import { sendEmail } from "../src/supplied/providers/sendgrid";

jest.mock("../src/supplied/providers/sendgrid", () => ({
	sendEmail: jest.fn(),
}));

const message = {
	to: "happyforms@bots.com",
	from: "no-reply@healthtech1.com",
	subject: "Form ingested: FORM-123",
	body: "Form FORM-123 has been ingested and is ready for FORM-BOT.",
};

describe("email sender", () => {
	const mockedSendEmail = jest.mocked(sendEmail);

	beforeEach(() => mockedSendEmail.mockReset());

	it("accepts a successful provider response", async () => {
		mockedSendEmail.mockResolvedValue({ statusCode: 202 });

		await expect(sendNotificationEmail(message)).resolves.toBeUndefined();
		expect(mockedSendEmail).toHaveBeenCalledWith(message);
	});

	it.each([199, 300, 500])("rejects provider status %s", async (statusCode) => {
		mockedSendEmail.mockResolvedValue({ statusCode });

		await expect(sendNotificationEmail(message)).rejects.toThrow(
			`Email delivery failed with status ${statusCode}`,
		);
	});
});
