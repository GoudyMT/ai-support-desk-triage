import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROUTES, type Category } from '../src/domain/labels';
import { SEED, START } from './helpers';

const STEP_MS = 1000;
const MAX_STEPS = 80;
const QUICK_PERCENT = 70;
const SEND = "Looks good, send it";
const SEND_CHANGED = 'Send with my changes';
const PAUSED = 'Paused while you review.';
const RESULT = /^(Your call matched the true answer\.|The true answer was .+, (Critical|High|Medium|Low)\.)$/;
const RESULT_MS = 4000;
const NEW_MS = 2000;
// Half of the number fade, so a paused fade shows a clear mid-point.
const HALF_FADE_MS = 110;

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

// A changed number fades out and then in on the browser's own clock, not the test's, so its text is final only once the
// animations are over.
async function fadesDone(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect !== null).length), { timeout: 5000 })
    .toBe(0);
}

const cards = (page: Page): Locator => page.locator('#open-list > li');
const rows = (page: Page): Locator => page.locator('#sent-list > li');
const approveOf = (card: Locator): Locator => card.getByRole('button', { name: /^Approve/ });
const reviewOf = (card: Locator): Locator => card.getByRole('button', { name: /^Review/ });

async function percentOf(card: Locator): Promise<number> {
  const lean = await card.locator('.lean strong').innerText();
  return Number(/(\d+)% sure/.exec(lean)?.[1] ?? Number.NaN);
}

// Lets the run go on a second at a time until a card satisfying `wanted` is in the list.
async function runUntilCard(page: Page, wanted: (card: Locator) => Locator): Promise<Locator> {
  const found = (): Locator => wanted(cards(page)).first();
  for (let step = 0; step < MAX_STEPS && (await wanted(cards(page)).count()) === 0; step += 1) {
    await page.clock.runFor(STEP_MS);
  }
  await expect(found()).toBeVisible();
  return found();
}

const withApprove = (list: Locator): Locator => list.filter({ has: list.page().getByRole('button', { name: /^Approve/ }) });
const withoutApprove = (list: Locator): Locator =>
  list.filter({ hasNot: list.page().getByRole('button', { name: /^Approve/ }) });

async function idOf(card: Locator): Promise<string> {
  return (await card.getAttribute('data-ticket')) ?? '';
}

const dialog = (page: Page): Locator => page.getByRole('dialog');
const mainButton = (page: Page): Locator =>
  dialog(page).getByRole('button', { name: new RegExp(`^(${SEND}|${SEND_CHANGED})$`) });

