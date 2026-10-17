import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AppConfigService } from '@config/app-config.service';
import { Group } from '../../database/entities/group.entity';
import { Server } from '../../database/entities/server.entity';
import { User } from '../../database/entities/user.entity';
import { UserGroup } from '../../database/entities/user-group.entity';
import { UserServerAccess } from '../../database/entities/user-server-access.entity';
import { GatewayIpcService } from '../../gateway-ipc/gateway-ipc.service';
import { isValidMinecraftNick } from '../decision/nickname-validator';
import {
  isValidGithubUsername,
  normalizeGithubUsername,
  RegisterSharedPlayerDto,
} from './register-shared-player.dto';
import { LinkSharedPlayerDto } from './link-shared-player.dto';
import { UnlinkedAttempt, UnlinkedAttemptsService } from './unlinked-attempts.service';

export interface SharedPlayerSummary {
  id: string;
  email: string | null;
  githubUsername: string | null;
  minecraftNick: string;
  realName: string | null;
  groupIds: string[];
  serverIds: string[];
  /** True once the player's Tailscale account has reached the gateway and been tied to this record. */
  linked: boolean;
}

@Injectable()
export class SharesService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    @InjectRepository(UserServerAccess)
    private readonly userServerAccessRepo: Repository<UserServerAccess>,
    private readonly gatewayIpcService: GatewayIpcService,
    private readonly appConfig: AppConfigService,
    private readonly unlinkedAttempts: UnlinkedAttemptsService,
  ) {}

  listUnlinkedAttempts(): UnlinkedAttempt[] {
    return this.unlinkedAttempts.list();
  }

  dismissUnlinkedAttempt(tailscaleUserId: string): void {
    this.unlinkedAttempts.dismiss(tailscaleUserId);
  }

  async linkAttempt(dto: LinkSharedPlayerDto): Promise<SharedPlayerSummary> {
    const user = await this.userRepo.findOne({ where: { id: dto.userId } });
    if (!user) {
      throw new NotFoundException(`Player ${dto.userId} not found`);
    }

    if (user.tailscale_user_id && user.tailscale_user_id !== dto.tailscaleUserId) {
      throw new ConflictException(
        `Player ${user.minecraft_nick} is already linked to another Tailscale account (${user.tailscale_user_id})`,
      );
    }

    const otherUser = await this.userRepo.findOne({
      where: { tailscale_user_id: dto.tailscaleUserId },
    });
    if (otherUser && otherUser.id !== user.id) {
      throw new ConflictException(
        `Tailscale account ${dto.tailscaleUserId} is already linked to player ${otherUser.minecraft_nick}`,
      );
    }

    user.tailscale_user_id = dto.tailscaleUserId;
    const cleanGh = normalizeGithubUsername(dto.githubUsername);
    if (cleanGh && !isValidGithubUsername(cleanGh)) {
      throw new BadRequestException('Invalid GitHub username');
    }
    if (cleanGh && !user.github_username) {
      user.github_username = cleanGh;
    }

    const saved = await this.userRepo.save(user);
    this.unlinkedAttempts.dismiss(dto.tailscaleUserId);

    const [userGroups, userServers] = await Promise.all([
      this.userGroupRepo.find({ where: { user_id: saved.id } }),
      this.userServerAccessRepo.find({ where: { user_id: saved.id } }),
    ]);

    return {
      id: saved.id,
      email: saved.email,
      githubUsername: saved.github_username,
      minecraftNick: saved.minecraft_nick,
      realName: saved.real_name,
      groupIds: userGroups.map((ug) => ug.group_id),
      serverIds: userServers.map((us) => us.server_id),
      linked: Boolean(saved.tailscale_user_id),
    };
  }

  async register(dto: RegisterSharedPlayerDto): Promise<SharedPlayerSummary> {
    if (!this.appConfig.tailscale.nodeSharingEnabled) {
      throw new ForbiddenException({
        code: 'NODE_SHARING_DISABLED',
        message: 'O compartilhamento de nó do Tailscale está desativado nas configurações.',
      });
    }

    const rawEmail = dto.email?.trim().toLowerCase() || null;
    let githubUser = normalizeGithubUsername(dto.github);

    if (dto.github && (!githubUser || !isValidGithubUsername(githubUser))) {
      throw new BadRequestException('Invalid GitHub username');
    }

    if (!githubUser && rawEmail && rawEmail.endsWith('@github')) {
      githubUser = normalizeGithubUsername(rawEmail);
    }

    if (githubUser && !isValidGithubUsername(githubUser)) {
      throw new BadRequestException('Invalid GitHub username');
    }

    if (!rawEmail && !githubUser) {
      throw new BadRequestException('Informe o e-mail ou o usuário do GitHub da conta Tailscale.');
    }

    const groupIds = dto.groupIds ?? [];
    const serverIds = dto.serverIds ?? [];

    if (!isValidMinecraftNick(dto.minecraftNick)) {
      throw new BadRequestException(
        'Nickname must contain 3 to 16 alphanumeric characters or underscores',
      );
    }
    if (rawEmail && (await this.userRepo.findOne({ where: { email: rawEmail } }))) {
      throw new ConflictException('A player is already registered with this Tailscale e-mail');
    }
    if (githubUser && (await this.userRepo.findOne({ where: { github_username: githubUser } }))) {
      throw new ConflictException('A player is already registered with this GitHub username');
    }
    if (await this.userRepo.findOne({ where: { minecraft_nick: dto.minecraftNick } })) {
      throw new ConflictException('Nickname already registered by another player');
    }
    await this.requireAll(groupIds, this.groupRepo, 'Group');
    await this.requireAll(serverIds, this.serverRepo, 'Server');

    const user = await this.userRepo.save(
      this.userRepo.create({
        email: rawEmail,
        github_username: githubUser,
        minecraft_nick: dto.minecraftNick,
        real_name: dto.realName ?? null,
        role: 'PLAYER',
      }),
    );
    for (const group_id of groupIds) {
      await this.userGroupRepo.save(this.userGroupRepo.create({ user_id: user.id, group_id }));
    }
    for (const server_id of serverIds) {
      await this.userServerAccessRepo.save(
        this.userServerAccessRepo.create({ user_id: user.id, server_id }),
      );
    }

    return {
      id: user.id,
      email: user.email,
      githubUsername: user.github_username,
      minecraftNick: user.minecraft_nick,
      realName: user.real_name,
      groupIds,
      serverIds,
      linked: false,
    };
  }

  /** Cuts the player's open sessions first: deleting the record alone would leave them playing. */
  async remove(userId: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Player ${userId} not found`);
    }
    if (user.role === 'ADMIN') {
      throw new ConflictException('Administrators cannot be removed as shared players');
    }

    await this.gatewayIpcService.revokePlayerSession({
      server_id: '',
      client_ip: '',
      minecraft_nick: user.minecraft_nick,
      reason_message: 'Acesso removido pelo administrador.',
    });
    await this.userRepo.remove(user);
  }

  private async requireAll(
    ids: string[],
    repo: Repository<Group> | Repository<Server>,
    label: string,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const found = await (repo as Repository<{ id: string }>).find({ where: { id: In(ids) } });
    if (found.length !== new Set(ids).size) {
      throw new NotFoundException(`${label} not found`);
    }
  }
}
