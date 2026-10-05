import * as net from 'node:net';

const RCON_AUTH = 3;
const RCON_EXECCOMMAND = 2;
const RCON_AUTH_RESPONSE = 2;
const RCON_RESPONSE_VALUE = 0;

export const LIST_REPLY = 'There are 0 of a max of 20 players online: ';

const REPLIES: Record<string, string> = {
  list: LIST_REPLY,
  'save-off': 'Automatic saving is now disabled',
  'save-all flush': 'Saved the game',
  'save-on': 'Automatic saving is now enabled',
  stop: 'Stopping the server',
};

function rconPacket(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, 'utf8');
  const packet = Buffer.alloc(14 + payload.length);
  packet.writeInt32LE(10 + payload.length, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  payload.copy(packet, 12);
  return packet;
}

/** Source RCON that accepts any password and answers the vanilla commands the control plane sends. */
export function startRcon(port: number): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= 4 + pending.readInt32LE(0)) {
        const size = pending.readInt32LE(0);
        const id = pending.readInt32LE(4);
        const type = pending.readInt32LE(8);
        const body = pending.subarray(12, 4 + size - 2).toString('utf8');
        pending = pending.subarray(4 + size);
        if (type === RCON_AUTH) {
          socket.write(rconPacket(id, RCON_AUTH_RESPONSE, ''));
        } else if (type === RCON_EXECCOMMAND) {
          socket.write(
            rconPacket(id, RCON_RESPONSE_VALUE, REPLIES[body] ?? `Unknown command: ${body}`),
          );
        }
      }
    });
    socket.on('error', () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function varInt(value: number): Buffer {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

/** Server List Ping status reply, which is what moves a STARTING server to READY in the reconciler. */
export function startSlp(port: number): Promise<net.Server> {
  const status = Buffer.from(
    JSON.stringify({
      version: { name: '1.21.1', protocol: 767 },
      players: { max: 20, online: 0 },
      description: { text: 'mineK8s e2e' },
    }),
    'utf8',
  );
  const payload = Buffer.concat([varInt(0x00), varInt(status.length), status]);
  const reply = Buffer.concat([varInt(payload.length), payload]);

  const server = net.createServer((socket) => {
    socket.once('data', () => socket.end(reply));
    socket.on('error', () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
