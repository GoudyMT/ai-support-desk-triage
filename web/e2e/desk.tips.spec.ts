import { expect, test, type Locator, type Page } from '@playwright/test';
import { TIME_SAVED_SOURCE, VALUE_SAVED_SOURCE } from '../src/page/copy';
import { SEED, START } from './helpers';

const PHONE = { width: 375, height: 812 };
const WIDE = { width: 1280, height: 800 };

// The words of each tip, as the locked wireframe has them; the last two are the sources the page already cites for its
// two assumptions.
const TIPS = [
  {
    name: 'Why the order changes',
    text: 'The most serious tickets go to the top, so a person sees them first. Two tickets at the same level stay oldest first.',
  },
  {
    name: 'What percent sure means',
    text: 'How sure the model is about the category. At 70% or more, Approve appears, so a person can send the ticket in one press. Below that, open it with Review.',
  },
  {
    name: 'What the labels mean',
    text: 'These tickets reached a team. No person needed: no rule fired and the model was sure enough. Reviewer checked: the simulated reviewer agreed. Reviewer changed it: the simulated reviewer changed the model\'s answer.',
  },
  { name: 'What high-risk missed means', text: 'Tickets that truly needed a person but went out without one. The goal is zero.' },
  {
    name: 'Why the reviewer changes the model',
    text: 'Times the simulated reviewer disagreed with the model. This is how most mistakes get caught before a ticket goes out.',
  },
  { name: 'Where the minutes figure comes from', text: TIME_SAVED_SOURCE },
  { name: 'Where the hourly pay figure comes from', text: VALUE_SAVED_SOURCE },
];
const HISTORY_TIPS = [
  {
    name: 'Why tickets it never saw',
    text: 'A model can look good on tickets it trained on. These are held back from training, so the score is a fair test.',
  },
  {
    name: 'Why fewer is better',
    text: 'Fewer is better, as long as High-risk missed stays at zero. Each ticket a person does not need to check is time saved.',
  },
];

// Opens the desk with the clock under the test's control: nothing moves until `runFor`.
async function openDesk(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: START });
  await page.clock.pauseAt(new Date(START.getTime() + 1000));
  await page.goto(`/?seed=${SEED}`);
}

async function startRun(page: Page, ms = 60_000): Promise<void> {
  await openDesk(page);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.clock.runFor(ms);
}

const tip = (page: Page, name: string): Locator => page.getByRole('button', { name, exact: true });
const tooltip = (page: Page): Locator => page.getByRole('tooltip');

// The panel's second half: behind Numbers on a phone, behind More numbers on a wide screen.
async function openPanel(page: Page): Promise<void> {
  const numbers = page.getByRole('button', { name: 'Numbers', exact: true });
  if (await numbers.isVisible()) await numbers.click();
  await page.getByRole('button', { name: 'More numbers and report' }).click();
}

// How far the page can scroll each way, and how wide it shows: a box that sticks out adds to the first two.
const pageSize = (page: Page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return { across: root.scrollWidth - root.clientWidth, down: root.scrollHeight - window.innerHeight };
  });