test.describe('Approve and Review on a card', () => {
  test('Approve is on every card at 70 percent or more and on no card under it', async ({ page }) => {
    await openDesk(page);
    await start(page);
    let quick = 0;
    let slow = 0;
    for (let step = 0; step < 40; step += 1) {
      await page.clock.runFor(STEP_MS);
      for (const card of await cards(page).all()) {
        const percent = await percentOf(card);
        const approves = await approveOf(card).count();
        expect(approves, `${percent}% sure`).toBe(percent >= QUICK_PERCENT ? 1 : 0);
        await expect(reviewOf(card)).toHaveCount(1);
        if (percent >= QUICK_PERCENT) quick += 1;
        else slow += 1;
      }
    }
    expect(quick).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(0);
  });

  test('Approve sends the ticket to the shown team as "You approved" and the count falls', async ({ page }) => {
    await openDesk(page);
    await start(page);
    const card = await runUntilCard(page, withApprove);
    const id = await idOf(card);
    const lean = await card.locator('.lean strong').innerText();
    const team = /^Leaning (.+), \d+% sure\.$/.exec(lean)?.[1] ?? '';
    const before = await cards(page).count();
    await expect(page.locator('#open-count')).toHaveText(String(before));
    await approveOf(card).click();
    const row = page.locator(`#sent-list > li[data-ticket="${id}"]`);
    await expect(row.locator('.how')).toHaveText('You approved');
    await expect(row.locator('.team')).toHaveText(team);
    await expect(page.locator(`#open-list > li[data-ticket="${id}"]`)).toHaveCount(0);
    await expect(page.locator('#open-count')).toHaveText(String(before - 1));
    // The card the viewer pressed is gone, so focus moves on to a Review button in the list.
    await expect(page.locator('#open-list button:focus')).toHaveAccessibleName(/^Review/);
  });

  test('Review opens the card at the model\'s picks with focus on the main button, and the run holds', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    // Two cards, the second only just arrived: the one left behind still carries its New word, which a run that
    // is held must not take away.
    for (let step = 0; step < MAX_STEPS * 4 && (await cards(page).count()) < 2; step += 1) await page.clock.runFor(250);
    await reviewOf(cards(page).first()).click();
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#open-list .new')).toHaveCount(1);
    await expect(dialog(page).getByRole('heading', { name: 'Review this ticket' })).toBeVisible();
    await expect(dialog(page).getByRole('heading', { name: 'Why it came to you' })).toBeVisible();
    await expect(mainButton(page)).toHaveText(SEND);
    await expect(mainButton(page)).toBeFocused();
    await expect(dialog(page).getByRole('button', { name: 'Hand back to the reviewer' })).toBeVisible();
    await expect(page.getByText(PAUSED)).toBeVisible();
    for (const label of ['Category', 'Priority', 'Team']) {
      const picked = await dialog(page).getByLabel(label, { exact: true }).evaluate((select: HTMLSelectElement) => {
        return select.selectedOptions[0]?.textContent ?? '';
      });
      expect(picked, label).toContain("(model's pick)");
    }
    await fadesDone(page);
    const held = await page.locator('#run').innerText();
    await page.clock.runFor(60_000);
    await expect(dialog(page)).toBeVisible();
    await fadesDone(page);
    expect(await page.locator('#run').innerText()).toBe(held);
  });

  test('changing any pick changes the main button to "Send with my changes", and putting it back restores it', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    await reviewOf(await runUntilCard(page, (list) => list)).click();
    const team = dialog(page).getByLabel('Team', { exact: true });
    const was = await team.inputValue();
    const other = (await team.locator('option').evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value))).find(
      (value) => value !== was,
    );
    await team.selectOption(other ?? '');
    await expect(mainButton(page)).toHaveText(SEND_CHANGED);
    await team.selectOption(was);
    await expect(mainButton(page)).toHaveText(SEND);
  });

  test('the team follows the category until the viewer picks a team', async ({ page }) => {
    await openDesk(page);
    await start(page);
    await reviewOf(await runUntilCard(page, (list) => list)).click();
    const category = dialog(page).getByLabel('Category', { exact: true });
    const team = dialog(page).getByLabel('Team', { exact: true });
    const names = Object.keys(ROUTES) as Category[];
    const current = await category.inputValue();
    const [first, second] = names.filter((name) => ROUTES[name] !== ROUTES[current as Category]);
    await category.selectOption(first ?? '');
    await expect(team).toHaveValue(ROUTES[first as Category]);
    const chosen = ROUTES[current as Category];
    await team.selectOption(chosen);
    await category.selectOption(second ?? '');
    await expect(team).toHaveValue(chosen);
  });

  test('sending puts the ticket in Sent to teams as "You reviewed" with the note, shows the result and returns focus', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    // Two cards, so one is left behind for focus to land on.
    for (let step = 0; step < MAX_STEPS && (await cards(page).count()) < 2; step += 1) await page.clock.runFor(STEP_MS);
    const card = cards(page).first();
    const id = await idOf(card);
    await reviewOf(card).click();
    const team = dialog(page).getByLabel('Team', { exact: true });
    const was = await team.inputValue();
    const other = (await team.locator('option').evaluateAll((nodes) => nodes.map((n) => (n as HTMLOptionElement).value))).find(
      (value) => value !== was,
    );
    await team.selectOption(other ?? '');
    await dialog(page).getByLabel('Note for the team (optional)').fill('Please call them back first.');
    await mainButton(page).click();
    await expect(dialog(page)).toBeHidden();
    const row = page.locator(`#sent-list > li[data-ticket="${id}"]`);
    await expect(row.locator('.how')).toHaveText('You reviewed');
    await expect(row.locator('.team')).toHaveText(other ?? '');
    await expect(row.locator('.your-note')).toHaveText('Your note: Please call them back first.');
    const result = page.locator('#notice');
    await expect(result).toHaveText(RESULT);
    // The list is where focus lands: the next card's Review.
    await expect(page.locator('#open-list button:focus')).toHaveAccessibleName(/^Review/);
    await page.clock.runFor(RESULT_MS + 100);
    await expect(result).not.toHaveText(RESULT);
  });

  test('closing the last card in the list puts focus on the list heading', async ({ page }) => {
    await openDesk(page);
    await start(page);
    // The first arrival is alone in the list; the clock stops there.
    for (let step = 0; step < MAX_STEPS && (await cards(page).count()) === 0; step += 1) await page.clock.runFor(250);
    await expect(cards(page)).toHaveCount(1);
    await reviewOf(cards(page).first()).click();
    await mainButton(page).click();
    await expect(cards(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Needs a person/ })).toBeFocused();
  });

  test('Escape hands the ticket back, and the run goes on', async ({ page }) => {
    await openDesk(page);
    await start(page);
    const card = await runUntilCard(page, (list) => list);
    const id = await idOf(card);
    const before = await cards(page).count();
    await reviewOf(card).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator(`#open-list > li[data-ticket="${id}"]`)).toHaveCount(1);
    await expect(rows(page).locator('.how', { hasText: 'You reviewed' })).toHaveCount(0);
    await expect(cards(page)).toHaveCount(before);
    await expect(page.getByText(PAUSED)).toBeHidden();
    const closed = await page.locator('#n-closed').innerText();
    await page.clock.runFor(30_000);
    await expect(page.locator('#n-closed')).not.toHaveText(closed);
  });

  test('a note with markup shows as the characters typed, not as markup', async ({ page }) => {
    await openDesk(page);
    await start(page);
    const card = await runUntilCard(page, (list) => list);
    const id = await idOf(card);
    await reviewOf(card).click();
    await dialog(page).getByLabel('Note for the team (optional)').fill('<b>x</b>');
    await mainButton(page).click();
    const note = page.locator(`#sent-list > li[data-ticket="${id}"] .your-note`);
    await expect(note).toHaveText('Your note: <b>x</b>');
    await expect(note.locator('b')).toHaveCount(0);
  });

  test('the note box holds at most 500 characters', async ({ page }) => {
    await openDesk(page);
    await start(page);
    await reviewOf(await runUntilCard(page, (list) => list)).click();
    const note = dialog(page).getByLabel('Note for the team (optional)');
    await note.pressSequentially('x'.repeat(600));
    expect((await note.inputValue()).length).toBe(500);
  });

  test('a card with no Approve still opens with Review', async ({ page }) => {
    await openDesk(page);
    await start(page);
    const slow = await runUntilCard(page, withoutApprove);
    await reviewOf(slow).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
  });
});

