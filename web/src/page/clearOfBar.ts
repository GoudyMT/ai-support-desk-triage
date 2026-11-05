import { byId } from './dom';

// Room kept between a focused control and the bar.
const GAP_PX = 8;

/**
 * How far to scroll so an element is above the bar, given its edges and the bar's top edge. Nothing for an
 * element that is already clear, and nothing for one that does not fit above the bar at all (the page itself, a list
 * taller than the screen): that is not a control to bring into view, and scrolling to its end would lose its start.
 */
export function scrollToClear(top: number, bottom: number, barTop: number): number {
  if (bottom <= barTop || bottom - top > barTop - 2 * GAP_PX) return 0;
  return bottom - barTop + GAP_PX;
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
    const box = target.getBoundingClientRect();
    const by = scrollToClear(box.top, box.bottom, bar.getBoundingClientRect().top);
    if (by > 0) window.scrollBy(0, by);
  });
}
