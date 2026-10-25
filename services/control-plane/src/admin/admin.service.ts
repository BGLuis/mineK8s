import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { Group } from '../database/entities/group.entity';
import { User } from '../database/entities/user.entity';
import { Server } from '../database/entities/server.entity';
import { UserGroup } from '../database/entities/user-group.entity';
import { ServerGroup } from '../database/entities/server-group.entity';
import { UserServerAccess } from '../database/entities/user-server-access.entity';
import { effectiveAccessPolicy } from '../tailscale/decision/effective-access-policy';
import { AccessDecisionEngineService } from '../tailscale/decision/access-decision-engine.service';
import {
  AccessGrantedBy,
  AccessResolverService,
  HypotheticalAccessDiff,
} from '../tailscale/decision/access-resolver.service';
import { GatewayIpcService } from '../gateway-ipc/gateway-ipc.service';
import { PlayerSessionsService } from '../gateway-ipc/player-sessions.service';
import { MinecraftRconConsoleDriver } from '../console/minecraft-rcon-console.driver';
import { CreateGroupDto } from './dto/create-group.dto';
import { SimulateAccessDto, SimulatedUserAccessResultDto } from './dto/simulate-access.dto';
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
    private readonly accessResolver: AccessResolverService,
    private readonly playerSessionsService: PlayerSessionsService,
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
      relations: {
        devices: true,
        user_groups: true,
        server_accesses: true,
      },
      order: { minecraft_nick: 'ASC' },
    });

    return users.map((user) => ({
      id: user.id,
      minecraftNick: user.minecraft_nick,
      realName: user.real_name,
      email: user.email,
      githubUsername: user.github_username,
      linked: Boolean(user.tailscale_user_id),
      role: user.role,
      devices: (user.devices || []).map((device) => ({
        id: device.id,
        deviceName: device.device_name,
        status: device.status,
        lastSeenAt: device.last_seen_at,
      })),
      groupIds: (user.user_groups || []).map((ug) => ug.group_id),
      serverIds: (user.server_accesses || []).map((sa) => sa.server_id),
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

    const servers = await this.serverRepo.find({ order: { name: 'ASC' } });
    const explanations = await this.accessResolver.explain([userId], {
      servers,
      users: [user],
    });

    const allowedServerIds = new Set(explanations.filter((e) => e.allowed).map((e) => e.serverId));

    return servers
      .filter((s) => allowedServerIds.has(s.id))
      .map((server) => ({
        id: server.id,
        name: server.name,
        subdomain: server.subdomain,
        state: server.state,
      }));
  }

  /**
   * Explicação detalhada do acesso do usuário a todos os servidores (#211).
   */
  async explainUserAccess(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      subdomain: string;
      state: string;
      access_policy: string;
      is_maintenance: boolean;
      allowed: boolean;
      reason: string;
      grantedBy: AccessGrantedBy | null;
    }>
  > {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const servers = await this.serverRepo.find({ order: { name: 'ASC' } });
    const explanations = await this.accessResolver.explain([userId], {
      servers,
      users: [user],
    });

    const explanationMap = new Map(explanations.map((e) => [e.serverId, e]));

    return servers.map((server) => {
      const exp = explanationMap.get(server.id);
      return {
        id: server.id,
        name: server.name,
        subdomain: server.subdomain,
        state: server.state,
        access_policy: server.access_policy || 'GROUP',
        is_maintenance: Boolean(server.is_maintenance),
        allowed: exp?.allowed ?? false,
        reason: exp?.reason ?? 'UNKNOWN',
        grantedBy: exp?.grantedBy ?? null,
      };
    });
  }

  /**
   * Concede acesso direto de servidor a um usuário (RF-ARQ-20, #212).
   */
  async grantServerToUser(userId: string, serverId: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) {
      throw new NotFoundException('Server not found');
    }

    const existing = await this.userServerAccessRepo.findOne({
      where: { user_id: userId, server_id: serverId },
    });
    if (!existing) {
      await this.userServerAccessRepo.save(
        this.userServerAccessRepo.create({ user_id: userId, server_id: serverId }),
      );
    }
    await this.gatewayIpcService.publishRoute(serverId);
  }

  /**
   * Revoga acesso direto de servidor de um usuário com Smart Kick caso perca o acesso (RF-ARQ-20, RF-TS-09, #212).
   */
  async revokeServerFromUser(
    userId: string,
    serverId: string,
  ): Promise<{ kickedServers: string[] }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const server = await this.serverRepo.findOne({
      where: { id: serverId },
      relations: { minecraft_settings: true },
    });
    if (!server) {
      throw new NotFoundException('Server not found');
    }

    await this.userServerAccessRepo.delete({ user_id: userId, server_id: serverId });
    await this.gatewayIpcService.publishRoute(serverId);

    const explanations = await this.accessResolver.explain([userId], {
      servers: [server],
      users: [user],
    });

    const kickedServers: string[] = [];
    const exp = explanations.find((e) => e.serverId === serverId);

    if (exp && !exp.allowed) {
      this.logger.log(
        `Smart Kick disparado: Usuário ${user.minecraft_nick} perdeu acesso ao servidor ${server.id} (${exp.reason})`,
      );

      const kickReason = '§cPermissão revogada pelo administrador.';

      if (!server.state || server.state === 'READY') {
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
      }

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

    return { kickedServers };
  }

  /**
   * Simula alterações de acesso sem persistir nem acionar Smart Kick (#213).
   */
  async simulateAccessChanges(dto: SimulateAccessDto): Promise<SimulatedUserAccessResultDto[]> {
    const hypothetical: HypotheticalAccessDiff = {
      addUserToGroup: [],
      removeUserFromGroup: [],
      addServerToGroup: [],
      removeServerFromGroup: [],
      grantServer: [],
      revokeServer: [],
      deleteGroupIds: [],
    };

    for (const change of dto.changes || []) {
      switch (change.type) {
        case 'addUserToGroup':
          hypothetical.addUserToGroup!.push({ userId: change.userId, groupId: change.groupId });
          break;
        case 'removeUserFromGroup':
          hypothetical.removeUserFromGroup!.push({
            userId: change.userId,
            groupId: change.groupId,
          });
          break;
        case 'addServerToGroup':
          hypothetical.addServerToGroup!.push({
            serverId: change.serverId,
            groupId: change.groupId,
          });
          break;
        case 'removeServerFromGroup':
          hypothetical.removeServerFromGroup!.push({
            serverId: change.serverId,
            groupId: change.groupId,
          });
          break;
        case 'grantServer':
          hypothetical.grantServer!.push({ userId: change.userId, serverId: change.serverId });
          break;
        case 'revokeServer':
          hypothetical.revokeServer!.push({ userId: change.userId, serverId: change.serverId });
          break;
        case 'deleteGroup':
          hypothetical.deleteGroupIds!.push(change.groupId);
          break;
      }
    }

    const [users, servers] = await Promise.all([
      this.userRepo.find({ order: { minecraft_nick: 'ASC' } }),
      this.serverRepo.find({ order: { name: 'ASC' } }),
    ]);

    const [baselineExplanations, simulatedExplanations] = await Promise.all([
      this.accessResolver.explain([], { users, servers }),
      this.accessResolver.explain([], { users, servers, hypothetical }),
    ]);

    const baselineMap = new Map<string, boolean>();
    for (const exp of baselineExplanations) {
      baselineMap.set(`${exp.userId}:${exp.serverId}`, exp.allowed);
    }

    const simulatedMap = new Map<string, boolean>();
    for (const exp of simulatedExplanations) {
      simulatedMap.set(`${exp.userId}:${exp.serverId}`, exp.allowed);
    }

    const results: SimulatedUserAccessResultDto[] = [];

    for (const user of users) {
      const gains: string[] = [];
      const losses: string[] = [];

      for (const server of servers) {
        const key = `${user.id}:${server.id}`;
        const wasAllowed = baselineMap.get(key) ?? false;
        const isAllowed = simulatedMap.get(key) ?? false;

        if (!wasAllowed && isAllowed) {
          gains.push(server.id);
        } else if (wasAllowed && !isAllowed) {
          losses.push(server.id);
        }
      }

      if (gains.length > 0 || losses.length > 0) {
        const wouldBeKicked = losses.filter((serverId) => {
          const activeSessions = this.playerSessionsService.list(serverId);
          return activeSessions.some(
            (s) => s.nick.toLowerCase() === user.minecraft_nick.toLowerCase(),
          );
        });

        results.push({
          userId: user.id,
          minecraftNick: user.minecraft_nick,
          gains,
          losses,
          wouldBeKicked,
        });
      }
    }

    return results;
  }

  /**
   * Lista todos os grupos cadastrados.
   */
  async listGroups(): Promise<Group[]> {
    return this.groupRepo.find({
      relations: {
        user_groups: true,
        server_groups: true,
      },
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
    const serverGroups = await this.serverGroupRepo.find({ where: { group_id: id } });
    await this.groupRepo.delete({ id });
    const affectedServerIds = Array.from(new Set(serverGroups.map((sg) => sg.server_id)));
    await Promise.all(
      affectedServerIds.map((serverId) => this.gatewayIpcService.publishRoute(serverId)),
    );
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

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return { kickedServers: [] };
    }

    // 2. Localiza todos os servidores vinculados a este grupo
    const serverGroups = await this.serverGroupRepo.find({
      where: { group_id: groupId },
    });
    if (serverGroups.length === 0) {
      return { kickedServers: [] };
    }

    const candidateServerIds = serverGroups.map((sg) => sg.server_id);
    let candidateServers = await this.serverRepo.find({
      where: { id: In(candidateServerIds) },
      relations: { minecraft_settings: true },
    });
    if (candidateServers.length === 0 && candidateServerIds.length > 0) {
      const fetched = await Promise.all(
        candidateServerIds.map((id) =>
          this.serverRepo.findOne({
            where: { id },
            relations: { minecraft_settings: true },
          }),
        ),
      );
      candidateServers = fetched.filter((s): s is Server => Boolean(s));
    }

    const explanations = await this.accessResolver.explain([userId], {
      servers: candidateServers,
      users: [user],
    });

    const kickedServers: string[] = [];

    for (const exp of explanations) {
      if (!exp.allowed) {
        const server = candidateServers.find((s) => s.id === exp.serverId);
        if (!server) continue;

        this.logger.log(
          `Smart Kick disparado: Usuário ${user.minecraft_nick} perdeu acesso ao servidor ${server.id} (${exp.reason})`,
        );

        const kickReason = '§cPermissão revogada pelo administrador.';

        if (!server.state || server.state === 'READY') {
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
        }

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
    await this.gatewayIpcService.publishRoute(serverId);
  }

  /**
   * Desassocia um servidor de um grupo de acesso (RF-ARQ-20).
   */
  async removeServerFromGroup(groupId: string, serverId: string): Promise<void> {
    const userGroups = await this.userGroupRepo.find({
      where: { group_id: groupId },
    });

    await this.serverGroupRepo.delete({ group_id: groupId, server_id: serverId });
    await this.gatewayIpcService.publishRoute(serverId);

    if (userGroups.length === 0) {
      return;
    }

    const server = await this.serverRepo.findOne({
      where: { id: serverId },
      relations: {
        minecraft_settings: true,
      },
    });

    if (!server) {
      return;
    }

    const userIds = userGroups.map((ug) => ug.user_id);
    let users = await this.userRepo.find({
      where: { id: In(userIds) },
    });
    if (users.length === 0 && userIds.length > 0) {
      const fetched = await Promise.all(
        userIds.map((id) => this.userRepo.findOne({ where: { id } })),
      );
      users = fetched.filter((u): u is User => Boolean(u));
    }

    const explanations = await this.accessResolver.explain(userIds, {
      servers: [server],
      users,
    });

    for (const exp of explanations) {
      if (!exp.allowed) {
        const user = users.find((u) => u.id === exp.userId);
        if (!user) continue;

        this.logger.log(
          `Smart Kick disparado: Usuário ${user.minecraft_nick} perdeu acesso ao servidor ${server.id} (${exp.reason})`,
        );

        const kickReason = '§cPermissão revogada pelo administrador.';

        if (!server.state || server.state === 'READY') {
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
        }

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
      }
    }
  }

  /**
   * Disparo manual de Smart Kick para um jogador específico (RF-GW-15, RF-TS-09).
   */
  async smartKick(
    dto: SmartKickDto,
  ): Promise<{ success: boolean; terminated_connections: number }> {
    const server = await this.serverRepo.findOne({
      where: { id: dto.serverId },
      relations: {
        minecraft_settings: true,
      },
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
