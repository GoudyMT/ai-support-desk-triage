import '../page/tokens.css';
import './desk.css';
import { byId, setText } from '../page/dom';
import { fetchModel } from '../page/fetchModel';
import { createDeskSchedule } from '../run/clock';
import { createRun, type Run } from '../run/engine';
import { createPrescreener } from '../run/prescreen';
import { foldOf, parseSeed, randomSeed } from '../run/seed';
import { createArrivals, drawCards, drawMeasured, drawNumbers, drawSent, type CardActions } from './draw';
import { createCardMotion } from './motion';
import { createReviewCard } from './review';
import { deskCards, deskNumbers, deskReview, resultLine, sentRows, type DeskNumbers } from './view';

const MODEL_FAILED = 'The sorting model could not be loaded. Check your connection, then press Retry.';
// How often the simulated reviewer closes the top card: one every two seconds, a slow trickle a viewer can follow.
const REVIEWER_PACE_MS = 2500;
const SLOW_NOTE ='Slowed down so you can follow.';
const PAUSED = 'Paused while you review.';
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
  setText(button, label);
  button.classList.toggle('btn-solid', solid);
  button.disabled = disabled;
}

function drawBar(playing: boolean, numbers: DeskNumbers, reviewing: boolean, result: string): void {
  const ended = numbers.closed >= numbers.total;
  setButton(playing && !ended ? 'Stop' : 'Start', !playing || ended);
  if (reviewing) {
    say(PAUSED);
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
  const review = deskReview(state);
  if (review === undefined) reviewCard.close();
  else if (!reviewCard.isOpen()) reviewCard.open(review);
  drawBar(state.playing, numbers, review !== undefined, current.result);
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
  document.body.dataset.seed = String(seed);
  byId('rest').hidden = true;
  byId('run').hidden = false;
  run.play();
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
