export class ConfigService {
  constructor(private internalConfig: Record<string, any> = {}) {}

  get<T = any>(propertyPath: string, defaultValue?: T): T {
    const val =
      this.internalConfig[propertyPath] !== undefined
        ? this.internalConfig[propertyPath]
        : process.env[propertyPath];

    if (val === undefined || val === null || val === '') {
      return defaultValue as T;
    }

    if (typeof defaultValue === 'number' && typeof val === 'string') {
      const num = Number(val);
      return (isNaN(num) ? defaultValue : num) as T;
    }

    if (typeof defaultValue === 'boolean' && typeof val === 'string') {
      return (val === 'true' || val === '1') as T;
    }

    return val as T;
  }
}

export class ConfigModule {
  static forRoot(_options?: any) {
    return {
      module: ConfigModule,
      providers: [ConfigService],
      exports: [ConfigService],
    };
  }
}
