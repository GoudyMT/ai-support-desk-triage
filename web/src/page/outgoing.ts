import { PILL_KEY, reviewerNote } from './copy';
import { el, reconcile, setClass, setText } from './dom';
import type { outgoingView } from './view';

type Outgoing = ReturnType<typeof outgoingView>;

export interface OutgoingActions {
  review(id: string): void;
}

function makeOpenCard(actions: OutgoingActions) {
  return (item: Outgoing['open'][number]): HTMLElement => {
    const card = el('li', 'card card-open');
    card.dataset.ticket = item.id;
    const head = el('div', 'card-head');
    head.append(el('span', 'card-title', ''), el('span', 'tag', ''));
    const review = el('button', 'btn btn-line', 'Review');
    review.type = 'button';
    review.setAttribute('aria-label', `Review ${item.id}`);
    review.addEventListener('click', () => {
      actions.review(item.id);
    });
    card.append(head, el('p', 'card-team', ''), el('p', 'card-line', ''), review);
    return card;
  };
}

function updateOpenCard(card: HTMLElement, item: Outgoing['open'][number], locked: boolean): void {
  const review = card.querySelector('button');
  if (review !== null) review.disabled = locked;
  const title = card.querySelector('.card-title');
  const tag = card.querySelector('.tag');
  const why = card.querySelector('.card-line');
  const team = card.querySelector('.card-team');
  if (team !== null) setText(team, item.team);
  if (title !== null) setText(title, `${item.id} ${item.category}`);
  if (tag !== null) {
    setText(tag, item.tag.word);
    setClass(tag, `tag tag-${item.tag.level}`);
  }
  if (why !== null) setText(why, item.why);
}

function makeClosedLine(item: Outgoing['closed'][number]): HTMLElement {
  const line = el('li', 'line');
  line.dataset.ticket = item.id;
  line.append(
    el('span', 'line-title', `${item.id} ${item.category}`),
    el('span', `pill pill-${item.pill.kind}`, item.pill.word),
  );
  return line;
}

function sectionHead(text: string): HTMLElement {
  return el('h3', 'sub-title', text);
}

// A small control, closed until asked for, that decodes the marks on the closed lines. It has the
// same arrow as "Why this choice" and "All numbers", so all three read as something that opens.
function buildKey(): { toggle: HTMLButtonElement; list: HTMLElement } {
  const list = el('ul', 'key');
  list.id = 'closed-key';
  list.hidden = true;
  for (const row of PILL_KEY) {
    const item = el('li', 'key-row');
    item.append(el('span', `pill pill-${row.kind}`, row.word), el('span', 'sr-only', ': '), el('span', undefined, row.meaning));
    list.append(item);
  }
  const toggle = el('button', 'btn btn-link btn-small');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', list.id);
  toggle.append(el('span', 'chevron'), document.createTextNode('What these mean'));
  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
  });
  return { toggle, list };
}

/**
 * Going out: open tickets as large cards with a Review button on top, closed ones as one gray
 * line each below, newest first. The column folds to a rail with the pending count. Cards are
 * kept between renders (see `reconcile`) so a focused Review button stays focused.
 */
export function mountOutgoing(
  root: HTMLElement,
  actions: OutgoingActions,
): { render(view: Outgoing, pending: string, locked: boolean): void } {
  const collapse = el('button', 'btn btn-line btn-small', 'Collapse');
  collapse.type = 'button';
  collapse.setAttribute('aria-expanded', 'true');
  const head = el('div', 'col-head');
  const note = el('p', 'muted col-head-note', reviewerNote());
  const heading = el('div', 'col-head-text');
  heading.append(el('h2', 'col-title', 'Going out'), note);
  head.append(heading, collapse);
  const rail = el('button', 'rail');
  rail.type = 'button';
  rail.setAttribute('aria-expanded', 'false');
  const railCount = el('span', 'rail-count', '0');
  rail.append(railCount, el('span', 'rail-word', 'pending'));
  const openTitle = sectionHead('');
  const openList = el('ul', 'cards open');
  const closedTitle = sectionHead('');
  const closedList = el('ul', 'lines closed');
  const key = buildKey();
  const body = el('div', 'col-body');
  body.append(openTitle, openList, closedTitle, key.toggle, key.list, closedList);
  root.replaceChildren(head, rail, body);

  const fold = (folded: boolean): void => {
    root.classList.toggle('col-out-rail', folded);
    (folded ? rail : collapse).focus();
  };
  collapse.addEventListener('click', () => {
    fold(true);
  });
  rail.addEventListener('click', () => {
    fold(false);
  });

  return {
    // `locked` while a review form is open: one ticket is reviewed at a time, so the other buttons wait.
    render(view, pending, locked) {
      setText(openTitle, `Open, needs a person (${view.open.length})`);
      setText(closedTitle, `Closed (${view.closed.length})`);
      setText(railCount, pending);
      rail.setAttribute('aria-label', `Show tickets going out, ${pending} pending human review`);
      reconcile(openList, view.open, (item) => item.id, makeOpenCard(actions), (card, item) => {
        updateOpenCard(card, item, locked);
      });
      reconcile(closedList, view.closed, (item) => item.id, makeClosedLine, () => undefined);
    },
  };
}
