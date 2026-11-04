import { expect, test, type Page } from '@playwright/test';
import {
  FAST_STATUS,
  FIRST_OPEN_MS,
  SEED,
  SLOW_STATUS,
  SLOW_TEST_MS,
  WHY_READY_MS,
  moreNumber,
  open,
  playToBusyDay,
  playToFirstOpen,
  playUntilOpenCount,
  reviewButton,
  runPlaying,
  runUntilOpen,
  stat,
  tabTo,
} from './helpers';

test.describe.configure({ timeout: SLOW_TEST_MS });

// Ticket T-1001-1 is flagged later with the picks Urgent Complaint, Medium and the Escalations
// Team, where the simulated reviewer would choose Account Access.
const PROBE_SETTLE_MS = 300;
const FREED_PX = 200;
const OPEN_CARDS = 13;
const CARDS_THAT_FIT = 6;
const MIN_TAG_GAP_PX = 4;
const REVIEWER_CLOSE_MS = 1_600;
const MAX_STEPS = 120;
const TOTAL_TICKETS = 130;

test.describe('the run, by keyboard alone', () => {
  test('goes from Play through a review to Run complete at real speed', async ({ page }) => {
    await open(page);
    await tabTo(page, 'Play');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText(SLOW_STATUS);
    await page.clock.runFor(FIRST_OPEN_MS);

    await tabTo(page, 'Review', true);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'You are reviewing T-1001-0' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Category')).toBeFocused();
    await tabTo(page, 'Confirm');
    await page.keyboard.press('Enter');
    await expect(page.locator('#review')).toBeHidden();
    // Focus lands on a control that still exists: the first one, which says Pause while the run plays.
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
    await expect(page.locator('#outgoing .closed li', { hasText: 'T-1001-0' })).toContainText('You');

    // One ticket is closed (by the viewer), so 129 are left to finish, but the measured pass is all 130;
    // the frozen test clock measures 0 ms and gives no rate.
    await tabTo(page, /^Run the last 129 tickets at real speed$/, true);
    await page.keyboard.press('Enter');
    await expect(page.locator('#status')).toHaveText('Run complete');
    await expect(stat(page, 'Tickets done')).toHaveText(String(TOTAL_TICKETS));
    await expect(page.getByRole('heading', { name: 'Run complete at real speed' })).toBeFocused();
    await expect(page.locator('#ticket')).toContainText('130 tickets through every stage in 0 ms.');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
  });
});

test.describe('the measured real speed result', () => {
  test('shows how long the whole run took and the rate, on the real clock', async ({ page }) => {
    await page.goto(`/?seed=${SEED}`);
    // Learn opens first and keeps the board behind it; See The Process plays at once.
    await page.getByRole('button', { name: 'See The Process' }).click();
    await page.getByRole('button', { name: /^Run the last \d+ tickets at real speed$/ }).click();
    await expect(page.locator('#status')).toHaveText('Run complete');
    await expect(page.getByRole('heading', { name: 'Run complete at real speed' })).toBeVisible();
    await expect(page.locator('#ticket')).toContainText(
      /130 tickets through every stage in \d+ ms, about [\d,]+ tickets a second\./,
    );
    await expect(page.locator('#ticket')).toContainText('Reviews are simulated');
    await page.getByRole('button', { name: 'All numbers' }).click();
    await expect(moreNumber(page, 'Tickets per second')).toHaveText(/^[\d.]+$/);
  });
});

