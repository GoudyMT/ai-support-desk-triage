import { expect, test, type Locator, type Page } from '@playwright/test';
import { SEED, START } from './helpers';

const STEP_MS = 250;
const MAX_STEPS = 400;
const RUN_STEP_MS = 10_000;
const MAX_RUN_STEPS = 60;
const HOLD_MS = 60_000;
const GO_ON_MS = 30_000;
const NEW_MS = 2000;
// A press this soon after a card opens or closes is a double press and is ignored; this is a moment past that.
const SETTLE_MS = 450;
const READING = 'Paused while you read. Move away to carry on.';
const PAUSED_TRY = 'Paused while you try a ticket.';
const PAUSED_REPORT = 'Paused while you read the report.';
const MORE = /^(More numbers and report|Fewer numbers)$/;
const SEND = /^(Looks good, send it|Send with my changes)$/;
const PHONE = { width: 375, height: 812 };

// Opens the desk with the clock under the test's control: nothing moves until `runFor`.
async function openDesk(page: Page): Promise<void> {
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/?seed=${SEED}`);
}

async function start(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
}

const list = (page: Page): Locator => page.locator('#open-list');
const cards = (page: Page): Locator => page.locator('#open-list > li');
const rows = (page: Page): Locator => page.locator('#sent-list > li');
const status = (page: Page): Locator => page.locator('#status');
const dialog = (page: Page): Locator => page.getByRole('dialog');
const tryButton = (page: Page): Locator => page.getByRole('button', { name: 'Try a ticket' });
const reviewOf = (card: Locator): Locator => card.getByRole('button', { name: /^Review/ });
const approveOf = (card: Locator): Locator => card.getByRole('button', { name: /^Approve/ });

// Lets the run go on until the open list holds `count` cards.
async function runUntilCards(page: Page, count: number): Promise<void> {
  for (let step = 0; step < MAX_STEPS && (await cards(page).count()) < count; step += 1) await page.clock.runFor(STEP_MS);
  expect(await cards(page).count()).toBeGreaterThanOrEqual(count);
}

// Rests the mouse in the middle of the Needs a person list, as a viewer does who is reading a card.
async function overList(page: Page): Promise<void> {
  const box = await list(page).boundingBox();
  expect(box, 'the list has a box').not.toBeNull();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
}

// Takes the mouse to the bar's status words: a place that is no part of the list.
async function awayFromList(page: Page): Promise<void> {
  const box = await page.locator('#status-wrap').boundingBox();
  expect(box, 'the status has a box').not.toBeNull();
  await page.mouse.move((box?.x ?? 0) + 4, (box?.y ?? 0) + 4);
}

// What the run shows that must stand still while it is held: the cards in order and how many tickets have been sent.
async function held(page: Page): Promise<{ cards: (string | null)[]; sent: number }> {
  return {
    cards: await cards(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-ticket'))),
    sent: await rows(page).count(),
  };
}

// Lets the clock run `ms` and says whether anything was sent in that time.
async function goesOn(page: Page, ms = GO_ON_MS): Promise<boolean> {
  const before = await rows(page).count();
  await page.clock.runFor(ms);
  return (await rows(page).count()) > before;
}

async function finishRun(page: Page): Promise<void> {
  const toggle = page.locator('#toggle');
  for (let step = 0; step < MAX_RUN_STEPS && (await toggle.innerText()) !== 'Start'; step += 1) {
    await page.clock.runFor(RUN_STEP_MS);
  }
  await expect(toggle).toHaveText('Start');
}

// A person reading a card must not see it taken away: the simulated reviewer closes the top card on a timer, and the
// pointer over the list is the viewer saying they are looking.
test.describe('reading a card', () => {
  test('a pointer over Needs a person holds the run and says so on the bar, and leaving lets it go on', async ({ page }) => {
    await openDesk(page);
    await start(page);
    await runUntilCards(page, 2);
    await overList(page);
    await expect(status(page)).toHaveText(READING);
    const still = await held(page);
    await page.clock.runFor(HOLD_MS);
    expect(await held(page)).toEqual(still);
    await awayFromList(page);
    await expect(status(page)).not.toHaveText(READING);
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(await goesOn(page)).toBe(true);
  });

  test('keyboard focus inside the list holds the run, and tabbing out lets it go on', async ({ page }) => {
    await openDesk(page);
    await start(page);
    await runUntilCards(page, 2);
    await page.getByRole('button', { name: 'Why the order changes' }).focus();
    await page.keyboard.press('Tab');
    await expect(list(page)).toBeFocused();
    await expect(status(page)).toHaveText(READING);
    const still = await held(page);
    await page.clock.runFor(HOLD_MS);
    expect(await held(page)).toEqual(still);
    // On through the cards, from one button to the next, which must not let the hold slip.
    const inList = (): Promise<boolean> => page.evaluate(() => document.getElementById('open-list')?.contains(document.activeElement) === true);
    for (let presses = 0; presses < MAX_STEPS && (await inList()); presses += 1) {
      await expect(status(page)).toHaveText(READING);
      await page.keyboard.press('Tab');
    }
    expect(await inList()).toBe(false);
    await expect(status(page)).not.toHaveText(READING);
    expect(await goesOn(page)).toBe(true);
  });

  // The script that moves focus to the next card after an Approve is not the viewer's keyboard.
  test('a mouse Approve leaves focus on the next card, and that focus does not hold the run once the pointer leaves', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    for (let step = 0; step < MAX_STEPS; step += 1) {
      const withApprove = cards(page).filter({ has: page.getByRole('button', { name: /^Approve/ }) });
      if ((await withApprove.count()) >= 1 && (await cards(page).count()) >= 2) break;
      await page.clock.runFor(STEP_MS);
    }
    await approveOf(cards(page).filter({ has: page.getByRole('button', { name: /^Approve/ }) }).first()).click();
    await expect(page.locator('#open-list button:focus')).toHaveCount(1);
    await expect(status(page)).toHaveText(READING);
    await awayFromList(page);
    await expect(status(page)).not.toHaveText(READING);
    await expect(page.locator('#open-list button:focus')).toHaveCount(1);
    expect(await goesOn(page)).toBe(true);
  });

  test('a run that was stopped stays stopped while the pointer comes and goes', async ({ page }) => {
    await openDesk(page);
    await start(page);
    await runUntilCards(page, 2);
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    await overList(page);
    await expect(status(page)).not.toHaveText(READING);
    await awayFromList(page);
    const still = await held(page);
    await page.clock.runFor(HOLD_MS);
    expect(await held(page)).toEqual(still);
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    await expect(page.locator('#notice')).toHaveText('Stopped.');
  });

  for (const how of ['sending it', 'handing it back']) {
    test(`a review card opened from the list and closed by ${how} leaves no hold once the pointer is away`, async ({ page }) => {
      await openDesk(page);
      await start(page);
      await runUntilCards(page, 2);
      await reviewOf(cards(page).first()).click();
      await expect(dialog(page)).toBeVisible();
      await page.clock.runFor(SETTLE_MS);
      if (how === 'sending it') await dialog(page).getByRole('button', { name: SEND }).click();
      else await dialog(page).getByRole('button', { name: 'Hand back to the reviewer' }).click();
      await expect(dialog(page)).toBeHidden();
      await awayFromList(page);
      await expect(status(page)).not.toHaveText(READING);
      await expect(status(page)).not.toHaveText('Paused while you review.');
      await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
      expect(await goesOn(page)).toBe(true);
    });
  }

  // A keyboard viewer who reviews a card and presses Escape lands back in the list, still reading, until Tab takes them out.
  test('a review opened and handed back from the keyboard returns to a held list, and tabbing out lets the run go on', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    await runUntilCards(page, 2);
    await page.getByRole('button', { name: 'Why the order changes' }).focus();
    await page.keyboard.press('Tab');
    await expect(list(page)).toBeFocused();
    await reviewOf(cards(page).first()).focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(status(page)).toHaveText('Paused while you review.');
    await page.clock.runFor(SETTLE_MS);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('#open-list button:focus')).toHaveCount(1);
    await expect(status(page)).toHaveText(READING);
    const still = await held(page);
    await page.clock.runFor(HOLD_MS);
    expect(await held(page)).toEqual(still);
    await page.getByRole('button', { name: 'Why the order changes' }).focus();
    await expect(status(page)).not.toHaveText(READING);
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(await goesOn(page)).toBe(true);
  });

  // The pointer leaves while Try a ticket is open: the run is not the pointer's to start then.
  test('Try a ticket opened from the keyboard over the list keeps the run held when the pointer leaves, and it goes on after Close', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    await runUntilCards(page, 2);
    await overList(page);
    await expect(status(page)).toHaveText(READING);
    await tryButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(status(page)).toHaveText(PAUSED_TRY);
    await awayFromList(page);
    const still = await held(page);
    await page.clock.runFor(HOLD_MS);
    expect(await held(page)).toEqual(still);
    await expect(status(page)).toHaveText(PAUSED_TRY);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(status(page)).not.toHaveText(PAUSED_TRY);
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(await goesOn(page)).toBe(true);
  });

  test('a report opened from the keyboard over the list keeps the run held when the pointer leaves, and it goes on after Close report', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    await runUntilCards(page, 2);
    // Generate report waits for a ticket to have closed.
    for (let step = 0; step < MAX_STEPS && (await rows(page).count()) === 0; step += 1) await page.clock.runFor(STEP_MS);
    await page.getByRole('button', { name: MORE }).click();
    await overList(page);
    await expect(status(page)).toHaveText(READING);
    await page.getByRole('button', { name: 'Generate report' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#report')).toBeVisible();
    await expect(status(page)).toHaveText(PAUSED_REPORT);
    await awayFromList(page);
    const still = await held(page);
    await page.clock.runFor(HOLD_MS);
    expect(await held(page)).toEqual(still);
    await expect(status(page)).toHaveText(PAUSED_REPORT);
    await page.getByRole('button', { name: 'Close report' }).click();
    await expect(page.locator('#report')).toBeHidden();
    await awayFromList(page);
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(await goesOn(page)).toBe(true);
  });

  // Start in the bar closes the report and goes on: the reading hold under the report must not turn that press into a Stop.
  test('Start in the bar over a report that waited on a reading hold closes it, and the run goes on', async ({ page }) => {
    await openDesk(page);
    await start(page);
    await runUntilCards(page, 2);
    for (let step = 0; step < MAX_STEPS && (await rows(page).count()) === 0; step += 1) await page.clock.runFor(STEP_MS);
    await page.getByRole('button', { name: MORE }).click();
    await overList(page);
    await page.getByRole('button', { name: 'Generate report' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#report')).toBeVisible();
    await awayFromList(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('#report')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(await goesOn(page)).toBe(true);
  });
});

// The row of a ticket that has just been sent is outlined as a new card is, so the eye finds where it went.
test.describe('where a ticket went', () => {
  test('a sent row is outlined for about two seconds, and the outline goes while the row stays', async ({ page }) => {
    await openDesk(page);
    await start(page);
    for (let step = 0; step < MAX_STEPS && (await rows(page).count()) === 0; step += 1) await page.clock.runFor(STEP_MS);
    const id = await rows(page).first().getAttribute('data-ticket');
    const row = page.locator(`#sent-list > li[data-ticket="${id}"]`);
    await expect(row).toHaveClass(/fresh/);
    await expect(row).toHaveCSS('outline-style', 'solid');
    await page.clock.runFor(NEW_MS / 2);
    await expect(row).toHaveClass(/fresh/);
    await page.clock.runFor(NEW_MS / 2 + 100);
    await expect(row).toHaveCount(1);
    await expect(row).not.toHaveClass(/fresh/);
    await expect(row).toHaveCSS('outline-style', 'none');
  });

  // The card's team is read from the card while it is open, so the row is held to what the viewer saw.
  test('a row says Was <team> when the ticket went to a team other than its card\'s, and says nothing otherwise', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openDesk(page);
    await start(page);
    const shown = new Map<string, string>();
    for (let step = 0; step < 240; step += 1) {
      await page.clock.runFor(500);
      const now = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#open-list > li')].map((card) => [
          card.dataset['ticket'] ?? '',
          card.querySelector('.team')?.textContent ?? '',
        ]),
      );
      for (const [id, team] of now) shown.set(id ?? '', team ?? '');
    }
    const sent = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('#sent-list > li')].map((row) => ({
        id: row.dataset['ticket'] ?? '',
        team: row.querySelector('.team')?.textContent ?? '',
        how: row.querySelector('.how')?.textContent ?? '',
        was: row.querySelector('.was')?.textContent ?? null,
      })),
    );
    let changed = 0;
    let kept = 0;
    for (const row of sent) {
      const card = shown.get(row.id);
      if (card === undefined) {
        // Never a card: a ticket that went straight to its team has nothing it was.
        if (row.how === 'No person needed') expect(row.was, row.id).toBeNull();
        continue;
      }
      if (card === row.team) {
        kept += 1;
        expect(row.was, row.id).toBeNull();
      } else {
        changed += 1;
        expect(row.was, row.id).toBe(`Was ${card}`);
      }
    }
    expect(changed).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });

  test('the wide layout keeps its count line while a run plays', async ({ page }) => {
    await openDesk(page);
    await start(page);
    for (let step = 0; step < MAX_STEPS && (await rows(page).count()) === 0; step += 1) await page.clock.runFor(STEP_MS);
    await expect(status(page)).toContainText('more on the way');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: PHONE, hasTouch: true });

    // The card's flight does not show on a phone, where one list shows at a time.
    test('the bar says where the last ticket was sent', async ({ page }) => {
      await openDesk(page);
      await start(page);
      await expect(status(page)).toContainText('more on the way');
      for (let step = 0; step < MAX_STEPS && (await rows(page).count()) < 3; step += 1) await page.clock.runFor(STEP_MS);
      const team = await rows(page).first().locator('.team').textContent();
      await expect(status(page)).toHaveText(`Sent to ${team}.`);
      await page.clock.runFor(GO_ON_MS);
      const latest = await rows(page).first().locator('.team').textContent();
      await expect(status(page)).toHaveText(`Sent to ${latest}.`);
    });
  });
});

// A viewer who opens another page in the middle of a run would lose it, so during a run those pages open beside it.
test.describe('the links on the bar', () => {
  const links = (page: Page): Locator => page.locator('#bar-links a');

  async function expectHere(page: Page): Promise<void> {
    for (const link of await links(page).all()) {
      await expect(link).not.toHaveAttribute('target', /.*/);
    }
  }

  test('open in a new tab that cannot reach the desk during a run, and in the same tab at rest and after the end', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await openDesk(page);
    await expect(links(page)).toHaveCount(2);
    await expectHere(page);
    await start(page);
    for (const link of await links(page).all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /(^| )noopener( |$)/);
    }
    await runUntilCards(page, 1);
    const opened = context.waitForEvent('page');
    await page.getByRole('link', { name: 'Model History' }).click();
    const tab = await opened;
    await expect(tab).toHaveURL(/\/model-history\.html$/);
    await tab.close();
    // The run is where it was left.
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page).toHaveURL(/\/\?seed=/);
    await finishRun(page);
    await expectHere(page);
  });
});
