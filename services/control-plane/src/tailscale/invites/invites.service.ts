import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { AppConfigService } from '@config/app-config.service';

import { Invite } from '../../database/entities/invite.entity';
import { PLAYER_TAG } from '../identity/network-identity-provider.interface';
import { InviteGroup } from '../../database/entities/invite-group.entity';
import { InviteServer } from '../../database/entities/invite-server.entity';
import { Server } from '../../database/entities/server.entity';
import { User } from '../../database/entities/user.entity';
import { UserGroup } from '../../database/entities/user-group.entity';
import { UserServerAccess } from '../../database/entities/user-server-access.entity';
import { TailscaleDevice } from '../../database/entities/tailscale-device.entity';
import { TailscaleCloudDriver } from '../drivers/tailscale-cloud.driver';
import { validateNicknameFormat } from '../decision/nickname-validator';
import {
  CreateInviteDto,
  ClaimInviteDto,
  ClaimResultDto,
  InviteSummaryDto,
  computeInviteStatus,
} from '../dto';

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    @InjectRepository(Invite)
    private readonly inviteRepo: Repository<Invite>,
    @InjectRepository(InviteGroup)
    private readonly inviteGroupRepo: Repository<InviteGroup>,
    @InjectRepository(InviteServer)
    private readonly inviteServerRepo: Repository<InviteServer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(UserGroup)
    private readonly userGroupRepo: Repository<UserGroup>,
    @InjectRepository(UserServerAccess)
    private readonly userServerAccessRepo: Repository<UserServerAccess>,
    @InjectRepository(TailscaleDevice)
    private readonly deviceRepo: Repository<TailscaleDevice>,
    private readonly tailscaleCloudDriver: TailscaleCloudDriver,
    @InjectRepository(Server)
    private readonly serverRepo: Repository<Server>,
    private readonly appConfig: AppConfigService,
  ) {}

  /** Key-based invites stay in the code but are off by default (see the `tailscale.inviteKeyEnabled` setting). */
  private assertInviteKeyEnabled(): void {
    if (!this.appConfig.tailscale.inviteKeyEnabled) {
      throw new ForbiddenException({
        code: 'INVITE_KEY_DISABLED',
        message:
          'Os convites com chave de acesso estão desativados. Peça a quem administra a rede para liberar seu acesso pelo Tailscale.',
      });
    }
  }

  /**
   * Emite um novo convite multi-uso com permissões pré-vinculadas (RF-TS-03, RF-TS-06).
   */
  async createInvite(dto: CreateInviteDto, createdBy?: string): Promise<InviteSummaryDto> {
    this.assertInviteKeyEnabled();
    const token = crypto.randomBytes(16).toString('hex');
    const maxUses = dto.maxUses ?? 1;
    const expiresInDays = dto.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invite = this.inviteRepo.create({
      name: dto.name,
      token,
      max_uses: maxUses,
      used_count: 0,
      expires_at: expiresAt,
      is_active: true,
      created_by: createdBy ?? null,
    });

    const savedInvite = await this.inviteRepo.save(invite);

    if (dto.groupIds && dto.groupIds.length > 0) {
      for (const groupId of dto.groupIds) {
        await this.inviteGroupRepo.save(
          this.inviteGroupRepo.create({
            invite_id: savedInvite.id,
            group_id: groupId,
          }),
        );
      }
    }

    if (dto.serverIds && dto.serverIds.length > 0) {
      for (const serverId of dto.serverIds) {
        await this.inviteServerRepo.save(
          this.inviteServerRepo.create({
            invite_id: savedInvite.id,
            server_id: serverId,
          }),
        );
      }
    }

    return this.toSummaryDto(savedInvite, dto.groupIds || [], dto.serverIds || []);
  }

  /**
   * Lista todos os convites com status computado (RF-TS-06).
   */
  async listInvites(): Promise<InviteSummaryDto[]> {
    const invites = await this.inviteRepo.find({
      relations: {
        invite_groups: true,
        invite_servers: true,
      },
      order: { created_at: 'DESC' },
    });

    return invites.map((inv) =>
      this.toSummaryDto(
        inv,
        (inv.invite_groups || []).map((g) => g.group_id),
        (inv.invite_servers || []).map((s) => s.server_id),
      ),
    );
  }

  /**
   * Obtém os detalhes de um convite pelo seu ID.
   */
  async getInviteById(id: string): Promise<InviteSummaryDto> {
    const invite = await this.inviteRepo.findOne({
      where: { id },
      relations: {
        invite_groups: true,
        invite_servers: true,
      },
    });

    if (!invite) {
      throw new NotFoundException(`Invite with ID ${id} not found`);
    }

    return this.toSummaryDto(
      invite,
      (invite.invite_groups || []).map((g) => g.group_id),
      (invite.invite_servers || []).map((s) => s.server_id),
    );
  }

  /**
   * Revoga explicitamente um convite (RF-TS-06: transição para Revoked).
   */
  async revokeInvite(id: string): Promise<InviteSummaryDto> {
    const invite = await this.inviteRepo.findOne({
      where: { id },
      relations: {
        invite_groups: true,
        invite_servers: true,
      },
    });

    if (!invite) {
      throw new NotFoundException(`Invite with ID ${id} not found`);
    }

    invite.is_active = false;
    await this.inviteRepo.save(invite);

    return this.toSummaryDto(
      invite,
      (invite.invite_groups || []).map((g) => g.group_id),
      (invite.invite_servers || []).map((s) => s.server_id),
    );
  }

  /**
   * Valida se um token é resgatável antes do preenchimento do formulário no portal /join.
   */
  async validateToken(token: string): Promise<InviteSummaryDto> {
    this.assertInviteKeyEnabled();
    const invite = await this.inviteRepo.findOne({
      where: { token },
      relations: {
        invite_groups: true,
        invite_servers: true,
      },
    });

    if (!invite) {
      throw new NotFoundException({
        code: 'INVITE_NOT_FOUND',
        message: 'Invite not found or invalid token',
      });
    }

    const status = computeInviteStatus(invite);
    if (status === 'Revoked') {
      throw new BadRequestException({
        code: 'INVITE_REVOKED',
        message: 'This invite has been revoked by the administrator',
      });
    }
    if (status === 'Expired') {
      throw new BadRequestException({ code: 'INVITE_EXPIRED', message: 'This invite has expired' });
    }
    if (status === 'Depleted') {
      throw new ConflictException({
        code: 'INVITE_DEPLETED',
        message: 'The usage limit of this invite has been reached',
      });
    }

    const serverIds = (invite.invite_servers || []).map((s) => s.server_id);
    const servers =
      serverIds.length > 0 ? await this.serverRepo.find({ where: { id: In(serverIds) } }) : [];

    return {
      ...this.toSummaryDto(
        invite,
        (invite.invite_groups || []).map((g) => g.group_id),
        serverIds,
      ),
      serverNames: servers.map((s) => s.name),
    };
  }

  /**
   * Resgate atômico de convite no portal /join com checagem de nickname e compensação L-03 (RF-TS-08, RF-TS-11).
   *
   * Critério de Concorrência: 10 claims simultâneos em maxUses=1 garantem exatamente 1 sucesso e 9 conflitos.
   */
  async claimInvite(dto: ClaimInviteDto): Promise<ClaimResultDto> {
    this.assertInviteKeyEnabled();
    // 1. Validação estrita do Nickname Vanilla (RF-ARQ-21, GW:430-432)
    const nickValidation = validateNicknameFormat(dto.minecraftNick);
    if (!nickValidation.valid) {
      throw new BadRequestException(`Invalid nickname format: ${nickValidation.reason}`);
    }

    // 2. Reserva atômica da cota no banco via conditional update atômico (RF-TS-08)
    const updateResult = await this.inviteRepo
      .createQueryBuilder()
      .update(Invite)
      .set({ used_count: () => 'used_count + 1' })
      .where('token = :token', { token: dto.token })
      .andWhere('is_active = true')
      .andWhere('used_count < max_uses')
      .andWhere('expires_at > :now', { now: new Date() })
      .execute();

    if (updateResult.affected === 0) {
      const invite = await this.inviteRepo.findOne({ where: { token: dto.token } });
      if (!invite) {
        throw new NotFoundException({
          code: 'INVITE_NOT_FOUND',
          message: 'Invite not found or invalid token',
        });
      }
      const status = computeInviteStatus(invite);
      if (status === 'Revoked') {
        throw new BadRequestException({
          code: 'INVITE_REVOKED',
          message: 'This invite has been revoked by the administrator',
        });
      }
      if (status === 'Expired') {
        throw new BadRequestException({
          code: 'INVITE_EXPIRED',
          message: 'This invite has expired',
        });
      }
      throw new ConflictException({
        code: 'INVITE_DEPLETED',
        message: 'The usage limit of this invite has been reached',
      });
    }

    // Carrega o convite completo e suas permissões pré-vinculadas
    const invite = await this.inviteRepo.findOne({
      where: { token: dto.token },
      relations: {
        invite_groups: true,
        invite_servers: true,
      },
    });

    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    // 3. Validação de Unicidade e Anti-Impersonation de Nickname (RF-TS-08, TS:328-332)
    const existingUser = await this.userRepo.findOne({
      where: { minecraft_nick: dto.minecraftNick },
    });

    if (existingUser) {
      // ⚠️ Compensação da cota reservada do convite
      await this.inviteRepo
        .createQueryBuilder()
        .update(Invite)
        .set({ used_count: () => 'used_count - 1' })
        .where('id = :id', { id: invite.id })
        .execute();

      throw new ConflictException('Nickname already registered by another player');
    }

    // 4. Criação do Usuário e Vínculos de Permissões Pré-Atribuídas (RF-TS-03)
    let user = this.userRepo.create({
      real_name: dto.realName,
      minecraft_nick: dto.minecraftNick,
      role: 'PLAYER',
    });
    user = await this.userRepo.save(user);

    // Associação de Grupos
    if (invite.invite_groups && invite.invite_groups.length > 0) {
      for (const ig of invite.invite_groups) {
        await this.userGroupRepo.save(
          this.userGroupRepo.create({
            user_id: user.id,
            group_id: ig.group_id,
          }),
        );
      }
    }

    // Associação de Servidores Individuais
    if (invite.invite_servers && invite.invite_servers.length > 0) {
      for (const is of invite.invite_servers) {
        await this.userServerAccessRepo.save(
          this.userServerAccessRepo.create({
            user_id: user.id,
            server_id: is.server_id,
          }),
        );
      }
    }

    // 5. Geração de AuthKey na Tailscale Cloud API (RF-TS-05, PR-11)
    // The tailnet policy cannot declare a tag per player, so every key carries the one static tag;
    // playerTag below is only the unique label of the device row.
    const playerTag = `tag:player-${user.id}`;
    let authKeyResult;

    try {
      authKeyResult = await this.tailscaleCloudDriver.generatePreAuthKey([PLAYER_TAG], 86400 * 7);
    } catch (cloudErr: any) {
      this.logger.error(
        `Falha ao gerar Pre-Auth Key na Tailscale Cloud API: ${cloudErr.message}. Executando compensação L-03...`,
      );

      // ⚠️ L-03 COMPENSAÇÃO ATÔMICA:
      // Devolve a cota do convite e desfaz o cadastro do usuário
      await this.inviteRepo
        .createQueryBuilder()
        .update(Invite)
        .set({ used_count: () => 'used_count - 1' })
        .where('id = :id', { id: invite.id })
        .execute();

      await this.userRepo.delete({ id: user.id });

      throw new BadGatewayException(
        'Failed to provision a network credential on Tailscale Cloud. The invite quota was preserved.',
      );
    }

    // 6. Registro do Dispositivo Pendente (RF-TS-06, RF-TS-08)
    const device = this.deviceRepo.create({
      user_id: user.id,
      tailscale_tag: playerTag,
      status: 'PENDING',
    });
    await this.deviceRepo.save(device);

    const deepLinkUrl = `tailscale://login?key=${authKeyResult.key}`;
    const worldAddress = await this.exampleWorldAddress(
      (invite.invite_servers || []).map((s) => s.server_id),
    );

    return {
      userId: user.id,
      realName: user.real_name || dto.realName,
      minecraftNick: user.minecraft_nick,
      authKey: authKeyResult.key,
      deepLinkUrl,
      tailcatTunnel: worldAddress
        ? {
            serverAddress: worldAddress,
            instructions:
              'Users without Administrator privileges must run the tailcat executable to connect via 127.0.0.1:25565.',
          }
        : undefined,
      expiresAt: authKeyResult.expires
        ? authKeyResult.expires.toISOString()
        : new Date(Date.now() + 86400000 * 7).toISOString(),
    };
  }

  /** What the player types in Minecraft for one of the invited worlds; unknown until the worlds domain is set. */
  private async exampleWorldAddress(serverIds: string[]): Promise<string | null> {
    const { worldsDomain } = this.appConfig.access;
    if (!worldsDomain || serverIds.length === 0) {
      return null;
    }
    const [server] = await this.serverRepo.find({ where: { id: In(serverIds) }, take: 1 });
    return server ? `${server.subdomain}.${worldsDomain}` : null;
  }

  private toSummaryDto(invite: Invite, groupIds: string[], serverIds: string[]): InviteSummaryDto {
    const status = computeInviteStatus(invite);
    return {
      id: invite.id,
      token: invite.token,
      name: invite.name,
      maxUses: invite.max_uses,
      usedCount: invite.used_count,
      expiresAt: invite.expires_at,
      status,
      joinUrl: `${this.appConfig.access.publicUrl}/join?token=${invite.token}`,
      groupIds,
      serverIds,
      createdBy: invite.created_by,
      createdAt: invite.created_at,
    };
  }
}
