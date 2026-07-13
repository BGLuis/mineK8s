import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
	constructor(private configService: ConfigService) {}

	get isProduction(): boolean {
		return this.nodeEnv === 'production';
	}

	get nodeEnv(): string {
		return this.configService.getOrThrow<string>('NODE_ENV');
	}

	get port(): number {
		return this.configService.getOrThrow<number>('PORT');
	}

	get joinPort(): number {
		return this.configService.getOrThrow<number>('JOIN_PORT');
	}

	get backupsHostPath(): string {
		return this.configService.getOrThrow<string>('BACKUPS_HOST_PATH');
	}

	get databaseUrl(): string {
		return this.configService.getOrThrow<string>('DATABASE_URL');
	}

	get cfApiKey(): string {
		return this.configService.get<string>('CF_API_KEY') || '';
	}

	get baseDomain(): string {
		return this.configService.getOrThrow<string>('BASE_DOMAIN');
	}

	get tailscaleTailnet(): string {
		return this.configService.getOrThrow<string>('TAILSCALE_TAILNET');
	}

	get tailscaleApiToken(): string {
		return this.configService.getOrThrow<string>('TAILSCALE_API_TOKEN');
	}

	get tailscaleFunnelHost(): string {
		return this.configService.getOrThrow<string>('TAILSCALE_FUNNEL_HOST');
	}
}
