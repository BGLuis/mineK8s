import { Test, TestingModule } from '@nestjs/testing';
import { GatewayService } from '../gateway/gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
	let service: AdminService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AdminService,
				{
					provide: PrismaService,
					useValue: { server: { findMany: jest.fn() } },
				},
				{
					provide: GatewayService,
					useValue: { checkAuthorization: jest.fn() },
				},
			],
		}).compile();

		service = module.get<AdminService>(AdminService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
