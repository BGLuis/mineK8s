import { MAX_EDITABLE_BYTES, checkEditable, languageFor, looksBinary } from './file-types';

describe('languageFor', () => {
  it.each([
    ['server.properties', 'properties'],
    ['bukkit.yml', 'yaml'],
    ['config.YAML', 'yaml'],
    ['ops.json', 'json'],
    ['pack.mcmeta', 'json'],
    ['paper-global.toml', 'toml'],
    ['eula.txt', 'plain'],
    ['.gitignore', 'plain'],
  ])('%s -> %s', (name, language) => {
    expect(languageFor(name)).toBe(language);
  });
});

describe('checkEditable', () => {
  it('opens small text files', () => {
    expect(checkEditable({ name: 'server.properties', size: 1200 })).toEqual({ editable: true });
    expect(checkEditable({ name: 'big.txt', size: MAX_EDITABLE_BYTES })).toEqual({
      editable: true,
    });
  });

  it('refuses known binary extensions regardless of size', () => {
    for (const name of ['server.jar', 'world.zip', 'level.dat', 'r.0.0.mca', 'icon.png']) {
      const result = checkEditable({ name, size: 10 });
      expect(result.editable).toBe(false);
      expect(result.editable === false && result.reason).toContain('binário');
    }
  });

  it('refuses files above the editor limit and says the size', () => {
    const result = checkEditable({ name: 'latest.log', size: MAX_EDITABLE_BYTES + 1 });
    expect(result.editable).toBe(false);
    expect(result.editable === false && result.reason).toContain('grande demais');
  });
});

describe('looksBinary', () => {
  it('detects NUL bytes and runs of replacement characters', () => {
    expect(looksBinary('abc\u0000def')).toBe(true);
    expect(looksBinary('�'.repeat(50) + 'a'.repeat(50))).toBe(true);
  });

  it('accepts ordinary text, including accents and a stray replacement char', () => {
    expect(looksBinary('motd=Sobrevivência\nmax-players=20\n')).toBe(false);
    expect(looksBinary('a'.repeat(1000) + '�')).toBe(false);
    expect(looksBinary('')).toBe(false);
  });
});
