import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

/** Corpo único de erro da API HTTP: a SPA lê `code` e `message` sem heurística. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
};

const MESSAGE_BY_STATUS: Record<number, string> = {
  400: 'Requisição inválida',
  401: 'Autenticação necessária',
  403: 'Você não tem permissão para esta ação',
  404: 'Recurso não encontrado',
  409: 'Conflito com o estado atual do recurso',
  413: 'Arquivo ou corpo da requisição grande demais',
  429: 'Muitas requisições, tente novamente em instantes',
};

/** Textos em inglês que o Nest emite por padrão quando nenhum código passa mensagem própria. */
const NEST_DEFAULT_MESSAGES = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Forbidden resource',
  'Not Found',
  'Conflict',
  'Payload Too Large',
  'Too Many Requests',
]);

const INTERNAL_ERROR: ApiErrorBody = {
  statusCode: 500,
  code: 'INTERNAL_ERROR',
  message: 'Erro interno do servidor',
};

export function toApiError(exception: unknown): ApiErrorBody {
  if (!(exception instanceof HttpException)) {
    return INTERNAL_ERROR;
  }

  const statusCode = exception.getStatus();
  const response = exception.getResponse();
  const raw = typeof response === 'string' ? response : (response as { message?: unknown })?.message;

  if (Array.isArray(raw)) {
    const details = raw.filter((item): item is string => typeof item === 'string');
    return { statusCode, code: 'VALIDATION_ERROR', message: details.join('. '), details };
  }

  const code = CODE_BY_STATUS[statusCode] ?? (statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
  const message =
    typeof raw !== 'string' || !raw.trim() || NEST_DEFAULT_MESSAGES.has(raw) || raw.startsWith('Cannot ')
      ? (MESSAGE_BY_STATUS[statusCode] ?? INTERNAL_ERROR.message)
      : raw;
  return { statusCode, code, message };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      return;
    }
    const body = toApiError(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }
    host.switchToHttp().getResponse().status(body.statusCode).json(body);
  }
}
