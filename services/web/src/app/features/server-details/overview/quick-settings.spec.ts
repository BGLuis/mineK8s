import {
  QuickSettings,
  diffSettings,
  hasChanges,
  validateSleepMinutes,
  validateStopWarningMinutes,
  validateSubdomain,
} from './quick-settings';

const INITIAL: QuickSettings = {
  memoryMb: 4096,
  sleepMinutes: '15',
  stopWarningMinutes: '10',
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

describe('validateStopWarningMinutes (#204)', () => {
  it('accepts 0 (warning off) up to 1440', () => {
    expect(validateStopWarningMinutes('0')).toBeNull();
    expect(validateStopWarningMinutes('1440')).toBeNull();
  });

  it.each(['', '1441', '-1', '1.5', 'abc'])('rejects "%s"', (value) => {
    expect(validateStopWarningMinutes(value)).not.toBeNull();
  });
});

describe('diffSettings', () => {
  it('reports nothing when nothing changed', () => {
    expect(hasChanges(diffSettings(INITIAL, { ...INITIAL }))).toBe(false);
  });

  it('sends the subdomain to PATCH /domain and every other field, memory included, to PATCH /:id', () => {
    const changes = diffSettings(INITIAL, {
      memoryMb: 6144,
      sleepMinutes: '30',
      stopWarningMinutes: '5',
      subdomain: 'novo',
      maintenance: true,
      autoWake: false,
    });

    expect(changes.domain).toBe('novo');
    expect(changes.patch).toEqual({
      allocated_memory_mb: 6144,
      sleep_timeout_minutes: 30,
      stop_warning_minutes: 5,
      is_maintenance: true,
      auto_wake: false,
    });
  });

  it('sends only the memory when nothing else changed', () => {
    const changes = diffSettings(INITIAL, { ...INITIAL, memoryMb: 8192 });

    expect(changes.domain).toBeNull();
    expect(changes.patch).toEqual({ allocated_memory_mb: 8192 });
    expect(hasChanges(changes)).toBe(true);
  });
});
