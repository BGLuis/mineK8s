import {
	Controller,
	HttpException,
	HttpStatus,
	Param,
	Post,
} from '@nestjs/common';
import { BackupsService } from './backups.service';

@Controller('backups')
export class BackupsController {
	constructor(private readonly backupsService: BackupsService) {}

	@Post(':serverId')
	async createBackup(@Param('serverId') serverId: string) {
		try {
			await this.backupsService.createBackupJob(serverId);
			return {
				message: `Backup job for server ${serverId} successfully initiated.`,
			};
		} catch (err) {
			const error = err as Error;
			throw new HttpException(
				`Failed to create backup job: ${error.message}`,
				HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}
}