test.describe('reviewing a ticket', () => {
  test('starts from the model picks, keeps the team with the category, and shows no reviewer answer', async ({ page }) => {
    await playToFirstOpen(page);
    // The open card already names the team the model's category sends the ticket to.
    await expect(page.locator('#outgoing .open li', { hasText: 'T-1001-0' })).toContainText('Billing Team');
    await reviewButton(page, 'T-1001-0').click();
    const category = page.getByLabel('Category');
    const priority = page.getByLabel('Priority');
    const team = page.getByLabel('Team');
    await expect(category).toHaveValue('Billing');
    await expect(priority).toHaveValue('Medium');
    await expect(team).toHaveValue('Billing Team');
    // The team follows the category until the viewer picks a team.
    await category.selectOption('Account Access');
    await expect(team).toHaveValue('Account Support');
    await team.selectOption('General Support');
    await category.selectOption('Security Concern');
    await expect(team).toHaveValue('General Support');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.getByRole('button', { name: 'All numbers' }).click();
    await expect(moreNumber(page, 'Your reviews correct')).toHaveText(/^\d of 1$/);

    await runUntilOpen(page, 'T-1001-1');
    await reviewButton(page, 'T-1001-1').click();
    await expect(page.locator('#review h2')).toHaveText('You are reviewing T-1001-1');
    await expect(category).toHaveValue('Urgent Complaint');
    await expect(priority).toHaveValue('Medium');
    await expect(team).toHaveValue('Escalations Team');
    for (const area of ['#review h2', '#review .why', '#review .ticket-text']) {
      expect(await page.locator(area).innerText()).not.toContain('Account Access');
    }
  });

  test('hands the ticket back to the open list and returns focus to a control that exists', async ({ page }) => {
    await playToFirstOpen(page);
    await reviewButton(page, 'T-1001-0').click();
    await page.getByRole('button', { name: 'Hand back to the reviewer' }).click();
    await expect(page.locator('#review')).toBeHidden();
    await expect(reviewButton(page, 'T-1001-0')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  });

  test('keeps focus on a Review button while the lists change under it', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    const buttons = page.locator('#outgoing .open').getByRole('button');
    for (let n = 0; n < MAX_STEPS && (await buttons.count()) < 3; n += 1) {
      await runPlaying(page, 1000);
    }
    expect(await buttons.count()).toBeGreaterThanOrEqual(3);
    const last = buttons.last();
    const name = await last.getAttribute('aria-label');
    await last.focus();
    // The simulated reviewer closes the top card and new tickets arrive meanwhile.
    await page.clock.runFor(REVIEWER_CLOSE_MS);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(name);
  });
});

test.describe('the right column', () => {
  test('collapses to a rail with the pending count while every ticket keeps moving', async ({ page }) => {
    await playToFirstOpen(page);
    const centerWidth = async () => (await page.locator('#center').boundingBox())?.width ?? 0;
    const openWidth = await centerWidth();
    await page.getByRole('button', { name: 'Collapse' }).click();
    // The center takes the room the column gives up: the column is 280 px and its rail 72 px.
    const railWidth = await centerWidth();
    expect(railWidth - openWidth).toBeGreaterThanOrEqual(FREED_PX);
    const rail = page.getByRole('button', { name: 'Show tickets going out, 1 pending human review' });
    await expect(rail).toBeFocused();
    await expect(rail.locator('.rail-count')).toHaveText('1');
    await expect(reviewButton(page, 'T-1001-0')).toBeHidden();
    await expect(stat(page, 'Tickets done')).toHaveText('0');
    await page.clock.runFor(REVIEWER_CLOSE_MS);
    await expect(stat(page, 'Tickets done')).toHaveText('1');
    const emptyRail = page.getByRole('button', { name: 'Show tickets going out, 0 pending human review' });
    await expect(emptyRail.locator('.rail-count')).toHaveText('0');
    await emptyRail.click();
    await expect(page.getByRole('button', { name: 'Collapse' })).toBeFocused();
    expect(await centerWidth()).toBe(openWidth);
    await expect(page.locator('#outgoing .closed li', { hasText: 'T-1001-0' })).toBeVisible();
  });
});

