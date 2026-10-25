import { describe, expect, it } from 'vitest';
import { formatAccessReason } from './access-reason';

describe('formatAccessReason', () => {
  it('formats allowed ADMIN', () => {
    expect(
      formatAccessReason({
        allowed: true,
        reason: 'ADMIN_BYPASS',
        grantedBy: { kind: 'ADMIN' },
      }),
    ).toBe('Administrador (acesso a todos os mundos)');
  });

  it('formats allowed POLICY PUBLIC and INTERNET', () => {
    expect(
      formatAccessReason({
        allowed: true,
        reason: 'POLICY_PUBLIC',
        grantedBy: { kind: 'POLICY', policy: 'PUBLIC' },
      }),
    ).toBe('Mundo público');

    expect(
      formatAccessReason({
        allowed: true,
        reason: 'POLICY_INTERNET',
        grantedBy: { kind: 'POLICY', policy: 'INTERNET' },
      }),
    ).toBe('Mundo aberto na internet');
  });

  it('formats allowed GROUP with names or fallback map', () => {
    expect(
      formatAccessReason({
        allowed: true,
        reason: 'GROUP_MATCH',
        grantedBy: { kind: 'GROUP', groupIds: ['g1'], groupNames: ['VIP'] },
      }),
    ).toBe('Pelo grupo VIP');

    expect(
      formatAccessReason({
        allowed: true,
        reason: 'GROUP_MATCH',
        grantedBy: { kind: 'GROUP', groupIds: ['g1', 'g2'], groupNames: ['VIP', 'Mods'] },
      }),
    ).toBe('Pelos grupos VIP, Mods');

    const map = new Map([
      ['g1', 'Amigos'],
      ['g2', 'Builders'],
    ]);
    expect(
      formatAccessReason(
        {
          allowed: true,
          reason: 'GROUP_MATCH',
          grantedBy: { kind: 'GROUP', groupIds: ['g1'] },
        },
        map,
      ),
    ).toBe('Pelo grupo Amigos');

    expect(
      formatAccessReason({
        allowed: true,
        reason: 'GROUP_MATCH',
        grantedBy: { kind: 'GROUP', groupIds: [] },
      }),
    ).toBe('Por grupo de acesso');
  });

  it('formats allowed DIRECT', () => {
    expect(
      formatAccessReason({
        allowed: true,
        reason: 'INDIVIDUAL_ALLOWED',
        grantedBy: { kind: 'DIRECT' },
      }),
    ).toBe('Acesso direto');
  });

  it('formats denied reasons', () => {
    expect(
      formatAccessReason({
        allowed: false,
        reason: 'MAINTENANCE_MODE',
      }),
    ).toBe('Mundo em manutenção');

    expect(
      formatAccessReason({
        allowed: false,
        reason: 'INSUFFICIENT_GROUPS',
      }),
    ).toBe('Nenhum grupo do jogador tem este mundo');

    expect(
      formatAccessReason({
        allowed: false,
        reason: 'INDIVIDUAL_ACCESS_DENIED',
      }),
    ).toBe('Sem acesso direto a este mundo');

    expect(
      formatAccessReason({
        allowed: false,
        reason: 'USER_INACTIVE',
      }),
    ).toBe('Conta inativa');

    expect(
      formatAccessReason({
        allowed: false,
        reason: 'UNKNOWN_REASON',
      }),
    ).toBe('Acesso negado');
  });
});
