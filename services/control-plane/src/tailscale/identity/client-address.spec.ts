import { parseClientAddress } from './client-address';

describe('parseClientAddress (#130)', () => {
  it.each([
    ['100.64.0.7', '100.64.0.7'],
    ['100.64.0.7:51234', '100.64.0.7'],
    ['fd7a:115c:a1e0::d338:4809', 'fd7a:115c:a1e0::d338:4809'],
    ['[fd7a:115c:a1e0::d338:4809]:25565', 'fd7a:115c:a1e0::d338:4809'],
    ['[fd7a:115c:a1e0::1]', 'fd7a:115c:a1e0::1'],
    ['::ffff:100.64.0.7', '100.64.0.7'],
    ['[::ffff:100.64.0.7]:443', '100.64.0.7'],
    ['::1', '::1'],
    [' 100.64.0.7 ', '100.64.0.7'],
  ])('%s -> %s', (raw, expected) => {
    expect(parseClientAddress(raw)).toBe(expected);
  });

  it.each(['', 'fd7a', 'player.example.com:25565', '100.64.0.7:abc', '[fd7a::1]:x', '999.1.1.1'])(
    'refuses %p',
    (raw) => {
      expect(parseClientAddress(raw)).toBeNull();
    },
  );
});
