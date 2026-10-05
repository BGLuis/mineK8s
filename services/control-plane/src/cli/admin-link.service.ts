import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';

import { User } from '@database/entities/user.entity';

import { TailscaleLocalDriver } from '../tailscale/drivers/tailscale-local.driver';

const UNIQUE_VIOLATION = '23505';

export class AdminLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminLinkError';
  }
}

export interface AdminLinkRequest {
  nick: string;
  /** Exactly one of `tailscaleUserId` and `ip` is expected. */
  tailscaleUserId?: string;
  ip?: string;
  force?: boolean;
}

export interface AdminLinkResult {
  outcome: 'linked' | 'unchanged' | 'replaced';
  nick: string;
  tailscaleUserId: string;
  previousTailscaleUserId: string | null;
}

/**
 * Binds an existing user to a Tailscale account so `POST /api/auth/session` can recognise them.
 * Every check runs before the single write, so a refused request leaves the database untouched.
 */
@Injectable()
export class AdminLinkService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly tailscaleDriver: TailscaleLocalDriver,
  ) {}

  async link(request: AdminLinkRequest): Promise<AdminLinkResult> {
    if (!!request.tailscaleUserId === !!request.ip) {
      throw new AdminLinkError('Provide exactly one of --tailscale-user-id and --ip');
    }

    const user = await this.userRepository.findOne({ where: { minecraft_nick: request.nick } });
    if (!user) {
      throw new AdminLinkError(`No user with Minecraft nickname "${request.nick}"`);
    }

    const tailscaleUserId = request.ip
      ? await this.resolveFromWhoIs(request.ip)
      : this.validateTailscaleUserId(request.tailscaleUserId as string);

    const holders = await this.userRepository.find({
      where: { tailscale_user_id: tailscaleUserId },
    });
    const otherHolder = holders.find((holder) => holder.id !== user.id);
    if (otherHolder) {
      throw new AdminLinkError(
        `Tailscale user ID ${tailscaleUserId} is already linked to "${otherHolder.minecraft_nick}"; one Tailscale account maps to one user`,
      );
    }

    const previous = user.tailscale_user_id;
    if (previous === tailscaleUserId) {
      return {
        outcome: 'unchanged',
        nick: user.minecraft_nick,
        tailscaleUserId,
        previousTailscaleUserId: previous,
      };
    }
    if (previous && !request.force) {
      throw new AdminLinkError(
        `"${user.minecraft_nick}" is already linked to Tailscale user ID ${previous}; pass --force to replace it`,
      );
    }

    try {
      await this.userRepository.update({ id: user.id }, { tailscale_user_id: tailscaleUserId });
    } catch (err) {
      // The check above can lose a race against a concurrent link or a manual SQL write; the unique index settles it.
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string })?.code === UNIQUE_VIOLATION
      ) {
        throw new AdminLinkError(
          `Tailscale user ID ${tailscaleUserId} was linked to another user while this command ran; one Tailscale account maps to one user`,
        );
      }
      throw err;
    }
    return {
      outcome: previous ? 'replaced' : 'linked',
      nick: user.minecraft_nick,
      tailscaleUserId,
      previousTailscaleUserId: previous,
    };
  }

  /** Tailscale user IDs are int64; anything else (a login name, say) would link an account nobody can sign in as. */
  private validateTailscaleUserId(value: string): string {
    if (!/^\d{1,100}$/.test(value)) {
      throw new AdminLinkError(
        `"${value}" is not a Tailscale user ID: expected the numeric ID, not the login name`,
      );
    }
    return value;
  }

  private async resolveFromWhoIs(ip: string): Promise<string> {
    if (isIP(ip) === 0) {
      throw new AdminLinkError(`"${ip}" is not a valid IP address`);
    }

    let identity;
    try {
      identity = await this.tailscaleDriver.queryWhoIs(ip);
    } catch (err) {
      throw new AdminLinkError(
        `Tailscale WhoIs failed for ${ip}: ${(err as Error).message} (is tailscaled running on this host, and is TAILSCALE_SOCKET_PATH right?)`,
      );
    }
    if (!identity?.userId) {
      throw new AdminLinkError(`${ip} does not belong to the tailnet: WhoIs returned no user`);
    }
    // A tagged node reports the shared "tagged-devices" owner, not a person; linking it would
    // hand the account to every device carrying the tag.
    if (!identity.isOwner) {
      throw new AdminLinkError(
        `${ip} is a tagged device (${identity.tags.join(', ')}) and has no personal Tailscale account to link`,
      );
    }
    return identity.userId;
  }
}
