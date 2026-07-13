const mockKubeConfig = jest.fn().mockImplementation(() => ({
	loadFromDefault: jest.fn(),
	makeApiClient: jest.fn().mockReturnValue({
		listNamespacedPod: jest.fn().mockResolvedValue({ body: { items: [] } }),
		readNamespacedPod: jest.fn().mockResolvedValue({ body: {} }),
		createNamespacedJob: jest.fn().mockResolvedValue({ body: {} }),
		listNamespacedPersistentVolumeClaim: jest
			.fn()
			.mockResolvedValue({ body: { items: [] } }),
	}),
}));

module.exports = {
	KubeConfig: mockKubeConfig,
	CoreV1Api: jest.fn(),
	BatchV1Api: jest.fn(),
	V1Job: class V1Job {},
	Exec: jest.fn().mockImplementation(() => ({
		exec: jest.fn(),
	})),
};
