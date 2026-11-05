import type { Run } from '../run/engine';
import { mountBar } from './bar';
import { mountCenter } from './center';
import { mountTabs } from './controls';
import { createDim } from './dim';
import { byId } from './dom';
import { createFocus } from './focus';
import { mountIncoming } from './incoming';
import type { Learn } from './learn';
import { STEPS } from './learnSteps';
import { createMotion } from './motion';
import { mountOutgoing } from './outgoing';
import { mountReviewForm } from './reviewForm';
import { createSentence } from './sentence';
import { createSpeech } from './speech';
import { mountStats } from './stats';
import { mountTopLine } from './topLine';

// What changes while the page runs. `run` is replaced by Restart; the panels read it through here.
export interface Page {
  run: Run;
  stopListening(): void;
  timer: number | undefined;
  explain: boolean;
  mode: 'learn' | 'see';
  // True while Learn walks the run to a step: the board is drawn once at the end, not at every event.
  quiet: boolean;
}

export interface PanelHooks {
  render(): void;
  restart(): void;
  learn(): Learn;
}

// Speed up, or Slow down: the other pace. On the offer the run is paused, so pressing it also plays.
function changePace(run: Run): void {
  const { pace, offerSpeedUp } = run.state();
  if (pace === 'fast') {
    run.slowDown();
    return;
  }
  run.speedUp();
  if (offerSpeedUp) run.play();
}

// Play in See. At the end of the slow part it is the viewer's choice to go on, which is Speed up: a quick pace on
// Act 1's arrivals would look broken. The run's own Play does not ask for the busy day (Learn plays on with it).
function playOrPause(run: Run): void {
  if (run.state().playing) {
    run.pause();
    return;
  }
  if (run.state().offerSpeedUp) run.speedUp();
  run.play();
}

export function mountPanels(page: Page, hooks: PanelHooks) {
  const bar = mountBar(
    byId('bar'),
    {
      playPause: () => playOrPause(page.run),
      step: () => page.run.step(),
      restart: hooks.restart,
      speed: () => changePace(page.run),
      back: () => hooks.learn().back(),
      learnPause: () => hooks.learn().togglePause(),
      next: () => hooks.learn().next(),
    },
    STEPS.length,
  );
  const center = mountCenter(byId('ticket'), {
    toggleExplain: () => {
      page.explain = !page.explain;
      hooks.render();
    },
    finishNow: () => page.run.finishNow(),
    // Replay is a call to start again, so it plays; the bar's Restart waits for Play.
    restart: () => {
      hooks.restart();
      page.run.play();
    },
  });
  const form = mountReviewForm(byId('review'), {
    confirm: (decision) => {
      page.run.confirm(decision);
      bar.focusPrimary();
    },
    handBack: () => {
      page.run.handBack();
      bar.focusPrimary();
    },
  });
  const motion = createMotion();
  return {
    motion,
    sentence: createSentence(),
    speech: createSpeech(byId('announcer')),
    focus: createFocus({ form, center, controls: bar }),
    stats: mountStats(byId('stats'), byId('more-toggle'), byId('numbers'), () => motion.cancel()),
    topLine: mountTopLine(byId('purpose'), byId('top-notice')),
    bar,
    dim: createDim(),
    tabs: mountTabs(byId('tabs'), byId('app')),
    incoming: mountIncoming(byId('incoming')),
    outgoing: mountOutgoing(byId('outgoing'), { review: (id) => page.run.review(id) }),
    center,
    form,
  };
}
