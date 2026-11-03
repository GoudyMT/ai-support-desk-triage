import type { Speed } from '../run/engine';
import { el } from './stageRow';
import type { ControlsView } from './view';

export interface ControlActions {
  playPause(): void;
  step(): void;
  setSpeed(speed: Speed): void;
  toggleExplain(): void;
  toggleTakeOver(): void;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', 'btn', label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function mountControls(
  root: HTMLElement,
  actions: ControlActions,
): { render(view: ControlsView, explain: boolean): void; focusPlay(): void } {
  const play = button('Play', actions.playPause);
  const step = button('Step', actions.step);
  const learn = button('Learn speed', () => actions.setSpeed('learn'));
  const real = button('Real speed', () => actions.setSpeed('real'));
  const explain = button('Explain', actions.toggleExplain);
  const takeOver = button('Take over', actions.toggleTakeOver);
  const speed = el('div', 'speed');
  speed.setAttribute('role', 'group');
  speed.setAttribute('aria-label', 'Speed');
  speed.append(learn, real);
  root.replaceChildren(play, step, speed, explain, takeOver);

  const setPressed = (node: HTMLButtonElement, on: boolean): void => {
    node.setAttribute('aria-pressed', String(on));
    node.classList.toggle('btn-on', on);
  };
  return {
    render(view, explainOn) {
      play.textContent = view.playLabel;
      play.disabled = view.playDisabled;
      // Play is the call to action while paused, drawn as the filled button.
      play.classList.toggle('btn-on', view.playLabel === 'Play');
      step.disabled = view.stepDisabled;
      setPressed(learn, view.speed === 'learn');
      setPressed(real, view.speed === 'real');
      setPressed(explain, explainOn);
      takeOver.textContent = view.takeOverLabel;
      takeOver.classList.toggle('btn-on', view.takeOverOn);
    },
    focusPlay() {
      play.focus();
    },
  };
}
