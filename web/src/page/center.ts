import { el, reconcile, segmentNodes, setClass, setText } from './dom';
import type { CenterView, realSpeedView } from './view';

export interface CenterInput {
  ticket: CenterView | undefined;
  // The plain sentence to show, held past the ticket it was for; null for none.
  sentence: string | null;
  explain: 'offered' | 'off';
  explainOpen: boolean;
  // What to say when no ticket is in the center.
  idle: string;
  realSpeedLabel: string | null;
  result: ReturnType<typeof realSpeedView>;
}

export interface CenterActions {
  toggleExplain(): void;
  finishNow(): void;
  restart(): void;
}

interface TicketPanel {
  box: HTMLElement;
  // Carries the ticket id, so a card travelling here or away has a small place to land or leave.
  titleBox: HTMLElement;
  title: HTMLElement;
  tag: HTMLElement;
  stage: HTMLElement;
  track: HTMLElement;
  text: HTMLElement;
  lines: HTMLElement;
  say: HTMLElement;
  toggle: HTMLButtonElement;
  why: HTMLElement;
  note: HTMLElement;
  off: HTMLElement;
}

const PER_SECOND_ROUND = 100;
const ROUND_ABOVE = 1000;

function rate(perSecond: number): string {
  const rounded = perSecond >= ROUND_ABOVE ? Math.round(perSecond / PER_SECOND_ROUND) * PER_SECOND_ROUND : Math.round(perSecond);
  return rounded.toLocaleString('en-US');
}

function resultLine(result: NonNullable<CenterInput['result']>): string {
  const base = `${result.tickets} tickets through every stage in ${Math.round(result.ms)} ms`;
  return result.perSecond === null ? `${base}.` : `${base}, about ${rate(result.perSecond)} tickets a second.`;
}

