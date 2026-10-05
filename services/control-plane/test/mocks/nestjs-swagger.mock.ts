export const ApiProperty = (_options?: any) => (_target: any, _key?: string | symbol) => {};
export const ApiPropertyOptional = (_options?: any) => (_target: any, _key?: string | symbol) => {};
export const ApiTags =
  (..._tags: string[]) =>
  (target: any) =>
    target;
export const ApiOperation = (_options: any) => (_target: any, _key?: string, desc?: any) => desc;
export const ApiResponse = (_options: any) => (_target: any, _key?: string, desc?: any) => desc;
export const ApiBearerAuth = () => (target: any) => target;
export const ApiQuery = (_options: any) => (_target: any, _key?: string, desc?: any) => desc;
export const ApiParam = (_options: any) => (_target: any, _key?: string, desc?: any) => desc;
export const ApiConsumes =
  (..._mimeTypes: string[]) =>
  (_target: any, _key?: string, desc?: any) =>
    desc;
export const ApiBody = (_options: any) => (_target: any, _key?: string, desc?: any) => desc;
