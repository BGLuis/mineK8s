import { IsOptional, IsString } from 'class-validator';

export class CreateGroupDto {
	@IsString()
	name: string;

	@IsOptional()
	@IsString()
	description?: string;
}
