import { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';
import { AppConfigModule } from '../app-config/app-config.module';
import { AppConfigService } from '../app-config/app-config.service';

@Module({
	imports: [
		LoggerModule.forRootAsync({
			imports: [AppConfigModule],
			inject: [AppConfigService],
			useFactory: (config: AppConfigService) => {
				const isProduction = config.nodeEnv === 'production';

				return {
					pinoHttp: {
						level: isProduction ? 'info' : 'debug',
						genReqId: (req: IncomingMessage) => {
							const headers = req.headers;
							return (
								(headers['x-correlation-id'] as string) ||
								(headers['x-request-id'] as string) ||
								uuidv7()
							);
						},
						transport: isProduction
							? undefined
							: {
									target: 'pino-pretty',
									options: {
										colorize: true,
										translateTime: 'SYS:HH:MM:ss.l',
										ignore: 'pid,hostname',
										singleLine: false,
										messageFormat: '[{context}] {msg}',
									},
								},
						customLogLevel: (
							_req: IncomingMessage,
							res: ServerResponse,
							error?: Error,
						) => {
							if (res.statusCode >= 400 && res.statusCode < 500) {
								return 'warn';
							}
							if (res.statusCode >= 500 || error) {
								return 'error';
							}
							if (res.statusCode >= 300 && res.statusCode < 400) {
								return 'silent';
							}
							return 'info';
						},
						base: {
							app: 'minekube-backend',
							environment: config.nodeEnv,
							pid: process.pid,
						},
					},
				};
			},
		}),
	],
	exports: [LoggerModule],
})
export class LoggingModule {}
