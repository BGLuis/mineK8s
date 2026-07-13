import { Controller, Get, Param, Query } from '@nestjs/common';
import { ModpacksService } from './modpacks.service';

@Controller('api/modpacks')
export class ModpacksController {
	constructor(private readonly modpacksService: ModpacksService) {}

	@Get('search')
	async search(
		@Query('q') query: string,
		@Query('limit') limit?: string,
		@Query('source') source?: string,
	) {
		const searchQuery = query || '';
		const limitNumber = limit ? parseInt(limit, 10) : 10;
		return this.modpacksService.searchModpacks(
			searchQuery,
			limitNumber,
			source,
		);
	}

	@Get(':id/versions')
	async getVersions(
		@Param('id') id: string,
		@Query('source') source: string,
	) {
		return await this.modpacksService.getModpackVersions(id, source);
	}
}
