import { squareCrop } from './server-icon';

describe('squareCrop', () => {
  it('keeps a square as it is', () => {
    expect(squareCrop(200, 200)).toEqual({ x: 0, y: 0, size: 200 });
  });

  it('takes the centre of a landscape picture', () => {
    expect(squareCrop(1920, 1080)).toEqual({ x: 420, y: 0, size: 1080 });
  });

  it('takes the centre of a portrait picture', () => {
    expect(squareCrop(600, 1000)).toEqual({ x: 0, y: 200, size: 600 });
  });

  it('rounds an odd margin to a whole pixel', () => {
    expect(squareCrop(101, 50)).toEqual({ x: 26, y: 0, size: 50 });
  });
});
