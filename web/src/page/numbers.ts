import { el } from './stageRow';
import type { NumbersView } from './view';

export function mountNumbers(root: HTMLElement): { render(view: NumbersView): void } {
  const rows = el('div');
  // The assumption line keeps its space when it is not shown, so Act 2 starting moves nothing.
  const assumption = el('p', 'muted assumption');
  root.replaceChildren(el('h2', 'h2', 'Live numbers'), rows, assumption);
  return {
    render(view) {
      rows.replaceChildren(
        ...view.rows.map((row) => {
          const line = el('div', 'row');
          line.append(el('span', undefined, row.label), el('span', 'num', row.value));
          return line;
        }),
      );
      assumption.textContent = view.assumption.text;
      assumption.style.visibility = view.assumption.shown ? 'visible' : 'hidden';
    },
  };
}
