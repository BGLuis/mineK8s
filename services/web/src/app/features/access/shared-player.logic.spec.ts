import { hasSharedPlayerErrors, validateSharedPlayer } from './shared-player.logic';

describe('validateSharedPlayer', () => {
  const valid = { email: 'amigo@example.com', nick: 'AmigoCraft' };

  it('aceita um e-mail e um nickname corretos', () => {
    expect(hasSharedPlayerErrors(validateSharedPlayer(valid))).toBe(false);
  });

  it('aceita apenas o usuário do GitHub sem e-mail', () => {
    expect(
      hasSharedPlayerErrors(
        validateSharedPlayer({ email: '', github: 'jaoppb', nick: 'AmigoCraft' }),
      ),
    ).toBe(false);
    expect(
      hasSharedPlayerErrors(
        validateSharedPlayer({ email: '', github: '@jaoppb', nick: 'AmigoCraft' }),
      ),
    ).toBe(false);
    expect(
      hasSharedPlayerErrors(
        validateSharedPlayer({ email: '', github: 'jaoppb@github', nick: 'AmigoCraft' }),
      ),
    ).toBe(false);
  });

  it('aceita ambos: e-mail e usuário do GitHub preenchidos', () => {
    expect(
      hasSharedPlayerErrors(
        validateSharedPlayer({
          email: 'joao@example.com',
          github: 'jaoppb',
          nick: 'AmigoCraft',
        }),
      ),
    ).toBe(false);
  });

  it('exige pelo menos um dos dois quando nenhum foi preenchido', () => {
    const errors = validateSharedPlayer({ email: '', github: '', nick: 'AmigoCraft' });
    expect(errors.identity).not.toBe('');
    expect(hasSharedPlayerErrors(errors)).toBe(true);
  });

  it('valida o formato do e-mail quando fornecido', () => {
    expect(validateSharedPlayer({ ...valid, email: 'amigo' }).email).not.toBe('');
    expect(validateSharedPlayer({ ...valid, email: 'amigo@' }).email).not.toBe('');
    expect(validateSharedPlayer({ ...valid, email: ' amigo@example.com ' }).email).toBe('');
  });

  it('valida o formato do usuário do GitHub quando fornecido', () => {
    expect(validateSharedPlayer({ ...valid, github: 'user/invalid' }).github).not.toBe('');
    expect(validateSharedPlayer({ ...valid, github: 'jaoppb-dev' }).github).toBe('');
  });

  it('segue o padrão de nickname do Minecraft: 3 a 16 letras, números ou _', () => {
    expect(validateSharedPlayer({ ...valid, nick: 'ab' }).nick).not.toBe('');
    expect(validateSharedPlayer({ ...valid, nick: 'a'.repeat(17) }).nick).not.toBe('');
    expect(validateSharedPlayer({ ...valid, nick: 'com espaço' }).nick).not.toBe('');
    expect(validateSharedPlayer({ ...valid, nick: 'Nick_123' }).nick).toBe('');
  });
});
