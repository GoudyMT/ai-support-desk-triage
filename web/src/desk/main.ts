import '../page/tokens.css';
import './desk.css';
import { byId, setText } from '../page/dom';
import { fetchModel } from '../page/fetchModel';
import { createDeskSchedule } from '../run/clock';
import { createRun, type Run } from '../run/engine';
import { createPrescreener } from '../run/prescreen';
import { foldOf, parseSeed, randomSeed } from '../run/seed';
import { createArrivals, drawCards, drawMeasured, drawNumbers, drawSent, type CardActions } from './draw';
import { createCardMotion, fadeNumber } from './motion';
import { createPanel } from './panel';
import { drawReport } from './reportPage';
import { createReviewCard } from './review';
import { initTips } from './tips';
import { createTryModal, createTryPanel } from './tryPanel';
import { deskCards, deskNumbers, deskReview, moreNumbers, resultLine, sentRows, type DeskNumbers } from './view';

const MODEL_FAILED = 'The sorting model could not be loaded. Check your connection, then press Retry.';
// How often the simulated reviewer closes the top card: one every two and a half seconds, a slow trickle a viewer can follow.
const REVIEWER_PACE_MS = 2500;
const SLOW_NOTE = 'Slowed down so you can follow.';
const PAUSED = 'Paused while you review.';
const PAUSED_TRY = 'Paused while you try a ticket.';
const PAUSED_REPORT = 'Paused while you read the report.';
const RESULT_MS = 4000;

interface Live {
  run: Run;
  total: number;
  stopListening: () => void;
  timer: number | undefined;
  // What the bar says for a few seconds after the viewer sends a ticket, and the timers that end it and the New words.
  result: string;
  resultTimer: number | undefined;
  newTimer: number | undefined;
  // Set once the end has been seen, so the next seed is drawn once.
  ended: boolean;
}

let live: Live | undefined;
// The seed the next Start runs: the address's, when it has a valid one, else a fresh draw.
let nextSeed = parseSeed(location.search).seed;
// The viewer's notes by ticket id, for this run only: never stored, sent, put in the address or in a report.
const notes = new Map<string, string>();
// Where in the open list the viewer last acted, so focus goes to the card that took its place.
let actedAt = 0;

const toggle = (): HTMLButtonElement => byId('toggle') as HTMLButtonElement;
const openList = (): HTMLElement => byId('open-list');
const arrivals = createArrivals();
const motion = createCardMotion(openList(), byId('sent-list'));

// A line about what is happening goes in the status; a message that must be heard goes in the notice, the one
// live region, so the screen reader is not told a count every two seconds.
function say(status: string, notice = ''): void {
  setText(byId('status'), status);
  setText(byId('notice'), notice);
}

function setButton(label: string, solid: boolean, disabled = false): void {
  const button = toggle();
  setText(byId('toggle-word'), label);
  button.classList.toggle('btn-solid', solid);
  button.disabled = disabled;
}

// What the run is held for, as the bar says it, or '' when nothing holds it. Try a ticket can open over a report, so
// it is named first.
function holdLine(reviewing: boolean): string {
  if (reviewing) return PAUSED;
  if (tryModal.isOpen()) return PAUSED_TRY;
  return report === undefined ? '' : PAUSED_REPORT;
}

function drawBar(playing: boolean, numbers: DeskNumbers, held: string, result: string): void {
  const ended = numbers.closed >= numbers.total;
  setButton(playing && !ended ? 'Stop' : 'Start', !playing || ended);
  if (held !== '') {
    say(held);
  } else if (result !== '') {
    say('', result);
  } else if (ended) {
    say('', `All ${numbers.total} tickets handled. Press Start to run a new set.`);
  } else if (playing) {
    say(`${numbers.total - numbers.closed - numbers.waiting} more on the way. ${SLOW_NOTE}`);
  } else {
    say('', 'Stopped.');
  }
}

// The bar alone, for a change in what holds a run that has nothing else to tell the desk: the lists stay as they are.
function redrawBar(current: Live): void {
  const state = current.run.state();
  const numbers = deskNumbers(state, current.total, current.run.truthOf);
  drawBar(state.playing, numbers, holdLine(state.reviewing !== undefined), current.result);
}

