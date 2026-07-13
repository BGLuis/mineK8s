import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
	@IsString()
	tailscaleUserId: string;

	@IsOptional()
	@IsEmail()
	email?: string;

	@IsString()
	minecraftNick: string;
}
