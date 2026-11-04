import { describe, expect, it } from 'vitest';
import { scrollToClear } from './clearOfBar';

// Rows are a focused element's top and bottom edge and the bar's top edge, in pixels from the top of the screen.
describe('how far to scroll so a focused control is above the bar', () => {
  it.each([
    // [top, bottom, barTop, scroll]
    [100, 144, 700, 0],
    [600, 700, 700, 0],
    [660, 712, 700, 20],
    [720, 764, 700, 72],
  ])('a control from %i to %i over a bar at %i scrolls %i', (top, bottom, barTop, scroll) => {
    expect(scrollToClear(top, bottom, barTop)).toBe(scroll);
  });

  // Focus on the body, or on a list taller than the screen, is not a control to bring into view.
  it('does not scroll for an element that does not fit above the bar', () => {
    expect(scrollToClear(-800, 5000, 700)).toBe(0);
    expect(scrollToClear(100, 2000, 700)).toBe(0);
  });
});
