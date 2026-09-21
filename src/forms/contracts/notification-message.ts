export type NotificationMessage = {
	to: string;
	from: string;
	subject: string;
	body: string;
};

export type SendNotification = (message: NotificationMessage) => Promise<void>;
