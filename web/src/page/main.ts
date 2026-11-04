import type { Model } from '../model/scorer';
import { createSchedule, type Schedule } from '../run/clock';
import { createRun, type Run } from '../run/engine';
import { createPrescreener, type Tag } from '../run/prescreen';
import { foldOf, parseSeed } from '../run/seed';
import './tokens.css';
import './page.css';
import './stats.css';
import './board.css';
import './cards.css';
import './center.css';
import './review.css';
import './a11y.css';
import { mountCenter } from './center';
import { mountControls, mountTabs } from './controls';
import { el, setText } from './dom';
import { fetchModel } from './fetchModel';
import { createFocus } from './focus';
import { mountIncoming } from './incoming';
import { createMotion } from './motion';
import { mountOutgoing } from './outgoing';
import { mountReviewForm } from './reviewForm';
import { createSpeech } from './speech';
import { mountStats } from './stats';
import {
  centerView,
  controlsView,
  explainMode,
  incomingView,
  moreNumbersView,
  outgoingView,
  realSpeedView,
  reviewView,
  statsView,
  statusView,
} from './view';

const IDLE_TEXT: Record<string, string> = {
  'Run complete': 'Run complete',
  Paused: 'Press Play to see the next ticket.',
};

interface Setup {
  seed: number;
  model: Model;
  schedule: Schedule;
  prescreen: (maskedText: string) => Tag;
}

// What changes while the page runs. `run` is replaced by Restart; the panels read it through here.
interface Page {
  run: Run;
  stopListening(): void;
  timer: number | undefined;
  explain: boolean;
}

type Panels = ReturnType<typeof mountPanels>;

interface Mounted {
  setup: Setup;
  page: Page;
  panels: Panels;
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error('E_PAGE_MARKUP');
  }
  return node;
}

function newRun({ seed, model, schedule, prescreen }: Setup): Run {
  return createRun({ seed, model, schedule, wallClock: () => performance.now(), prescreen });
}

function mountPanels(page: Page, restart: () => void, render: () => void) {
  const controls = mountControls(byId('controls'), {
    playPause: () => (page.run.state().playing ? page.run.pause() : page.run.play()),
    step: () => page.run.step(),
    restart,
  });
  const center = mountCenter(byId('ticket'), {
    toggleExplain: () => {
      page.explain = !page.explain;
      render();
    },
    finishNow: () => page.run.finishNow(),
    // Replay is a call to start again, so it plays; the header's Restart waits for Play.
    restart: () => {
      restart();
      page.run.play();
    },
  });
  const form = mountReviewForm(byId('review'), {
    confirm: (decision) => {
      page.run.confirm(decision);
      controls.focusPrimary();
    },
    handBack: () => {
      page.run.handBack();
      controls.focusPrimary();
    },
  });
  return {
    motion: createMotion(),
    speech: createSpeech(byId('announcer')),
    focus: createFocus({ form, center, controls }),
    stats: mountStats(byId('stats'), byId('more-toggle'), byId('numbers')),
    controls,
    tabs: mountTabs(byId('tabs'), byId('app')),
    incoming: mountIncoming(byId('incoming')),
    outgoing: mountOutgoing(byId('outgoing'), { review: (id) => page.run.review(id) }),
    center,
    form,
  };
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
  setText(byId('status'), statusView(state));
  panels.stats.render(numbers, moreNumbersView(state, run.truthOf));
  panels.controls.render(controls);
  panels.tabs.render({ in: `${waiting.length} waiting`, out: `${pending} pending` });
  panels.incoming.render(waiting);
  panels.outgoing.render(outgoingView(state, run.truthOf), pending, review !== undefined);
  byId('ticket').hidden = review !== undefined;
  byId('review').hidden = review === undefined;
  panels.form.render(review);
  panels.center.render({
    ticket: centerView(state),
    explain: explainMode(state),
    explainOpen: page.explain,
    idle: IDLE_TEXT[statusView(state)] ?? 'Waiting for the next ticket',
    realSpeedLabel: controls.realSpeedLabel,
    result,
  });
  panels.speech.say(centerView(state));
  panels.focus.after(review !== undefined, result !== undefined);
  // Real speed shows the finished run in one render, so no card travels.
  panels.motion.play(result === undefined);
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

function restart(mounted: Mounted): void {
  const { setup, page, panels } = mounted;
  page.stopListening();
  window.clearTimeout(page.timer);
  page.run = newRun(setup);
  page.stopListening = page.run.onChange(() => sync(mounted));
  page.explain = false;
  panels.motion.skipNext();
  panels.speech.reset();
  sync(mounted);
  panels.controls.focusPrimary();
}

function mountRun(setup: Setup): void {
  const page: Page = {
    run: newRun(setup),
    stopListening: () => undefined,
    timer: undefined,
    explain: false,
  };
  const mounted: Mounted = {
    setup,
    page,
    panels: mountPanels(page, () => restart(mounted), () => render(mounted)),
  };
  page.stopListening = page.run.onChange(() => sync(mounted));
  byId('top-live').hidden = false;
  byId('app').hidden = false;
  sync(mounted);
}

function start(): void {
  const { seed, ignored } = parseSeed(location.search);
  const replay = el('a', undefined, 'replay this run with the same seed');
  replay.href = `?seed=${seed}`;
  byId('seed-line').replaceChildren(document.createTextNode(`Seed ${seed} - `), replay);
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
        mountRun({ seed, model, schedule: createSchedule(seed), prescreen: createPrescreener(model) });
        if (retried) document.querySelector<HTMLElement>('#controls button')?.focus();
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
