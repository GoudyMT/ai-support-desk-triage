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

test.describe('the note that the run is slowed down', () => {
  test('shows from the start, goes when the fourth ticket enters the center, and moves nothing', async ({ page }) => {
    await open(page);
    const note = page.locator('#pace');
    const ticketTop = async () => (await page.locator('#ticket').boundingBox())?.y ?? Number.NaN;
    await expect(note).toBeVisible();
    await expect(note).toHaveText('Slowed down so you can read each step. It speeds up after the first 3 tickets.');
    const before = await ticketTop();
    await page.getByRole('button', { name: 'Play' }).click();
    // Three tickets take 20 s each; the fourth enters the center at 60 s.
    await page.clock.runFor(SLOW_TICKETS_MS - 1000);
    await expect(note).toBeVisible();
    await page.clock.runFor(2000);
    await expect(note).toBeHidden();
    expect(await ticketTop()).toBe(before);
    // Polite, not a live region: it is a plain line that nothing announces.
    await expect(note).not.toHaveAttribute('aria-live', /.+/);
    await expect(page.locator('#announcer')).not.toContainText('Slowed down');
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

const SLOW_TICKETS_MS = 60_000;
const DAY_STEP_MS = 5000;
const DAY_LIMIT = 200;

test.describe('the end of a paced run', () => {
  test('says no more tickets are coming while the reviewer finishes the open ones, then offers the timing pass alone', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    const idle = page.locator('#ticket .idle');
    for (let n = 0; n < DAY_LIMIT && !(await idle.innerText()).startsWith('No more tickets'); n += 1) {
      await page.clock.runFor(DAY_STEP_MS);
    }
    await expect(idle).toHaveText('No more tickets coming. The reviewer is finishing the open ones.');
    await expect(page.locator('#status')).not.toHaveText('Run complete');

    for (let n = 0; n < DAY_LIMIT && (await page.locator('#status').innerText()) !== 'Run complete'; n += 1) {
      await page.clock.runFor(DAY_STEP_MS);
    }
    await expect(page.locator('#status')).toHaveText('Run complete');
    await expect(idle).toHaveText('Run complete');
    await expect(page.locator('#announcer')).toHaveText('Run complete.');
    // Nothing is left to run, so the only button is the one that times the pass.
    await expect(page.getByRole('button', { name: /^Run the last/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'See how fast this runs at real speed' }).click();
    await expect(page.getByRole('heading', { name: 'Run complete at real speed' })).toBeFocused();
    await expect(page.locator('#ticket .result')).toContainText('130 tickets through every stage in');
    await expect(page.locator('#status')).toHaveText('Run complete');
    await expect(page.getByRole('button', { name: /real speed$/ })).toHaveCount(0);
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
