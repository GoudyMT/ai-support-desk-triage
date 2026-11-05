import { expect, test, type Page } from '@playwright/test';
import { SEED, ghosts, openLearn, seeAndPause, stat, tabTo, watchGhosts } from './helpers';

// Learn The Process: the walk that opens first, step by step, on the live board.
const WORDS_PER_MINUTE = 238;
const MS_PER_MINUTE = 60_000;
const EDGE_MS = 40;
const HOLE_TOLERANCE_PX = 2;
const BREATHING_PX = 4;
// Longer than the 0.5 s the hole takes to ease to the next lit part.
const EASE_WAIT_MS = 6_000;
const EASE_SETTLE_MS = 700;
const LIT_SHOWING_PX = 44; // a card's height of the lit part, above the docked block on a phone
interface Step {
  title: string;
  text: string;
  // Where the hole must be: the parts of the page the step talks about.
  lit: string;
  // What the engine holds the live ticket at, as the center says it.
  stage?: string;
}

const LINE = '.lines-detail > .line-detail:nth-child';
const STEPS: Step[] = [
  {
    title: 'Messages come in',
    text: 'A company gets hundreds of customer messages a week. Each new one joins this line. The messages here are made up, so nobody real is involved.',
    lit: '#incoming',
  },
  {
    title: 'One message at a time',
    text: 'The top message, called a ticket, moves to the middle so the system can work on it. This is what the customer wrote. Any email, phone, order or card number in it is already covered. The bars along the top show its steps.',
    lit: '.now-head, .track, .ticket-text',
    stage: 'Intake',
  },
  {
    title: 'Private details get hidden',
    text: 'This step is called Privacy. Before the model reads the message, this step swaps any email addresses, phone numbers, order numbers and card numbers it finds for labels.',
    lit: `${LINE}(1)`,
    stage: 'Privacy',
  },
  {
    title: 'The computer makes its best guess',
    text: 'This step is called Classify, and the part doing it is the model. It has studied thousands of example messages and counts which words usually go together. It says what the message is about, how urgent it is, and how sure it is.',
    lit: `${LINE}(2)`,
    stage: 'Classify',
  },
  {
    title: 'Safety rules check the guess',
    text: 'These checks are called guardrails. The team wrote a short list of things that must always go to a person. The rules can overrule the computer. The computer can never overrule the rules.',
    lit: `${LINE}(3)`,
    stage: 'Guardrails',
  },
  {
    title: 'A person has the final say',
    text: 'Doubtful messages wait here for a person. In this demo a simulated reviewer stands in. In See The Process, you can press Review to take its place. The rest go straight to the team the model picked, which is sometimes the wrong one. The demo stops once the ticket reaches its team. The team writes the reply.',
    lit: '#outgoing',
  },
  {
    title: 'Keeping score',
    text: 'Because we know the true answer for each made-up message, these numbers are measured, not claimed. All numbers, in See The Process, shows how often it was right and wrong.',
    lit: '#stats',
  },
];

const next = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
const block = (page: Page) => page.locator('.learn-block');
const count = (page: Page) => page.locator('#learn-controls .bar-status');

// The smallest box holding every part of the page that matches the selector.
const union = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    // The review form has a .ticket-text of its own, hidden here: only what is drawn counts.
    const boxes = [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length > 0).map((n) => n.getBoundingClientRect());
    const left = Math.min(...boxes.map((b) => b.left));
    const top = Math.min(...boxes.map((b) => b.top));
    return {
      x: left,
      y: top,
      width: Math.max(...boxes.map((b) => b.right)) - left,
      height: Math.max(...boxes.map((b) => b.bottom)) - top,
    };
  }, selector);

async function holeOffBy(page: Page, selector: string): Promise<number> {
  const hole = await page.locator('.dim').boundingBox();
  if (hole === null) return Number.POSITIVE_INFINITY;
  const lit = await union(page, selector);
  // The hole has a little room all round the lit part.
  const want = {
    x: lit.x - BREATHING_PX,
    y: lit.y - BREATHING_PX,
    width: lit.width + 2 * BREATHING_PX,
    height: lit.height + 2 * BREATHING_PX,
  };
  return Math.max(Math.abs(hole.x - want.x), Math.abs(hole.y - want.y), Math.abs(hole.width - want.width), Math.abs(hole.height - want.height));
}

async function holeCovers(page: Page, selector: string): Promise<void> {
  await expect.poll(() => holeOffBy(page, selector), { timeout: EASE_WAIT_MS }).toBeLessThanOrEqual(HOLE_TOLERANCE_PX);
}

