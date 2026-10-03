import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { AppConfigService } from '@config/app-config.service';
import { User } from '@database/entities/user.entity';

import { BootstrapAdminDTO } from './dto/bootstrap-admin.dto';
import { LoginDTO } from './dto/login.dto';
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

  async bootstrapAdmin(dto: BootstrapAdminDTO) {
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
      message: 'Administrador configurado com sucesso',
      user: saved,
      access_token: token,
    };
  }

  async login(dto: LoginDTO) {
    const user = await this.userRepository.findOne({
      where: { minecraft_nick: dto.minecraft_nick },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials: user not found');
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
}
