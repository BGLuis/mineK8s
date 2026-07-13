import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './app-config/app-config.service';
import { configureSwagger } from './config/swagger.config';

async function bootstrap() {
	const app = await NestFactory.create(AppModule, { bufferLogs: true });

	// Configura validação global de DTOs
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true, // Remove propriedades que não estão no DTO
			forbidNonWhitelisted: true, // Retorna erro se enviar propriedades extras
			transform: true, // Transforma os payloads automaticamente nas instâncias dos DTOs
			transformOptions: {
				enableImplicitConversion: true, // Converte tipos primitivos automaticamente
			},
		}),
	);

	app.useLogger(app.get(Logger));
	configureSwagger(app);

	const appConfig = app.get(AppConfigService);
	app.enableCors();
	await app.listen(appConfig.port);
}
bootstrap();
