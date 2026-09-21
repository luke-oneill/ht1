import type { NotificationMessage } from "../contracts/notification-message";

type NotificationSource = {
	applicationReference: string;
};

export const createNotification = (
	form: NotificationSource,
): NotificationMessage => ({
	to: "happyforms@bots.com",
	from: "no-reply@healthtech1.com",
	subject: `Form ingested: ${form.applicationReference}`,
	body: `Form ${form.applicationReference} has been ingested and is ready for FORM-BOT.`,
});
