import { HttpErrorResponse } from '@angular/common/http';

import { Modpack, ModpackVersion } from '../../core/api/models';
import {
  PROFILE_OPTIONS,
  WizardState,
  buildCreateServerDto,
  createServerErrorMessage,
  formatSpeed,
  initialWizardState,
  loaderToServerType,
  progressStepText,
  provisioningSteps,
  slugifySubdomain,
  validateNetwork,
  validateProfile,
  validateResources,
  validateSubdomain,
} from './create-server.model';

const modpack: Modpack = {
  id: 'cobblemon-official',
  name: 'Cobblemon Official Modpack',
  summary: '',
  source: 'MODRINTH',
  downloads: 1,
};

const version: ModpackVersion = {
  id: 'cobblemon-official-v1.0.0',
  name: '1.0.0 (Release)',
  gameVersion: '1.20.1',
  loader: 'fabric',
  releaseType: 'release',
  datePublished: '2026-01-15',
};

function state(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...initialWizardState(),
    profile: 'PAPER',
    gameVersion: '1.21.1',
    name: '  Sobrevivência ',
    subdomain: 'sobrevivencia',
    ...overrides,
  };
}

describe('buildCreateServerDto', () => {
  it('maps a plain profile to server_type, version, resources and access policy', () => {
    const dto = buildCreateServerDto(
      state({
        profile: 'NEOFORGE',
        memoryMb: 12288,
        sleepTimeoutMinutes: 30,
        autoWake: false,
        accessPolicy: 'INDIVIDUAL',
      }),
    );

    expect(dto).toEqual({
      name: 'Sobrevivência',
      subdomain: 'sobrevivencia',
      server_type: 'NEOFORGE',
      game_version: '1.21.1',
      allocated_memory_mb: 12288,
      sleep_timeout_minutes: 30,
      auto_wake: false,
      access_policy: 'INDIVIDUAL',
    });
    expect(dto.modpack_id).toBeUndefined();
  });

  it('offers Purpur and sends it as server_type', () => {
    expect(PROFILE_OPTIONS.map((option) => option.value)).toContain('PURPUR');
    expect(buildCreateServerDto(state({ profile: 'PURPUR' })).server_type).toBe('PURPUR');
  });

  it('takes loader, game version and modpack_id from the chosen modpack version', () => {
    const dto = buildCreateServerDto(
      state({
        profile: 'MODPACK',
        gameVersion: '1.99',
        modpack,
        modpackVersion: { ...version, loader: 'NeoForge', gameVersion: '1.21.1' },
      }),
    );

    expect(dto.server_type).toBe('NEOFORGE');
    expect(dto.game_version).toBe('1.21.1');
    expect(dto.modpack_id).toBe('cobblemon-official');
  });

  it('never sends INTERNET: that policy is set later through Publicar', () => {
    const dto = buildCreateServerDto(state());
    expect(dto.access_policy).toBe('GROUP');
    expect(['PUBLIC', 'GROUP', 'INDIVIDUAL']).toContain(dto.access_policy);
  });
});

describe('loaderToServerType', () => {
  it('maps the loaders the control plane can run and rejects the rest', () => {
    expect(loaderToServerType('fabric')).toBe('FABRIC');
    expect(loaderToServerType('Forge')).toBe('FORGE');
    expect(loaderToServerType('neoforge')).toBe('NEOFORGE');
    expect(loaderToServerType('quilt')).toBeNull();
  });
});

describe('subdomain validation (RFC 1123 label, 2-63 chars)', () => {
  it.each(['ab', 'survival', 'a1-b2', 'a'.repeat(63)])('accepts %s', (value) => {
    expect(validateSubdomain(value)).toBeNull();
  });

  it.each([
    ['a', 'too short'],
    ['a'.repeat(64), 'too long'],
    ['-abc', 'leading hyphen'],
    ['abc-', 'trailing hyphen'],
    ['Abc', 'uppercase'],
    ['a_b', 'underscore'],
    ['a.b', 'dot'],
    ['sobrevivência', 'accent'],
  ])('rejects %s (%s)', (value) => {
    expect(validateSubdomain(value)).not.toBeNull();
  });

  it('derives a valid label from a display name', () => {
    expect(slugifySubdomain('  Sobrevivência do Zé! ')).toBe('sobrevivencia-do-ze');
    expect(validateSubdomain(slugifySubdomain('Meu Mundo #1'))).toBeNull();
  });
});

