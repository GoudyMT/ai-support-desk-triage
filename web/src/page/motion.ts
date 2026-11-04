import { el } from './dom';

// How long a card takes to get where it is going. A ticket spends about a second in the center,
// so the move ends well inside that and the next one never has to wait for it.
const MOVE_MS = 350;
const MOVE_EASING = 'ease-out';
// A card that has moved less than this has not moved.
const MIN_MOVE_PX = 1;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

// The one gate for motion: read when a move starts, so a change in the middle of a run takes effect.
export const reducedMotion = (): boolean => window.matchMedia(REDUCED_MOTION).matches;

type Zone = 'incoming' | 'center' | 'open' | 'closed';

interface Spot {
  zone: Zone;
  box: DOMRect;
}

// A card that is on screen has a box, sits in a visible part of its column and is not hidden
// (a list on a closed tab, or a folded column, has no box at all).
function spotOf(node: HTMLElement): Spot | undefined {
  const zone = zoneOf(node);
  const box = node.getBoundingClientRect();
  if (zone === undefined || box.width === 0 || box.height === 0) return undefined;
  const column = node.closest('.col')?.getBoundingClientRect();
  const inColumn = column === undefined || (box.bottom > column.top && box.top < column.bottom);
  const inWindow = box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
  return inColumn && inWindow ? { zone, box } : undefined;
}

function zoneOf(node: Element): Zone | undefined {
  if (node.closest('.col-in') !== null) return 'incoming';
  if (node.closest('.col-center') !== null) return 'center';
  if (node.closest('.open') !== null) return 'open';
  return node.closest('.closed') === null ? undefined : 'closed';
}

const centerOf = (box: DOMRect): { x: number; y: number } => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

// The word and color a ticket carries at its new place, copied so the ghost reads like the card it becomes.
function badgeOf(node: HTMLElement): HTMLElement | undefined {
  const badge = node.querySelector<HTMLElement>('.tag:not([hidden]), .pill');
  return badge === null ? undefined : el('span', badge.className, badge.textContent ?? '');
}

/**
 * The one big motion: a card that changes sections (coming in, the center, open, closed) is shown
 * travelling there, and cards that stay in their list slide to their new place. Nothing else moves.
 *
 * A move between sections cannot use the real card (the columns scroll and clip), so a small ghost
 * with the ticket id and tag crosses a fixed overlay above everything and is removed when it lands;
 * the real card is already in place. Both kinds of move use transform only, through the Web
 * Animations API. Call `snapshot` just before the panels render and `play` just after.
 */
export function createMotion(): { snapshot(): void; play(animate: boolean): void; skipNext(): void } {
  const layer = el('div', 'ghost-layer');
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
  // At most one ghost for a ticket: a new move replaces the one still travelling.
  const ghosts = new Map<string, HTMLElement>();
  const slides = new Set<Animation>();
  let before = new Map<string, Spot>();
  let skip = false;

  const spots = (): Map<HTMLElement, Spot | undefined> =>
    new Map([...document.querySelectorAll<HTMLElement>('[data-ticket]')].map((node) => [node, spotOf(node)]));

  function clearGhost(id: string): void {
    ghosts.get(id)?.remove();
    ghosts.delete(id);
  }

  function clear(): void {
    for (const id of [...ghosts.keys()]) clearGhost(id);
    for (const animation of slides) animation.cancel();
    slides.clear();
  }

  function fly(id: string, from: Spot, to: Spot, target: HTMLElement): void {
    // A ticket that is still travelling carries on from where its ghost is now.
    const live = ghosts.get(id)?.getBoundingClientRect();
    const start = centerOf(live ?? from.box);
    const end = centerOf(to.box);
    clearGhost(id);
    const ghost = el('div', 'ghost');
    ghost.setAttribute('data-moving', id);
    ghost.setAttribute('data-from', from.zone);
    ghost.setAttribute('data-to', to.zone);
    ghost.append(el('span', 'ghost-id', id));
    const badge = badgeOf(target);
    if (badge !== undefined) ghost.append(badge);
    layer.append(ghost);
    const place = (point: { x: number; y: number }): string =>
      `translate(${point.x - ghost.offsetWidth / 2}px, ${point.y - ghost.offsetHeight / 2}px)`;
    const animation = ghost.animate([{ transform: place(start) }, { transform: place(end) }], {
      duration: MOVE_MS,
      easing: MOVE_EASING,
    });
    ghosts.set(id, ghost);
    animation.onfinish = () => {
      if (ghosts.get(id) === ghost) clearGhost(id);
    };
  }

  function slide(node: HTMLElement, from: DOMRect, to: DOMRect): void {
    const animation = node.animate(
      [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'translate(0, 0)' }],
      { duration: MOVE_MS, easing: MOVE_EASING },
    );
    slides.add(animation);
    animation.onfinish = () => slides.delete(animation);
  }

  return {
    snapshot() {
      before = new Map();
      for (const [node, spot] of spots()) {
        if (spot !== undefined) before.set(node.dataset.ticket ?? '', spot);
      }
    },
    // The next render shows a different run (a restart), so nothing moves between the two.
    skipNext() {
      skip = true;
    },
    // The media query is read on every render, so a change in the middle of a run takes effect.
    play(animate) {
      // A slide still running is dropped first: the snapshot already holds where its card was
      // seen, and the new slide starts from there.
      for (const animation of slides) animation.cancel();
      slides.clear();
      const calm = skip || !animate || reducedMotion();
      skip = false;
      if (calm) {
        clear();
        return;
      }
      for (const [node, to] of spots()) {
        const id = node.dataset.ticket ?? '';
        const from = before.get(id);
        if (from === undefined || to === undefined) continue;
        if (from.zone !== to.zone) {
          fly(id, from, to, node);
        } else if (Math.abs(from.box.left - to.box.left) + Math.abs(from.box.top - to.box.top) > MIN_MOVE_PX) {
          slide(node, from.box, to.box);
        }
      }
    },
  };
}
