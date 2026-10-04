import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Group } from '../database/entities/group.entity';
import { User } from '../database/entities/user.entity';
import { Server } from '../database/entities/server.entity';
import { UserGroup } from '../database/entities/user-group.entity';
import { ServerGroup } from '../database/entities/server-group.entity';
import { UserServerAccess } from '../database/entities/user-server-access.entity';
import { effectiveAccessPolicy } from '../tailscale/decision/effective-access-policy';
import { AccessDecisionEngineService } from '../tailscale/decision/access-decision-engine.service';
import { GatewayIpcService } from '../gateway-ipc/gateway-ipc.service';
import { MinecraftRconConsoleDriver } from '../console/minecraft-rcon-console.driver';
import { CreateGroupDto } from './dto/create-group.dto';
import { SmartKickDto } from './dto/smart-kick.dto';
import { AccessibleServerDto, UserSummaryDto } from './dto/user-summary.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    @InjectRepository(ServerGroup)
    private readonly serverGroupRepo: Repository<ServerGroup>,
    @InjectRepository(UserServerAccess)
    private readonly userServerAccessRepo: Repository<UserServerAccess>,
    private readonly accessDecisionEngine: AccessDecisionEngineService,
    private readonly gatewayIpcService: GatewayIpcService,
    private readonly consoleDriver: MinecraftRconConsoleDriver,
  ) {}

  /**
   * Cria um novo grupo de acesso (RF-ARQ-20).
   */
  async createGroup(dto: CreateGroupDto): Promise<Group> {
    const existing = await this.groupRepo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Group named "${dto.name}" already exists`);
    }

    const group = this.groupRepo.create({
      name: dto.name,
      description: dto.description,
    });
    return this.groupRepo.save(group);
  }

  /**
   * Lista os usuários com papel, dispositivos e grupos para o editor de grupos da SPA.
   */
  async listUsers(): Promise<UserSummaryDto[]> {
    const users = await this.userRepo.find({
      relations: ['devices', 'user_groups'],
      order: { minecraft_nick: 'ASC' },
    });

    return users.map((user) => ({
      id: user.id,
      minecraftNick: user.minecraft_nick,
      realName: user.real_name,
      role: user.role,
      devices: (user.devices || []).map((device) => ({
        id: device.id,
        deviceName: device.device_name,
        status: device.status,
        lastSeenAt: device.last_seen_at,
      })),
      groupIds: (user.user_groups || []).map((ug) => ug.group_id),
    }));
  }

  /**
   * Servidores em que o usuário pode estar conectado, pelas mesmas regras de acesso que o gateway aplica.
   */
  async listAccessibleServers(userId: string): Promise<AccessibleServerDto[]> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [servers, serverGroups, userGroups, userAccesses] = await Promise.all([
      this.serverRepo.find({ order: { name: 'ASC' } }),
      this.serverGroupRepo.find(),
      this.userGroupRepo.find({ where: { user_id: userId } }),
      this.userServerAccessRepo.find({ where: { user_id: userId } }),
    ]);

    const groupIds = userGroups.map((ug) => ug.group_id);
    const directServerIds = new Set(userAccesses.map((ua) => ua.server_id));

    return servers
      .filter(
        (server) =>
          this.accessDecisionEngine.evaluateAccess(
            { userId: user.id, role: user.role, groupIds, isActive: true },
            {
              serverId: server.id,
              policy: effectiveAccessPolicy(server),
              allowedGroupIds: serverGroups.filter((sg) => sg.server_id === server.id).map((sg) => sg.group_id),
              allowedUserIds: directServerIds.has(server.id) ? [user.id] : [],
            },
          ).allowed,
      )
      .map((server) => ({
        id: server.id,
        name: server.name,
        subdomain: server.subdomain,
        state: server.state,
      }));
  }

  /**
   * Lista todos os grupos cadastrados.
   */
  async listGroups(): Promise<Group[]> {
    return this.groupRepo.find({
      relations: ['user_groups', 'server_groups'],
      order: { created_at: 'ASC' },
    });
  }

  /**
   * Remove um grupo de acesso.
   */
  async deleteGroup(id: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id } });
    if (!group) {
      throw new NotFoundException(`Group with ID "${id}" not found`);
    }
    await this.groupRepo.delete({ id });
  }

  /**
   * Adiciona um usuário a um grupo (RF-ARQ-20).
   */
  async addUserToGroup(groupId: string, userId: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.userGroupRepo.findOne({
      where: { group_id: groupId, user_id: userId },
    });
    if (!existing) {
      await this.userGroupRepo.save(
        this.userGroupRepo.create({ group_id: groupId, user_id: userId }),
      );
    }
  }

  /**
   * Remove um usuário do grupo e dispara Smart Kick caso perca o acesso a servidores ativos (RF-ARQ-20, RF-TS-09, Critério de Aceite).
   */
  async removeUserFromGroup(groupId: string, userId: string): Promise<{ kickedServers: string[] }> {
    const userGroup = await this.userGroupRepo.findOne({
      where: { group_id: groupId, user_id: userId },
    });

    if (!userGroup) {
      return { kickedServers: [] };
    }

    // 1. Remove o vínculo relacional do usuário com o grupo
    await this.userGroupRepo.delete({ group_id: groupId, user_id: userId });

    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['user_groups', 'server_accesses'],
    });

    if (!user) {
      return { kickedServers: [] };
    }

    // 2. Localiza todos os servidores vinculados a este grupo
    const serverGroups = await this.serverGroupRepo.find({
      where: { group_id: groupId },
    });

    const remainingGroupIds = (user.user_groups || [])
      .map((ug) => ug.group_id)
      .filter((g) => g !== groupId);

    const kickedServers: string[] = [];

    // 3. Para cada servidor, verifica se o usuário perdeu o acesso total
    for (const sg of serverGroups) {
      const server = await this.serverRepo.findOne({
        where: { id: sg.server_id },
        relations: ['server_groups', 'minecraft_settings'],
      });

      if (!server) continue;

      const userContext = {
        userId: user.id,
        role: user.role,
        groupIds: remainingGroupIds,
        isTailscaleOwner: false,
        isActive: true,
      };

      const serverContext = {
        serverId: server.id,
        policy: server.access_policy || 'GROUP',
        allowedGroupIds: (server.server_groups || []).map((g) => g.group_id),
        allowedUserIds: (user.server_accesses || []).map((sa) => sa.user_id),
        isMaintenance: Boolean(server.is_maintenance),
      };

      const decision = this.accessDecisionEngine.evaluateAccess(userContext, serverContext);

      // Se não é mais permitido acessar este servidor, executa Smart Kick imediato (RF-TS-09 Nível 1)
      if (!decision.allowed) {
        this.logger.log(
          `Smart Kick disparado: Usuário ${user.minecraft_nick} perdeu acesso ao servidor ${server.id} (${decision.reason})`,
        );

        const kickReason = '§cPermissão revogada pelo administrador.';

        // Lado A: RCON kick no Minecraft JVM (E-06 compressão tratada nativamente pelo servidor)
        try {
          await this.consoleDriver.sendCommand(
            server,
            `kick ${user.minecraft_nick} Permissao revogada pelo administrador`,
          );
        } catch (rconErr: any) {
          this.logger.debug(
            `RCON kick não enviado (servidor pode estar offline/hibernado): ${rconErr.message}`,
          );
        }

        // Lado B: gRPC IPC no Gateway L7 para derrubar socket do proxy se ativo
        try {
          await this.gatewayIpcService.revokePlayerSession({
            server_id: server.id,
            client_ip: '',
            minecraft_nick: user.minecraft_nick,
            reason_message: kickReason,
          });
        } catch (ipcErr: any) {
          this.logger.warn(`Falha ao revogar a sessão no Gateway via IPC: ${ipcErr.message}`);
        }

        kickedServers.push(server.id);
      }
    }

    return { kickedServers };
  }

  /**
   * Associa um servidor a um grupo de acesso (RF-ARQ-20).
   */
  async addServerToGroup(groupId: string, serverId: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Group not found');

    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) throw new NotFoundException('Server not found');

    const existing = await this.serverGroupRepo.findOne({
      where: { group_id: groupId, server_id: serverId },
    });
    if (!existing) {
      await this.serverGroupRepo.save(
        this.serverGroupRepo.create({ group_id: groupId, server_id: serverId }),
      );
    }
  }

  /**
   * Desassocia um servidor de um grupo de acesso (RF-ARQ-20).
   */
  async removeServerFromGroup(groupId: string, serverId: string): Promise<void> {
    await this.serverGroupRepo.delete({ group_id: groupId, server_id: serverId });
  }

  /**
   * Disparo manual de Smart Kick para um jogador específico (RF-GW-15, RF-TS-09).
   */
  async smartKick(dto: SmartKickDto): Promise<{ success: boolean; terminated_connections: number }> {
    const server = await this.serverRepo.findOne({
      where: { id: dto.serverId },
      relations: ['minecraft_settings'],
    });

    if (!server) {
      throw new NotFoundException(`Server with ID "${dto.serverId}" not found`);
    }

    const reason = dto.reason || 'Desconectado pelo administrador.';

    try {
      await this.consoleDriver.sendCommand(server, `kick ${dto.minecraftNick} ${reason}`);
    } catch (err: any) {
      this.logger.debug(`RCON offline ou falhou: ${err.message}`);
    }

    const revoked = await this.gatewayIpcService.revokePlayerSession({
      server_id: server.id,
      client_ip: '',
      minecraft_nick: dto.minecraftNick,
      reason_message: reason,
    });

    return { success: true, terminated_connections: revoked.terminated_connections_count };
  }
}
