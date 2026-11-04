import { byId, el, setText } from './dom';
import type { barFills as barFillsFn, learnBarView } from './learnView';
import type { controlsView, speedView } from './view';

export interface BarActions {
  playPause(): void;
  step(): void;
  restart(): void;
  speed(): void;
  back(): void;
  learnPause(): void;
  next(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// One stroke weight for all of them, drawn on a 24-unit grid.
const ICONS = {
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  step: 'M6 5l9 7-9 7zM19 5v14',
  restart: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  faster: 'M5 6l6 6-6 6M12 6l6 6-6 6',
  slower: 'M11 6l-6 6 6 6M18 6l-6 6 6 6',
  back: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
} as const;

type IconName = keyof typeof ICONS;

function icon(name: IconName): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function button(className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', `btn ${className}`);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

// The icon always sits beside its word. Rebuilt only when the face changes, so a focused button stays put.
function face(node: HTMLButtonElement, name: IconName, label: string): void {
  if (node.dataset.face === `${name} ${label}`) return;
  node.dataset.face = `${name} ${label}`;
  node.replaceChildren(icon(name), el('span', 'bar-word', label));
}

function setSolid(node: HTMLElement, solid: boolean): void {
  node.classList.toggle('btn-solid', solid);
}

type SeeView = {
  controls: ReturnType<typeof controlsView>;
  speed: ReturnType<typeof speedView>;
  status: string;
};

export interface Bar {
  show(mode: 'learn' | 'see'): void;
  renderSee(view: SeeView): void;
  renderLearn(view: ReturnType<typeof learnBarView>): void;
  fill(fills: ReturnType<typeof barFillsFn>): void;
  // The main button of the row on show: Play or Pause (Restart once the run ends), or the Learn pause.
  focusPrimary(): void;
}

/**
 * The bar fixed to the bottom of the screen, like a video player. One row for See The Process (Play or
 * Pause, Step, Restart, the plain status, Speed up or Slow down) and one for Learn The Process (Back,
 * Pause or Resume, Next, the step count), with the loading bars of Learn along its top edge.
 */
export function mountBar(root: HTMLElement, actions: BarActions, steps: number): Bar {
  const seeRow = byId('controls');
  const learnRow = byId('learn-controls');
  const progress = byId('bars');
  const play = button('btn-solid', actions.playPause);
  const step = button('bar-quiet', actions.step);
  const restart = button('bar-quiet', actions.restart);
  const speed = button('btn-speed', actions.speed);
  seeRow.prepend(play, step, restart);
  seeRow.append(speed);
  const back = button('bar-quiet', actions.back);
  const main = button('btn-solid', actions.learnPause);
  const next = button('', actions.next);
  const count = el('p', 'bar-status bar-count');
  learnRow.append(back, main, next, count);
  face(step, 'step', 'Step');
  face(restart, 'restart', 'Restart');
  face(back, 'back', 'Back');
  const fills = Array.from({ length: steps }, () => {
    const fill = el('i');
    const segment = el('span');
    segment.append(fill);
    progress.append(segment);
    return fill;
  });
  // The page keeps this much room under its content so the bar never covers it.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--bar-h', `${root.offsetHeight}px`);
  }).observe(root);
  return {
    show(mode: 'learn' | 'see') {
      root.hidden = false;
      seeRow.hidden = mode !== 'see';
      learnRow.hidden = mode !== 'learn';
      progress.hidden = mode !== 'learn';
    },
    renderSee(view: SeeView) {
      face(play, view.controls.playLabel === 'Play' ? 'play' : 'pause', view.controls.playLabel);
      play.disabled = view.controls.playDisabled;
      step.disabled = view.controls.stepDisabled;
      face(speed, view.speed.label === 'Speed up' ? 'faster' : 'slower', view.speed.label);
      speed.disabled = view.speed.disabled;
      setSolid(speed, view.speed.solid);
      setText(byId('status'), view.status);
    },
    renderLearn(view: ReturnType<typeof learnBarView>) {
      back.disabled = view.backDisabled;
      face(main, view.mainLabel === 'Pause' ? 'pause' : 'play', view.mainLabel);
      face(next, 'next', view.nextLabel);
      setText(count, view.count);
    },
    fill(values: number[]) {
      values.forEach((value, i) => {
        const node = fills[i];
        if (node !== undefined) node.style.width = `${value * 100}%`;
      });
    },
    focusPrimary() {
      (learnRow.hidden ? (play.disabled ? restart : play) : main).focus();
    },
  };
}
