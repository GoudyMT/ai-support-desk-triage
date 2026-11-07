import { expect, test } from '@playwright/test';
import { DEMO_PATH } from './helpers';

test('Under the Hood has a way back to the desk', async ({ page }) => {
  await page.goto('/under-the-hood.html');
  await page.getByRole('link', { name: 'Back to the desk' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /You are the support team/ })).toBeVisible();
});

test('the site root opens the desk with its title and heading', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Support Desk - AI Support Desk Triage');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'You are the support team. Tickets reach your desk already sorted.',
    }),
  ).toBeVisible();
});

test('Under the Hood opens at its own address with its own title', async ({ page }) => {
  await page.goto(DEMO_PATH);
  await expect(page).toHaveTitle('Under the Hood - AI Support Desk Triage');
});