// The words the step stays for, read from the screen: the title, the text and the live ticket's sentence.
async function wordsShown(page: Page): Promise<number> {
  const parts = await block(page).locator('h2, p').allInnerTexts();
  // A step with no live sentence keeps that line hidden and empty: it adds no words.
  const words = parts.map((part) => part.replace(/^This ticket: ?/, '')).filter((part) => part !== '');
  return words.join(' ').split(' ').length;
}

const msFor = (words: number) => (words / WORDS_PER_MINUTE) * MS_PER_MINUTE;

test.describe('Learn The Process, first on every load', () => {
  test('shows step 1 with the line lit and the switch clear of the dim layer', async ({ page }) => {
    await openLearn(page);
    await expect(block(page).locator('h2')).toHaveText('Messages come in');
    await expect(count(page)).toHaveText('Step 1 of 7');
    await holeCovers(page, '#incoming');
    // The dim layer takes no pointer, so what is under a point says nothing about it: the switch is above the dim
    // layer when it stacks higher in the same (root) stacking context, which an unset z-index (NaN) is not.
    const stacking = await page.evaluate(() => {
      const z = (selector: string): number => Number.parseInt(getComputedStyle(document.querySelector(selector) as Element).zIndex, 10);
      return { views: z('#views'), dim: z('.dim') };
    });
    expect(stacking.dim).toBeGreaterThan(0);
    expect(stacking.views).toBeGreaterThan(stacking.dim);
    // The switch has its own place: it never sits over the stats.
    const [views, stats] = await Promise.all([page.locator('#views').boundingBox(), page.locator('#stats').boundingBox()]);
    const apart = (views?.x ?? 0) + (views?.width ?? 0) <= (stats?.x ?? 0) || (stats?.x ?? 0) + (stats?.width ?? 0) <= (views?.x ?? 0);
    expect(apart || (views?.y ?? 0) + (views?.height ?? 0) <= (stats?.y ?? 0)).toBe(true);
  });

  test('walks the seven steps with Next: each has its words, its lit part and the ticket where the words say', async ({ page }) => {
    await openLearn(page);
    for (const [at, step] of STEPS.entries()) {
      if (at > 0) await next(page).click();
      await expect(block(page).locator('h2')).toHaveText(step.title);
      await expect(block(page).locator('p').first()).toHaveText(step.text);
      await expect(count(page)).toHaveText(`Step ${at + 1} of 7`);
      await holeCovers(page, step.lit);
      if (step.stage !== undefined) {
        await expect(page.locator('#ticket .now-stage')).toHaveText(`Now: ${step.stage}`);
        await expect(page.locator('#ticket .now-title')).toHaveAttribute('data-ticket', `T-${SEED}-0`);
      }
    }
    await expect(next(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'See The Process' }).nth(1)).toBeVisible();
  });

  test('holds the line on step 1, and shows an open ticket on step 6 and a closed one on step 7', async ({ page }) => {
    await openLearn(page);
    await expect(page.locator('#incoming .cards li').first()).toBeVisible();
    await expect(page.locator('#ticket .now')).toBeHidden();
    for (let n = 0; n < 5; n += 1) await next(page).click();
    await expect(page.locator('#outgoing .open > li').first()).toBeVisible();
    await next(page).click();
    await expect(stat(page, 'Tickets done')).not.toHaveText('0');
  });

  test('says the live ticket\'s own sentence on steps 3, 4 and 5, the one the center shows, and none elsewhere', async ({ page }) => {
    await openLearn(page);
    const line = block(page).locator('p').nth(1);
    await expect(line).toBeHidden();
    for (let at = 1; at <= 4; at += 1) {
      await next(page).click();
      if (at === 1) {
        await expect(line).toBeHidden();
        continue;
      }
      await expect(line).toBeVisible();
      const own = (await line.innerText()).replace(/^This ticket: /, '');
      expect(own.length).toBeGreaterThan(10);
      await expect(page.locator('#ticket .say')).toHaveText(own);
    }
    await next(page).click();
    await expect(line).toBeHidden();
  });
});

