import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { ApiExceptionFilter, toApiError } from './api-exception.filter';

describe('toApiError', () => {
  it('keeps the message the service chose and adds a status-based code', () => {
    expect(toApiError(new ConflictException('Nickname already registered'))).toEqual({
      statusCode: 409,
      code: 'CONFLICT',
      message: 'Nickname already registered',
    });
  });

  it('uses the code fixed by the service instead of the status-based one', () => {
    const error = new BadRequestException({
      code: 'INVITE_EXPIRED',
      message: 'This invite has expired',
    });

    expect(toApiError(error)).toEqual({
      statusCode: 400,
      code: 'INVITE_EXPIRED',
      message: 'This invite has expired',
    });
  });

  it('flattens class-validator arrays into one message plus the individual details', () => {
    const error = new BadRequestException({
      statusCode: 400,
      message: ['field A is invalid', 'field B is invalid'],
    });

    expect(toApiError(error)).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'field A is invalid. field B is invalid',
      details: ['field A is invalid', 'field B is invalid'],
    });
  });

  it('replaces the generic texts emitted by Nest', () => {
    expect(toApiError(new ForbiddenException('Forbidden resource')).message).toBe(
      'You do not have permission to perform this action',
    );
    expect(toApiError(new NotFoundException('Cannot GET /api/nada')).message).toBe(
      'Resource not found',
    );
  });

  it('hides the details of unexpected errors', () => {
    expect(toApiError(new Error('connection to db 10.0.0.5 refused'))).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });
});

describe('ApiExceptionFilter', () => {
  it('writes the unified body with the exception status', () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = {
      getType: () => 'http',
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    };

    new ApiExceptionFilter().catch(new NotFoundException('Server not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Server not found',
    });
  });
});
