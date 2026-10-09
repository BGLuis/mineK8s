const UNITS: Record<string, number> = {
  '': 1,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
};

/** Kubernetes memory quantity ("512Mi", "123456Ki", "2G") in bytes. */
export function memoryQuantityToBytes(quantity: string): number {
  const match = /^(\d+(?:\.\d+)?)([KMGT]i?)?$/.exec(quantity.trim());
  if (!match) {
    throw new Error(`Unsupported memory quantity "${quantity}"`);
  }
  return Math.round(Number(match[1]) * UNITS[match[2] ?? '']);
}
