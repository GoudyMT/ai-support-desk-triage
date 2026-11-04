import { describe, expect, it } from 'vitest';
import { hiddenBy } from './clearOfBar';

// A focused control whose bottom edge is below the top of the bar is partly or wholly behind it.
describe('how much of a focused control the bar covers', () => {
  it.each([
    [500, 700, 0],
    [700, 700, 0],
    [712, 700, 12],
    [900, 700, 200],
  ])('a control ending at %i over a bar starting at %i is covered by %i', (bottom, top, covered) => {
    expect(hiddenBy(bottom, top)).toBe(covered);
  });
});
