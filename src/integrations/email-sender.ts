import type { SendNotification } from "../forms/contracts/notification-message";
import { sendEmail } from "../supplied/providers/sendgrid";

export const sendNotificationEmail: SendNotification = async (message) => {
	const response = await sendEmail(message);
	if (
		typeof response.statusCode !== "number"
		|| !Number.isInteger(response.statusCode)
		|| response.statusCode < 200
		|| response.statusCode >= 300
	) {
		throw new Error(`Email delivery failed with status ${String(response.statusCode)}`);
	}
};
