import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './app-config/app-config.service';
import { configureCors } from './config/cors.config';
import { configureSwagger } from './config/swagger.config';
import { configureValidationPipe } from './config/validation-pipe.config';

async function bootstrap() {
	const logger = new NestLogger('Bootstrap');

	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		bufferLogs: true,
	});

	app.useLogger(app.get(Logger));
	const configService = app.get(AppConfigService);

	configureValidationPipe(app);
	configureCors(app);

	app.enableShutdownHooks();
	app.setGlobalPrefix('api');

	if (configService.nodeEnv === 'development') {
		configureSwagger(app);
	}

	await app.listen(configService.port);
	logger.log(`API rodando na porta: ${configService.port}`);
}

bootstrap().catch((err) => {
	console.error('Fatal error during bootstrap:', err);
	process.exit(1);
});
