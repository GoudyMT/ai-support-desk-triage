import type { Model } from '../model/scorer';
import { createSchedule, type Schedule } from '../run/clock';
import { createRun, type Run } from '../run/engine';
import { createPrescreener, type Tag } from '../run/prescreen';
import { foldOf, parseSeed } from '../run/seed';
import './tokens.css';
import './page.css';
import './states.css';
import './stats.css';
import './board.css';
import './cards.css';
import './center.css';
import './review.css';
import './bar.css';
import './learn.css';
import './a11y.css';
import type { Bar } from './bar';
import { keepFocusClearOfBar } from './clearOfBar';
import { byId, el, setText } from './dom';
import { fetchModel } from './fetchModel';
import { seeEntry } from './learnView';
import { createLearn, type Learn } from './learn';
import { mountPanels, type Page } from './panels';
import {
  centerView,
  controlsView,
  explainMode,
  idleText,
  incomingView,
  moreNumbersView,
  outgoingView,
  realSpeedView,
  reviewView,
  speedView,
  statsView,
  statusView,
} from './view';

interface Setup {
  seed: number;
  model: Model;
  schedule: Schedule;
  prescreen: (maskedText: string) => Tag;
}

type Panels = ReturnType<typeof mountPanels>;

interface Mounted {
  setup: Setup;
  page: Page;
  panels: Panels;
  learn: Learn;
  // The viewer's run, paused, while Learn walks a fresh one; See brings it back.
  stash?: Run;
}

// Learn lights one part of the page at a time; the board and the numbers behind the dim take no clicks.
const BEHIND_THE_DIM = ['app', 'top-live', 'numbers'];

function newRun({ seed, model, schedule, prescreen }: Setup): Run {
  return createRun({ seed, model, schedule, wallClock: () => performance.now(), prescreen });
}

function render(mounted: Mounted): void {
  const { setup, page, panels } = mounted;
  const { run } = page;
  const state = run.state();
  const numbers = statsView(state, run.truthOf);
  const pending = numbers.find((stat) => stat.label === 'Pending review')?.value ?? '0';
  panels.focus.before();
  panels.motion.snapshot();
  const waiting = incomingView(state);
  const review = reviewView(state);
  const result = realSpeedView(state);
  const controls = controlsView(state, setup.schedule.total);
  // A real speed finish lands the whole day in one drawing, and Learn is a narrated walk: neither pulses.
  panels.stats.render(numbers, moreNumbersView(state, run.truthOf), result === undefined && page.mode === 'see');
  panels.topLine.render(page.mode, state);
  panels.bar.renderSee({ controls, speed: speedView(state), status: statusView(state) });
  panels.tabs.render({ in: `${waiting.length} waiting`, out: `${pending} pending` });
  panels.incoming.render(waiting);
  panels.outgoing.render(outgoingView(state, run.truthOf), pending, review !== undefined);
  byId('ticket').hidden = review !== undefined;
  byId('review').hidden = review === undefined;
  panels.form.render(review);
  const ticket = centerView(state);
  const sentence = panels.sentence.next(state, ticket);
  panels.center.render({
    ticket,
    sentence,
    explain: explainMode(state),
    explainOpen: page.explain,
    idle: idleText(state, setup.schedule.total),
    realSpeedLabel: controls.realSpeedLabel,
    result,
  });
  // The run's own narration stays quiet while Learn speaks: two voices at once cannot be followed.
  if (page.mode === 'see') panels.speech.say(sentence, state);
  panels.focus.after(review !== undefined, result !== undefined);
  // Real speed shows the finished run in one render, so no card travels.
  panels.motion.play(result === undefined);
  if (page.mode === 'learn') mounted.learn.render();
}

// The timer is re-armed after every change to the run, so a pause, a viewer's confirm or
// the real speed button restarts it from the state they leave.
function sync(mounted: Mounted): void {
  const { page } = mounted;
  render(mounted);
  window.clearTimeout(page.timer);
  const delay = page.run.nextDelayMs();
  if (delay !== null) page.timer = window.setTimeout(() => page.run.advance(), delay);
}

