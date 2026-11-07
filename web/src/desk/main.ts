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
const PAUSED_READ = 'Paused while you read. Move away to carry on.';
const RESULT_MS = 4000;
const FOCUS_CLEAR_PX = 8;
const STARTED = 'Run started.';
// The width where the lists show one at a time, as the style sheet has it (40rem): there the card's flight does not show.
const PHONE = window.matchMedia('(max-width: 40rem)');

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
const addressSeed = parseSeed(location.search);
// The seed the next Start runs: the address's, when it has a valid one, else a fresh draw.
let nextSeed = addressSeed.seed;
// Whether the address named a seed that could not be used, until the first run has said so.
let seedIgnored = addressSeed.ignored;
// Whether a model is on its way or failed to come, which the bar shows over everything else: a hold that ends (Try a
// ticket closed, a report closed) redraws the bar and must not turn Loading or Retry back into Start.
let loadState: 'idle' | 'loading' | 'failed' = 'idle';
// The viewer's notes by ticket id, for this run only: never stored, sent, put in the address or in a report.
const notes = new Map<string, string>();
// Where in the open list the viewer last acted, so focus goes to the card that took its place.
let actedAt = 0;

const toggle = (): HTMLButtonElement => byId('toggle') as HTMLButtonElement;
const openList = (): HTMLElement => byId('open-list');
const arrivals = createArrivals();
const sentArrivals = createArrivals();
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
  if (report !== undefined) return PAUSED_REPORT;
  return reading && readOwes ? PAUSED_READ : '';
}

// The bar while a model loads or after it failed to, or false when it is neither and the run says what the bar shows.
function drawLoad(): boolean {
  if (loadState === 'loading') {
    setButton('Loading...', true, true);
    say('Loading...');
  } else if (loadState === 'failed') {
    setButton('Retry', true);
    say('', MODEL_FAILED);
  }
  return loadState !== 'idle';
}

