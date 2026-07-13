import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ModpacksController } from './modpacks.controller';
import { ModpacksService } from './modpacks.service';

describe('ModpacksController', () => {
	let controller: ModpacksController;
	let service: ModpacksService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ModpacksController],
			providers: [
				{
					provide: ModpacksService,
					useValue: {
						searchModpacks: jest
							.fn()
							.mockResolvedValue({ total: 1, results: [] }),
					},
				},
			],
		}).compile();

		controller = module.get<ModpacksController>(ModpacksController);
		service = module.get<ModpacksService>(ModpacksService);
	});

	it('should call service with correct query', async () => {
		await controller.search('fabric', '5');
		expect(service.searchModpacks).toHaveBeenCalledWith('fabric', 5);
	});

	it('should throw BadRequestException if query is empty', async () => {
		await expect(controller.search('', '10')).rejects.toThrow(
			BadRequestException,
		);
	});
});