// A run drawn at once, a new one with the same seed unless one is given. Nothing moves in from the old board.
function replaceRun(mounted: Mounted, run: Run = newRun(mounted.setup)): void {
  const { page, panels } = mounted;
  page.stopListening();
  window.clearTimeout(page.timer);
  page.run = run;
  page.stopListening = page.run.onChange(() => {
    if (!page.quiet) sync(mounted);
  });
  page.explain = false;
  panels.motion.skipNext();
  panels.sentence.reset();
  panels.speech.reset();
  sync(mounted);
}

function restart(mounted: Mounted): void {
  // Starting over is the viewer's choice of a new run: no older one is to come back.
  delete mounted.stash;
  replaceRun(mounted);
  mounted.panels.bar.focusPrimary();
}

// Learn walks a fresh run, and puts the viewer's away if it came from See; See plays the run it is handed, the
// viewer's own if one was put away.
function showView(mounted: Mounted, mode: Page['mode'], moveFocus: boolean): void {
  const { page, panels } = mounted;
  const from = page.mode;
  page.mode = mode;
  document.body.dataset.view = mode;
  for (const which of ['learn', 'see']) {
    const view = byId(`view-${which}`);
    view.setAttribute('aria-pressed', String(which === mode));
    view.classList.toggle('btn-solid', which === mode);
  }
  for (const id of BEHIND_THE_DIM) byId(id).inert = mode === 'learn';
  panels.bar.show(mode);
  if (mode === 'learn') {
    if (from === 'see') {
      page.run.pause();
      mounted.stash = page.run;
    }
    replaceRun(mounted);
    mounted.learn.begin();
  } else {
    mounted.learn.end();
    if (mounted.stash !== undefined) {
      replaceRun(mounted, mounted.stash);
      delete mounted.stash;
    }
    panels.speech.reset();
    page.run.hold(null);
    // See does not ask for the busy day for the viewer: a run at the offer waits there, and one that Learn played on
    // at the quick pace on Act 1 is offered the busy day again.
    const entry = seeEntry(page.run.state());
    if (entry === 'play') page.run.play();
    else if (entry === 'offer') page.run.offerBusyDay();
  }
  if (moveFocus) panels.bar.focusPrimary();
}

function mountRun(setup: Setup): Bar {
  const page: Page = { run: newRun(setup), stopListening: () => undefined, timer: undefined, explain: false, mode: 'learn', quiet: false };
  const panels = mountPanels(page, { render: () => render(mounted), restart: () => restart(mounted), learn: () => mounted.learn });
  const learn = createLearn(
    {
      run: () => page.run,
      restartRun: () => replaceRun(mounted),
      quietly: (change) => {
        page.quiet = true;
        try {
          change();
        } finally {
          page.quiet = false;
        }
        // One redraw for the whole walk: the cards that changed section in it each travel once.
        sync(mounted);
      },
      selectTab: (tab) => panels.tabs.select(tab),
      announce: (text) => setText(byId('announcer'), text),
      toSee: () => showView(mounted, 'see', true),
    },
    panels.dim,
    panels.bar,
  );
  const mounted: Mounted = { setup, page, panels, learn };
  for (const mode of ['learn', 'see'] as const) {
    byId(`view-${mode}`).addEventListener('click', () => {
      if (page.mode !== mode) showView(mounted, mode, true);
    });
  }
  keepFocusClearOfBar();
  byId('views').hidden = false;
  byId('top-live').hidden = false;
  byId('app').hidden = false;
  showView(mounted, 'learn', false);
  return mounted.panels.bar;
}

function start(): void {
  const { seed, ignored } = parseSeed(location.search);
  const replay = el('a', undefined, 'replay this run with the same seed');
  replay.href = `?seed=${seed}`;
  byId('seed-line').replaceChildren(document.createTextNode(`Seed ${seed} sets which tickets this run uses - `), replay);
  if (ignored) {
    const notice = byId('notice');
    notice.textContent = `The seed in the replay link could not be used, so this is a new run with seed ${seed}.`;
    notice.hidden = false;
  }
  const loading = byId('loading');
  const failure = byId('load-error');

  function load(): void {
    // Retry is hidden below, so a viewer who pressed it needs focus handed on once the run is there.
    const retried = document.activeElement === byId('retry');
    failure.hidden = true;
    loading.hidden = false;
    fetchModel(foldOf(seed)).then(
      (model) => {
        loading.hidden = true;
        const bar = mountRun({ seed, model, schedule: createSchedule(seed), prescreen: createPrescreener(model) });
        if (retried) bar.focusPrimary();
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
