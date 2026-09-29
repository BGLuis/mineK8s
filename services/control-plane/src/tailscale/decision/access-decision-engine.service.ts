import { Injectable, Logger } from '@nestjs/common';
import { validateNicknameFormat } from './nickname-validator';

export interface UserContext {
  userId: string;
  minecraftNick?: string;
  role: 'ADMIN' | 'PLAYER';
  groupIds: string[];
  isActive: boolean;
}

export interface ServerContext {
  serverId: string;
  policy: 'PUBLIC' | 'GROUP' | 'INDIVIDUAL' | 'MAINTENANCE' | 'INTERNET';
  allowedGroupIds?: string[];
  allowedUserIds?: string[];
}

export interface AccessDecisionResult {
  allowed: boolean;
  reason?: string;
  adminBypass?: boolean;
}

export interface NicknameDecisionResult {
  allowed: boolean;
  autoAdopted: boolean;
  reason?: string;
}

@Injectable()
export class AccessDecisionEngineService {
  private readonly logger = new Logger(AccessDecisionEngineService.name);

  /**
   * Avalia a política de acesso a uma instância de servidor (RF-TS-02).
   * Suporta: PUBLIC, GROUP, INDIVIDUAL, MAINTENANCE, INTERNET e bypass de ADMIN.
   */
  public evaluateAccess(user: UserContext, server: ServerContext): AccessDecisionResult {
    // 1. Usuário inativo / revogado
    if (!user.isActive) {
      return { allowed: false, reason: 'USER_INACTIVE' };
    }

    // 2. Administrador possui bypass irrestrito
    if (user.role === 'ADMIN') {
      return { allowed: true, adminBypass: true };
    }

    // 3. Servidor em modo manutenção
    if (server.policy === 'MAINTENANCE') {
      return { allowed: false, reason: 'MAINTENANCE_MODE' };
    }

    // 4. Servidor público ou internet
    if (server.policy === 'PUBLIC' || server.policy === 'INTERNET') {
      return { allowed: true };
    }

    // 5. Servidor restrito por grupo
    if (server.policy === 'GROUP') {
      const allowedGroups = new Set(server.allowedGroupIds || []);
      const hasGroup = user.groupIds.some((g) => allowedGroups.has(g));

      if (hasGroup) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'INSUFFICIENT_GROUPS' };
    }

    // 6. Servidor restrito individualmente
    if (server.policy === 'INDIVIDUAL') {
      const allowedUsers = new Set(server.allowedUserIds || []);
      if (allowedUsers.has(user.userId)) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'INDIVIDUAL_ACCESS_DENIED' };
    }

    // Política desconhecida: bloqueio por padrão Zero-Trust
    return { allowed: false, reason: 'UNKNOWN_POLICY' };
  }

  /**
   * Avalia validação do nickname declarado contra a identidade do dispositivo (RF-ARQ-21).
   * Implementa auto-adoção no primeiro acesso e rejeição contra impersonação.
   */
  public evaluateNickname(declaredNick: string, registeredNick?: string): NicknameDecisionResult {
    // 1. Validação estrita do formato do nickname
    const formatValidation = validateNicknameFormat(declaredNick);
    if (!formatValidation.valid) {
      return {
        allowed: false,
        autoAdopted: false,
        reason: formatValidation.reason,
      };
    }

    // 2. Auto-adoção: usuário novo sem nickname registrado
    if (!registeredNick || registeredNick.trim() === '') {
      this.logger.log(`Primeiro acesso do usuário. Auto-adotando nickname '${declaredNick}'`);
      return {
        allowed: true,
        autoAdopted: true,
      };
    }

    // 3. Validação anti-impersonação: deve coincidir exatamente com o nickname registrado
    if (declaredNick.toLowerCase() === registeredNick.toLowerCase()) {
      return {
        allowed: true,
        autoAdopted: false,
      };
    }

    // Tentativa de impersonação detectada
    this.logger.warn(
      `Tentativa de impersonação detectada: declarou '${declaredNick}', mas dispositivo pertence a '${registeredNick}'`,
    );
    return {
      allowed: false,
      autoAdopted: false,
      reason: 'IMPERSONATION_DETECTED',
    };
  }
}