test.describe('open cards', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('are short enough that six of thirteen show without scrolling the column', async ({ page }) => {
    await open(page);
    await playUntilOpenCount(page, OPEN_CARDS);
    const fit = await page.evaluate(() => {
      const column = document.getElementById('outgoing')?.getBoundingClientRect();
      const boxes = [...document.querySelectorAll('#outgoing .open > li')].map((card) => card.getBoundingClientRect());
      return boxes.filter((box) => column !== undefined && box.bottom <= column.bottom).length;
    });
    expect(fit).toBeGreaterThanOrEqual(CARDS_THAT_FIT);
  });
});

// The smallest clear space between a card's priority tag and its Review button, over all open cards.
// Two boxes are apart by the larger of their horizontal and vertical gaps (zero or less: they touch).
function tagToButtonGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const gaps = [...document.querySelectorAll('#outgoing .open > li')].map((card) => {
      const tag = card.querySelector('.tag')?.getBoundingClientRect();
      const button = card.querySelector('button')?.getBoundingClientRect();
      if (tag === undefined || button === undefined) return -Infinity;
      return Math.max(button.left - tag.right, tag.left - button.right, button.top - tag.bottom, tag.top - button.bottom);
    });
    return Math.min(...gaps);
  });
}

for (const [name, width, height] of [
  ['1280', 1280, 800],
  ['375', 375, 812],
] as const) {
  test.describe(`open cards at ${name} px`, () => {
    test.use({ viewport: { width, height } });

    test('keep a visible gap between the priority tag and the Review button', async ({ page }) => {
      await open(page);
      await playUntilOpenCount(page, OPEN_CARDS);
      if (width < 1024) await page.getByRole('tab', { name: /Going out/ }).click();
      expect(await tagToButtonGap(page)).toBeGreaterThanOrEqual(MIN_TAG_GAP_PX);
    });
  });
}

test.describe('what the viewer hears', () => {
  test('speaks each stage at learn pace and stays quiet on the busy day', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Step' }).click();
    await page.getByRole('button', { name: 'Step' }).click();
    const spoken = await page.locator('#ticket .say').innerText();
    expect(spoken).not.toBe('');
    await expect(page.locator('#announcer')).toHaveText(spoken);

    await page.getByRole('button', { name: 'Play' }).click();
    await playToBusyDay(page, 5000);
    await expect(page.locator('#status')).toHaveText(FAST_STATUS);
    const ticket = await page.locator('#ticket .now .ticket-title').innerText();
    const quiet = await page.locator('#announcer').innerText();
    await page.clock.runFor(10_000);
    expect(await page.locator('#ticket .now .ticket-title').innerText()).not.toBe(ticket);
    await expect(page.locator('#announcer')).toHaveText(quiet);
  });
});

test.describe('the stage rows in the center', () => {
  test('are all there from Intake, waiting with no text, and fill in as each stage is reached', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Step' }).click();
    const rows = page.locator('#ticket .line-detail');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('#ticket .now-stage')).toHaveText('Now: Intake');
    for (const row of await rows.all()) {
      await expect(row.locator('.dots')).toBeVisible();
      await expect(row.locator('.line-text')).toBeHidden();
      await expect(row).toContainText('Waiting');
    }
    for (let n = 0; n < MAX_STEPS && (await page.locator('#ticket .now-stage').innerText()) !== 'Now: Privacy'; n += 1) {
      await page.getByRole('button', { name: 'Step' }).click();
    }
    await expect(rows.nth(0).locator('.line-text')).toBeVisible();
    await expect(rows.nth(0).locator('.sr-only')).toBeHidden();
    await expect(rows.nth(0).locator('.dots')).toBeHidden();
    await expect(rows.nth(1).locator('.line-text')).toBeHidden();
    await expect(rows.nth(1)).toContainText('Waiting');
    await expect(rows.nth(2)).toContainText('Waiting');
  });
});

