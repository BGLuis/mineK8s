import { parseArgs } from 'node:util';

import { AdminLinkRequest } from './admin-link.service';

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const ADMIN_LINK_USAGE = `Usage: npm run admin:link -- --nick <minecraft-nick> (--tailscale-user-id <id> | --ip <tailnet-ip>) [--force]

  --nick                 Minecraft nickname of the existing user to link
  --tailscale-user-id    Numeric Tailscale user ID to store
  --ip                   Tailnet IP of one of that person's devices; the local tailscaled WhoIs supplies the ID
  --force                Replace a Tailscale ID the user is already linked to`;

export function parseAdminLinkArgs(argv: string[]): AdminLinkRequest | 'help' {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        nick: { type: 'string' },
        'tailscale-user-id': { type: 'string' },
        ip: { type: 'string' },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }

  const { values, positionals } = parsed;
  if (values.help) {
    return 'help';
  }
  if (positionals.length > 0) {
    throw new UsageError(`Unexpected argument "${positionals[0]}"`);
  }
  if (!values.nick) {
    throw new UsageError('--nick is required');
  }
  if (values['tailscale-user-id'] !== undefined && values.ip !== undefined) {
    throw new UsageError('--tailscale-user-id and --ip are mutually exclusive');
  }
  if (!values['tailscale-user-id'] && !values.ip) {
    throw new UsageError('Provide --tailscale-user-id or --ip');
  }

  return {
    nick: values.nick,
    tailscaleUserId: values['tailscale-user-id'],
    ip: values.ip,
    force: values.force,
  };
}
