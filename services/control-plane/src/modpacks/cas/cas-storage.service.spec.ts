import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { CasStorageService } from './cas-storage.service';
import { CasObjectEntity } from '@database/entities/cas-object.entity';

describe('CasStorageService (RF-STO-05, L-07)', () => {
  let service: CasStorageService;
  let tempCacheRoot: string;
  let mockCasRepo: any;
  let inMemoryCas: CasObjectEntity[];

  beforeEach(async () => {
    tempCacheRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cas-test-'));
    inMemoryCas = [];

    mockCasRepo = {
      save: jest.fn().mockImplementation(async (entity) => {
        const idx = inMemoryCas.findIndex((e) => e.sha256 === entity.sha256);
        if (idx >= 0) {
          inMemoryCas[idx] = entity;
        } else {
          inMemoryCas.push(entity);
        }
        return entity;
      }),
      findOne: jest.fn().mockImplementation(async (options) => {
        if (options?.where?.sha256) {
          return inMemoryCas.find((e) => e.sha256 === options.where.sha256) || null;
        }
        if (options?.where?.sha1) {
          return inMemoryCas.find((e) => e.sha1 === options.where.sha1) || null;
        }
        if (Array.isArray(options?.where)) {
          for (const cond of options.where) {
            const found = inMemoryCas.find((e) => (cond.sha256 && e.sha256 === cond.sha256) || (cond.sha1 && e.sha1 === cond.sha1));
            if (found) return found;
          }
        }
        return null;
      }),
      find: jest.fn().mockImplementation(async (options) => {
        let list = [...inMemoryCas];
        if (options?.order?.lastAccessedAt === 'ASC') {
          list.sort((a, b) => a.lastAccessedAt.getTime() - b.lastAccessedAt.getTime());
        }
        if (options?.take) {
          list = list.slice(0, options.take);
        }
        return list;
      }),
      delete: jest.fn().mockImplementation(async (sha256) => {
        inMemoryCas = inMemoryCas.filter((e) => e.sha256 !== sha256);
        return { affected: 1 };
      }),
    };

    const mockConfigService = {
      storage: {
        sharedCachePath: tempCacheRoot,
      },
    };

    service = new CasStorageService(mockConfigService as any, mockCasRepo);
  });

  afterEach(async () => {
    await fs.promises.rm(tempCacheRoot, { recursive: true, force: true });
  });

  it('deve calcular hashes criptográficos SHA-256 e SHA-1 corretamente', () => {
    const data = Buffer.from('Minecraft Fabric Mod content');
    const sha256 = service.computeSha256(data);
    const sha1 = service.computeSha1(data);

    expect(sha256).toHaveLength(64);
    expect(sha1).toHaveLength(40);
  });

  it('deve armazenar arquivo no CAS e registrar metadados no TypeORM (RF-STO-05)', async () => {
    const content = Buffer.from('fake jar binary data');
    const fileName = 'lithium-mc1.20.1.jar';

    const obj = await service.store(content, fileName);

    expect(obj.fileName).toBe(fileName);
    expect(obj.fileSize).toBe(content.length);
    expect(fs.existsSync(obj.storagePath)).toBe(true);
    expect(await fs.promises.readFile(obj.storagePath, 'utf-8')).toBe('fake jar binary data');
    expect(mockCasRepo.save).toHaveBeenCalled();
  });

  it('deve obter objeto por SHA-256 e atualizar timestamp lastAccessedAt (LRU tracking)', async () => {
    const content = Buffer.from('fast-render-mod');
    const stored = await service.store(content, 'fast-render.jar');

    const originalAccessTime = stored.lastAccessedAt;
    // Pequena pausa artificial para diferenciar o timestamp
    stored.lastAccessedAt = new Date(Date.now() - 5000);

    const hit = await service.getByHash(stored.sha256);
    expect(hit).toBeDefined();
    expect(hit!.sha256).toBe(stored.sha256);
    expect(hit!.lastAccessedAt.getTime()).toBeGreaterThan(originalAccessTime.getTime() - 5000);
  });

  it('deve copiar ou criar hardlink para o destino final /data/mods/ (RF-STO-05)', async () => {
    const content = Buffer.from('jei-mod-binary');
    const stored = await service.store(content, 'jei.jar');

    const destDir = path.join(tempCacheRoot, 'mock-server', 'mods');
    const destFile = path.join(destDir, 'jei.jar');

    const mode = await service.copyOrLinkTo(stored.sha256, destFile);

    expect(['linked', 'copied']).toContain(mode);
    expect(fs.existsSync(destFile)).toBe(true);
    expect(await fs.promises.readFile(destFile, 'utf-8')).toBe('jei-mod-binary');
  });

  it('deve lançar NotFoundException ao tentar linkar hash inexistente', async () => {
    await expect(service.copyOrLinkTo('nonexistenthash', '/tmp/anywhere')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deve purgar arquivos com lastAccessedAt mais antigo quando invocado cleanLru (RF-STO-05)', async () => {
    // Armazena 3 arquivos com datas de acesso escalonadas
    const obj1 = await service.store(Buffer.from('mod1'), 'mod1.jar');
    obj1.lastAccessedAt = new Date(Date.now() - 30000);

    const obj2 = await service.store(Buffer.from('mod2'), 'mod2.jar');
    obj2.lastAccessedAt = new Date(Date.now() - 20000);

    const obj3 = await service.store(Buffer.from('mod3'), 'mod3.jar');
    obj3.lastAccessedAt = new Date(Date.now());

    expect(inMemoryCas).toHaveLength(3);

    // Força cleanLru com limiar 0% para simular volume cheio (> 85%)
    const result = await service.cleanLru(0);

    expect(result.purgedCount).toBe(3);
    expect(inMemoryCas).toHaveLength(0);
    expect(fs.existsSync(obj1.storagePath)).toBe(false);
  });
});
