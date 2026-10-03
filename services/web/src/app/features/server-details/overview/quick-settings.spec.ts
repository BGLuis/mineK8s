import {
  QuickSettings,
  diffSettings,
  hasChanges,
  validateSleepMinutes,
  validateSubdomain,
} from './quick-settings';

const INITIAL: QuickSettings = {
  memoryMb: 4096,
  sleepMinutes: '15',
  subdomain: 'survival',
  maintenance: false,
  autoWake: true,
};

describe('validateSubdomain (RFC 1123 label, same rule as UpdateDomainDto)', () => {
  it.each(['survival', 'mundo-2', 'a1', 'x'.repeat(63)])('accepts %s', (value) => {
    expect(validateSubdomain(value)).toBeNull();
  });

  it.each([
    '',
    'a',
    'x'.repeat(64),
    'Survival',
    '-mundo',
    'mundo-',
    'meu mundo',
    'mundo.local',
    'ação',
  ])('rejects "%s"', (value) => {
    expect(validateSubdomain(value)).not.toBeNull();
  });
});

describe('validateSleepMinutes', () => {
  it('accepts 0 (hibernation off) up to 1440', () => {
    expect(validateSleepMinutes('0')).toBeNull();
    expect(validateSleepMinutes('1440')).toBeNull();
  });

  it.each(['', '1441', '-1', '1.5', 'abc'])('rejects "%s"', (value) => {
    expect(validateSleepMinutes(value)).not.toBeNull();
  });
});

describe('diffSettings', () => {
  it('reports nothing when nothing changed', () => {
    expect(hasChanges(diffSettings(INITIAL, { ...INITIAL }))).toBe(false);
  });

  it('routes subdomain and settings to the real endpoints and only memory to the mock', () => {
    const changes = diffSettings(INITIAL, {
      memoryMb: 6144,
      sleepMinutes: '30',
      subdomain: 'novo',
      maintenance: true,
      autoWake: false,
    });

    expect(changes.domain).toBe('novo');
    expect(changes.patch).toEqual({
      sleep_timeout_minutes: 30,
      is_maintenance: true,
      auto_wake: false,
    });
    expect(changes.memory).toEqual({ allocated_memory_mb: 6144 });
  });

  it('keeps domain and patch empty when only memory changed, which is still mock-backed', () => {
    const changes = diffSettings(INITIAL, { ...INITIAL, memoryMb: 8192 });

    expect(changes.domain).toBeNull();
    expect(changes.patch).toEqual({});
    expect(changes.memory).toEqual({ allocated_memory_mb: 8192 });
    expect(hasChanges(changes)).toBe(true);
  });
});
