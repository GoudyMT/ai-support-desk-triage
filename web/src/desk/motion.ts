// The desk's movement: a number fades to its new value, a card that stays slides to its new place, a new card
// fades in, and a ticket that moves from Needs a person to Sent to teams is shown travelling there. Web Animations
// only, so an animation is its own state and nothing here waits on a timer. With reduced motion nothing animates.
import { el } from '../page/dom';

const FADE_MS = 220;
const ENTER_MS = 250;
const SLIDE_MS = 300;
const FLIGHT_MS = 400;
// A card that has moved less than this has not moved.
const MIN_MOVE_PX = 1;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

// Read each time something moves, so a change in the middle of a run takes effect.
const reducedMotion = (): boolean => window.matchMedia(REDUCED_MOTION).matches;

// A number that is fading out: the text it will show when it is gone. A change that comes meanwhile only
// replaces that text, so the last value is always the one that stays.
const fading = new WeakMap<HTMLElement, { next: string }>();

export function fadeNumber(node: HTMLElement, text: string): void {
  const pending = fading.get(node);
  if (pending !== undefined) {
    pending.next = text;
    return;
  }
  if (node.textContent === text) return;
  if (reducedMotion()) {
    node.textContent = text;
    return;
  }
  const state = { next: text };
  fading.set(node, state);
  const out = node.animate({ opacity: [Number(getComputedStyle(node).opacity), 0] }, { duration: FADE_MS, fill: 'forwards' });
  out.onfinish = () => {
    fading.delete(node);
    node.textContent = state.next;
    out.cancel();
    node.animate({ opacity: [0, 1] }, { duration: FADE_MS });
  };
}

interface Spot {
  zone: 'open' | 'sent';
  box: DOMRect;
  node: HTMLElement;
  // Inside its list's visible part: a card scrolled out of sight has nothing to show moving.
  visible: boolean;
}

export interface CardMotion {
  // Call just before a list is redrawn and `play` just after.
  snapshot(): void;
  play(): void;
  // The next `play` is for a different run, so nothing moves between the two.
  reset(): void;
}

export function createCardMotion(open: HTMLElement, sent: HTMLElement): CardMotion {
  const layer = el('ul', 'flights');
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  document.body.append(layer);
  // Slides and entrances are cancelled at the next draw, which starts them again from where the cards now look.
  // A flight is left to land: it is short, and a draw a moment later must not cut it off.
  const moves = new Set<Animation>();
  const flights = new Set<Animation>();
  let before = new Map<string, Spot>();
  let quiet = false;

  function spots(): Map<string, Spot> {
    const found = new Map<string, Spot>();
    for (const [zone, list] of [['open', open], ['sent', sent]] as const) {
      const listBox = list.getBoundingClientRect();
      for (const node of list.querySelectorAll<HTMLElement>(':scope > [data-ticket]')) {
        const box = node.getBoundingClientRect();
        const visible = box.height > 0 && box.bottom > listBox.top && box.top < listBox.bottom;
        found.set(node.dataset.ticket ?? '', { zone, box, node, visible });
      }
    }
    return found;
  }

  function run(node: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions, kept: Set<Animation>): void {
    const animation = node.animate(keyframes, options);
    kept.add(animation);
    animation.onfinish = () => {
      kept.delete(animation);
      if (node.parentElement === layer) node.remove();
    };
  }

  // The real card is gone from the list, so a copy of it crosses above everything while the new row waits to be seen.
  function fly(from: Spot, to: Spot): void {
    const copy = from.node.cloneNode(true) as HTMLElement;
    copy.removeAttribute('data-ticket');
    copy.setAttribute('data-flight', from.node.dataset.ticket ?? '');
    Object.assign(copy.style, { left: `${from.box.left}px`, top: `${from.box.top}px`, width: `${from.box.width}px` });
    layer.append(copy);
    const shift = `translate(${to.box.left - from.box.left}px, ${to.box.top - from.box.top}px)`;
    const keyframes = [{ transform: 'translate(0, 0)', opacity: 1 }, { transform: shift, opacity: 0 }];
    run(copy, keyframes, { duration: FLIGHT_MS, easing: 'ease-in-out' }, flights);
    run(to.node, [{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], { duration: FLIGHT_MS }, flights);
  }

  function stop(kept: Set<Animation>): void {
    for (const animation of kept) animation.cancel();
    kept.clear();
  }

  return {
    snapshot() {
      before = spots();
    },
    reset() {
      quiet = true;
    },
    play() {
      stop(moves);
      const calm = quiet || reducedMotion();
      quiet = false;
      if (calm) {
        stop(flights);
        layer.replaceChildren();
        return;
      }
      for (const [id, to] of spots()) {
        const from = before.get(id);
        if (from === undefined) {
          if (to.visible) run(to.node, [{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS }, moves);
        } else if (from.zone !== to.zone) {
          if (from.visible && to.visible) fly(from, to);
        } else if (
          (from.visible || to.visible) &&
          Math.abs(from.box.left - to.box.left) + Math.abs(from.box.top - to.box.top) > MIN_MOVE_PX
        ) {
          const shift = `translate(${from.box.left - to.box.left}px, ${from.box.top - to.box.top}px)`;
          const slide = [{ transform: shift }, { transform: 'translate(0, 0)' }];
          run(to.node, slide, { duration: SLIDE_MS, easing: 'ease-out' }, moves);
        }
      }
    },
  };
}