test.describe('All numbers', () => {
  test('looks expandable: a chevron that turns when the panel opens', async ({ page }) => {
    await open(page);
    const toggle = page.locator('#more-toggle');
    const chevron = toggle.locator('.chevron');
    const turn = () => chevron.evaluate((node) => getComputedStyle(node).transform);
    await expect(chevron).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const closed = await turn();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#numbers')).toBeVisible();
    await expect.poll(turn).not.toBe(closed);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(turn).toBe(closed);
  });
});

test.describe('Why this choice', () => {
  // Opened at Intake it would show an empty list: nothing has been decided yet.
  test('is not offered until the ticket has a result to explain', async ({ page }) => {
    await open(page);
    const toggle = page.getByRole('button', { name: 'Why this choice' });
    const stage = page.locator('#ticket .now-stage');
    await page.getByRole('button', { name: 'Step' }).click();
    await expect(stage).toHaveText('Now: Intake');
    await expect(toggle).toBeHidden();
    for (let n = 0; n < MAX_STEPS && (await stage.innerText()) !== 'Now: Privacy'; n += 1) {
      await page.getByRole('button', { name: 'Step' }).click();
    }
    await expect(stage).toHaveText('Now: Privacy');
    await expect(toggle).toBeVisible();
  });

  test('adds the note on the highlighted words once Classify is reached, and not before', async ({ page }) => {
    await open(page);
    const stage = page.locator('#ticket .now-stage');
    const note = page.locator('#ticket .why-note');
    const stepTo = async (name: string) => {
      for (let n = 0; n < MAX_STEPS && (await stage.innerText().catch(() => '')) !== name; n += 1) {
        await page.getByRole('button', { name: 'Step' }).click();
      }
    };
    await stepTo('Now: Privacy');
    await page.getByRole('button', { name: 'Why this choice' }).click();
    await expect(page.locator('#ticket .why-list')).toBeVisible();
    await expect(note).toBeHidden();
    await stepTo('Now: Classify');
    await expect(note).toHaveText(
      'The highlighted words moved the model most. It counts words and does not read meaning, so small words can show up.',
    );
  });
});

test.describe('reduced motion', () => {
  test('declares no transition or animation on any element and runs none', async ({ page }) => {
    const longest = () =>
      page.evaluate(() => {
        const seconds = (value: string) => Math.max(...value.split(',').map((part) => parseFloat(part)));
        return Math.max(...[...document.querySelectorAll('*')].map((node) => seconds(getComputedStyle(node).transitionDuration)));
      });
    const animated = () =>
      page.evaluate(() => [...document.querySelectorAll('*')].filter((node) => getComputedStyle(node).animationName !== 'none').length);
    // Reduced motion is set before the page loads, so the Learn row shown at load never holds a fade that
    // WebKit would keep on a hidden button; the control below still switches it on and off mid-run.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    // One Step puts a ticket in the center with its three stage rows still waiting (the twinkling dots).
    await page.getByRole('button', { name: 'Step' }).click();
    await expect(page.locator('#ticket .dots').first()).toBeVisible();
    // Control: with motion allowed the buttons fade and the dots twinkle, so the checks below can tell the difference.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await longest()).toBeGreaterThan(0);
    expect(await animated()).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Play' }).click();
    for (let n = 0; n < 6; n += 1) {
      await page.clock.runFor(4000);
      expect(await longest()).toBe(0);
      expect(await animated()).toBe(0);
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    }
  });
});