test.describe('how long a step stays', () => {
  test('is its words at 238 a minute: just under, the same step; just over, the next', async ({ page }) => {
    await openLearn(page);
    const first = msFor(await wordsShown(page));
    await page.clock.runFor(first - EDGE_MS);
    await expect(count(page)).toHaveText('Step 1 of 7');
    await page.clock.runFor(2 * EDGE_MS);
    await expect(count(page)).toHaveText('Step 2 of 7');
  });

  test('counts the live ticket\'s sentence too, on a step that shows one', async ({ page }) => {
    await openLearn(page);
    await next(page).click();
    await next(page).click();
    await expect(block(page).locator('p').nth(1)).toBeVisible();
    const stay = msFor(await wordsShown(page));
    await page.clock.runFor(stay - EDGE_MS);
    await expect(count(page)).toHaveText('Step 3 of 7');
    await page.clock.runFor(2 * EDGE_MS);
    await expect(count(page)).toHaveText('Step 4 of 7');
  });

  test('fills the current bar with the time spent, full for the steps before and empty for the rest', async ({ page }) => {
    await openLearn(page);
    const fills = () => page.locator('#bars i').evaluateAll((nodes) => nodes.map((n) => parseFloat((n as HTMLElement).style.width) || 0));
    await next(page).click();
    await next(page).click();
    const stay = msFor(await wordsShown(page));
    await page.clock.runFor(stay / 2);
    const half = await fills();
    expect(half.slice(0, 2)).toEqual([100, 100]);
    expect(half[2]).toBeGreaterThan(45);
    expect(half[2]).toBeLessThan(55);
    expect(half.slice(3)).toEqual([0, 0, 0, 0]);
  });

  test('ends step 7 in See The Process', async ({ page }) => {
    await openLearn(page);
    for (let n = 0; n < 6; n += 1) await next(page).click();
    const stay = msFor(await wordsShown(page));
    await page.clock.runFor(stay - EDGE_MS);
    await expect(page.locator('#learn-controls')).toBeVisible();
    await page.clock.runFor(2 * EDGE_MS);
    await expect(page.locator('#controls')).toBeVisible();
    await expect(page.locator('#view-see')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.dim')).toBeHidden();
  });
});

test.describe('Pause, Back and the two views', () => {
  test('Pause stops the step timer and the run together, and Resume starts both', async ({ page }) => {
    await openLearn(page);
    await next(page).click();
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    const waiting = await page.locator('#incoming .cards li').count();
    await page.clock.runFor(120_000);
    await expect(count(page)).toHaveText('Step 2 of 7');
    expect(await page.locator('#incoming .cards li').count()).toBe(waiting);
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.clock.runFor(120_000);
    await expect(count(page)).not.toHaveText('Step 2 of 7');
  });

  test('Next under Pause shows the next step with the run still stopped', async ({ page }) => {
    await openLearn(page);
    await page.getByRole('button', { name: 'Pause' }).click();
    await next(page).click();
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    const waiting = await page.locator('#incoming .cards li').count();
    await page.clock.runFor(120_000);
    await expect(count(page)).toHaveText('Step 2 of 7');
    expect(await page.locator('#incoming .cards li').count()).toBe(waiting);
  });

  test('Resume gives a step only the time it had left, not all of it again', async ({ page }) => {
    await openLearn(page);
    const stay = msFor(await wordsShown(page));
    await page.clock.runFor(stay * 0.7);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.clock.runFor(120_000);
    await expect(count(page)).toHaveText('Step 1 of 7');
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.clock.runFor(stay * 0.4);
    await expect(count(page)).toHaveText('Step 2 of 7');
  });

  test('Back from step 5 to step 3 puts the ticket at Privacy again', async ({ page }) => {
    await openLearn(page);
    for (let n = 0; n < 4; n += 1) await next(page).click();
    await expect(page.locator('#ticket .now-stage')).toHaveText('Now: Guardrails');
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(count(page)).toHaveText('Step 3 of 7');
    await expect(page.locator('#ticket .now-stage')).toHaveText('Now: Privacy');
    await expect(page.locator('#ticket .now-title')).toHaveAttribute('data-ticket', `T-${SEED}-0`);
    await holeCovers(page, `${LINE}(1)`);
  });

  test('See pressed in the middle takes the dim away and plays the same tickets', async ({ page }) => {
    await openLearn(page);
    await next(page).click();
    await next(page).click();
    await page.getByRole('button', { name: 'See The Process' }).click();
    await expect(page.locator('.dim')).toBeHidden();
    await expect(block(page)).toBeHidden();
    expect(await page.evaluate(() => document.getElementById('app')?.inert)).toBe(false);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
    await expect(page.locator('#ticket .now-title')).toHaveAttribute('data-ticket', `T-${SEED}-0`);
    await page.clock.runFor(10_000);
    await expect(page.locator('#ticket .now-stage')).not.toHaveText('Now: Privacy');
  });

  test('Learn pressed in See starts the walk again with the same seed, even after a Pause', async ({ page }) => {
    await openLearn(page);
    await seeAndPause(page);
    await page.clock.runFor(30_000);
    await page.getByRole('button', { name: 'Learn The Process' }).click();
    await expect(count(page)).toHaveText('Step 1 of 7');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
    await expect(page.locator('#ticket .now')).toBeHidden();
    await expect(stat(page, 'Tickets done')).toHaveText('0');
    await expect(page.locator('#view-learn')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#seed-line')).toContainText(`Seed ${SEED}`);
    // Not paused: the line fills.
    const waiting = await page.locator('#incoming .cards li').count();
    await page.clock.runFor(6_000);
    expect(await page.locator('#incoming .cards li').count()).toBeGreaterThan(waiting);
  });
});

test.describe('by keyboard and for assistive technology', () => {
  test('the switch and the bar are the only places Tab goes while the board is behind the dim', async ({ page }) => {
    await openLearn(page);
    await tabTo(page, 'Learn The Process');
    await tabTo(page, 'See The Process');
    // Back cannot be used on step 1, so the next stop is the Learn pause.
    await tabTo(page, 'Pause');
    await tabTo(page, 'Next');
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText('Step 2 of 7');
    await expect(next(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Back' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'See The Process' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
    await expect(page.locator('#controls')).toBeVisible();
  });

  test('the board and the numbers take no input behind the dim, but the switch and the bar do', async ({ page }) => {
    await openLearn(page);
    const inert = (id: string) => page.evaluate((x) => document.getElementById(x)?.inert, id);
    expect([await inert('app'), await inert('top-live'), await inert('numbers')]).toEqual([true, true, true]);
    expect([await inert('views'), await inert('bar')]).toEqual([false, false]);
  });

  test('speaks each step once through the live region, and the run stays quiet', async ({ page }) => {
    await openLearn(page);
    const said = () => page.locator('#announcer').innerText();
    const [first, second] = STEPS;
    expect(await said()).toBe(`${first?.title}. ${first?.text}`);
    await page.clock.runFor(4_000);
    expect(await said()).toBe(`${first?.title}. ${first?.text}`);
    await next(page).click();
    expect(await said()).toBe(`${second?.title}. ${second?.text}`);
  });

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('starts paused, with Resume in the bar and nothing moving', async ({ page }) => {
      await openLearn(page);
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
      await page.clock.runFor(60_000);
      await expect(count(page)).toHaveText('Step 1 of 7');
      await page.getByRole('button', { name: 'Resume' }).click();
      await page.clock.runFor(10_000);
      await expect(count(page)).toHaveText('Step 2 of 7');
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    });
  });
});

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('keeps the block clear of the view switch, the lit part and the bar on every step', async ({ page }) => {
      await openLearn(page);
      for (const [at, step] of STEPS.entries()) {
        if (at > 0) await next(page).click();
        await expect(block(page).locator('h2')).toHaveText(step.title);
        // Polled: the hole eases to its new place, and only where it lands counts.
        const seen = () => page.evaluate(() => {
          const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
          const learn = rect('.learn-block');
          const apart = (other: DOMRect | undefined): boolean =>
            learn !== undefined &&
            other !== undefined &&
            (learn.right <= other.left || other.right <= learn.left || learn.bottom <= other.top || other.bottom <= learn.top);
          return { view: apart(rect('#view-learn')) && apart(rect('#view-see')), hole: apart(rect('.dim')), bar: apart(rect('#bar')) };
        });
        await expect.poll(seen, { message: `step ${at + 1}`, timeout: EASE_WAIT_MS }).toEqual({ view: true, hole: true, bar: true });
      }
    });
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('has no sideways scroll, the block clear of the lit part and the bar, and targets of 44 px, on every step', async ({ page }) => {
    await openLearn(page);
    for (const [at, step] of STEPS.entries()) {
      if (at > 0) await next(page).click();
      await expect(block(page).locator('h2')).toHaveText(step.title);
      // Real time: the hole eases for half a second and the clock under test does not drive that.
      await page.waitForTimeout(EASE_SETTLE_MS);
      const seen = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
        const hole = rect('.dim');
        const learn = rect('.learn-block');
        const bar = rect('#bar');
        const small = [...document.querySelectorAll<HTMLElement>('button')]
          .filter((node) => node.getClientRects().length > 0)
          .filter((node) => node.getBoundingClientRect().width < 43.5 || node.getBoundingClientRect().height < 43.5)
          .map((node) => node.textContent?.trim() ?? '');
        return {
          sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          blockTop: learn?.top ?? 0,
          holeHeight: hole?.height ?? 0,
          blockEnd: learn?.bottom ?? Number.POSITIVE_INFINITY,
          barTop: bar?.top ?? 0,
          small,
        };
      });
      expect(seen.sideways, `step ${at + 1} scrolls sideways`).toBe(false);
      // The hole stops at the block by design, so it never overlaps it; the lit element itself must show above it.
      const lit = await union(page, step.lit);
      expect(Math.min(lit.y + lit.height, seen.blockTop) - Math.max(lit.y, 0), `step ${at + 1} lit part above the block`).toBeGreaterThanOrEqual(Math.min(lit.height, LIT_SHOWING_PX));
      expect(seen.holeHeight, `step ${at + 1} hole`).toBeGreaterThan(0);
      expect(seen.blockEnd, `step ${at + 1} block over the bar`).toBeLessThanOrEqual(seen.barTop + 0.5);
      expect(seen.small, `step ${at + 1} small targets`).toEqual([]);
    }
  });

  test('shows the list a step is about: Coming in on step 1, Going out on step 6', async ({ page }) => {
    await openLearn(page);
    await expect(page.locator('#incoming')).toBeVisible();
    for (let n = 0; n < 5; n += 1) await next(page).click();
    await expect(page.locator('#outgoing')).toBeVisible();
    await expect(page.locator('#incoming')).toBeHidden();
  });

  test('leaves the end of the page clear of the bar', async ({ page }) => {
    await openLearn(page);
    await page.getByRole('button', { name: 'See The Process' }).click();
    // The room kept under the page follows the bar's height a moment after it changes, so scroll and look again.
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          const bar = document.getElementById('bar')?.getBoundingClientRect();
          const board = document.getElementById('app')?.getBoundingClientRect();
          // Firefox lays out in sixtieths of a pixel: the board ends where the bar starts, give or take that.
          return (board?.bottom ?? Number.POSITIVE_INFINITY) <= (bar?.top ?? 0) + 0.01;
        }),
      )
      .toBe(true);
  });
});

