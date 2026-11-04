import { el, setText } from './dom';
import type { controlsView } from './view';

export interface ControlActions {
  playPause(): void;
  step(): void;
  restart(): void;
}

type ControlsState = ReturnType<typeof controlsView>;

export type TabName = 'in' | 'out';

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** Play or Pause, Step and Restart. */
export function mountControls(
  root: HTMLElement,
  actions: ControlActions,
): { render(view: ControlsState): void; focusPrimary(): void } {
  const play = button('Play', 'btn btn-solid', actions.playPause);
  const step = button('Step', 'btn btn-line', actions.step);
  const restart = button('Restart', 'btn btn-line', actions.restart);
  root.replaceChildren(play, step, restart);
  return {
    render(view) {
      setText(play, view.playLabel);
      play.disabled = view.playDisabled;
      step.disabled = view.stepDisabled;
    },
    // The first control that can take focus: Play or Pause while the run can go on, Restart after it ends.
    focusPrimary() {
      (play.disabled ? restart : play).focus();
    },
  };
}

const TABS: { name: TabName; label: string; listId: string }[] = [
  { name: 'in', label: 'Coming in', listId: 'incoming' },
  { name: 'out', label: 'Going out', listId: 'outgoing' },
];

/**
 * Under 1024 px the two lists share one slot: these tabs choose which one shows, and the
 * tab itself carries the count (the pending count on Going out). CSS hides the tabs, and
 * shows both lists, at wider screens. Arrow keys move between the tabs.
 */
export function mountTabs(
  root: HTMLElement,
  board: HTMLElement,
): { render(counts: Record<TabName, string>): void } {
  const nodes = new Map<TabName, { tab: HTMLButtonElement; count: HTMLElement }>();
  const select = (name: TabName, focus: boolean): void => {
    board.classList.toggle('show-in', name === 'in');
    board.classList.toggle('show-out', name === 'out');
    for (const [key, { tab }] of nodes) {
      tab.setAttribute('aria-selected', String(key === name));
      tab.tabIndex = key === name ? 0 : -1;
      if (focus && key === name) tab.focus();
    }
  };
  for (const { name, label, listId } of TABS) {
    const tab = button('', 'tab', () => {
      select(name, false);
    });
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', listId);
    const count = el('span', 'tab-count');
    tab.append(document.createTextNode(label), count);
    nodes.set(name, { tab, count });
    root.append(tab);
  }
  root.addEventListener('keydown', (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    select(event.key === 'ArrowLeft' || event.key === 'Home' ? 'in' : 'out', true);
  });
  select('in', false);
  return {
    render(counts) {
      for (const [name, { count }] of nodes) setText(count, counts[name]);
    },
  };
}
