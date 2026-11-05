import { reducedMotion } from './motion';

// One short, light pulse: long enough to catch the eye, short enough that the next ticket's pulse is not on top of it.
const FLASH_MS = 600;
// Where in the pulse the text goes back to its own color. The color behind it has faded halfway by then, which
// is where dark text and light text read about equally well on it.
const INK_BACK_AT = 0.45;
const INK_BACK_GAP = 0.001;

/**
 * Pulses the background of a number that has just gone up: a color that is read from the page's tokens when
 * it runs, so it follows the theme, fading to nothing. The text takes the token's own color for the start of
 * the pulse, so it keeps its contrast on the color behind it. Nothing runs under reduced motion.
 */
export function pulse(node: HTMLElement, kind: 'time' | 'value'): void {
  if (reducedMotion()) return;
  const tokens = getComputedStyle(document.documentElement);
  const background = tokens.getPropertyValue(`--flash-${kind}-bg`).trim();
  const ink = tokens.getPropertyValue(`--flash-${kind}-text`).trim();
  const own = getComputedStyle(node).color;
  // A number that rises again while it is still pulsing starts the pulse over.
  for (const running of node.getAnimations()) running.cancel();
  node.animate(
    [
      { backgroundColor: background, color: ink, offset: 0 },
      { color: ink, offset: INK_BACK_AT },
      { color: own, offset: INK_BACK_AT + INK_BACK_GAP },
      { backgroundColor: 'transparent', color: own, offset: 1 },
    ],
    { duration: FLASH_MS, easing: 'ease-out' },
  );
}