// The walked ticket is seen travelling, not jumping: from the line to the center as step 2 starts, and from the
// center to Going out as step 6 starts, whether the step ends by its timer or by Next.
test.describe('cards travel in Learn too', () => {
  const FIRST = `T-${SEED}-0`;
  const CROSSING = [
    { name: 'the line to the center on step 2', steps: 0, from: 'incoming', to: 'center' },
    { name: 'the center to Going out on step 6', steps: 4, from: 'center', to: 'open' },
  ];

  for (const { name, steps, from, to } of CROSSING) {
    test(`a ghost carries the ticket from ${name}, by Next`, async ({ page }) => {
      await watchGhosts(page);
      await openLearn(page);
      for (let n = 0; n < steps; n += 1) await next(page).click();
      const before = (await ghosts(page)).length;
      await next(page).click();
      expect((await ghosts(page)).slice(before)).toContainEqual(expect.objectContaining({ id: FIRST, from, to }));
    });

    test(`a ghost carries the ticket from ${name}, when the step's time ends`, async ({ page }) => {
      await watchGhosts(page);
      await openLearn(page);
      for (let n = 0; n < steps; n += 1) await next(page).click();
      const stay = msFor(await wordsShown(page));
      const before = (await ghosts(page)).length;
      await page.clock.runFor(stay + EDGE_MS);
      expect((await ghosts(page)).slice(before)).toContainEqual(expect.objectContaining({ id: FIRST, from, to }));
    });
  }

  test.describe('with reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('no ghost appears on the same moves', async ({ page }) => {
      await watchGhosts(page);
      await openLearn(page);
      await page.getByRole('button', { name: 'Resume' }).click();
      for (let n = 0; n < 5; n += 1) await next(page).click();
      await expect(count(page)).toHaveText('Step 6 of 7');
      await expect(page.locator('#outgoing .open > li').first()).toBeVisible();
      expect(await ghosts(page)).toEqual([]);
      expect(await page.locator('.ghost-layer').evaluate((layer) => layer.childElementCount)).toBe(0);
    });
  });
});

test.describe('on a wide screen', () => {
  test('the bar never covers the last row of a list', async ({ page }) => {
    await openLearn(page);
    await page.getByRole('button', { name: 'See The Process' }).click();
    // The room kept under the page follows the bar's height a moment after the bar changes.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const bar = document.getElementById('bar')?.getBoundingClientRect();
          const board = document.getElementById('app')?.getBoundingClientRect();
          // Firefox lays out in sixtieths of a pixel: the board ends where the bar starts, give or take that.
          return (board?.bottom ?? Number.POSITIVE_INFINITY) <= (bar?.top ?? 0) + 0.01;
        }),
      )
      .toBe(true);
  });
});
