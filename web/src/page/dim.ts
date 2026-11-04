import { byId, el, setText } from './dom';
import { placeBlock, unionBox, type Box, type LearnStep } from './learnView';

const WIDE = '(min-width: 1024px)';
// Room kept between a lit element scrolled into view and the top of the screen.
const SCROLL_MARGIN_PX = 8;
// Room between a lit element and the outline of the hole.
const BREATHING_PX = 4;

export interface Dim {
  // Lights the step's parts of the page and shows its words; `line` is the live ticket's sentence.
  show(step: LearnStep, line: string | null): void;
  // Measures the lit parts again (after a render, a resize or a scroll).
  measure(): void;
  hide(): void;
}

function boxOf(node: Element): Box {
  const { left, top, width, height } = node.getBoundingClientRect();
  return { left, top, width, height };
}

const drawn = (node: Element): boolean => node.getClientRects().length > 0;

/**
 * The dim layer and the context block. The layer is one fixed element whose huge shadow dims the whole
 * screen around a hole; the hole is measured from the real elements, so it follows them wherever the
 * page puts them. On a wide screen the block sits beside the hole; on a phone it docks above the bar and
 * the lit part is scrolled into the room above it.
 */
export function createDim(): Dim {
  const hole = el('div', 'dim');
  const block = el('section', 'learn-block');
  block.setAttribute('aria-label', 'Learn The Process');
  const title = el('h2', 'learn-title');
  const text = el('p');
  const ticket = el('p', 'muted');
  block.append(title, text, ticket);
  hole.hidden = true;
  block.hidden = true;
  document.body.append(hole, block);
  let lit: string[] = [];

  const barHeight = (): number => byId('bar').offsetHeight;
  const room = (): number => window.innerHeight - barHeight();

  // The lit parts with a little room around them, so text never touches the outline.
  function litBox(): Box | undefined {
    const box = unionBox(lit.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(drawn).map(boxOf));
    if (box === undefined) return undefined;
    return {
      left: box.left - BREATHING_PX,
      top: box.top - BREATHING_PX,
      width: box.width + 2 * BREATHING_PX,
      height: box.height + 2 * BREATHING_PX,
    };
  }

  // On a phone the block covers the bottom of the screen, so what is lit goes above it.
  function scrollAbove(): void {
    const box = litBox();
    const free = window.innerHeight - barHeight() - block.offsetHeight;
    if (box !== undefined && (box.top < 0 || box.top + box.height > free)) {
      window.scrollBy(0, box.top - SCROLL_MARGIN_PX);
    }
  }

  function measure(): void {
    const box = litBox();
    if (hole.hidden || box === undefined) return;
    const wide = window.matchMedia(WIDE).matches;
    // On a wide screen the hole may run under the bar, which is above the dim layer; on a phone it stops above the block.
    const bottom = wide ? Number.POSITIVE_INFINITY : room() - block.offsetHeight;
    const top = Math.max(box.top, 0);
    const shown = { left: box.left, top, width: box.width, height: Math.max(Math.min(box.top + box.height, bottom) - top, 0) };
    hole.style.left = `${shown.left}px`;
    hole.style.top = `${shown.top}px`;
    hole.style.width = `${shown.width}px`;
    hole.style.height = `${shown.height}px`;
    const at = wide
      ? placeBlock(shown, { width: block.offsetWidth, height: block.offsetHeight }, { width: window.innerWidth, height: room() }, [
          boxOf(byId('view-learn')),
          boxOf(byId('view-see')),
          boxOf(byId('view-note')),
        ])
      : { left: 0, top: 0 };
    block.style.left = wide ? `${at.left}px` : '';
    block.style.top = wide ? `${at.top}px` : '';
  }

  // The page keeps room under its content for the docked block too, or the last list could never be scrolled above it.
  const keepRoom = (height: number): void => {
    document.documentElement.style.setProperty('--block-h', `${height}px`);
  };

  window.addEventListener('resize', measure);
  window.addEventListener('scroll', measure, true);
  // The bar's height decides how tall the board is, so a change to it moves what is lit.
  new ResizeObserver(measure).observe(byId('bar'));
  return {
    show(step, line) {
      lit = step.lit;
      setText(title, step.title);
      setText(text, step.text);
      ticket.hidden = line === null;
      setText(ticket, `This ticket: ${line ?? ''}`);
      block.hidden = false;
      const docked = !window.matchMedia(WIDE).matches;
      keepRoom(docked ? block.offsetHeight : 0);
      if (docked) scrollAbove();
      hole.hidden = false;
      measure();
    },
    measure,
    hide() {
      hole.hidden = true;
      block.hidden = true;
      keepRoom(0);
    },
  };
}
