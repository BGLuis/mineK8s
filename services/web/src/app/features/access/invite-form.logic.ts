export interface InviteFormValues {
  name: string;
  days: string;
  maxUses: string;
}

export interface InviteFormErrors {
  name: string;
  days: string;
  maxUses: string;
}

export const INVITE_LIMITS = {
  name: { min: 3, max: 100 },
  days: { min: 1, max: 90 },
  maxUses: { min: 1, max: 500 },
} as const;

function integerError(raw: string, min: number, max: number, what: string): string {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    return `Informe ${what} entre ${min} e ${max}.`;
  }
  const number = Number(value);
  return number < min || number > max ? `Use ${what} entre ${min} e ${max}.` : '';
}

/** Mirrors CreateInviteDto: name 3-100, expiresInDays 1-90, maxUses 1-500. Empty string means valid. */
export function validateInvite(values: InviteFormValues): InviteFormErrors {
  const name = values.name.trim();
  const { name: nameLimit, days, maxUses } = INVITE_LIMITS;
  return {
    name:
      name.length < nameLimit.min || name.length > nameLimit.max
        ? `O nome deve ter entre ${nameLimit.min} e ${nameLimit.max} caracteres.`
        : '',
    days: integerError(values.days, days.min, days.max, 'uma validade'),
    maxUses: integerError(values.maxUses, maxUses.min, maxUses.max, 'um número de usos'),
  };
}

export function hasErrors(errors: InviteFormErrors): boolean {
  return Object.values(errors).some((message) => message !== '');
}
