import { loadModel, type Model } from '../model/scorer';
import { createSchedule } from '../run/clock';
import { createRun, type Run } from '../run/engine';
import { foldOf, parseSeed } from '../run/seed';
import './page.css';
import { mountControls } from './controls';
import { mountCurrentTicket } from './currentTicket';
import { mountFeed } from './feed';
import { mountNumbers } from './numbers';
import { nextDelayMs } from './pacing';
import { el, mountStageRow } from './stageRow';
import { mountTakeOverForm } from './takeOverForm';
import {
  controlsView,
  currentTicketView,
  feedView,
  narrationView,
  numbersView,
  stageRowView,
  statusView,
  takeOverDefaults,
} from './view';

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error('E_PAGE_MARKUP');
  }
  return node;
}

// The only request the page makes after its own files: the one fold model this run scores with.
async function fetchModel(fold: number): Promise<Model> {
  const response = await fetch(`${import.meta.env.BASE_URL}models/fold_${fold}.json`);
  if (!response.ok) {
    throw new Error('E_MODEL_LOAD');
  }
  return loadModel(await response.json());
}

function mountRun(run: Run): void {
  const schedule = createSchedule(run.state().seed);
  const ui = { explain: false };
  const status = byId('status');
  const announcer = byId('announcer');
  const currentPanel = byId('current');
  const formPanel = byId('take-over');
  const stageRow = mountStageRow(byId('stages'));
  const feed = mountFeed(byId('feed'));
  const numbers = mountNumbers(byId('numbers'));
  const current = mountCurrentTicket(currentPanel);
  let timer: number | undefined;
  let wasWaiting = false;
  let announced = '';

  function render(): void {
    const state = run.state();
    const ticket = currentTicketView(state);
    const narration = narrationView(state);
    const defaults = takeOverDefaults(state);
    const waiting = defaults !== undefined;
    controls.render(controlsView(state), ui.explain);
    stageRow.render(stageRowView(state));
    feed.render(feedView(state, run.truthOf));
    numbers.render(numbersView(state, run.truthOf));
    form.render(defaults, ticket, narration);
    current.render(ticket, narration, ui.explain);
    currentPanel.hidden = waiting;
    formPanel.hidden = !waiting;
    status.textContent = statusView(state);
    if (waiting && !wasWaiting) {
      form.focus();
    }
    wasWaiting = waiting;
    // Real speed would flood a screen reader, so only learn speed is spoken.
    const key = `${state.current?.trail.id ?? ''}|${state.current?.stage ?? ''}`;
    if (state.speed === 'learn' && narration !== undefined && key !== announced) {
      announcer.textContent = narration.plain;
    }
    announced = key;
  }

  // The timer is re-armed after every change, so a pause, a speed switch or a viewer's
  // confirm restarts it from the state they leave.
  function sync(): void {
    render();
    window.clearTimeout(timer);
    const delay = nextDelayMs(run.state(), schedule);
    if (delay !== null) {
      timer = window.setTimeout(() => {
        run.advance();
      }, delay);
    }
  }

  const controls = mountControls(byId('controls'), {
    playPause() {
      if (run.state().playing) {
        run.pause();
      } else {
        ui.explain = false;
        run.play();
      }
      sync();
    },
    step: () => {
      run.step();
    },
    setSpeed: (speed) => {
      run.setSpeed(speed);
    },
    toggleExplain() {
      ui.explain = !ui.explain;
      if (ui.explain) {
        run.pause();
      }
      sync();
    },
    toggleTakeOver: () => {
      run.setTakeOver(!run.state().takeOver);
    },
  });
  const form = mountTakeOverForm(formPanel, (decision) => {
    run.confirm(decision);
    controls.focusPlay();
  });
  run.onChange(sync);
  byId('app').hidden = false;
  sync();
}

function start(): void {
  const { seed, ignored } = parseSeed(location.search);
  const seedLine = byId('seed-line');
  const replay = el('a', undefined, 'replay this run with the same seed');
  replay.href = `?seed=${seed}`;
  seedLine.replaceChildren(document.createTextNode(`Seed ${seed} - `), replay);
  if (ignored) {
    const notice = byId('notice');
    notice.textContent = `The seed in the replay link could not be used, so this is a new run with seed ${seed}.`;
    notice.hidden = false;
  }
  const loading = byId('loading');
  const failure = byId('load-error');

  function load(): void {
    failure.hidden = true;
    loading.hidden = false;
    fetchModel(foldOf(seed)).then(
      (model) => {
        loading.hidden = true;
        mountRun(createRun({ seed, model, schedule: createSchedule(seed), wallClock: () => performance.now() }));
      },
      () => {
        loading.hidden = true;
        failure.hidden = false;
        byId('retry').focus();
      },
    );
  }
  byId('retry').addEventListener('click', load);
  load();
}

start();
