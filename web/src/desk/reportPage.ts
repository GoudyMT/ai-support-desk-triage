// Puts the report into the page's report article, whose labels are already in the markup. Every value goes in with
// textContent, because a ticket's words are data.
import type { TicketLabel } from '../domain/labels';
import { byId, el, setText } from '../page/dom';
import type { RunState } from '../run/engine';
import type { Assumptions } from './panel';
import { reportView } from './report';

// Writes `texts` into the nodes the selector finds, in order.
function fill(selector: string, texts: readonly string[]): void {
  document.querySelectorAll(selector).forEach((node, at) => {
    node.textContent = texts[at] ?? '';
  });
}

export function drawReport(
  state: RunState,
  truthOf: (id: string) => TicketLabel,
  total: number,
  assumed: Assumptions,
): void {
  const view = reportView(state, truthOf, total, assumed);
  setText(byId('report-title'), view.heading);
  setText(byId('report-lead'), view.lead);
  fill('#report-table td', view.table);
  fill('#report-rows dd', view.rows);
  byId('report-misses').replaceChildren(
    ...view.misses.map(({ text, detail }) => {
      const item = el('li', 'row');
      item.append(el('p', 'text', text));
      if (detail !== '') item.append(el('p', 'lean', detail));
      return item;
    }),
  );
}
