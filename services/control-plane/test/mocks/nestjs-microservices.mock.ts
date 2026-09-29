export const GrpcMethod =
  (_service?: string, _method?: string) =>
  (_target: any, _key: string, desc: any) =>
    desc;

export const GrpcStreamMethod =
  (_service?: string, _method?: string) =>
  (_target: any, _key: string, desc: any) =>
    desc;

export const MessagePattern =
  (_pattern: any) => (_target: any, _key: string, desc: any) =>
    desc;

export const EventPattern =
  (_pattern: any) => (_target: any, _key: string, desc: any) =>
    desc;

export const Payload = () => (_target: any, _key: string, _idx: number) => {};

export const Ctx = () => (_target: any, _key: string, _idx: number) => {};

export enum Transport {
  TCP = 0,
  REDIS = 1,
  NATS = 2,
  MQTT = 3,
  GRPC = 4,
  RMQ = 5,
  KAFKA = 6,
}

export interface MicroserviceOptions {
  transport?: Transport;
  options?: any;
}