const reviewCard = createReviewCard({
  send(decision, note) {
    const current = live;
    const id = current?.run.state().reviewing?.id;
    if (current === undefined || id === undefined) return;
    if (note !== '') notes.set(id, note);
    current.run.confirm(decision);
    current.result = resultLine(decision, current.run.truthOf(id));
    window.clearTimeout(current.resultTimer);
    current.resultTimer = window.setTimeout(() => {
      current.result = '';
      render(current);
    }, RESULT_MS);
    render(current);
    focusList(actedAt);
  },
  handBack() {
    live?.run.handBack();
    focusList(actedAt);
  },
});

// Try a ticket sits beside the numbers at rest. During a run the bar's button opens the same panel over the desk and the
// run holds while it is open, then goes on only if it was going when the panel opened, or if a new run arrived under it.
const tryOpen = byId('try-open');
const tryPanel = createTryPanel();
byId('rest').append(tryPanel);
let resumeAfterTry = false;
const tryModal = createTryModal(tryPanel, byId('rest'), () => {
  const current = live;
  if (resumeAfterTry) current?.run.play();
  else if (current !== undefined) redrawBar(current);
  resumeAfterTry = false;
  tryOpen.focus();
});

tryOpen.addEventListener('click', () => {
  resumeAfterTry = live?.run.state().playing === true;
  tryModal.open();
  live?.run.pause();
  // Pausing only tells the desk when the run was going; a stopped run still has to show why it is held.
  if (live !== undefined && !resumeAfterTry) redrawBar(live);
});

// The report shows the tickets closed when Generate report is pressed and holds the run while it is open, as Try a
// ticket does.
interface Report {
  // Whether the run was going when the report opened.
  resume: boolean;
  // Draws the report from the tickets closed at the press, again after an edit to an assumption.
  draw: () => void;
}
let report: Report | undefined;
const panel = createPanel(() => report?.draw());

function closeReport(resume: boolean): void {
  const open = report;
  report = undefined;
  byId('run').classList.remove('reporting');
  byId('report').hidden = true;
  if (resume && open?.resume === true) {
    live?.run.play();
  } else if (open !== undefined && live !== undefined) {
    // A run that stays held has nothing to tell the desk, so the bar is drawn again to drop the report's line.
    redrawBar(live);
  }
}

panel.generate.addEventListener('click', () => {
  const current = live;
  if (current === undefined || report !== undefined) return;
  const state = current.run.state();
  report = {
    resume: state.playing,
    draw: () => drawReport(state, current.run.truthOf, current.total, panel.assumptions()),
  };
  current.run.pause();
  if (!state.playing) redrawBar(current);
  report.draw();
  byId('run').classList.add('reporting');
  byId('report').hidden = false;
  byId('report-title').focus();
});

byId('report-print').addEventListener('click', () => window.print());
byId('report-close').addEventListener('click', () => {
  closeReport(true);
  panel.generate.focus();
  // Fewer numbers may have folded the button away while the report was open.
  if (document.activeElement !== panel.generate) byId('more').focus();
});

// On a phone one list shows at a time and the This run panel can cover them: the run's data-view says which, and the
// style sheet reads it only at that width. The panel's way back returns to the list that was showing.
const tabs = [byId('tab-open'), byId('tab-sent')];
const TAB_STEPS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
let listView = 'open';

function pickTab(tab: HTMLElement): void {
  listView = tab.dataset['view'] ?? 'open';
  byId('run').dataset['view'] = listView;
  for (const other of tabs) {
    other.setAttribute('aria-selected', String(other === tab));
    other.tabIndex = other === tab ? 0 : -1;
  }
}

tabs.forEach((tab, at) => {
  tab.addEventListener('click', () => pickTab(tab));
  tab.addEventListener('keydown', (event) => {
    const step = TAB_STEPS[event.key];
    const next = step === undefined ? undefined : tabs[(at + step + tabs.length) % tabs.length];
    if (next === undefined) return;
    event.preventDefault();
    pickTab(next);
    next.focus();
  });
});

byId('numbers-open').addEventListener('click', () => {
  // A report open over the panel gives way to it, as Close report does.
  closeReport(true);
  byId('run').dataset['view'] = 'numbers';
  byId('run-title').focus();
});

byId('numbers-back').addEventListener('click', () => {
  byId('run').dataset['view'] = listView;
  (tabs.find((tab) => tab.dataset['view'] === listView) ?? tabs[0])?.focus();
});

function drawPhone(numbers: DeskNumbers, open: number, sent: number): void {
  fadeNumber(byId('p-closed'), `${numbers.closed} of ${numbers.total}`);
  fadeNumber(byId('p-missed'), String(numbers.highRiskMissed));
  fadeNumber(byId('p-right'), String(numbers.rightNoPerson));
  fadeNumber(byId('tab-open-n'), String(open));
  fadeNumber(byId('tab-sent-n'), String(sent));
}

