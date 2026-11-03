import { expect, test, type Page } from '@playwright/test';

// Seed 1001 runs on fold 1. Its first ticket (T-1001-0) is flagged and the model's picks
// for it are Billing and Medium; the second (T-1001-1) is flagged with the model's picks
// Urgent Complaint and Medium, where the simulated reviewer would choose Account Access.
const SEED = 1001;
const START = new Date('2026-01-01T09:00:00');
const COMPLETE_RUN_MS = 300_000;
const STEPS_TO_FIRST_REVIEW = 4;
const MAX_TABS = 25;

// Opens the page with the clock under the test's control: nothing moves until `runFor`.
async function open(page: Page, query = `?seed=${SEED}`): Promise<void> {
  await page.clock.install({ time: START });
  await page.goto(`/${query}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
}

async function activeLabel(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
}

// Presses Tab until the named control has focus; keyboard only, so no pointer and no focus().
async function tabTo(page: Page, name: string): Promise<void> {
  for (let n = 0; n < MAX_TABS; n += 1) {
    await page.keyboard.press('Tab');
    if ((await activeLabel(page)) === name) return;
  }
  throw new Error(`test: Tab never reached ${name}`);
}

function numberOf(page: Page, label: string) {
  return page.locator('#numbers .row', { hasText: label }).locator('.num');
}

test.describe('the run, by keyboard alone', () => {
  test('goes from Play to Run complete at real speed', async ({ page }) => {
    await open(page);
    await tabTo(page, 'Play');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Act 1 of 2 - learn speed');
    // Step is disabled while playing, so the next Tab stop is Learn speed, then Real speed.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: 'Real speed' })).toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(COMPLETE_RUN_MS);
    await expect(page.locator('#status')).toHaveText('Run complete');
    await expect(numberOf(page, 'Tickets done')).toHaveText('130');
    await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  test('pauses, steps, explains, takes over and confirms', async ({ page }) => {
    await open(page);
    await tabTo(page, 'Play');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Paused');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Step' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.stage-lit .stage-name')).toHaveText('2 Privacy');
    await tabTo(page, 'Explain');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Explain' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#current summary')).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Hand back to the reviewer' })).toBeVisible();
    // Back from Take over to Step (past Explain, Real speed and Learn speed), then step on
    // until the first flagged ticket waits for the viewer.
    for (let n = 0; n < 4; n += 1) await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Step' })).toBeFocused();
    for (let n = 0; n < STEPS_TO_FIRST_REVIEW - 1; n += 1) await page.keyboard.press('Enter');
    await expect(page.locator('#take-over')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Category')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Confirm and continue' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#take-over')).toBeHidden();
    // Focus returns to the first control, which says Play because this run was paused.
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused();
    await expect(numberOf(page, 'Your reviews correct')).toHaveText(/^\d of 1$/);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('moves no element while stages change', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    const boxes = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.stage, .stage-name, .stage-count, .panel, .btn, h1, #stages')].map((node, i) => {
          const box = node.getBoundingClientRect();
          return `${i}|${box.x}|${box.y}${node.classList.contains('stage') ? `|${box.width}|${box.height}` : ''}`;
        }),
      );
    const before = await boxes();
    const captions = new Set<string>();
    for (let n = 0; n < 12; n += 1) {
      await page.clock.runFor(4000);
      captions.add(await page.locator('#stages').innerText());
      expect(await boxes()).toEqual(before);
    }
    // The stages did change while nothing moved.
    expect(captions.size).toBeGreaterThan(3);
  });
});

test.describe('a phone-width screen', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('never scrolls sideways', async ({ page }) => {
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    await open(page);
    expect(await fits()).toBe(true);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(30_000);
    expect(await fits()).toBe(true);
    await page.getByRole('button', { name: 'Explain' }).click();
    await expect(page.locator('#current summary')).toBeVisible();
    expect(await fits()).toBe(true);
    await page.getByRole('button', { name: 'Take over' }).click();
    while (await page.locator('#take-over').isHidden()) {
      await page.getByRole('button', { name: 'Step' }).click();
    }
    expect(await fits()).toBe(true);
  });
});

test.describe('what the page fetches', () => {
  for (const seed of [1001, 1002]) {
    test(`loads only fold_${seed % 4}.json for seed ${seed}, and nothing from another origin`, async ({ page, baseURL }) => {
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await open(page, `?seed=${seed}`);
      await page.getByRole('button', { name: 'Play' }).click();
      await page.clock.runFor(20_000);
      expect(requests.filter((url) => url.includes('/models/'))).toEqual([`${baseURL}/models/fold_${seed % 4}.json`]);
      expect(requests.filter((url) => !url.startsWith(`${baseURL}/`))).toEqual([]);
    });
  }
});

test.describe('a model that does not load', () => {
  test('shows the error and Retry, and no ticket, when the file is missing; Retry then starts the run', async ({ page }) => {
    await page.route('**/models/*', (route) => route.fulfill({ status: 404, body: 'not found' }));
    await page.goto(`/?seed=${SEED}`);
    await expect(page.getByText('The model could not be loaded.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.locator('body').innerText()).not.toContain('T-1001-');
    await page.unroute('**/models/*');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(page.getByText('The model could not be loaded.')).toBeHidden();
  });

  test('shows the same error when the file is not a model', async ({ page }) => {
    await page.route('**/models/*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(`/?seed=${SEED}`);
    await expect(page.getByText('The model could not be loaded.')).toBeVisible();
    await expect(page.locator('#app')).toBeHidden();
    expect(await page.locator('body').innerText()).not.toContain('T-1001-');
  });
});

test.describe('Take over', () => {
  test('starts from the model picks, keeps the team with the category, and shows no reviewer answer', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Take over' }).click();
    for (let n = 0; n < STEPS_TO_FIRST_REVIEW; n += 1) await page.getByRole('button', { name: 'Step' }).click();
    const category = page.getByLabel('Category');
    const priority = page.getByLabel('Priority');
    const team = page.getByLabel('Send to');
    await expect(page.locator('#take-over')).toBeVisible();
    await expect(category).toHaveValue('Billing');
    await expect(priority).toHaveValue('Medium');
    await expect(team).toHaveValue('Billing Team');
    // The team follows the category until the viewer picks a team.
    await category.selectOption('Account Access');
    await expect(team).toHaveValue('Account Support');
    await team.selectOption('General Support');
    await category.selectOption('Security Concern');
    await expect(team).toHaveValue('General Support');
    await page.getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(numberOf(page, 'Your reviews correct')).toHaveText(/^\d of 1$/);

    // The second flagged ticket: the simulated reviewer would pick Account Access, the model says Urgent Complaint.
    while (await page.locator('#take-over').isHidden()) {
      await page.getByRole('button', { name: 'Step' }).click();
    }
    await expect(page.locator('#take-over h2')).toHaveText('Review T-1001-1');
    await expect(category).toHaveValue('Urgent Complaint');
    await expect(priority).toHaveValue('Medium');
    await expect(team).toHaveValue('Escalations Team');
    await expect(page.locator('#feed .row-current')).toHaveText(/T-1001-1 waiting for you/);
    for (const area of ['#stages', '#feed', '#announcer', '#take-over .why', '#take-over h2', '#take-over .ticket-text']) {
      expect(await page.locator(area).innerText()).not.toContain('Account Access');
    }
  });

  test('hands the ticket back to the simulated reviewer', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Take over' }).click();
    for (let n = 0; n < STEPS_TO_FIRST_REVIEW; n += 1) await page.getByRole('button', { name: 'Step' }).click();
    await expect(page.locator('#take-over')).toBeVisible();
    await page.getByRole('button', { name: 'Hand back to the reviewer' }).click();
    await expect(page.locator('#take-over')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Take over' })).toBeVisible();
    await expect(page.locator('#current li', { hasText: 'Review:' })).toContainText('the simulated reviewer chose');
  });
});

test.describe('the seed', () => {
  test('says a seed that cannot be used was not used, and still runs', async ({ page }) => {
    await open(page, '?seed=abc');
    const notice = page.locator('#notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('could not be used');
    await expect(notice).toContainText('new run with seed');
    await expect(page.locator('#seed-line')).toContainText(/Seed \d{4,10} - /);
  });

  test('shows a seed from the address with a link that replays it', async ({ page }) => {
    await open(page);
    await expect(page.locator('#notice')).toBeHidden();
    await expect(page.locator('#seed-line')).toContainText(`Seed ${SEED}`);
    await expect(page.getByRole('link', { name: 'replay this run with the same seed' })).toHaveAttribute(
      'href',
      `?seed=${SEED}`,
    );
  });

  test('names the tickets after the seed', async ({ page }) => {
    await open(page);
    await expect(page.locator('#current h2')).toHaveText(`Current ticket T-${SEED}-0`);
  });
});
