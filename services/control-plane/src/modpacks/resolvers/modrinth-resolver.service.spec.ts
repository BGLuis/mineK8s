import { ModrinthResolverService, ModrinthIndex } from './modrinth-resolver.service';

describe('ModrinthResolverService (RF-STO-11, Critério de Aceite)', () => {
  let resolver: ModrinthResolverService;

  beforeEach(() => {
    resolver = new ModrinthResolverService();
  });

  const mockIndex: ModrinthIndex = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: 'Precision Pack',
    dependencies: {
      minecraft: '1.20.1',
      'fabric-loader': '0.15.11',
    },
    files: [
      {
        path: 'mods/sodium-fabric-mc1.20.1-0.5.8.jar',
        hashes: { sha1: '3a7b', sha512: '8f2c' },
        env: { client: 'required', server: 'unsupported' },
        downloads: ['https://cdn.modrinth.com/data/sodium.jar'],
      },
      {
        path: 'mods/iris-fabric-mc1.20.1.jar',
        hashes: { sha1: '1234', sha512: '5678' },
        env: { client: 'required', server: 'unsupported' },
        downloads: ['https://cdn.modrinth.com/data/iris.jar'],
      },
      {
        path: 'mods/lithium-fabric-mc1.20.1-0.11.2.jar',
        hashes: { sha1: '4b8c', sha512: '9d1e' },
        env: { client: 'optional', server: 'required' },
        downloads: ['https://cdn.modrinth.com/data/lithium.jar'],
      },
      {
        path: 'mods/ferritecore-mc1.20.1.jar',
        hashes: { sha1: '9999', sha512: '8888' },
        env: { client: 'optional', server: 'optional' },
        downloads: ['https://cdn.modrinth.com/data/ferritecore.jar'],
      },
    ],
  };

  it('CRITÉRIO DE ACEITE: mod com env.server = unsupported NUNCA é aceito para download (RF-STO-11)', () => {
    const result = resolver.resolveServerFiles(mockIndex);

    // Sodium e Iris devem ser descartados
    expect(result.discardedFiles).toHaveLength(2);
    expect(result.discardedFiles.map((f) => f.path)).toEqual([
      'mods/sodium-fabric-mc1.20.1-0.5.8.jar',
      'mods/iris-fabric-mc1.20.1.jar',
    ]);

    // Lithium e FerriteCore devem ser aceitos
    expect(result.acceptedFiles).toHaveLength(2);
    expect(result.acceptedFiles.map((f) => f.path)).toEqual([
      'mods/lithium-fabric-mc1.20.1-0.11.2.jar',
      'mods/ferritecore-mc1.20.1.jar',
    ]);

    // O loader correto deve ter sido detectado
    expect(result.loaderType).toBe('fabric');
    expect(result.loaderVersion).toBe('0.15.11');
    expect(result.gameVersion).toBe('1.20.1');
  });

  it('deve aceitar mods que não especificam a tag env (default permissive para mods agnósticos)', () => {
    const permissiveIndex: ModrinthIndex = {
      ...mockIndex,
      files: [
        {
          path: 'mods/universal-lib.jar',
          hashes: { sha1: 'abc' },
          downloads: ['https://cdn.modrinth.com/data/universal.jar'],
        },
      ],
    };

    const result = resolver.resolveServerFiles(permissiveIndex);
    expect(result.acceptedFiles).toHaveLength(1);
    expect(result.acceptedFiles[0].path).toBe('mods/universal-lib.jar');
    expect(result.discardedFiles).toHaveLength(0);
  });

  it('deve validar o formato do modrinth.index.json e rejeitar json inválido', () => {
    expect(() => resolver.parseIndex({ game: 'othergame', files: [] })).toThrow(/incompatible game/);
    expect(() => resolver.parseIndex({ game: 'minecraft' })).toThrow(/"files" field missing/);
  });
});