// The number comes from a second pass over every ticket, so it says what that pass was.
function howLine(result: NonNullable<CenterInput['result']>): string {
  return `We ran all ${result.tickets} tickets again with no pacing and no cards drawn, so you see how fast the software really is. The page measures it in your browser.`;
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function makeStep(item: { name: string }): HTMLElement {
  const step = el('li', 'step');
  step.append(el('span', 'step-bar'), el('span', 'step-name', item.name));
  return step;
}

function updateStep(step: HTMLElement, item: CenterView['steps'][number]): void {
  setClass(step, `step step-${item.status}`);
  if (item.status === 'now') {
    step.setAttribute('aria-current', 'step');
  } else {
    step.removeAttribute('aria-current');
  }
}

type Line = CenterView['lines'][number];

// A row is built once and kept, so the dots of a row still waiting keep their rhythm
// instead of starting over on every render.
function makeLine(line: Line): HTMLElement {
  const row = el('p', 'line-detail');
  const dots = el('span', 'dots');
  dots.setAttribute('aria-hidden', 'true');
  dots.append(el('span', 'dot'), el('span', 'dot'), el('span', 'dot'));
  row.append(el('strong', undefined, `${line.label}: `), el('span', 'line-text'), dots, el('span', 'sr-only', 'Waiting'));
  return row;
}

function updateLine(row: HTMLElement, line: Line): void {
  const text = row.querySelector<HTMLElement>('.line-text');
  const dots = row.querySelector<HTMLElement>('.dots');
  const waiting = row.querySelector<HTMLElement>('.sr-only');
  if (text === null || dots === null || waiting === null) return;
  text.hidden = line.text === null;
  dots.hidden = line.text !== null;
  waiting.hidden = line.text !== null;
  setText(text, line.text ?? '');
}

function whyNodes(rows: CenterView['why']): HTMLElement[] {
  return rows.flatMap((row) => [el('dt', undefined, row.label), el('dd', undefined, row.value)]);
}

function buildResult(actions: CenterActions): {
  box: HTMLElement;
  title: HTMLElement;
  line: HTMLElement;
  how: HTMLElement;
} {
  const box = el('div', 'result');
  const title = el('h2', 'ticket-title', 'Run complete at real speed');
  title.tabIndex = -1;
  const line = el('p', 'result-line');
  const how = el('p');
  const note = el('p', 'muted', "Reviews are simulated, so this is the software's speed, not a person's.");
  box.append(title, line, how, note, button('btn btn-line', 'Replay at learn speed', actions.restart));
  return { box, title, line, how };
}

function buildTicket(actions: CenterActions): TicketPanel {
  const box = el('div', 'now');
  const title = el('h2', 'ticket-title');
  const tag = el('span', 'tag');
  const stage = el('span', 'now-stage');
  const titleBox = el('div', 'now-title');
  titleBox.append(title, tag);
  const head = el('div', 'now-head');
  head.append(titleBox, stage);
  const track = el('ol', 'track');
  const text = el('p', 'ticket-text');
  const lines = el('div', 'lines-detail');
  const say = el('p', 'say');
  const toggle = button('btn btn-link', '', actions.toggleExplain);
  toggle.append(el('span', 'chevron'), document.createTextNode('Why this choice'));
  const why = el('dl', 'why-list');
  const note = el('p', 'muted why-note');
  const off = el('p', 'muted', 'Explanations are off on the busy day. Pause to read one.');
  box.append(head, track, text, lines, say, toggle, why, note, off);
  return { box, titleBox, title, tag, stage, track, text, lines, say, toggle, why, note, off };
}

function renderTicket(panel: TicketPanel, input: CenterInput, ticket: CenterView): void {
  setText(panel.title, `Ticket ${ticket.id}`);
  panel.titleBox.dataset.ticket = ticket.id;
  panel.tag.hidden = ticket.tag === null;
  setText(panel.tag, ticket.tag?.text ?? '');
  setClass(panel.tag, `tag tag-${ticket.tag?.level ?? 'low'}`);
  setText(panel.stage, `Now: ${ticket.stageName}`);
  reconcile(panel.track, ticket.steps, (s) => s.name, makeStep, updateStep);
  panel.text.replaceChildren(...segmentNodes(ticket.segments));
  reconcile(panel.lines, ticket.lines, (line) => line.label, makeLine, updateLine);
  setText(panel.say, input.sentence ?? '');
  const offered = input.explain === 'offered';
  const open = offered && input.explainOpen;
  // Nothing is decided at Intake, so there is nothing yet to open.
  panel.toggle.hidden = !offered || ticket.why.length === 0;
  panel.toggle.classList.toggle('open', open);
  panel.toggle.setAttribute('aria-expanded', String(open));
  panel.off.hidden = offered;
  panel.why.hidden = !open;
  panel.note.hidden = !open || ticket.whyNote === null;
  setText(panel.note, ticket.whyNote ?? '');
  if (open) panel.why.replaceChildren(...whyNodes(ticket.why));
}

/**
 * The center, the widest column: the ticket being worked, its stage track, its masked text,
 * a line for each stage reached, the plain sentence and a closed "Why this choice". It is
 * built once and then updated in place, so a button the viewer has focused is never replaced
 * by a render. The same space shows the real speed result and the idle line.
 */
export function mountCenter(
  root: HTMLElement,
  actions: CenterActions,
): { render(input: CenterInput): void; focusResult(): void } {
  const result = buildResult(actions);
  const panel = buildTicket(actions);
  const idle = el('p', 'muted idle');
  // With no ticket in the center the last sentence is still shown here, so it is not lost with the ticket.
  const idleSay = el('p', 'idle-say');
  const cta = el('div', 'cta');
  const real = button('btn btn-link', '', actions.finishNow);
  cta.append(real);
  root.replaceChildren(result.box, panel.box, idle, idleSay, cta);
  return {
    render(input) {
      const { ticket } = input;
      const finished = input.result !== undefined;
      result.box.hidden = !finished;
      panel.box.hidden = finished || ticket === undefined;
      idle.hidden = finished || ticket !== undefined;
      idleSay.hidden = idle.hidden || input.sentence === null;
      setText(idleSay, input.sentence ?? '');
      cta.hidden = finished || input.realSpeedLabel === null;
      if (input.result !== undefined) {
        setText(result.line, resultLine(input.result));
        setText(result.how, howLine(input.result));
      }
      if (ticket !== undefined) renderTicket(panel, input, ticket);
      setText(idle, input.idle);
      setText(real, input.realSpeedLabel ?? '');
    },
    focusResult() {
      result.title.focus();
    },
  };
}
