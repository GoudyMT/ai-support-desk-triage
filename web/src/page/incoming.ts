import { el, reconcile, setClass, setText } from './dom';
import type { incomingView } from './view';

type Incoming = ReturnType<typeof incomingView>;

function makeCard(item: Incoming[number]): HTMLElement {
  const card = el('li', 'card');
  const head = el('div', 'card-head');
  head.append(el('span', 'card-title', item.id), el('span', 'tag', ''));
  card.append(head, el('p', 'card-line', ''));
  return card;
}

function updateCard(card: HTMLElement, item: Incoming[number]): void {
  const tag = card.querySelector<HTMLElement>('.tag');
  const line = card.querySelector('.card-line');
  if (tag !== null) {
    // The property, not toggleAttribute('hidden', ...): WebKit reports that call as an inline
    // style, which the page's content security policy refuses.
    tag.hidden = item.tag === null;
    setText(tag, item.tag?.word ?? '');
    setClass(tag, `tag tag-${item.tag?.level ?? 'low'}`);
  }
  if (line !== null) setText(line, item.preview);
}

/** Coming in: the waiting tickets, next one on top, each with its first words and its tag once tagged. */
export function mountIncoming(root: HTMLElement): { render(items: Incoming): void } {
  const heading = el('h2', 'col-title');
  const list = el('ul', 'cards');
  root.replaceChildren(heading, list);
  return {
    render(items) {
      setText(heading, `Coming in (${items.length} waiting)`);
      reconcile(list, items, (item) => item.id, makeCard, updateCard);
    },
  };
}
