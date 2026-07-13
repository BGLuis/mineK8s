import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

const request = require('supertest');

import { AdminModule } from '../src/admin/admin.module';
import { GatewayModule } from '../src/gateway/gateway.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Mock Tailscale to avoid network calls during tests
jest.mock('../src/tailscale/tailscale.service', () => ({
	TailscaleService: jest.fn().mockImplementation(() => ({
		getDeviceOwner: jest.fn().mockResolvedValue('test@tailscale.com'),
	})),
}));

describe('AdminController (e2e)', () => {
	let app: INestApplication;
	let prisma: PrismaService;

	beforeAll(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AdminModule, GatewayModule],
		}).compile();

		app = moduleFixture.createNestApplication();
		await app.init();

		prisma = app.get<PrismaService>(PrismaService);
	});

	afterAll(async () => {
		await app.close();
	});

	beforeEach(async () => {
		// Limpa o banco antes de cada teste
		await prisma.serverGroup.deleteMany();
		await prisma.userGroup.deleteMany();
		await prisma.group.deleteMany();
		await prisma.server.deleteMany();
		await prisma.user.deleteMany();
	});

	it('/api/admin/groups (POST) - should create a group', async () => {
		const response = await request(app.getHttpServer())
			.post('/api/admin/groups')
			.send({ name: 'VIP', description: 'Jogadores VIP' })
			.expect(201);

		expect(response.body).toHaveProperty('id');
		expect(response.body.name).toBe('VIP');
	});

	it('/api/admin/users (POST) - should create a user', async () => {
		const response = await request(app.getHttpServer())
			.post('/api/admin/users')
			.send({
				tailscaleUserId: 'user@test.com',
				minecraftNick: 'Player1',
			})
			.expect(201);

		expect(response.body.tailscaleUserId).toBe('user@test.com');
	});

	it('/api/admin/servers (POST) - should create a server', async () => {
		const response = await request(app.getHttpServer())
			.post('/api/admin/servers')
			.send({
				name: 'Survival',
				subdomain: 'survival.mine.test',
				k8sServiceName: 'survival-svc',
				k8sServicePort: 25565,
			})
			.expect(201);

		expect(response.body.name).toBe('Survival');
	});
});