describe('step validation', () => {
  it('requires a profile, and a modpack plus a supported version for modpacks', () => {
    expect(validateProfile(state({ profile: null }))['profile']).toBeDefined();
    expect(validateProfile(state({ profile: 'MODPACK' }))['modpack']).toBeDefined();
    expect(validateProfile(state({ profile: 'MODPACK', modpack }))['modpackVersion']).toBeDefined();
    expect(
      validateProfile(
        state({ profile: 'MODPACK', modpack, modpackVersion: { ...version, loader: 'quilt' } }),
      )['modpackVersion'],
    ).toBeDefined();
    expect(
      validateProfile(state({ profile: 'MODPACK', modpack, modpackVersion: version })),
    ).toEqual({});
    expect(validateProfile(state({ gameVersion: '  ' }))['gameVersion']).toBeDefined();
  });

  it('keeps memory within 1024-65536 MB and sleep within 0-1440 minutes', () => {
    expect(validateResources(state({ memoryMb: 1024, sleepTimeoutMinutes: 0 }))).toEqual({});
    expect(validateResources(state({ memoryMb: 65536, sleepTimeoutMinutes: 1440 }))).toEqual({});
    expect(validateResources(state({ memoryMb: 1023 }))['memory']).toBeDefined();
    expect(validateResources(state({ memoryMb: 65537 }))['memory']).toBeDefined();
    expect(validateResources(state({ sleepTimeoutMinutes: 1441 }))['sleep']).toBeDefined();
    expect(validateResources(state({ sleepTimeoutMinutes: -1 }))['sleep']).toBeDefined();
    expect(validateResources(state({ sleepTimeoutMinutes: Number.NaN }))['sleep']).toBeDefined();
  });

  it('requires a 2-100 character name and a valid subdomain', () => {
    expect(validateNetwork(state())).toEqual({});
    expect(validateNetwork(state({ name: ' a ' }))['name']).toBeDefined();
    expect(validateNetwork(state({ name: 'x'.repeat(101) }))['name']).toBeDefined();
    expect(validateNetwork(state({ subdomain: 'Bad Name' }))['subdomain']).toBeDefined();
  });
});

describe('provisioningSteps', () => {
  it('marks earlier steps done and the active one current', () => {
    const steps = provisioningSteps('DOWNLOADING');
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'pending', 'pending']);
    expect(steps[2].label).toBe('Baixando arquivos (DOWNLOADING)');
  });

  it('marks every step done on COMPLETED', () => {
    expect(provisioningSteps('COMPLETED').every((s) => s.state === 'done')).toBe(true);
  });

  it('flags the step that was running when the task FAILED', () => {
    const steps = provisioningSteps('FAILED', 'RESOLVING');
    expect(steps.map((s) => s.state)).toEqual(['done', 'failed', 'pending', 'pending', 'pending']);
  });
});

describe('progress text', () => {
  it('formats speed in decimal units with a pt-BR comma', () => {
    expect(formatSpeed(4_200_000)).toBe('4,2 MB/s');
    expect(formatSpeed(512)).toBe('512 B/s');
    expect(formatSpeed(undefined)).toBe('');
  });

  it('joins step, file count and speed', () => {
    expect(
      progressStepText({
        taskId: 't',
        serverId: 's',
        status: 'DOWNLOADING',
        progressPercent: 45,
        downloadedFiles: 142,
        totalFiles: 318,
        currentStep: 'Baixando mods',
        speedBytesPerSec: 4_200_000,
      }),
    ).toBe('Baixando mods · 142 de 318 arquivos · 4,2 MB/s');
  });
});

describe('createServerErrorMessage', () => {
  it('explains a duplicated subdomain on 409', () => {
    const error = new HttpErrorResponse({ status: 409 });
    expect(createServerErrorMessage(error)).toContain('endereço já está em uso');
  });

  it('explains a full disk by its code, not as a duplicated subdomain', () => {
    const error = new HttpErrorResponse({
      status: 507,
      error: { statusCode: 507, code: 'DISK_USAGE_BLOCKED', message: 'Host disk is 86% full' },
    });

    const message = createServerErrorMessage(error);

    expect(message).toContain('disco');
    expect(message).not.toContain('endereço');
  });

  it('shows the validation message of a 400', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { message: ['name must be longer than 2 characters', 'subdomain invalid'] },
    });
    expect(createServerErrorMessage(error)).toBe(
      'name must be longer than 2 characters subdomain invalid',
    );
  });
});
