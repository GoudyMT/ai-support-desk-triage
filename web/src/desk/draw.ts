// Puts the desk's view (cards, rows, numbers) into the page. Every value goes in with textContent, never as markup,
// because a ticket's words are data. The lists are reconciled by ticket id, so a card that stays keeps its node.
import { byId, el, reconcile, setText } from '../page/dom';
import { HAND_WRITTEN_RIGHT, HIGH_RISK_MISSED, KEYWORD_RIGHT, SENT_TO_PERSON } from './measured';
import type { DeskCard, DeskNumbers, SentRow } from './view';

export function drawMeasured(): void {
  setText(byId('m-missed'), HIGH_RISK_MISSED);
  setText(byId('m-hand'), HAND_WRITTEN_RIGHT);
  setText(byId('m-hand-what'), `hand-written tickets sorted right; the old keyword method got ${KEYWORD_RIGHT}`);
  setText(byId('m-sent'), SENT_TO_PERSON);
}

function makeCard(card: DeskCard): HTMLElement {
  const meta = el('div', 'meta');
  meta.append(el('span', 'team', card.team), el('span', `tag tag-${card.tag.level}`, card.tag.word));
  const lean = el('p', 'lean');
  lean.append(el('strong', undefined, `Leaning ${card.team}, ${card.percent}% sure.`), document.createTextNode(' '));
  lean.append(el('span', 'why', card.why));
  const node = el('li', 'card');
  node.append(meta, el('p', 'text', card.text), lean);
  return node;
}

function makeRow(row: SentRow): HTMLElement {
  const head = el('div', 'meta');
  head.append(el('span', 'team', row.team), el('span', 'how', row.how));
  const node = el('li', 'row');
  node.append(head, el('p', 'text', row.text));
  return node;
}

// A card or a row never changes once drawn: it only enters, moves or leaves, so there is nothing to update.
const KEEP = (): void => undefined;

export function drawCards(list: HTMLElement, cards: readonly DeskCard[]): void {
  reconcile(list, cards, (card) => card.id, makeCard, KEEP);
}

export function drawSent(list: HTMLElement, rows: readonly SentRow[]): void {
  reconcile(list, rows, (row) => row.id, makeRow, KEEP);
}

export function drawNumbers(numbers: DeskNumbers, cards: number, rows: number): void {
  setText(byId('open-count'), String(cards));
  setText(byId('sent-count'), String(rows));
  setText(byId('n-closed'), `${numbers.closed} of ${numbers.total}`);
  setText(byId('n-missed'), String(numbers.highRiskMissed));
  setText(byId('n-right'), String(numbers.rightNoPerson));
  setText(byId('n-changed'), String(numbers.reviewerChanged));
}
