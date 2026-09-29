import {
  CurseForgeResolverService,
  CurseForgeManifest,
  CURSEFORGE_CLIENT_ONLY_BLACKLIST,
} from './curseforge-resolver.service';

describe('CurseForgeResolverService (RF-STO-12, PR-12)', () => {
  let resolver: CurseForgeResolverService;

  beforeEach(() => {
    resolver = new CurseForgeResolverService();
  });

  const mockManifest: CurseForgeManifest = {
    minecraft: {
      version: '1.20.1',
      modLoaders: [{ id: 'forge-47.2.0', primary: true }],
    },
    manifestType: 'minecraftModpack',
    manifestVersion: 1,
    name: 'All The Mods 9',
    version: '0.2.59',
    files: [
      { projectID: 101, fileID: 1001, required: true },
      { projectID: 102, fileID: 1002, required: true },
      { projectID: 103, fileID: 1003, required: true },
    ],
  };

  it('deve detectar Server Pack oficial quando serverPackFileId for válido (RF-STO-12)', () => {
    const withServerPack = {
      id: 5001,
      fileName: 'ATM9-client.zip',
      serverPackFileId: 5002,
    };

    const res = resolver.checkServerPack(withServerPack);
    expect(res.isServerPackAvailable).toBe(true);
    expect(res.serverPackFileId).toBe(5002);

    const withoutServerPack = {
      id: 5001,
      fileName: 'VanillaPlus.zip',
    };
    expect(resolver.checkServerPack(withoutServerPack).isServerPackAvailable).toBe(false);
  });

  it('deve filtrar mods da blacklist client-only no modo fallback (RF-STO-12)', () => {
    const slugMap = new Map<number, string>([
      [101, 'appleskin-client'],
      [102, 'create-forge'],
      [103, 'oculus'],
    ]);

    const { accepted, discarded } = resolver.filterClientOnlyFiles(mockManifest, slugMap);

    // appleskin-client e oculus devem ser descartados
    expect(discarded).toHaveLength(2);
    expect(discarded.map((d) => d.slug)).toEqual(['appleskin-client', 'oculus']);

    // create-forge deve ser aceito
    expect(accepted).toHaveLength(1);
    expect(accepted[0].projectID).toBe(102);
  });

  it('deve identificar corretamente os termos presentes na blacklist', () => {
    for (const term of CURSEFORGE_CLIENT_ONLY_BLACKLIST) {
      expect(resolver.isClientOnlyMod(`my-mod-${term}-1.0`)).toBe(true);
    }
    expect(resolver.isClientOnlyMod('applied-energistics-2')).toBe(false);
  });

  it('resolveDownloadUrl deve gerar URL de borda válida em fallback', async () => {
    const url = await resolver.resolveDownloadUrl(238222, 4839211);
    expect(url).toContain('https://edge.forgecdn.net/files/4839/211/');
  });
});