test.describe('numbers and cards moving', () => {
  const COUNTS = '#open-count, #sent-count, #n-closed, #n-missed, #n-right, #n-changed';

  test('a changing count fades below full opacity mid-change, ends at full opacity and shows the latest value', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    // Pause the fade at its middle: the opacity then is a fact of the animation, not of a race with the frame.
    const caught = async (): Promise<{ id: string; opacity: string } | undefined> =>
      page.evaluate(
        ({ selector, half }) => {
          for (const node of document.querySelectorAll<HTMLElement>(selector)) {
            const fade = node.getAnimations()[0];
            if (fade === undefined) continue;
            fade.pause();
            fade.currentTime = half;
            const opacity = getComputedStyle(node).opacity;
            fade.play();
            return { id: node.id, opacity };
          }
          return undefined;
        },
        { selector: COUNTS, half: HALF_FADE_MS },
      );
    let seen: { id: string; opacity: string } | undefined;
    for (let step = 0; step < MAX_STEPS && seen === undefined; step += 1) {
      await page.clock.runFor(STEP_MS);
      seen = await caught();
    }
    expect(seen).toBeDefined();
    expect(Number(seen?.opacity)).toBeLessThan(1);
    expect(Number(seen?.opacity)).toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect !== null).length), { timeout: 5000 })
      .toBe(0);
    await expect(page.locator(`#${seen?.id ?? ''}`)).toHaveCSS('opacity', '1');
    await expect(page.locator('#open-count')).toHaveText(String(await cards(page).count()));
    await expect(page.locator('#sent-count')).toHaveText(String(await rows(page).count()));
  });

  test('two changes in quick succession leave the latest number showing', async ({ page }) => {
    await openDesk(page);
    await start(page);
    // A whole run step is many changes in less than one fade: the last one must be the one that stays.
    await page.clock.runFor(30_000);
    await page.clock.runFor(30_000);
    await expect(page.locator('#open-count')).toHaveText(String(await cards(page).count()));
    await expect(page.locator('#sent-count')).toHaveText(String(await rows(page).count()));
    await expect(page.locator('#n-closed')).toHaveText(`${await rows(page).count()} of 130`);
  });

  test('with reduced motion nothing animates and each number is its new value at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDesk(page);
    await start(page);
    for (let step = 0; step < 12; step += 1) {
      await page.clock.runFor(5000);
      const shown = await page.evaluate(() => ({
        animations: document.getAnimations().length,
        open: document.getElementById('open-count')?.textContent,
        sent: document.getElementById('sent-count')?.textContent,
        cards: document.querySelectorAll('#open-list > li').length,
        rows: document.querySelectorAll('#sent-list > li').length,
      }));
      expect(shown).toEqual({ animations: 0, open: String(shown.cards), sent: String(shown.rows), cards: shown.cards, rows: shown.rows });
    }
    expect(await rows(page).count()).toBeGreaterThan(0);
  });

  test('with motion on, a card that arrives in Needs a person is animated, and so is one that slides to a new place', async ({
    page,
  }) => {
    await openDesk(page);
    await start(page);
    // A card with only an opacity animation is entering; one with a transform animation is sliding.
    const seen = { entering: 0, sliding: 0 };
    for (let step = 0; step < 40; step += 1) {
      await page.clock.runFor(STEP_MS);
      const now = await page.evaluate(() => {
        const kinds = [...document.querySelectorAll('#open-list > li')].flatMap((node) =>
          node.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k))),
        );
        return { entering: kinds.filter((k) => k === 'opacity').length, sliding: kinds.filter((k) => k === 'transform').length };
      });
      seen.entering += now.entering;
      seen.sliding += now.sliding;
    }
    expect(seen.entering).toBeGreaterThan(0);
    expect(seen.sliding).toBeGreaterThan(0);
  });

  test('a ticket that leaves Needs a person for Sent to teams flies there for about 400 ms and the flight is then gone', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const flights: { id: string; duration: number; gone: boolean; node: Node }[] = [];
      Object.assign(window, { flights });
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement && node.hasAttribute('data-flight')) {
              const timing = node.getAnimations()[0]?.effect?.getTiming();
              flights.push({ id: node.getAttribute('data-flight') ?? '', duration: Number(timing?.duration), gone: false, node });
            }
          }
          for (const node of record.removedNodes) for (const flight of flights) if (flight.node === node) flight.gone = true;
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await openDesk(page);
    await start(page);
    const card = await runUntilCard(page, withApprove);
    const id = await idOf(card);
    await approveOf(card).click();
    const flight = (): Promise<{ id: string; duration: number; gone: boolean } | undefined> =>
      page.evaluate(
        (wanted) =>
          (window as unknown as { flights: { id: string; duration: number; gone: boolean }[] }).flights
            .map(({ id: from, duration, gone }) => ({ id: from, duration, gone }))
            .find((one) => one.id === wanted),
        id,
      );
    await expect.poll(flight).toMatchObject({ id, gone: true });
    const done = await flight();
    expect(done?.duration).toBeGreaterThanOrEqual(300);
    expect(done?.duration).toBeLessThanOrEqual(500);
  });

  test('a card that arrives says New for about two seconds, and the word goes while the card stays', async ({ page }) => {
    await openDesk(page);
    await start(page);
    const lastCard = (): Locator => cards(page).last();
    for (let step = 0; step < MAX_STEPS && ((await cards(page).count()) < 3 || (await lastCard().locator('.new').count()) === 0); step += 1) {
      await page.clock.runFor(250);
    }
    const id = await idOf(lastCard());
    const same = page.locator(`#open-list > li[data-ticket="${id}"]`);
    await expect(same.locator('.new')).toHaveText(/^New/);
    await page.clock.runFor(NEW_MS / 2);
    await expect(same.locator('.new')).toHaveCount(1);
    await page.clock.runFor(NEW_MS);
    await expect(same).toHaveCount(1);
    await expect(same.locator('.new')).toHaveCount(0);
  });

  test('a Critical or High card that lands above older lower ones reads "New: moved up"', async ({ page }) => {
    await openDesk(page);
    await start(page);
    const moved = cards(page).filter({ has: page.locator('.new', { hasText: 'New: moved up' }) });
    for (let step = 0; step < MAX_STEPS * 4 && (await moved.count()) === 0; step += 1) {
      await page.clock.runFor(250);
    }
    await expect(moved.first()).toBeVisible();
    const tag = await moved.first().locator('.tag').innerText();
    expect(['Critical', 'High']).toContain(tag);
    const below = await moved.first().evaluate((node) => {
      const rest: string[] = [];
      for (let next = node.nextElementSibling; next !== null; next = next.nextElementSibling) {
        rest.push(next.querySelector('.tag')?.textContent ?? '');
      }
      return rest;
    });
    expect(below.some((word) => word === 'Medium' || word === 'Low' || (tag === 'Critical' && word === 'High'))).toBe(true);
  });
});
