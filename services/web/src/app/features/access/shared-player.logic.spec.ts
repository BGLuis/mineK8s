import { hasSharedPlayerErrors, validateSharedPlayer } from './shared-player.logic';

describe('validateSharedPlayer', () => {
  const valid = { email: 'amigo@example.com', nick: 'AmigoCraft' };

  it('aceita um e-mail e um nickname corretos', () => {
    expect(hasSharedPlayerErrors(validateSharedPlayer(valid))).toBe(false);
  });

  it('exige que o e-mail seja de uma conta, com @ e domínio', () => {
    expect(validateSharedPlayer({ ...valid, email: 'amigo' }).email).not.toBe('');
    expect(validateSharedPlayer({ ...valid, email: 'amigo@' }).email).not.toBe('');
    expect(validateSharedPlayer({ ...valid, email: ' amigo@example.com ' }).email).toBe('');
  });

  it('segue o padrão de nickname do Minecraft: 3 a 16 letras, números ou _', () => {
    expect(validateSharedPlayer({ ...valid, nick: 'ab' }).nick).not.toBe('');
    expect(validateSharedPlayer({ ...valid, nick: 'a'.repeat(17) }).nick).not.toBe('');
    expect(validateSharedPlayer({ ...valid, nick: 'com espaço' }).nick).not.toBe('');
    expect(validateSharedPlayer({ ...valid, nick: 'Nick_123' }).nick).toBe('');
  });
});
