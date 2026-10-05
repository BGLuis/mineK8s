import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { ADMIN_LINK_USAGE, parseAdminLinkArgs, UsageError } from './admin-link.args';
import { AdminLinkModule } from './admin-link.module';
import { AdminLinkError, AdminLinkResult, AdminLinkService } from './admin-link.service';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

function describeResult(result: AdminLinkResult): string {
  const { nick, tailscaleUserId, previousTailscaleUserId } = result;
  switch (result.outcome) {
    case 'linked':
      return `Linked "${nick}" to Tailscale user ID ${tailscaleUserId}.`;
    case 'replaced':
      return `Replaced the link of "${nick}": Tailscale user ID ${previousTailscaleUserId} -> ${tailscaleUserId}.`;
    case 'unchanged':
      return `"${nick}" is already linked to Tailscale user ID ${tailscaleUserId}; nothing changed.`;
  }
}

async function main(): Promise<number> {
  let request;
  try {
    request = parseAdminLinkArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}\n\n${ADMIN_LINK_USAGE}`);
      return EXIT_USAGE;
    }
    throw err;
  }
  if (request === 'help') {
    console.log(ADMIN_LINK_USAGE);
    return 0;
  }

  const app = await NestFactory.createApplicationContext(AdminLinkModule, {
    logger: ['error', 'warn'],
  });
  try {
    console.log(describeResult(await app.get(AdminLinkService).link(request)));
    return 0;
  } catch (err) {
    if (err instanceof AdminLinkError) {
      console.error(`Error: ${err.message}`);
      return EXIT_FAILURE;
    }
    throw err;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = EXIT_FAILURE;
  },
);