test.describe('a tip opens and closes', () => {
  test.use({ viewport: WIDE });

  test('hover opens it and moving off closes it', async ({ page }) => {
    await startRun(page);
    await tip(page, 'Why the order changes').hover();
    await expect(tooltip(page)).toHaveText(TIPS[0]?.text ?? '');
    await page.mouse.move(2, 2);
    await expect(tooltip(page)).toHaveCount(0);
  });

  test('keyboard focus opens it and moving focus on closes it', async ({ page }) => {
    await startRun(page);
    await tip(page, 'What percent sure means').focus();
    await expect(tooltip(page)).toHaveText(TIPS[1]?.text ?? '');
    // Back to the list above it: the next stop forward is another icon, which would open its own box.
    await page.keyboard.press('Shift+Tab');
    await expect(tooltip(page)).toHaveCount(0);
  });

  test('only one tip is open at a time', async ({ page }) => {
    await startRun(page);
    await tip(page, 'Why the order changes').hover();
    await expect(tooltip(page)).toHaveCount(1);
    await tip(page, 'What the labels mean').hover();
    await expect(tooltip(page)).toHaveCount(1);
    await expect(tooltip(page)).toHaveText(TIPS[2]?.text ?? '');
  });

  test('every tip has a name, the words of its box, and is described by it', async ({ page }) => {
    await startRun(page);
    await openPanel(page);
    for (const { name, text } of TIPS) {
      const button = tip(page, name);
      await expect(button, name).toHaveCount(1);
      await button.focus();
      const box = tooltip(page);
      await expect(box, name).toHaveText(text);
      // The button points at its box, so a screen reader reads the words when the icon takes focus.
      const id = await button.getAttribute('aria-describedby');
      expect(id, name).toBeTruthy();
      await expect(page.locator(`#${id ?? ''}`), name).toHaveText(text);
      await button.blur();
    }
  });

  test('Escape closes the tip and leaves an open review card open', async ({ page }) => {
    await startRun(page);
    await page.locator('#open-list button[aria-label^="Review "]').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // The page behind a card cannot be hovered, and a tip open before the card opens is closed by the browser's own pointer
    // events. So the tip is opened under the open card with the pointer event a hover sends: what is under test is the key.
    await page.locator('#tip-sure').evaluate((box) => {
      document.querySelector(`[aria-describedby="${box.id}"]`)?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
    });
    await expect(tooltip(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(tooltip(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
    // The next Escape is the card's own: it hands the ticket back.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});

test.describe('a tap on a phone', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('opens a tip, a second tap closes it, and a tap elsewhere closes it too', async ({ page }) => {
    await startRun(page);
    const button = tip(page, 'What high-risk missed means');
    await button.tap();
    await expect(tooltip(page)).toHaveText(TIPS[3]?.text ?? '');
    await button.tap();
    await expect(tooltip(page)).toHaveCount(0);
    await button.tap();
    await expect(tooltip(page)).toHaveCount(1);
    // On a wider font the box can reach down over the tabs, and the tap must still land on them.
    await expect(tooltip(page)).toHaveCSS('pointer-events', 'none');
    await page.getByRole('tab', { name: /^Sent to teams/ }).tap();
    await expect(tooltip(page)).toHaveCount(0);
  });
});

// A box must stay on the screen and add no scroll to the page, for every icon the viewer can see.
for (const viewport of [WIDE, PHONE]) {
  test.describe(`tips at ${viewport.width} wide`, () => {
    test.use({ viewport });

    test('every visible icon opens a box inside the screen that adds no scroll', async ({ page }) => {
      await startRun(page);
      const seen: string[] = [];
      for (const open of [false, true]) {
        if (open) await openPanel(page);
        const icons = page.locator('.tip:visible');
        const count = await icons.count();
        const still = await pageSize(page);
        expect(still.across).toBeLessThanOrEqual(0);
        for (let at = 0; at < count; at += 1) {
          const icon = icons.nth(at);
          seen.push((await icon.getAttribute('aria-label')) ?? '');
          await icon.focus();
          const box = await tooltip(page).boundingBox();
          expect(box, `icon ${at}`).not.toBeNull();
          expect(box?.x ?? -1, `icon ${at} left`).toBeGreaterThanOrEqual(0);
          expect(box?.y ?? -1, `icon ${at} top`).toBeGreaterThanOrEqual(0);
          expect((box?.x ?? 0) + (box?.width ?? 0), `icon ${at} right`).toBeLessThanOrEqual(viewport.width);
          expect((box?.y ?? 0) + (box?.height ?? 0), `icon ${at} bottom`).toBeLessThanOrEqual(viewport.height);
          expect(await pageSize(page), `icon ${at} page scroll`).toEqual(still);
          await icon.blur();
        }
      }
      expect(seen.length).toBeGreaterThanOrEqual(viewport.width === PHONE.width ? 3 : 7);
      // The two assumption tips are among the lowest icons, so they are part of this check.
      expect(seen).toContain('Where the hourly pay figure comes from');
    });
  });
}

test.describe('an icon moves nothing', () => {
  test.use({ viewport: WIDE });

  // Everything the viewer reads in the desk, as boxes.
  const boxes = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('.stats dt, .stats dd, .col-title, #open-list > li, #sent-list > li, .hint')].map((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return [x, y, width, height];
      }),
    );

  test('an open tip leaves every row where it was', async ({ page }) => {
    await startRun(page);
    const before = await boxes(page);
    expect(before.length).toBeGreaterThan(8);
    for (const name of ['Why the order changes', 'What high-risk missed means', 'What percent sure means']) {
      await tip(page, name).focus();
      await expect(tooltip(page)).toHaveCount(1);
      expect(await boxes(page), name).toEqual(before);
      await tip(page, name).blur();
    }
  });

  test('a row with an icon is as tall as a row without one', async ({ page }) => {
    await startRun(page);
    const heights = await page.evaluate(() => {
      // Each row against itself with the icon gone, since a wider font may wrap a long name with or without an icon.
      const withAndWithout = (node: Element) => {
        const icon = node.querySelector<HTMLElement>('.tip');
        const shown = node.getBoundingClientRect().height;
        if (icon !== null) icon.style.display = 'none';
        const gone = node.getBoundingClientRect().height;
        if (icon !== null) icon.style.display = '';
        return [shown, gone];
      };
      return {
        terms: [...document.querySelectorAll('aside.side > .stats dt')].map(withAndWithout),
        titles: [...document.querySelectorAll('.col-title')].map((head) => [
          head.getBoundingClientRect().height,
          head.querySelector('h2')?.getBoundingClientRect().height,
        ]),
      };
    });
    expect(heights.terms.length).toBe(4);
    for (const [shown, gone] of heights.terms) expect(shown).toBe(gone);
    // A heading with an icon beside it is no taller than the heading alone.
    expect(heights.titles.length).toBe(2);
    for (const [head, title] of heights.titles) expect(head).toBe(title);
  });
});

test('the Model History page has its two tips, and each box stays on the screen', async ({ page }) => {
  for (const viewport of [WIDE, PHONE]) {
    await page.setViewportSize(viewport);
    await page.goto('/model-history.html');
    const still = await pageSize(page);
    for (const { name, text } of HISTORY_TIPS) {
      const button = tip(page, name);
      await button.focus();
      await expect(tooltip(page), name).toHaveText(text);
      const box = await tooltip(page).boundingBox();
      expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= viewport.width, `${name} at ${viewport.width}`).toBe(true);
      expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= viewport.height, `${name} at ${viewport.width}`).toBe(true);
      expect(await pageSize(page)).toEqual(still);
      await page.keyboard.press('Escape');
      await expect(tooltip(page)).toHaveCount(0);
    }
  }
});
