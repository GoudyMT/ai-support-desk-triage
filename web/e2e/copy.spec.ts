import { expect, test } from '@playwright/test';
import { SEED, open, playToFirstOpen, reviewButton } from './helpers';

// Words a first-time visitor reads: each row pins one sentence the page must say, so a change to the
// copy has to be a deliberate one.
test.describe('the title block', () => {
  test('says what the demo is under the title', async ({ page }) => {
    await open(page);
    await expect(page.locator('#purpose')).toHaveText(
      "A live demo. Made-up support tickets go through a trained model and safety rules, and a person checks the doubtful ones. The model has never seen these tickets' wording.",
    );
  });
});

test.describe('what the review form says', () => {
  test('tells the viewer what is scored and what is not', async ({ page }) => {
    await playToFirstOpen(page);
    await reviewButton(page, 'T-1001-0').click();
    await expect(page.locator('#review .muted')).toHaveText(
      'Your category and priority are scored against the true answer. The team is not scored.',
    );
  });
});

test.describe('what the real speed result says', () => {
  test('explains the second pass in plain words and keeps the simulated reviews line', async ({ page }) => {
    await page.goto(`/?seed=${SEED}`);
    await page.getByRole('button', { name: /^Run the last \d+ tickets at real speed$/ }).click();
    const result = page.locator('#ticket .result');
    await expect(result).toContainText(
      'We ran all 130 tickets again with no pacing and no cards drawn, so you see how fast the software really is. The page measures it in your browser.',
    );
    await expect(result).not.toContainText('This is the same run');
    await expect(result).toContainText("Reviews are simulated, so this is the software's speed, not a person's.");
  });
});
