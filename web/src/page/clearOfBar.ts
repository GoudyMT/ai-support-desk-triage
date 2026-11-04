import { byId } from './dom';

// Room kept between a focused control and the bar.
const GAP_PX = 8;

// How far a control's bottom edge sits under the bar's top edge, or 0 when it is clear.
export function hiddenBy(controlBottom: number, barTop: number): number {
  return Math.max(controlBottom - barTop, 0);
}

/**
 * Keeps a control the keyboard reaches above the bar fixed over the bottom of the screen. The page's
 * scroll-padding asks the browser for that; this scrolls the little that is left for a browser that scrolls
 * a focused control to the very edge of the screen all the same.
 */
export function keepFocusClearOfBar(): void {
  const bar = byId('bar');
  document.addEventListener('focusin', (event) => {
    const { target } = event;
    if (!(target instanceof HTMLElement) || bar.contains(target)) return;
    const under = hiddenBy(target.getBoundingClientRect().bottom, bar.getBoundingClientRect().top);
    if (under > 0) window.scrollBy(0, under + GAP_PX);
  });
}
