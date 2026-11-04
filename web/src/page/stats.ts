import { el, reconcile, setClass, setText } from './dom';
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

function makeRow(item: { label: string }): HTMLElement {
  const node = el('div', 'more-row');
  node.append(el('dt', 'stat-label', item.label), el('dd', 'more-value'));
  return node;
}

function updateRow(node: HTMLElement, item: { value: string }): void {
  const value = node.querySelector('dd');
  if (value !== null) setText(value, item.value);
}

/**
 * The four live numbers across the top and the "All numbers" panel that opens in place under
 * them. The panel's open state is the viewer's own and lives here; the numbers come in.
 */
export function mountStats(
  strip: HTMLElement,
  toggle: HTMLElement,
  panel: HTMLElement,
): { render(stats: Stats, more: More): void } {
  const rows = el('dl', 'more');
  const notes = el('ul', 'assumptions');
  panel.replaceChildren(rows, notes);
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    setText(toggle, open ? 'Fewer numbers' : 'All numbers');
  });
  return {
    render(stats, more) {
      reconcile(strip, stats, (s) => s.label, makeStat, updateStat);
      reconcile(rows, more.rows, (r) => r.label, makeRow, updateRow);
      reconcile(notes, more.assumptions, (text) => text, (text) => el('li', 'muted', text), () => undefined);
    },
  };
}
