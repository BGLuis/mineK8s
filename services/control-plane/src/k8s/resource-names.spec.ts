import { disambiguatedResourceName, MAX_RESOURCE_NAME_LENGTH } from './resource-names';

describe('disambiguatedResourceName', () => {
  const dns1123Label = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

  it('appends the suffix to a subdomain that fits', () => {
    expect(disambiguatedResourceName('hub', 'a1b2c3')).toBe('hub-a1b2c3');
  });

  it.each([
    ['at the limit', 'a'.repeat(MAX_RESOURCE_NAME_LENGTH)],
    ['longer than the limit', 'a'.repeat(63)],
    ['cut right after a hyphen', `${'a'.repeat(52)}-${'b'.repeat(10)}`],
  ])('stays a Service-safe DNS-1123 name when the subdomain is %s', (_case, subdomain) => {
    const name = disambiguatedResourceName(subdomain, 'a1b2c3');

    expect(name).toMatch(dns1123Label);
    expect(name.endsWith('-a1b2c3')).toBe(true);
    expect(`mc-${name}`.length).toBeLessThanOrEqual(63);
  });
});
