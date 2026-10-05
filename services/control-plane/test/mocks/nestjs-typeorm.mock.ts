export const InjectRepository =
  (_entity?: any) => (_target: any, _key?: string | symbol, _index?: number) => {};

export class TypeOrmModule {
  static forRootAsync(_options?: any) {
    return {
      module: TypeOrmModule,
    };
  }

  static forFeature(_entities?: any[]) {
    return {
      module: TypeOrmModule,
    };
  }
}
