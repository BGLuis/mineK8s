import { HttpService } from '@nestjs/axios';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { ModpacksService } from './modpacks.service';

describe('ModpacksService', () => {
	let service: ModpacksService;
	let httpService: HttpService;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ModpacksService,
				{
					provide: HttpService,
					useValue: {
						get: jest.fn(),
					},
				},
			],
		}).compile();

		service = module.get<ModpacksService>(ModpacksService);
		httpService = module.get<HttpService>(HttpService);
	});

	it('should return mapped modpacks', async () => {
		const mockResponse = {
			data: {
				total_hits: 1,
				hits: [
					{
						project_id: 'test_id',
						title: 'Test Modpack',
						description: 'A test modpack',
						author: 'author',
						downloads: 100,
					},
				],
			},
		};

		jest.spyOn(httpService, 'get').mockReturnValueOnce(
			of(mockResponse as any),
		);

		const result = await service.searchModpacks('test');

		expect(result).toBeDefined();
		expect(result.total).toBe(1);
		expect(result.results[0].id).toBe('test_id');
		expect(result.results[0].title).toBe('Test Modpack');
	});
});