test.describe('a phone-width screen', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  const fits = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  test('never scrolls sideways, in any panel', async ({ page }) => {
    await open(page);
    expect(await fits(page)).toBe(true);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(WHY_READY_MS);
    await page.getByRole('button', { name: 'All numbers' }).click();
    await page.getByRole('button', { name: 'Why this choice' }).click();
    await page.clock.runFor(FIRST_OPEN_MS - WHY_READY_MS);
    expect(await fits(page)).toBe(true);
    await page.getByRole('tab', { name: /Going out/ }).click();
    await reviewButton(page, 'T-1001-0').click();
    await expect(page.locator('#review')).toBeVisible();
    expect(await fits(page)).toBe(true);
  });

  test('puts the current ticket above two tabs that swap the lists and show the pending count', async ({ page }) => {
    await playToFirstOpen(page);
    const coming = page.getByRole('tab', { name: /Coming in/ });
    const going = page.getByRole('tab', { name: /Going out/ });
    await expect(going).toContainText('1 pending');
    await expect(coming).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#incoming')).toBeVisible();
    await expect(page.locator('#outgoing')).toBeHidden();
    const ticketBox = await page.locator('#center').boundingBox();
    const tabsBox = await coming.boundingBox();
    expect(ticketBox?.y ?? Infinity).toBeLessThan(tabsBox?.y ?? 0);

    await going.click();
    await expect(going).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#outgoing')).toBeVisible();
    await expect(page.locator('#incoming')).toBeHidden();
    await expect(reviewButton(page, 'T-1001-0')).toBeVisible();
    await coming.click();
    await expect(page.locator('#incoming')).toBeVisible();
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

test.describe('the content security policy', () => {
  test('is in the page, and nothing the page does breaks it', async ({ page }) => {
    const violations: string[] = [];
    await page.addInitScript(() => {
      const seen: string[] = [];
      Object.assign(window, { seen });
      document.addEventListener('securitypolicyviolation', (event) => seen.push(event.violatedDirective));
    });
    const read = () => page.evaluate(() => (window as unknown as { seen: string[] }).seen);
    page.on('console', (message) => {
      if (/content security policy|refused to/i.test(message.text())) violations.push(message.text());
    });
    await open(page);
    expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toBe("default-src 'self'");
    // Control: an inline style, which the policy refuses, is seen by the listener.
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = 'csp-probe';
      probe.setAttribute('style', 'color: red');
      document.body.append(probe);
    });
    // The event is queued (WebKit sends it three times, a moment apart), so it is waited for
    // and let settle before the list is cleared.
    await expect.poll(async () => (await read()).length).toBeGreaterThan(0);
    await page.waitForTimeout(PROBE_SETTLE_MS);
    await page.evaluate(() => {
      document.getElementById('csp-probe')?.remove();
      (window as unknown as { seen: string[] }).seen.length = 0;
    });
    violations.length = 0;

    await page.getByRole('button', { name: 'Play' }).click();
    await page.clock.runFor(WHY_READY_MS);
    await page.getByRole('button', { name: 'Why this choice' }).click();
    await page.clock.runFor(FIRST_OPEN_MS - WHY_READY_MS);
    await page.getByRole('button', { name: 'All numbers' }).click();
    await page.getByRole('button', { name: 'Collapse' }).click();
    await page.getByRole('button', { name: /^Show tickets going out/ }).click();
    await reviewButton(page, 'T-1001-0').click();
    await page.getByRole('button', { name: 'Hand back to the reviewer' }).click();
    await page.clock.runFor(60_000);
    await page.getByRole('button', { name: /at real speed$/ }).click();
    await expect(page.locator('#status')).toHaveText('Run complete');
    expect(await read()).toEqual([]);
    expect(violations).toEqual([]);
  });
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
    await expect(page.locator('#learn-controls')).toBeVisible();
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
    // The seed line lives in the All numbers panel, closed until asked for.
    await expect(page.locator('#seed-line')).toBeHidden();
    await page.getByRole('button', { name: 'All numbers' }).click();
    await expect(page.locator('#seed-line')).toBeVisible();
    await expect(page.locator('#seed-line')).toContainText(`Seed ${SEED}`);
    await expect(page.getByRole('link', { name: 'replay this run with the same seed' })).toHaveAttribute(
      'href',
      `?seed=${SEED}`,
    );
  });

  test('names the tickets after the seed', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Step' }).click();
    await expect(page.locator('#ticket .now .ticket-title')).toHaveText(`Ticket T-${SEED}-0`);
  });
});
