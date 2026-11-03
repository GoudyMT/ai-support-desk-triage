import { el } from './stageRow';
import type { CurrentTicketView, NarrationView } from './view';

const LEGEND =
  'Blue = words the model leaned on. Outlined = the word a rule caught. Gray = masked before the model saw it.';
const COMPLETE_TEXT = 'Every ticket has been through the six stages. The numbers beside this panel are final.';

export function appendDetail(list: HTMLElement, detail: NarrationView['detail']): void {
  list.replaceChildren(
    ...detail.flatMap((row) => {
      const term = el('dt', undefined, row.label);
      const value = el('dd', 'num', row.value);
      return [term, value];
    }),
  );
}

export function mountCurrentTicket(root: HTMLElement): {
  render(ticket: CurrentTicketView | undefined, narration: NarrationView | undefined, explain: boolean): void;
} {
  const title = el('h2', 'h2');
  const heading = el('h3', 'h3');
  const plain = el('p', 'narration');
  const technical = el('details', 'technical');
  const summary = el('summary', undefined, 'Show technical detail');
  const detailList = el('dl', 'tech');
  technical.append(summary, detailList);
  const text = el('p', 'ticket-text');
  const legend = el('p', 'muted', LEGEND);
  const lines = el('ol', 'trail');
  root.replaceChildren(title, heading, plain, technical, text, legend, lines);
  let wasExplaining = false;

  return {
    render(ticket, narration, explain) {
      if (ticket === undefined || narration === undefined) {
        title.textContent = 'Run complete';
        heading.hidden = true;
        plain.textContent = COMPLETE_TEXT;
        technical.hidden = true;
        text.replaceChildren();
        legend.hidden = true;
        lines.replaceChildren();
        wasExplaining = false;
        return;
      }
      title.textContent = `Current ticket ${ticket.id}`;
      heading.hidden = false;
      heading.textContent = narration.heading;
      plain.textContent = narration.plain;
      technical.hidden = !explain;
      // Turning Explain on opens the detail; a viewer who closes it keeps it closed until the next time.
      if (explain && !wasExplaining) {
        technical.open = true;
      }
      wasExplaining = explain;
      appendDetail(detailList, narration.detail);
      text.replaceChildren(
        ...ticket.segments.map((segment) =>
          segment.kind === 'plain' ? document.createTextNode(segment.text) : el('span', segment.kind, segment.text),
        ),
      );
      legend.hidden = false;
      lines.replaceChildren(
        ...ticket.lines.map((line) => {
          const item = el('li', `trail-${line.status}`);
          item.append(el('strong', undefined, `${line.label}: `), document.createTextNode(line.text ?? 'not yet'));
          return item;
        }),
      );
    },
  };
}