// After a card leaves the list, focus goes to the Review button of the card that now stands in its place, and to the
// list's heading when the list is empty, so a keyboard user is never left at the top of the page.
function focusList(at: number): void {
  const cards = openList().children;
  const target = cards[Math.min(at, cards.length - 1)]?.querySelector<HTMLElement>('.buttons > button:last-child');
  (target ?? byId('open-title')).focus();
}

const cardActions: CardActions = {
  approve(id) {
    actedAt = indexOfCard(id);
    live?.run.approve(id);
    focusList(actedAt);
  },
  review(id) {
    actedAt = indexOfCard(id);
    live?.run.review(id);
  },
};

function indexOfCard(id: string): number {
  return [...openList().children].findIndex((card) => (card as HTMLElement).dataset.ticket === id);
}

function render(current: Live): DeskNumbers {
  const { run, total } = current;
  const state = run.state();
  const cards = deskCards(state);
  const rows = sentRows(state);
  const numbers = deskNumbers(state, total, run.truthOf);
  const now = performance.now();
  const fresh = arrivals.mark(cards, now);
  motion.snapshot();
  drawCards(openList(), cards, fresh, cardActions);
  drawSent(byId('sent-list'), rows, notes);
  motion.play();
  drawNumbers(numbers, cards.length, rows.length);
  drawPhone(numbers, cards.length, rows.length);
  panel.draw(numbers, moreNumbers(state, run.truthOf));
  const review = deskReview(state);
  if (review === undefined) reviewCard.close();
  else if (!reviewCard.isOpen()) reviewCard.open(review);
  drawBar(state.playing, numbers, holdLine(review !== undefined), current.result);
  // The New words go after about two seconds of the run going on: a held run (stopped, or waiting on a review) keeps
  // the screen as it is.
  window.clearTimeout(current.newTimer);
  const due = arrivals.nextExpiry();
  if (due !== undefined && run.nextDelayMs() !== null) {
    current.newTimer = window.setTimeout(() => render(current), Math.max(0, due - now));
  }
  return numbers;
}

function sync(current: Live): void {
  const numbers = render(current);
  window.clearTimeout(current.timer);
  const delay = current.run.nextDelayMs();
  if (delay !== null) current.timer = window.setTimeout(() => current.run.advance(), delay);
  if (numbers.closed >= numbers.total && !current.ended) {
    current.ended = true;
    nextSeed = randomSeed();
  }
}

function mount(seed: number, run: Run, total: number): void {
  if (live !== undefined) {
    live.stopListening();
    window.clearTimeout(live.timer);
    window.clearTimeout(live.resultTimer);
    window.clearTimeout(live.newTimer);
  }
  const current: Live = {
    run,
    total,
    stopListening: () => undefined,
    timer: undefined,
    result: '',
    resultTimer: undefined,
    newTimer: undefined,
    ended: false,
  };
  current.stopListening = run.onChange(() => sync(current));
  live = current;
  notes.clear();
  arrivals.reset();
  motion.reset();
  closeReport(false);
  setText(byId('frame-opt'), `This run (${total} tickets)`);
  document.body.dataset.seed = String(seed);
  byId('rest').hidden = true;
  byId('run').hidden = false;
  tryOpen.hidden = false;
  // The model can arrive while the form is open: the run waits under it and goes on when the form closes.
  if (tryModal.isOpen()) {
    resumeAfterTry = true;
    render(current);
  } else {
    run.play();
  }
}

function load(): void {
  const seed = nextSeed;
  setButton('Loading...', true, true);
  say('Loading...');
  fetchModel(foldOf(seed)).then(
    (model) => {
      const schedule = createDeskSchedule(seed);
      const run = createRun({
        seed,
        model,
        schedule,
        wallClock: () => performance.now(),
        prescreen: createPrescreener(model),
        closeEveryMs: REVIEWER_PACE_MS,
        deepTickets: 0,
      });
      mount(seed, run, schedule.total);
      toggle().focus();
    },
    () => {
      setButton('Retry', true);
      say('', MODEL_FAILED);
      toggle().focus();
    },
  );
}

toggle().addEventListener('click', () => {
  closeReport(false);
  const current = live;
  if (current === undefined || current.ended) {
    load();
  } else if (current.run.state().playing) {
    current.run.pause();
  } else {
    current.run.play();
  }
});

drawMeasured();
initTips();
