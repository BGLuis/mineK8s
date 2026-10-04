import { NICK_PATTERN, validateNick } from './nick';

describe('validateNick (C-06: 3 to 16 letters, digits or underscore)', () => {
  it('rejects 2 characters even though the backend DTO still accepts them', () => {
    expect(validateNick('ab')).not.toBeNull();
  });

  it('accepts exactly 3 characters', () => {
    expect(validateNick('abc')).toBeNull();
  });

  it('accepts exactly 16 characters', () => {
    expect(validateNick('a'.repeat(16))).toBeNull();
  });

  it('rejects 17 characters', () => {
    expect(validateNick('a'.repeat(17))).not.toBeNull();
  });

  it('accepts letters, digits and underscores', () => {
    expect(validateNick('Steve_99')).toBeNull();
  });

  it.each(['Steve!', 'a b c', 'João', 'x-y-z', '../..'])('rejects symbols and spaces inside: %s', (nick) => {
    expect(validateNick(nick)).not.toBeNull();
  });

  it('ignores spaces around the nick, which keyboards tend to add', () => {
    expect(validateNick('  Steve ')).toBeNull();
  });

  it('asks for a nick when empty', () => {
    expect(validateNick('   ')).toMatch(/informe/i);
  });

  it('exposes the same rule as a pattern', () => {
    expect(NICK_PATTERN.test('abc')).toBe(true);
    expect(NICK_PATTERN.test('ab')).toBe(false);
  });
});
