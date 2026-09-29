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
import { AccessDecisionEngineService } from '../tailscale/decision/access-decision-engine.service';
import { GatewayIpcService } from '../gateway-ipc/gateway-ipc.service';
import { MinecraftRconConsoleDriver } from '../console/minecraft-rcon-console.driver';
import { CreateGroupDto } from './dto/create-group.dto';
import { SmartKickDto } from './dto/smart-kick.dto';

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
      throw new ConflictException(`Grupo com nome "${dto.name}" já existe`);
    }

    const group = this.groupRepo.create({
      name: dto.name,
      description: dto.description,
    });
    return this.groupRepo.save(group);
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
      throw new NotFoundException(`Grupo com ID "${id}" não encontrado`);
    }
    await this.groupRepo.delete({ id });
  }

  /**
   * Adiciona um usuário a um grupo (RF-ARQ-20).
   */
  async addUserToGroup(groupId: string, userId: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Grupo não encontrado');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

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
          this.logger.debug(`Falha ao despachar revokePlayerSession via IPC: ${ipcErr.message}`);
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
    if (!group) throw new NotFoundException('Grupo não encontrado');

    const server = await this.serverRepo.findOne({ where: { id: serverId } });
    if (!server) throw new NotFoundException('Servidor não encontrado');

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
  async smartKick(dto: SmartKickDto): Promise<{ success: boolean }> {
    const server = await this.serverRepo.findOne({
      where: { id: dto.serverId },
      relations: ['minecraft_settings'],
    });

    if (!server) {
      throw new NotFoundException(`Servidor com ID "${dto.serverId}" não encontrado`);
    }

    const reason = dto.reason || 'Desconectado pelo administrador.';

    try {
      await this.consoleDriver.sendCommand(server, `kick ${dto.minecraftNick} ${reason}`);
    } catch (err: any) {
      this.logger.debug(`RCON offline ou falhou: ${err.message}`);
    }

    await this.gatewayIpcService.revokePlayerSession({
      server_id: server.id,
      client_ip: '',
      minecraft_nick: dto.minecraftNick,
      reason_message: reason,
    });

    return { success: true };
  }
}
