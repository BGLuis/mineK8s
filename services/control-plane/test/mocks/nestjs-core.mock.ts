export class Reflector {
  getAllAndOverride<T>(_metadataKey: any, _targets: any[]): T {
    return null as any;
  }

  get<T>(_metadataKey: any, _target: any): T {
    return null as any;
  }
}

export const APP_GUARD = 'APP_GUARD';

export class NestFactory {
  static async create(..._args: any[]): Promise<any> {
    return {
      useLogger: () => {},
      use: () => {},
      enableCors: () => {},
      useGlobalPipes: () => {},
      listen: async () => {},
      get: () => ({ log: () => {}, error: () => {} }),
    };
  }
}
