import { expect, test } from '@playwright/test';

test('the built page opens with its title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Under the Hood - AI Support Desk Triage');
});
