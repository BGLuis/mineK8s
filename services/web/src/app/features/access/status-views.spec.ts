import { InviteStatus } from '../../core/api';
import {
  DEVICE_STATUS_VIEW,
  INVITE_STATUS_VIEW,
  inviteUsageText,
  isInviteActionable,
} from './status-views';

describe('invite status view', () => {
  it('maps every backend status to its pt-BR label and tone', () => {
    expect(INVITE_STATUS_VIEW.Active).toEqual({ label: 'ATIVO', tone: 'success' });
    expect(INVITE_STATUS_VIEW.Depleted).toEqual({ label: 'ESGOTADO', tone: 'neutral' });
    expect(INVITE_STATUS_VIEW.Expired).toEqual({ label: 'EXPIRADO', tone: 'neutral' });
    expect(INVITE_STATUS_VIEW.Revoked).toEqual({ label: 'REVOGADO', tone: 'danger' });
  });

  it('lets only active invites be copied or revoked', () => {
    const statuses: InviteStatus[] = ['Active', 'Depleted', 'Expired', 'Revoked'];
    expect(statuses.filter(isInviteActionable)).toEqual(['Active']);
  });

  it('shows usage and expiry, with no expiry once revoked', () => {
    const expiresAt = new Date(2026, 9, 15, 12).toISOString();
    expect(inviteUsageText({ usedCount: 2, maxUses: 3, expiresAt, status: 'Active' })).toBe(
      '2/3 usos · expira 15/10',
    );
    expect(inviteUsageText({ usedCount: 4, maxUses: 20, expiresAt, status: 'Revoked' })).toBe(
      '4/20 usos · expira —',
    );
  });
});

describe('device status view', () => {
  it('labels the VPN state the way the table shows it', () => {
    expect(DEVICE_STATUS_VIEW.ACTIVE).toEqual({ label: 'Ativo', tone: 'success' });
    expect(DEVICE_STATUS_VIEW.PENDING).toEqual({ label: 'Pendente', tone: 'warning' });
    expect(DEVICE_STATUS_VIEW.REVOKED).toEqual({ label: 'Banido', tone: 'danger' });
  });
});