// `last` is the team the latest closed ticket went to. On a phone the card's flight does not show, so while a run plays the
// bar says where the ticket went.
function drawBar(playing: boolean, numbers: DeskNumbers, held: string, result: string, last: string | undefined): void {
  if (drawLoad()) return;
  const ended = numbers.closed >= numbers.total;
  setButton(playing && !ended ? 'Stop' : 'Start', !playing || ended);
  // A run at its end says so, whatever is open over it, unless the viewer's last answer is still being shown.
  if (held !== '' && !ended) {
    say(held);
  } else if (result !== '') {
    say('', result);
  } else if (ended) {
    const next = PHONE.matches ? 'Numbers' : 'More numbers and report';
    say('', `All ${numbers.total} tickets handled. Open ${next}, or press Start to run a new set.`);
  } else if (playing && PHONE.matches && last !== undefined) {
    say(`Sent to ${last}.`);
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
  drawBar(state.playing, numbers, holdLine(state.reviewing !== undefined), current.result, state.done.at(-1)?.final.route);
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

// A held Enter repeats its keydown, and each repeat would press the focused button again, closing ticket after ticket down
// the list unread: only the first keydown of a press counts.
document.addEventListener(
  'keydown',
  (event) => {
    if (event.repeat && event.key === 'Enter' && event.target instanceof HTMLButtonElement) event.preventDefault();
  },
  true,
);

// The second press of a double press lands on whatever the first brought under it: the card that just opened, or the bar
// behind the card that just closed. It is not a new choice, so nothing hears it.
document.addEventListener(
  'click',
  (event) => {
    if (reviewCard.settling()) {
      event.stopPropagation();
      event.preventDefault();
    }
  },
  true,
);

// A viewer reading a card must not see it taken away, so the run holds while a mouse pointer is over Needs a person or the
// keyboard is working inside it, and goes on when that ends. It is the held run Try a ticket and the report make: it holds
// only a run that is going and starts only a run it held, so a run the viewer stopped, or one that has ended, stays as it is.
let pointerIn = false;
let keyboardIn = false;
// Whether the last input was a key: focus that a script moved after a mouse press is not the keyboard working there.
let lastInputWasKey = false;
let reading = false;
// A going run was held for reading and has not been started again. It may have to wait for Try a ticket or a report that
// opened meanwhile, which hold the run in their own way and start it again only for themselves.
let readOwes = false;

function settleReading(): void {
  const current = live;
  const list = openList();
  // A list that is not showing (the report over it, the other tab on a phone) is not being read.
  const shown = list.getClientRects().length > 0;
  if (!shown) pointerIn = false;
  if (!shown || !list.contains(document.activeElement)) keyboardIn = false;
  reading = current !== undefined && !current.ended && (pointerIn || keyboardIn);
  if (current === undefined) return;
  if (current.ended) readOwes = false;
  if (reading && current.run.state().playing) {
    readOwes = true;
    current.run.pause();
  } else if (!reading && readOwes && !tryModal.isOpen() && report === undefined) {
    readOwes = false;
    current.run.play();
  }
}

openList().addEventListener('pointerenter', (event) => {
  pointerIn = event.pointerType !== 'touch';
  settleReading();
});
openList().addEventListener('pointerleave', () => {
  pointerIn = false;
  settleReading();
});
document.addEventListener(
  'keydown',
  () => {
    lastInputWasKey = true;
    keyboardIn = openList().contains(document.activeElement);
    settleReading();
  },
  true,
);
document.addEventListener('pointerdown', () => (lastInputWasKey = false), true);
let pressing = false;
document.addEventListener('pointerdown', () => {
  pressing = true;
}, true);
document.addEventListener('pointerup', () => {
  pressing = false;
}, true);

// WebKit leaves a focused control under the sticky bar, whatever the page's scroll padding says.
function clearOfBar(target: HTMLElement): void {
  const bar = document.querySelector('.bar');
  // Scrolling during a press would move the button out from under it, and the click would be lost.
  if (bar === null || pressing || target.closest('dialog') !== null) return;
  const under = target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
  if (under > 0) window.scrollBy(0, under + FOCUS_CLEAR_PX);
}

document.addEventListener('focusin', (event) => {
  keyboardIn = lastInputWasKey && openList().contains(event.target as Node);
  settleReading();
  clearOfBar(event.target as HTMLElement);
});
document.addEventListener('focusout', (event) => {
  if (openList().contains(event.relatedTarget as Node | null)) return;
  keyboardIn = false;
  settleReading();
});

// Try a ticket sits beside the numbers at rest on a wide screen. During a run the bar's button opens the same panel over
// the desk and the run holds while it is open, then goes on only if it was going when the panel opened, or if a new run
// arrived under it.
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
  settleReading();
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
  settleReading();
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
  settleReading();
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
    // The answer to an earlier review is about that ticket, not this one.
    if (live !== undefined) {
      window.clearTimeout(live.resultTimer);
      live.result = '';
    }
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

// A run that is live is lost by leaving its page, so while one is going the links to other pages open beside it, in a tab
// that cannot reach it; at rest and after the end they open here.
function openLinksIn(newTab: boolean): void {
  for (const link of document.querySelectorAll('a[href]')) {
    if (newTab) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
    } else {
      link.removeAttribute('target');
      link.removeAttribute('rel');
    }
  }
}

function render(current: Live): DeskNumbers {
  const { run, total } = current;
  const state = run.state();
  const cards = deskCards(state);
  const rows = sentRows(state);
  const numbers = deskNumbers(state, total, run.truthOf);
  const now = performance.now();
  const fresh = arrivals.mark(cards, now);
  const freshRows = sentArrivals.mark(rows, now);
  motion.snapshot();
  drawCards(openList(), cards, fresh, cardActions);
  drawSent(byId('sent-list'), rows, notes, freshRows);
  motion.play();
  drawNumbers(numbers, cards.length, rows.length);
  drawPhone(numbers, cards.length, rows.length);
  panel.draw(numbers, moreNumbers(state, run.truthOf));
  const ended = numbers.closed >= numbers.total;
  byId('open-none').hidden = !ended;
  openLinksIn(!ended);
  const review = deskReview(state);
  if (review === undefined) reviewCard.close();
  else if (!reviewCard.isOpen()) reviewCard.open(review);
  drawBar(state.playing, numbers, holdLine(review !== undefined), current.result, state.done.at(-1)?.final.route);
  // The New words go after about two seconds of the run going on: a held run (stopped, or waiting on a review) keeps
  // the screen as it is.
  window.clearTimeout(current.newTimer);
  const expiries = [arrivals.nextExpiry(), sentArrivals.nextExpiry()].filter((at): at is number => at !== undefined);
  const due = expiries.length === 0 ? undefined : Math.min(...expiries);
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
  settleReading();
}

// `announce` is said once in the live region when the run starts, since a screen reader hears nothing from a bar that
// only changes its words.
function mount(seed: number, run: Run, total: number, announce: string): void {
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
  sentArrivals.reset();
  motion.reset();
  reading = false;
  readOwes = false;
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
    setText(byId('notice'), announce);
  }
}

function load(): void {
  const seed = nextSeed;
  loadState = 'loading';
  drawLoad();
  fetchModel(foldOf(seed)).then(
    (model) => {
      loadState = 'idle';
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
      mount(seed, run, schedule.total, startLine(seed));
      toggle().focus();
    },
    () => {
      loadState = 'failed';
      drawLoad();
      toggle().focus();
    },
  );
}

// What the first run says when it starts: the same line Under the Hood gives when the address's seed was refused.
function startLine(seed: number): string {
  const line = seedIgnored
    ? `The seed in the replay link could not be used, so this is a new run with seed ${seed}.`
    : STARTED;
  seedIgnored = false;
  return line;
}

toggle().addEventListener('click', () => {
  const current = live;
  // Read before the report closes: closing it may start a run that was held for reading, and a press is about the state the
  // viewer saw.
  const going = current?.run.state().playing === true;
  closeReport(false);
  if (current === undefined || current.ended) {
    load();
  } else if (going) {
    current.run.pause();
  } else {
    current.run.play();
  }
});

drawMeasured();
initTips();
