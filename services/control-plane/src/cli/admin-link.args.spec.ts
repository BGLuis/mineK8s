import { parseAdminLinkArgs, UsageError } from './admin-link.args';

describe('parseAdminLinkArgs (#131)', () => {
  it('reads a link by Tailscale user ID', () => {
    expect(parseAdminLinkArgs(['--nick', 'Steve', '--tailscale-user-id', '4242'])).toEqual({
      nick: 'Steve',
      tailscaleUserId: '4242',
      ip: undefined,
      force: false,
    });
  });

  it('reads a link by IP with --force', () => {
    expect(parseAdminLinkArgs(['--nick', 'Steve', '--ip', '100.64.0.7', '--force'])).toMatchObject({
      nick: 'Steve',
      ip: '100.64.0.7',
      force: true,
    });
  });

  it('answers --help without requiring anything else', () => {
    expect(parseAdminLinkArgs(['--help'])).toBe('help');
  });

  it.each([
    ['no nick', ['--tailscale-user-id', '1'], /--nick is required/],
    ['no source', ['--nick', 'Steve'], /Provide --tailscale-user-id or --ip/],
    ['both sources', ['--nick', 'Steve', '--ip', '100.64.0.7', '--tailscale-user-id', '1'], /mutually exclusive/],
    ['an unknown flag', ['--nick', 'Steve', '--ip', '100.64.0.7', '--frce'], /Unknown option/],
    ['a stray argument', ['--nick', 'Steve', '--ip', '100.64.0.7', 'extra'], /Unexpected argument "extra"/],
    ['a flag without its value', ['--nick'], /argument missing|requires/i],
  ])('rejects %s as a usage error', (_label, argv, message) => {
    expect(() => parseAdminLinkArgs(argv)).toThrow(UsageError);
    expect(() => parseAdminLinkArgs(argv)).toThrow(message);
  });
});
