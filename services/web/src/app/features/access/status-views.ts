import { DeviceStatus, InviteStatus, InviteSummary } from '../../core/api/models';
import { formatShortDate } from './format';

export type StatusViewTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface StatusView {
  readonly label: string;
  readonly tone: StatusViewTone;
}

export const INVITE_STATUS_VIEW: Record<InviteStatus, StatusView> = {
  Active: { label: 'ATIVO', tone: 'success' },
  Depleted: { label: 'ESGOTADO', tone: 'neutral' },
  Expired: { label: 'EXPIRADO', tone: 'neutral' },
  Revoked: { label: 'REVOGADO', tone: 'danger' },
};

export const DEVICE_STATUS_VIEW: Record<DeviceStatus, StatusView> = {
  ACTIVE: { label: 'Ativo', tone: 'success' },
  PENDING: { label: 'Pendente', tone: 'warning' },
  REVOKED: { label: 'Banido', tone: 'danger' },
};

export const TONE_TEXT_CLASS: Record<StatusViewTone, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
  neutral: 'text-text-muted',
};

/** Only a live invite can still be copied or revoked. */
export function isInviteActionable(status: InviteStatus): boolean {
  return status === 'Active';
}

/** "2/3 usos · expira 15/10"; a revoked invite no longer has a meaningful expiry. */
export function inviteUsageText(
  invite: Pick<InviteSummary, 'usedCount' | 'maxUses' | 'expiresAt' | 'status'>,
): string {
  const expiry = invite.status === 'Revoked' ? '—' : formatShortDate(invite.expiresAt);
  return `${invite.usedCount}/${invite.maxUses} usos · expira ${expiry}`;
}
