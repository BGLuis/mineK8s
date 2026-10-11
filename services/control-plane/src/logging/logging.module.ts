import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { AppConfigModule } from '../config/app-config.module';
import { K8sLogStreamerService } from './k8s-log-streamer.service';
import { redactBody } from './redact';

const SAFE_HEADERS = new Set([
  'host',
  'user-agent',
  'content-type',
  'content-length',
  'referer',
  'x-request-id',
  'x-correlation-id',
  'x-tailscale-user',
]);

function pickHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k] = SAFE_HEADERS.has(k.toLowerCase()) ? v : '[Redacted]';
  }
  return out;
}

interface PinoRequest extends IncomingMessage {
  id: string;
  method: string;
  url: string;
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  headers: IncomingHttpHeaders;
  raw?: { body?: unknown };
  body?: unknown;
  remoteAddress: string;
  remotePort: number;
}

interface PinoError extends Error {
  type: string;
  stack: string;
  code: string;
  statusCode: number;
}

const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProduction ? 'info' : 'debug',
        genReqId: (req: IncomingMessage) => {
          const headers = req.headers;
          return (
            (headers['x-correlation-id'] as string) ||
            (headers['x-request-id'] as string) ||
            uuidv4()
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
        serializers: {
          req: (req: PinoRequest) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            query: req.query,
            params: req.params,
            headers: pickHeaders(req.headers as Record<string, unknown>),
            body: redactBody(req.raw?.body || req.body),
            remoteAddress: req.remoteAddress,
            remotePort: req.remotePort,
          }),
          res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
          err: (err: PinoError) => ({
            type: err.type,
            message: err.message,
            stack: err.stack,
            code: err.code,
            statusCode: err.statusCode,
          }),
        },
        customLogLevel: (_req: IncomingMessage, res: ServerResponse, error?: Error) => {
          if (res.statusCode >= 500 || error) return 'error';
          if (res.statusCode >= 400) return 'warn';
          if (res.statusCode >= 300) return 'silent';
          return 'info';
        },
        timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
        autoLogging: {
          ignore: (req: IncomingMessage) =>
            (req.url || '').startsWith('/health') || (req.url || '').startsWith('/metrics'),
        },
      },
    }),
  ],
  providers: [K8sLogStreamerService],
  exports: [LoggerModule, K8sLogStreamerService],
})
export class LoggingModule {}
