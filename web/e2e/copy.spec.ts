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

test.describe('Going out', () => {
  test('says that a simulated reviewer closes the tickets, and how often', async ({ page }) => {
    await open(page);
    await expect(page.locator('#outgoing .col-head-note')).toHaveText(
      'A simulated reviewer stands in for a person here. It closes one ticket every 1.5 seconds.',
    );
  });
});

test.describe('the key to the closed list', () => {
  test('is closed until asked for, then names each mark, with the arrow every other opener has', async ({ page }) => {
    await open(page);
    const toggle = page.getByRole('button', { name: 'What these mean' });
    const list = page.locator('#closed-key');
    const turn = () => toggle.locator('.chevron').evaluate((node) => getComputedStyle(node).transform);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(list).toBeHidden();
    const closed = await turn();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(list.locator('li')).toHaveText([
      'Auto: no person needed.',
      "Flagged: a person checked it and kept the model's category.",
      "Overridden: the reviewer changed the model's category.",
      'Missed: it needed a person and did not get one.',
      'You: your own review.',
    ]);
    await expect.poll(turn).not.toBe(closed);
    await toggle.click();
    await expect(list).toBeHidden();
    await expect.poll(turn).toBe(closed);
  });

  test('opens and closes from the keyboard', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'What these mean' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#closed-key')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('#closed-key')).toBeHidden();
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
