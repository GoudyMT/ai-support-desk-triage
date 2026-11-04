import type { Page } from '@playwright/test';

// The parts of Learn The Process that the learn specs look at.
export const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
export const block = (page: Page) => page.locator('.learn-block');
export const count = (page: Page) => page.locator('#learn-controls .bar-status');
