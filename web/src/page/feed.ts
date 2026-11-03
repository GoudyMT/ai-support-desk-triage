import { el } from './stageRow';
import type { FeedRow } from './view';

const EMPTY_TEXT = 'No tickets yet. Press Play to start.';

export function mountFeed(root: HTMLElement): { render(rows: FeedRow[]): void } {
  const list = el('div', 'feed-scroll');
  // A list that scrolls must be reachable by keyboard.
  list.tabIndex = 0;
  list.setAttribute('role', 'region');
  list.setAttribute('aria-label', 'Tickets so far, latest first');
  root.replaceChildren(el('h2', 'h2', 'Ticket feed (latest first)'), list);
  let shown = '';
  return {
    render(rows) {
      const key = rows.map((row) => `${row.id}|${row.text}|${row.pill.word}|${row.current}`).join('\n');
      if (key === shown) return;
      shown = key;
      if (rows.length === 0) {
        list.replaceChildren(el('p', 'muted', EMPTY_TEXT));
        return;
      }
      list.replaceChildren(
        ...rows.map((row) => {
          const line = el('div', row.current ? 'row row-current' : 'row');
          line.append(el('span', 'row-text', row.text), el('span', `pill p-${row.pill.kind}`, row.pill.word));
          return line;
        }),
      );
    },
  };
}
