import { defaultMotd } from './server-language';

describe('defaultMotd', () => {
  it('puts the world name first and a friendly line below, in the language of the world', () => {
    expect(defaultMotd('Sekiro', 'pt-BR')).toBe('§a§l' + 'Sekiro' + '\\n§7Entre e bom jogo!');
    expect(defaultMotd('Sekiro', 'en')).toBe('§a§l' + 'Sekiro' + '\\n§7Join in and have fun!');
  });
});
