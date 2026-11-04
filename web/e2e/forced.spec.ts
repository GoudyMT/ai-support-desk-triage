import { expect, test } from '@playwright/test';
import { openLearn } from './helpers';
import { next } from './learnKit';

// Forced colors drop backgrounds: a bar that is only a color on a color disappears, and so does the button that
// says which view is in use. Each is drawn by an outline or a border in a system color instead.
test.use({ forcedColors: 'active' });

const FILLED_STEPS = 2;

test.describe('in forced colors', () => {
  test('shows the loading bars of the steps and the view in use', async ({ page, browserName }) => {
    // WebKit does not emulate forced colors; Chromium and Firefox cover this.
    test.skip(browserName === 'webkit', 'WebKit does not emulate forced colors');
    await openLearn(page);
    for (let n = 0; n < FILLED_STEPS; n += 1) await next(page).click();
    const seen = await page.evaluate(() => {
      const page = getComputedStyle(document.body).backgroundColor;
      const segments = [...document.querySelectorAll<HTMLElement>('#bars span')].map((span) => {
        const fill = span.querySelector<HTMLElement>('i');
        return {
          full: fill?.style.width === '100%',
          track: getComputedStyle(span).borderTopWidth,
          trackColor: getComputedStyle(span).borderTopColor,
          fill: fill === null ? '' : getComputedStyle(fill).backgroundColor,
        };
      });
      const view = (id: string) => {
        const style = getComputedStyle(document.getElementById(id) as Element);
        return { outline: style.outlineStyle, width: style.outlineWidth };
      };
      return { page, segments, learn: view('view-learn'), see: view('view-see') };
    });
    const done = seen.segments.filter((segment) => segment.full);
    expect(done).toHaveLength(FILLED_STEPS);
    for (const segment of seen.segments) {
      // Every segment has an edge, so the bar can be seen, and a finished one is filled in a color of its own.
      expect(Number.parseFloat(segment.track)).toBeGreaterThanOrEqual(1);
      expect(segment.trackColor).not.toBe('rgba(0, 0, 0, 0)');
    }
    for (const segment of done) expect(segment.fill).not.toBe(seen.page);
    // The view in use has a ring, the other none.
    expect(seen.learn.outline).toBe('solid');
    expect(Number.parseFloat(seen.learn.width)).toBeGreaterThanOrEqual(2);
    expect(seen.see.outline).toBe('none');
  });
});
