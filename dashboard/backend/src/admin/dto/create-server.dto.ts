import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateServerDto {
	@IsString()
	name: string;

	@IsString()
	subdomain: string;

	@IsString()
	k8sServiceName: string;

	@IsNumber()
	k8sServicePort: number;

	@IsOptional()
	@IsString()
	memoryAllocated?: string;
}
