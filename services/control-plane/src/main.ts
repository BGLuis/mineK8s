import * as fs from 'fs';
import * as path from 'path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { AllowedOriginsIoAdapter } from './common/allowed-origins.io-adapter';
import { serveSpa, SPA_HELMET_OPTIONS } from './common/spa-static';
import { AppConfigService } from './config/app-config.service';
import { GATEWAY_GRPC_LOADER_OPTIONS } from './gateway-ipc/grpc-loader-options';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  // Pino logger setup
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.error(
      `Unhandled promise rejection: ${
        reason instanceof Error ? reason.stack : String(reason)
      }`,
    );
  });

  const configService = app.get(AppConfigService);

  // Security headers via Helmet
  app.use(helmet(SPA_HELMET_OPTIONS));

  const webDistDir = configService.webDistDir ?? path.resolve(__dirname, '../../web/dist/web/browser');
  if (serveSpa(app, webDistDir)) {
    logger.log(`Serving the web SPA from ${webDistDir}`);
  } else {
    logger.warn(`No SPA build at ${webDistDir} (set WEB_DIST_DIR); serving the API only`);
  }

  // CORS configuration
  app.enableCors({
    origin: configService.allowedOrigins,
    credentials: true,
  });

  app.useWebSocketAdapter(new AllowedOriginsIoAdapter(app, configService.allowedOrigins));

  // Strict ValidationPipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Swagger OpenAPI documentation
  if (configService.enableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MineKubernetes Control Plane API')
      .setDescription(
        'Declarative Game Server Hypervisor API for Kubernetes orchestration, user onboarding and lifecycle management.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Connect gRPC Microservice for Gateway IPC
  const protoCandidates = [
    path.resolve(process.cwd(), 'proto/gateway_control.proto'),
    path.resolve(__dirname, '../../../proto/gateway_control.proto'),
    path.resolve(__dirname, '../../proto/gateway_control.proto'),
  ];
  const protoPath = protoCandidates.find((p) => fs.existsSync(p)) || protoCandidates[0];

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'minekubernetes.gateway.v1',
      protoPath,
      loader: GATEWAY_GRPC_LOADER_OPTIONS,
      url: `${configService.grpc.host}:${configService.grpc.port}`,
    },
  });

  await app.startAllMicroservices();
  logger.log(
    `Control Plane gRPC IPC listening on ${configService.grpc.host}:${configService.grpc.port}`,
  );

  await app.listen(configService.port);
  logger.log(
    `Control Plane API running on port ${configService.port} (${configService.nodeEnv})`,
  );
}

bootstrap();
