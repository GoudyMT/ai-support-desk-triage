import { rose } from '../run/valueSaved';
import { el, reconcile, setClass, setText } from './dom';
import { pulse } from './flash';
import { mountSource } from './sourcePanel';
import type { moreNumbersView, statsView } from './view';

type Stats = ReturnType<typeof statsView>;
type More = ReturnType<typeof moreNumbersView>;

function makeStat(item: { label: string }): HTMLElement {
  const node = el('div', 'stat');
  node.append(el('dt', 'stat-label', item.label), el('dd', 'stat-value'));
  return node;
}

function updateStat(node: HTMLElement, item: Stats[number]): void {
  setClass(node, item.alert ? 'stat stat-alert' : 'stat');
  const value = node.querySelector('dd');
  if (value !== null) setText(value, item.value);
}

function makeRow(item: More['rows'][number]): HTMLElement {
  const node = el('div', 'more-row');
  const value = el('dd', 'more-value');
  value.append(el('span', 'more-text'));
  if (item.source !== undefined) {
    const word = item.label.toLowerCase();
    value.append(...mountSource(node, item.source, `source-${word.replace(/ /g, '-')}`, `Where ${word} comes from`));
  }
  node.append(el('dt', 'stat-label', item.label), value);
  return node;
}

// The level each pulsing number had when it was last drawn, so a drawing knows whether it went up.
const SHOWN = new WeakMap<HTMLElement, number>();

function updateRow(node: HTMLElement, item: More['rows'][number], pulsing: boolean): void {
  const value = node.querySelector<HTMLElement>('.more-text');
  if (value === null) return;
  setText(value, item.value);
  if (item.level === undefined) return;
  // The level is kept even when the pulse is held back, so the next drawing compares with what is on screen.
  if (pulsing && item.flash !== undefined && rose(SHOWN.get(node), item.level)) pulse(value, item.flash);
  SHOWN.set(node, item.level);
}

/**
 * The four live numbers across the top and the "All numbers" panel that opens in place under
 * them. The panel's open state is the viewer's own and lives here; the numbers come in.
 */
export function mountStats(
  strip: HTMLElement,
  toggle: HTMLElement,
  panel: HTMLElement,
  // Opening or closing the panel moves everything below it.
  onToggle: () => void,
): { render(stats: Stats, more: More, pulsing: boolean): void } {
  const rows = el('dl', 'more');
  const notes = el('ul', 'assumptions');
  // The panel already holds the seed line, which stays last.
  panel.prepend(rows, notes);
  // The same chevron as "Why this choice", so both read as something that opens.
  const label = el('span', undefined, 'All numbers');
  toggle.replaceChildren(el('span', 'chevron'), label);
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('open', open);
    setText(label, open ? 'Fewer numbers' : 'All numbers');
    onToggle();
  });
  return {
    // `pulsing` is false when the drawing is not one a viewer watches move (the real speed finish).
    render(stats, more, pulsing) {
      reconcile(strip, stats, (s) => s.label, makeStat, updateStat);
      reconcile(rows, more.rows, (r) => r.label, makeRow, (node, item) => updateRow(node, item, pulsing));
      reconcile(notes, more.assumptions, (text) => text, (text) => el('li', 'muted', text), () => undefined);
    },
  };
}
