import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Group } from '../../database/entities/group.entity';
import { Server } from '../../database/entities/server.entity';
import { User } from '../../database/entities/user.entity';
import { UserGroup } from '../../database/entities/user-group.entity';
import { UserServerAccess } from '../../database/entities/user-server-access.entity';
import { GatewayIpcService } from '../../gateway-ipc/gateway-ipc.service';
import { isValidMinecraftNick } from '../decision/nickname-validator';
import { RegisterSharedPlayerDto } from './register-shared-player.dto';

export interface SharedPlayerSummary {
  id: string;
  email: string;
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
  ) {}

  async register(dto: RegisterSharedPlayerDto): Promise<SharedPlayerSummary> {
    const email = dto.email.trim().toLowerCase();
    const groupIds = dto.groupIds ?? [];
    const serverIds = dto.serverIds ?? [];

    if (!isValidMinecraftNick(dto.minecraftNick)) {
      throw new BadRequestException(
        'Nickname must contain 3 to 16 alphanumeric characters or underscores',
      );
    }
    if (await this.userRepo.findOne({ where: { email } })) {
      throw new ConflictException('A player is already registered with this Tailscale e-mail');
    }
    if (await this.userRepo.findOne({ where: { minecraft_nick: dto.minecraftNick } })) {
      throw new ConflictException('Nickname already registered by another player');
    }
    await this.requireAll(groupIds, this.groupRepo, 'Group');
    await this.requireAll(serverIds, this.serverRepo, 'Server');

    const user = await this.userRepo.save(
      this.userRepo.create({
        email,
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
      email,
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
