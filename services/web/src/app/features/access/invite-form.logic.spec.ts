import { hasErrors, validateInvite } from './invite-form.logic';

const valid = { name: 'Amigos da escola', days: '7', maxUses: '5' };

describe('validateInvite (mirrors CreateInviteDto)', () => {
  it('accepts the default form', () => {
    expect(hasErrors(validateInvite(valid))).toBe(false);
  });

  it('requires a name of 3 to 100 characters', () => {
    expect(validateInvite({ ...valid, name: 'ab' }).name).not.toBe('');
    expect(validateInvite({ ...valid, name: 'abc' }).name).toBe('');
    expect(validateInvite({ ...valid, name: 'a'.repeat(100) }).name).toBe('');
    expect(validateInvite({ ...valid, name: 'a'.repeat(101) }).name).not.toBe('');
  });

  it('limits validity to 1-90 days', () => {
    expect(validateInvite({ ...valid, days: '0' }).days).not.toBe('');
    expect(validateInvite({ ...valid, days: '1' }).days).toBe('');
    expect(validateInvite({ ...valid, days: '90' }).days).toBe('');
    expect(validateInvite({ ...valid, days: '91' }).days).not.toBe('');
  });

  it('limits uses to 1-500', () => {
    expect(validateInvite({ ...valid, maxUses: '0' }).maxUses).not.toBe('');
    expect(validateInvite({ ...valid, maxUses: '500' }).maxUses).toBe('');
    expect(validateInvite({ ...valid, maxUses: '501' }).maxUses).not.toBe('');
  });

  it.each(['', 'abc', '1.5', '-3', '1e2'])('rejects non-integer numbers: "%s"', (value) => {
    expect(validateInvite({ ...valid, days: value }).days).not.toBe('');
  });
});
