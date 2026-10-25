import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
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
import { AppConfigService } from '../config/app-config.service';
import { ServerIconService } from '../servers/server-icon.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { SimulateAccessDto, SimulatedUserAccessResultDto } from './dto/simulate-access.dto';
import { SmartKickDto } from './dto/smart-kick.dto';
import { AccessibleServerDto, UserSummaryDto } from './dto/user-summary.dto';
import { AccessMatrixDto } from './dto/access-matrix.dto';
import { IdentityProbeDto, IdentityProbeResultDto } from './dto/identity-probe.dto';
import { MyServerDto } from './dto/my-server.dto';

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
    @Optional() private readonly appConfig?: AppConfigService,
    @Optional() private readonly serverIconService?: ServerIconService,
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
   * Matriz consolidada de acesso de usuários aos servidores (#214).
   * Faz no máximo 5 consultas aos repositórios independentemente do número de usuários.
   */
  async getAccessMatrix(): Promise<AccessMatrixDto> {
    const [users, servers, userGroups] = await Promise.all([
      this.userRepo.find({
        relations: { user_groups: true },
        order: { minecraft_nick: 'ASC' },
      }),
      this.serverRepo.find({ order: { name: 'ASC' } }),
      this.userGroupRepo.find(),
    ]);

    const explanations = await this.accessResolver.explain([], {
      users,
      servers,
      userGroups,
    });

    const userGroupsByUserId = new Map<string, string[]>();
    for (const ug of userGroups) {
      const list = userGroupsByUserId.get(ug.user_id) || [];
      list.push(ug.group_id);
      userGroupsByUserId.set(ug.user_id, list);
    }

    const cells: Record<
      string,
      Record<
        string,
        {
          allowed: boolean;
          reason: string;
          grantedBy: AccessGrantedBy | null;
        }
      >
    > = {};

    for (const user of users) {
      cells[user.id] = {};
    }

    for (const exp of explanations) {
      if (!cells[exp.userId]) {
        cells[exp.userId] = {};
      }
      cells[exp.userId][exp.serverId] = {
        allowed: exp.allowed,
        reason: exp.reason,
        grantedBy: exp.grantedBy,
      };
    }

    return {
      users: users.map((user) => {
        const fromMap = userGroupsByUserId.get(user.id) || [];
        const fromRel = (user.user_groups || []).map((ug) => ug.group_id);
        const groupIds = Array.from(new Set([...fromMap, ...fromRel]));
        return {
          id: user.id,
          minecraftNick: user.minecraft_nick,
          realName: user.real_name ?? null,
          role: user.role,
          groupIds,
        };
      }),
      servers: servers.map((server) => ({
        id: server.id,
        name: server.name,
        subdomain: server.subdomain,
        state: server.state,
        access_policy: server.access_policy || 'GROUP',
        is_maintenance: Boolean(server.is_maintenance),
      })),
      cells,
    };
  }

  /**
   * Sondagem dry-run de identidade por ID Tailscale ou IP (#215).
   * Consulta WhoIs, usuário correspondente, anti-impersonação e permissão de acesso a mundos.
   */
  async probeIdentity(dto: IdentityProbeDto): Promise<IdentityProbeResultDto> {
    const lookup = await this.gatewayIpcService.probePlayerIdentity({
      tailscaleUserId: dto.tailscaleUserId?.trim() || undefined,
      clientIp: dto.ip?.trim() || undefined,
    });

    const nicknameCheck = dto.minecraftNick?.trim()
      ? this.accessDecisionEngine.evaluateNickname(
          dto.minecraftNick.trim(),
          lookup.user?.minecraft_nick ?? undefined,
        )
      : null;

    const servers = lookup.user ? await this.explainUserAccess(lookup.user.id) : [];

    return {
      whois: lookup.networkIdentity,
      user: lookup.user
        ? {
            id: lookup.user.id,
            minecraftNick: lookup.user.minecraft_nick,
            realName: lookup.user.real_name ?? null,
            email: lookup.user.email ?? null,
            githubUsername: lookup.user.github_username ?? null,
            role: lookup.user.role,
          }
        : null,
      matchedBy: lookup.matchedBy,
      wouldBind: lookup.wouldBind,
      nicknameCheck,
      servers,
    };
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
      await this.executeSmartKick(server, user, exp.reason);
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
          if (change.userId && change.groupId) {
            hypothetical.addUserToGroup!.push({ userId: change.userId, groupId: change.groupId });
          }
          break;
        case 'removeUserFromGroup':
          if (change.userId && change.groupId) {
            hypothetical.removeUserFromGroup!.push({
              userId: change.userId,
              groupId: change.groupId,
            });
          }
          break;
        case 'addServerToGroup':
          if (change.serverId && change.groupId) {
            hypothetical.addServerToGroup!.push({
              serverId: change.serverId,
              groupId: change.groupId,
            });
          }
          break;
        case 'removeServerFromGroup':
          if (change.serverId && change.groupId) {
            hypothetical.removeServerFromGroup!.push({
              serverId: change.serverId,
              groupId: change.groupId,
            });
          }
          break;
        case 'grantServer':
          if (change.userId && change.serverId) {
            hypothetical.grantServer!.push({ userId: change.userId, serverId: change.serverId });
          }
          break;
        case 'revokeServer':
          if (change.userId && change.serverId) {
            hypothetical.revokeServer!.push({ userId: change.userId, serverId: change.serverId });
          }
          break;
        case 'deleteGroup':
          if (change.groupId) {
            hypothetical.deleteGroupIds!.push(change.groupId);
          }
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
   * Remove um grupo de acesso e dispara Smart Kick para jogadores online que perderem o acesso (#210, #213).
   */
  async deleteGroup(id: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id } });
    if (!group) {
      throw new NotFoundException(`Group with ID "${id}" not found`);
    }
    const [serverGroups, userGroups] = await Promise.all([
      this.serverGroupRepo.find({ where: { group_id: id } }),
      this.userGroupRepo.find({ where: { group_id: id } }),
    ]);

    await this.groupRepo.delete({ id });

    const affectedServerIds = Array.from(new Set(serverGroups.map((sg) => sg.server_id)));
    await Promise.all(
      affectedServerIds.map((serverId) => this.gatewayIpcService.publishRoute(serverId)),
    );

    const affectedUserIds = Array.from(new Set(userGroups.map((ug) => ug.user_id)));
    if (affectedServerIds.length > 0 && affectedUserIds.length > 0) {
      const [servers, users] = await Promise.all([
        this.serverRepo.find({
          where: { id: In(affectedServerIds) },
          relations: { minecraft_settings: true },
        }),
        this.userRepo.find({ where: { id: In(affectedUserIds) } }),
      ]);

      const explanations = await this.accessResolver.explain(affectedUserIds, {
        servers,
        users,
      });

      for (const exp of explanations) {
        if (!exp.allowed) {
          const server = servers.find((s) => s.id === exp.serverId);
          const user = users.find((u) => u.id === exp.userId);
          if (server && user) {
            await this.executeSmartKick(server, user, exp.reason);
          }
        }
      }
    }
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
    const candidateServers = await this.serverRepo.find({
      where: { id: In(candidateServerIds) },
      relations: { minecraft_settings: true },
    });

    const explanations = await this.accessResolver.explain([userId], {
      servers: candidateServers,
      users: [user],
    });

    const kickedServers: string[] = [];

    for (const exp of explanations) {
      if (!exp.allowed) {
        const server = candidateServers.find((s) => s.id === exp.serverId);
        if (!server) continue;
        await this.executeSmartKick(server, user, exp.reason);
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
    const users = await this.userRepo.find({
      where: { id: In(userIds) },
    });

    const explanations = await this.accessResolver.explain(userIds, {
      servers: [server],
      users,
    });

    for (const exp of explanations) {
      if (!exp.allowed) {
        const user = users.find((u) => u.id === exp.userId);
        if (!user) continue;
        await this.executeSmartKick(server, user, exp.reason);
      }
    }
  }

  /**
   * Helper privado para executar o Smart Kick (RCON kick + revogação de sessão via IPC gRPC)
   * quando um jogador perde o acesso a um servidor ativo (#210, #212, #213).
   */
  private async executeSmartKick(
    server: Server,
    user: User,
    reason = '§cPermissão revogada pelo administrador.',
  ): Promise<void> {
    this.logger.log(
      `Smart Kick disparado: Usuário ${user.minecraft_nick} perdeu acesso ao servidor ${server.id} (${reason})`,
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

  /**
   * Lista os servidores acessíveis pelo jogador logado para exibição na Área do Jogador (#216).
   * Retorna apenas informações sanitizadas de cada mundo. Mundos em manutenção continuam
   * visíveis com state 'MAINTENANCE' caso o usuário possua a concessão base subjacente.
   */
  async listMyServers(user: User): Promise<MyServerDto[]> {
    const servers = await this.serverRepo.find({ order: { name: 'ASC' } });
    if (servers.length === 0) {
      return [];
    }

    const baseServers = servers.map(
      (s) =>
        ({
          ...s,
          is_maintenance: false,
          access_policy: s.access_policy === 'MAINTENANCE' ? 'GROUP' : s.access_policy,
        }) as Server,
    );

    const [baseExps, liveExps] = await Promise.all([
      this.accessResolver.explain([user.id], { users: [user], servers: baseServers }),
      this.accessResolver.explain([user.id], { users: [user], servers }),
    ]);

    const baseMap = new Map(baseExps.map((e) => [e.serverId, e]));
    const liveMap = new Map(liveExps.map((e) => [e.serverId, e]));

    const worldsDomain = this.appConfig?.access?.worldsDomain ?? '';
    const results: MyServerDto[] = [];

    for (const server of servers) {
      const liveExp = liveMap.get(server.id);
      const baseExp = baseMap.get(server.id);
      const isMaintenance =
        Boolean(server.is_maintenance) || server.access_policy === 'MAINTENANCE';

      const isIncluded = Boolean(liveExp?.allowed) || (Boolean(baseExp?.allowed) && isMaintenance);
      if (!isIncluded) {
        continue;
      }

      const state = isMaintenance ? 'MAINTENANCE' : server.state;
      const address = worldsDomain ? `${server.subdomain}.${worldsDomain}` : server.subdomain;
      const playersOnline = this.playerSessionsService.count(server.id);
      const icon = this.serverIconService ? await this.serverIconService.dataUri(server) : null;

      results.push({
        name: server.name,
        address,
        state,
        playersOnline,
        icon,
      });
    }

    return results;
  }
}
