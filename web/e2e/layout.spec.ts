import { expect, test, type Page } from '@playwright/test';
import { open, playToFirstOpen, reviewButton } from './helpers';

// The phone layout (stats, the current ticket, then Coming in / Going out tabs) runs below 1024 px,
// so a tablet is not squeezed into three columns; at 1024 px and up there are three.
const SIDE_MARGIN_PX = 40;

const width = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())?.width ?? 0;

test.describe('a tablet, 768 px wide', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('has the center at the full width, with tabs for the lists', async ({ page }) => {
    await open(page);
    const pageWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(await width(page, '#center')).toBeGreaterThan(pageWidth - SIDE_MARGIN_PX);
    await expect(page.getByRole('tab', { name: /Coming in/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Going out/ })).toBeVisible();
  });

  test('shows the review form with none of its choices clipped', async ({ page }) => {
    await playToFirstOpen(page);
    await page.getByRole('tab', { name: /Going out/ }).click();
    await reviewButton(page, 'T-1001-0').click();
    const center = await page.locator('#center').boundingBox();
    expect(center).not.toBeNull();
    for (const label of ['Category', 'Priority', 'Team']) {
      const box = await page.getByLabel(label).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(100);
      expect(box?.x ?? 0).toBeGreaterThanOrEqual(center?.x ?? 0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((center?.x ?? 0) + (center?.width ?? 0));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

test.describe('the edge between the two layouts', () => {
  for (const [viewport, tabs] of [
    [1023, true],
    [1024, false],
  ] as const) {
    test(`${tabs ? 'has' : 'has no'} tabs at ${viewport} px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport, height: 900 });
      await open(page);
      const tab = page.getByRole('tab', { name: /Coming in/ });
      if (tabs) await expect(tab).toBeVisible();
      else await expect(tab).toBeHidden();
      // With tabs only the chosen list shows (Coming in first); with three columns both do.
      await expect(page.locator('#outgoing')).toBeVisible({ visible: !tabs });
    });
  }
});

test.describe('a small laptop, 1024 px wide', () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test('has three columns with the center the widest', async ({ page }) => {
    await open(page);
    await expect(page.locator('#incoming')).toBeVisible();
    await expect(page.locator('#outgoing')).toBeVisible();
    const [incoming, center, outgoing] = await Promise.all([
      width(page, '#incoming'),
      width(page, '#center'),
      width(page, '#outgoing'),
    ]);
    expect(center).toBeGreaterThan(incoming);
    expect(center).toBeGreaterThan(outgoing);
  });
});
