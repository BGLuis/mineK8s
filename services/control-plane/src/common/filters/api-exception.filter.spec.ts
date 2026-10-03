import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { ApiExceptionFilter, toApiError } from './api-exception.filter';

describe('toApiError', () => {
  it('keeps the pt-BR message the service chose and adds a status-based code', () => {
    expect(toApiError(new ConflictException('Nickname já cadastrado'))).toEqual({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Nickname já cadastrado',
    });
  });

  it('flattens class-validator arrays into one message plus the individual details', () => {
    const error = new BadRequestException({ statusCode: 400, message: ['campo A inválido', 'campo B inválido'] });

    expect(toApiError(error)).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'campo A inválido. campo B inválido',
      details: ['campo A inválido', 'campo B inválido'],
    });
  });

  it('replaces the default English texts emitted by Nest', () => {
    expect(toApiError(new ForbiddenException('Forbidden resource')).message).toBe(
      'Você não tem permissão para esta ação',
    );
    expect(toApiError(new NotFoundException('Cannot GET /api/nada')).message).toBe('Recurso não encontrado');
  });

  it('hides the details of unexpected errors', () => {
    expect(toApiError(new Error('connection to db 10.0.0.5 refused'))).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor',
    });
  });
});

describe('ApiExceptionFilter', () => {
  it('writes the unified body with the exception status', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = { getType: () => 'http', switchToHttp: () => ({ getResponse: () => ({ status }) }) };

    new ApiExceptionFilter().catch(new NotFoundException('Servidor não encontrado'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ statusCode: 404, code: 'NOT_FOUND', message: 'Servidor não encontrado' });
  });
});
