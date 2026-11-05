import { describe, expect, it } from 'vitest';
import { panelOffset } from './sourcePanel';

// A panel hangs from the left edge of its row; on a phone the row can sit far enough right that the panel
// would run off the screen, and the visitor could not read the end of the words.
describe('where a source panel sits', () => {
  it('stays put when it fits', () => {
    expect(panelOffset(16, 300, 1280)).toBe(0);
  });

  it('moves left by what runs past the right edge, leaving the margin', () => {
    expect(panelOffset(200, 343, 375)).toBe(375 - 8 - 343 - 200);
  });

  it('keeps its left edge on the screen when it is wider than the screen', () => {
    expect(panelOffset(40, 500, 375)).toBe(8 - 40);
  });

  it('stays put at the exact edge of the margin', () => {
    expect(panelOffset(8, 359, 375)).toBe(0);
  });
});
