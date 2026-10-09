import { memoryQuantityToBytes } from './memory-quantity';

describe('memoryQuantityToBytes', () => {
  it.each([
    ['5632Mi', 5632 * 1024 ** 2],
    ['123456Ki', 123456 * 1024],
    ['2G', 2e9],
    ['1Gi', 1024 ** 3],
    ['1048576', 1048576],
  ])('converts %s', (quantity, bytes) => {
    expect(memoryQuantityToBytes(quantity)).toBe(bytes);
  });

  it('rejects quantities it cannot read instead of reporting a wrong size', () => {
    expect(() => memoryQuantityToBytes('12e3')).toThrow('Unsupported memory quantity');
  });
});
