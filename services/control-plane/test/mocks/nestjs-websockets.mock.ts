export const WebSocketGateway = (_options?: any) => (target: any) => target;

export const WebSocketServer = () => (target: any, key: string | symbol) => {};

export const SubscribeMessage = (_message: string) => (_target: any, _key: string, desc: any) =>
  desc;

export const MessageBody = () => (_target: any, _key: string, _idx: number) => {};

export const ConnectedSocket = () => (_target: any, _key: string, _idx: number) => {};

export interface OnGatewayConnection {
  handleConnection(client: any, ...args: any[]): any;
}

export interface OnGatewayDisconnect {
  handleDisconnect(client: any): any;
}

export interface OnGatewayInit {
  afterInit(server: any): any;
}

export class WsException extends Error {
  constructor(public error: string | object) {
    super(typeof error === 'string' ? error : JSON.stringify(error));
  }
}
