import { IngestionRepository, IngestionService } from "../src/application/ingestion-service";

describe("IngestionService", () => {
	it("creates and persists a received ingestion before returning its receipt", async () => {
		const repository: jest.Mocked<IngestionRepository> = {
			createReceived: jest.fn().mockResolvedValue(undefined),
		};
		const service = new IngestionService(repository);
		const payload = { application_reference: "APP-1" };

		const receipt = await service.receive(payload);

		expect(receipt).toEqual({
			ingestionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
			status: "received",
		});
		expect(repository.createReceived).toHaveBeenCalledWith({
			id: receipt.ingestionId,
			payload,
			status: "received",
		});
	});

	it("does not return a receipt when persistence fails", async () => {
		const repository: jest.Mocked<IngestionRepository> = {
			createReceived: jest.fn().mockRejectedValue(new Error("database unavailable")),
		};
		const service = new IngestionService(repository);

		await expect(service.receive({ data: true })).rejects.toThrow("database unavailable");
	});
});
