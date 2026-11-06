// Puts the desk's view (cards, rows, numbers) into the page. Every value goes in with textContent, never as markup,
// because a ticket's words and a viewer's note are data. The lists are reconciled by ticket id, so a card that stays
// keeps its node.
import { button, byId, el, reconcile, setText } from '../page/dom';
import { HAND_WRITTEN_RIGHT, HIGH_RISK_MISSED, KEYWORD_RIGHT, SENT_TO_PERSON } from './measured';
import { fadeNumber } from './motion';
import type { DeskCard, DeskNumbers, SentRow } from './view';

const NEW_MS = 2000;
const NEW = 'New';
const NEW_MOVED_UP = 'New: moved up';
const LEVELS = ['low', 'medium', 'high', 'critical'];

export interface CardActions {
  approve(id: string): void;
  review(id: string): void;
}

export function drawMeasured(): void {
  setText(byId('m-missed'), HIGH_RISK_MISSED);
  setText(byId('m-hand'), HAND_WRITTEN_RIGHT);
  setText(byId('m-hand-what'), `hand-written tickets sorted right; the old keyword method got ${KEYWORD_RIGHT}`);
  setText(byId('m-sent'), SENT_TO_PERSON);
}

// The ids ever shown in the open list, so a ticket handed back to it is not mistaken for an arrival, and the ones that
// arrived within the last two seconds with the word they carry.
export interface Arrivals {
  // The word each card that is still new carries.
  mark(cards: readonly DeskCard[], now: number): ReadonlyMap<string, string>;
  // When the oldest word is due to go, or undefined when none is showing.
  nextExpiry(): number | undefined;
  reset(): void;
}

export function createArrivals(): Arrivals {
  const seen = new Set<string>();
  const until = new Map<string, { word: string; at: number }>();
  let first = true;
  return {
    mark(cards, now) {
      cards.forEach((card, at) => {
        if (seen.has(card.id)) return;
        seen.add(card.id);
        if (first) return;
        const level = LEVELS.indexOf(card.tag.level);
        const above = cards.slice(at + 1).some((later) => LEVELS.indexOf(later.tag.level) < level);
        const moved = level >= LEVELS.indexOf('high') && above;
        until.set(card.id, { word: moved ? NEW_MOVED_UP : NEW, at: now + NEW_MS });
      });
      first = false;
      for (const [id, mark] of until) if (mark.at <= now) until.delete(id);
      return new Map([...until].map(([id, mark]) => [id, mark.word]));
    },
    nextExpiry() {
      return until.size === 0 ? undefined : Math.min(...[...until.values()].map((mark) => mark.at));
    },
    reset() {
      seen.clear();
      until.clear();
      first = true;
    },
  };
}

// Many cards carry the same word, so the name a screen reader reads says which ticket it is for; it starts with the
// word on the button.
function cardButton(className: string, word: string, id: string, act: (id: string) => void): HTMLButtonElement {
  const node = button(className, word, () => act(id));
  node.setAttribute('aria-label', `${word} ${id}`);
  return node;
}

function makeCard(card: DeskCard, actions: CardActions): HTMLElement {
  const meta = el('div', 'meta');
  meta.append(el('span', 'team', card.team), el('span', `tag tag-${card.tag.level}`, card.tag.word));
  const lean = el('p', 'lean');
  lean.append(el('strong', undefined, `Leaning ${card.team}, ${card.percent}% sure.`), document.createTextNode(' '));
  lean.append(el('span', 'why', card.why));
  const buttons = el('div', 'buttons');
  if (card.showApprove) buttons.append(cardButton('btn btn-solid', 'Approve', card.id, actions.approve));
  buttons.append(cardButton('btn', 'Review', card.id, actions.review));
  const node = el('li', 'card');
  node.dataset.ticket = card.id;
  node.append(meta, el('p', 'text', card.text), lean, buttons);
  return node;
}

// The thin outline and the word on a card that has just arrived; both go together.
function markNew(node: HTMLElement, word: string | undefined): void {
  node.classList.toggle('fresh', word !== undefined);
  const shown = node.querySelector('.new');
  if (word === undefined) {
    shown?.remove();
  } else if (shown === null) {
    node.querySelector('.meta')?.append(el('span', 'new', word));
  } else {
    setText(shown, word);
  }
}

function makeRow(row: SentRow, note: string | undefined): HTMLElement {
  const head = el('div', 'meta');
  head.append(el('span', 'team', row.team), el('span', 'how', row.how));
  const node = el('li', 'row');
  node.dataset.ticket = row.id;
  node.append(head, el('p', 'text', row.text));
  if (note !== undefined) node.append(el('p', 'your-note', `Your note: ${note}`));
  return node;
}

export function drawCards(
  list: HTMLElement,
  cards: readonly DeskCard[],
  fresh: ReadonlyMap<string, string>,
  actions: CardActions,
): void {
  reconcile(list, cards, (card) => card.id, (card) => makeCard(card, actions), (node, card) => markNew(node, fresh.get(card.id)));
}

// A row never changes once drawn: it only enters or moves, so there is nothing to update. The note is the viewer's, kept
// by the page and set before the ticket closes, so it is on the row from the start.
export function drawSent(list: HTMLElement, rows: readonly SentRow[], notes: ReadonlyMap<string, string>): void {
  reconcile(list, rows, (row) => row.id, (row) => makeRow(row, notes.get(row.id)), () => undefined);
}

export function drawNumbers(numbers: DeskNumbers, cards: number, rows: number): void {
  fadeNumber(byId('open-count'), String(cards));
  fadeNumber(byId('sent-count'), String(rows));
  fadeNumber(byId('n-closed'), `${numbers.closed} of ${numbers.total}`);
  fadeNumber(byId('n-missed'), String(numbers.highRiskMissed));
  fadeNumber(byId('n-right'), String(numbers.rightNoPerson));
  fadeNumber(byId('n-changed'), String(numbers.reviewerChanged));
}
