import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AppConfigService } from '@config/app-config.service';
import { User } from '@database/entities/user.entity';

import { TailscaleLocalDriver } from '../tailscale/drivers/tailscale-local.driver';
import { BootstrapAdminDTO } from './dto/bootstrap-admin.dto';
import { JwtService } from './jwt.service';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private activeBootstrapToken: string | null = null;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigService,
    private readonly tailscaleDriver: TailscaleLocalDriver,
  ) {}

  async onModuleInit() {
    await this.checkAndInitializeBootstrapToken();
  }

  public async checkAndInitializeBootstrapToken(): Promise<string | null> {
    try {
      const adminCount = await this.userRepository.count({
        where: { role: 'ADMIN' },
      });

      if (adminCount === 0) {
        const configuredToken = this.configService.jwt.initialBootstrapToken;
        this.activeBootstrapToken =
          configuredToken && configuredToken.trim().length > 0
            ? configuredToken.trim()
            : uuidv4();

        this.logger.warn(
          `[SECURITY ALERT] No administrator found! INITIAL_BOOTSTRAP_TOKEN is: ${this.activeBootstrapToken}`,
        );
        this.logger.warn(
          `Execute POST /api/auth/bootstrap with this token to configure the primary administrator.`,
        );
        return this.activeBootstrapToken;
      }

      this.activeBootstrapToken = null;
      return null;
    } catch {
      // In tests without active database connection, fallback
      return null;
    }
  }

  public getActiveBootstrapToken(): string | null {
    return this.activeBootstrapToken;
  }

  public setBootstrapTokenForTesting(token: string | null) {
    this.activeBootstrapToken = token;
  }

  async bootstrapAdmin(dto: BootstrapAdminDTO, clientIp: string | null = null) {
    if (!this.activeBootstrapToken || this.activeBootstrapToken !== dto.bootstrap_token) {
      throw new UnauthorizedException('Invalid or expired bootstrap token');
    }

    const existingNick = await this.userRepository.findOne({
      where: { minecraft_nick: dto.minecraft_nick },
    });
    if (existingNick) {
      throw new ConflictException('Minecraft nickname is already registered');
    }

    const admin = this.userRepository.create({
      minecraft_nick: dto.minecraft_nick,
      email: dto.email || null,
      real_name: dto.real_name || null,
      tailscale_user_id: await this.findTailscaleUserId(clientIp),
      role: 'ADMIN',
    });

    const saved = await this.userRepository.save(admin);
    // Invalidate token after first successful use
    this.activeBootstrapToken = null;
    this.logger.log(`Primeiro administrador [${saved.minecraft_nick}] registrado com sucesso.`);

    const token = this.jwtService.sign({
      sub: saved.id,
      nick: saved.minecraft_nick,
      role: saved.role,
    });

    return {
      message: 'Administrator configured successfully',
      user: saved,
      access_token: token,
    };
  }

  /**
   * Opens a panel session for whoever the Tailscale daemon says owns `clientIp`. The identity
   * comes from the network, never from the request body.
   */
  async createSession(clientIp: string | null) {
    const identity = clientIp ? await this.queryWhoIs(clientIp) : null;
    if (!identity?.userId) {
      throw new UnauthorizedException('This address does not belong to the tailnet');
    }
    // Every tagged node reports the same "tagged-devices" owner, so its userId names no person: a user
    // linked to it would be shared by every server and gateway on the tailnet.
    if (!identity.isOwner) {
      throw new UnauthorizedException('Tagged devices cannot open a panel session; sign in from a personal device');
    }

    const user = await this.validateTailscaleUser(identity.userId);
    if (!user) {
      throw new UnauthorizedException('No account is linked to this Tailscale identity');
    }

    const token = this.jwtService.sign({
      sub: user.id,
      nick: user.minecraft_nick,
      role: user.role,
    });

    return {
      access_token: token,
      user,
    };
  }

  async validateUserById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async validateTailscaleUser(tailscaleUserId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { tailscale_user_id: tailscaleUserId },
    });
  }

  private async queryWhoIs(clientIp: string) {
    try {
      return await this.tailscaleDriver.queryWhoIs(clientIp);
    } catch (err) {
      this.logger.warn(`Tailscale WhoIs failed for ${clientIp}: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Tailscale identity lookup is unavailable');
    }
  }

  /** Links the first admin to the Tailscale account it is bootstrapped from, so the VPN login works. */
  private async findTailscaleUserId(clientIp: string | null): Promise<string | null> {
    if (!clientIp) {
      return null;
    }
    try {
      const identity = await this.tailscaleDriver.queryWhoIs(clientIp);
      if (identity && !identity.isOwner) {
        this.logger.warn(`Admin bootstrapped without a Tailscale link: ${clientIp} is a tagged device`);
        return null;
      }
      return identity?.userId || null;
    } catch (err) {
      this.logger.warn(
        `Admin bootstrapped without a Tailscale link, WhoIs failed for ${clientIp}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
