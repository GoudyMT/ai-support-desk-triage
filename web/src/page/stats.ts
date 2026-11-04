import { el, reconcile, setClass, setText } from './dom';
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

function updateRow(node: HTMLElement, item: { value: string }): void {
  const value = node.querySelector('.more-text');
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
  });
  return {
    render(stats, more) {
      reconcile(strip, stats, (s) => s.label, makeStat, updateStat);
      reconcile(rows, more.rows, (r) => r.label, makeRow, updateRow);
      reconcile(notes, more.assumptions, (text) => text, (text) => el('li', 'muted', text), () => undefined);
    },
  };
}
