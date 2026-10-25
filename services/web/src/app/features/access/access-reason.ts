import type { AccessGrantedBy } from '../../core/api';

export interface AccessReasonContext {
  allowed: boolean;
  reason: string;
  grantedBy?: AccessGrantedBy | null;
}

/**
 * Traduz a avaliação e justificativa de acesso para texto legível em português (#212).
 */
export function formatAccessReason(
  context: AccessReasonContext,
  groupNameById?: ReadonlyMap<string, string> | Record<string, string>,
): string {
  if (context.allowed) {
    const grantedBy = context.grantedBy;
    if (grantedBy?.kind === 'ADMIN') {
      return 'Administrador (acesso a todos os mundos)';
    }
    if (grantedBy?.kind === 'POLICY') {
      if (grantedBy.policy === 'PUBLIC') return 'Mundo público';
      if (grantedBy.policy === 'INTERNET') return 'Mundo aberto na internet';
    }
    if (grantedBy?.kind === 'GROUP') {
      const names: string[] = [];
      if (grantedBy.groupNames && grantedBy.groupNames.length > 0) {
        names.push(...grantedBy.groupNames);
      } else if (grantedBy.groupIds && groupNameById) {
        for (const gid of grantedBy.groupIds) {
          const name =
            groupNameById instanceof Map
              ? groupNameById.get(gid)
              : (groupNameById as Record<string, string>)[gid];
          if (name) names.push(name);
        }
      }
      if (names.length === 1) return `Pelo grupo ${names[0]}`;
      if (names.length > 1) return `Pelos grupos ${names.join(', ')}`;
      return 'Por grupo de acesso';
    }
    if (grantedBy?.kind === 'DIRECT') {
      return 'Acesso direto';
    }
    return 'Acesso permitido';
  }

  switch (context.reason) {
    case 'MAINTENANCE_MODE':
      return 'Mundo em manutenção';
    case 'INSUFFICIENT_GROUPS':
      return 'Nenhum grupo do jogador tem este mundo';
    case 'INDIVIDUAL_ACCESS_DENIED':
      return 'Sem acesso direto a este mundo';
    case 'USER_INACTIVE':
      return 'Conta inativa';
    default:
      return 'Acesso negado';
  }
}
