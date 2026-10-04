import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplicationContext } from '@nestjs/common';

import { isOriginAllowed } from './allowed-origins';

type IoServerOptions = Parameters<IoAdapter['createIOServer']>[1];

/**
 * Makes the Socket.IO namespaces follow the same ALLOWED_ORIGINS as the REST API. The `cors`
 * option only shapes the HTTP long-polling responses; browsers do not apply CORS to WebSocket
 * upgrades, so `allowRequest` is what actually refuses a foreign Origin on every transport.
 */
export class AllowedOriginsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: IoServerOptions): ReturnType<IoAdapter['createIOServer']> {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.allowedOrigins },
      allowRequest: (req, callback) =>
        callback(null, isOriginAllowed(req.headers.origin, this.allowedOrigins)),
    } as IoServerOptions);
  }
}
