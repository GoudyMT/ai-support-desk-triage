import '../page/tokens.css';
import './desk.css';
import { byId, setText } from '../page/dom';
import { fetchModel } from '../page/fetchModel';
import { createDeskSchedule } from '../run/clock';
import { createRun, type Run } from '../run/engine';
import { createPrescreener } from '../run/prescreen';
import { foldOf, parseSeed, randomSeed } from '../run/seed';
import { drawCards, drawMeasured, drawNumbers, drawSent } from './draw';
import { deskCards, deskNumbers, sentRows, type DeskNumbers } from './view';

const MODEL_FAILED = 'The sorting model could not be loaded. Check your connection, then press Retry.';
// How often the simulated reviewer closes the top card: one every two seconds, a slow trickle a viewer can follow.
const REVIEWER_PACE_MS = 2500;
const SLOW_NOTE ='Slowed down so you can follow.';

interface Live {
  run: Run;
  total: number;
  stopListening: () => void;
  timer: number | undefined;
  // Set once the end has been seen, so the next seed is drawn once.
  ended: boolean;
}

let live: Live | undefined;
// The seed the next Start runs: the address's, when it has a valid one, else a fresh draw.
let nextSeed = parseSeed(location.search).seed;

const toggle = (): HTMLButtonElement => byId('toggle') as HTMLButtonElement;

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

function drawBar(playing: boolean, numbers: DeskNumbers): void {
  if (numbers.closed >= numbers.total) {
    setButton('Start', true);
    say('', `All ${numbers.total} tickets handled. Press Start to run a new set.`);
  } else if (playing) {
    setButton('Stop', false);
    say(`${numbers.total - numbers.closed - numbers.waiting} more on the way. ${SLOW_NOTE}`);
  } else {
    setButton('Start', true);
    say('', 'Stopped.');
  }
}

function render({ run, total }: Live): DeskNumbers {
  const state = run.state();
  const cards = deskCards(state);
  const rows = sentRows(state);
  const numbers = deskNumbers(state, total, run.truthOf);
  drawCards(byId('open-list'), cards);
  drawSent(byId('sent-list'), rows);
  drawNumbers(numbers, cards.length, rows.length);
  drawBar(state.playing, numbers);
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
  }
  const current: Live = { run, total, stopListening: () => undefined, timer: undefined, ended: false };
  current.stopListening = run.onChange(() => sync(current));
  live = current;
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
