export const Injectable = () => (target: any) => target;
export const Module = (_options?: any) => (target: any) => target;
export const Global = () => (target: any) => target;
export const Controller = (_path?: string) => (target: any) => target;
export const Get = (_path?: string) => (_target: any, _key: string, desc: any) => desc;
export const Post = (_path?: string) => (_target: any, _key: string, desc: any) => desc;
export const Put = (_path?: string) => (_target: any, _key: string, desc: any) => desc;
export const Delete = (_path?: string) => (_target: any, _key: string, desc: any) => desc;
export const Patch = (_path?: string) => (_target: any, _key: string, desc: any) => desc;
export const Body = () => (_target: any, _key: string, _idx: number) => {};
export const Param = () => (_target: any, _key: string, _idx: number) => {};
export const Query = () => (_target: any, _key: string, _idx: number) => {};
export const UseGuards = () => (_target: any, _key?: string, desc?: any) => desc || _target;
export const SetMetadata = (_key: any, _val: any) => (_target: any, _keyName?: string, desc?: any) => desc || _target;

export class Logger {
  constructor(private context?: string) {}
  log(msg: any, ...args: any[]) {}
  error(msg: any, ...args: any[]) {}
  warn(msg: any, ...args: any[]) {}
  debug(msg: any, ...args: any[]) {}
}

export class HttpException extends Error {
  constructor(public response: string | object, public status: number) {
    super(typeof response === 'string' ? response : JSON.stringify(response));
  }
  getStatus() {
    return this.status;
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'Not Found') {
    super(message, 404);
  }
}

export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request') {
    super(message, 400);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ValidationPipe {
  constructor(public options?: any) {}
}

export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
};
