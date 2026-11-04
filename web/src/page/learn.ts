import type { Run } from '../run/engine';
import type { Bar } from './bar';
import type { Dim } from './dim';
import { STEPS } from './learnSteps';
import { barFills, learnBarView, reachStep, stepMs, ticketLine } from './learnView';

// How often the loading bar of the current step is redrawn.
const FILL_MS = 100;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export interface LearnHost {
  run(): Run;
  // A new run with the same seed and the board drawn from it.
  restartRun(): void;
  // Changes the run with no redraw until `change` is done, then redraws once.
  quietly(change: () => void): void;
  selectTab(tab: 'in' | 'out'): void;
  announce(text: string): void;
  toSee(): void;
}

export interface Learn {
  begin(): void;
  end(): void;
  back(): void;
  next(): void;
  togglePause(): void;
  // After every redraw of the board: the lit parts may have moved.
  render(): void;
}

/**
 * The walk through the seven steps. Each step holds the engine so the live ticket is where the words
 * say, lights its part of the page, and stays for as long as its words take to read. The timer is the
 * page's own; its Pause stops the run as well. Going back restarts the run with the same seed and walks
 * it to the earlier step again, because a run cannot be undone.
 */
export function createLearn(host: LearnHost, dim: Dim, bar: Bar): Learn {
  let at = 0;
  let spent = 0;
  let startedAt: number | null = null;
  let paused = false;
  // How long the current step stays: its words, and the live ticket's sentence, at reading speed.
  let total = 1;
  let ends: number | undefined;
  let ticker: number | undefined;

  const elapsed = (): number => spent + (startedAt === null ? 0 : performance.now() - startedAt);

  function paint(): void {
    bar.fill(barFills(at, elapsed() / total, STEPS.length));
    bar.renderLearn(learnBarView(at, STEPS.length, paused));
  }

  function stop(): void {
    spent = elapsed();
    startedAt = null;
    window.clearTimeout(ends);
    window.clearInterval(ticker);
  }

  function arm(): void {
    stop();
    if (!paused) {
      startedAt = performance.now();
      ends = window.setTimeout(() => go(at + 1), Math.max(total - spent, 0));
      ticker = window.setInterval(paint, FILL_MS);
    }
    paint();
  }

  function go(to: number): void {
    stop();
    const step = STEPS[to];
    if (step === undefined) {
      host.toSee();
      return;
    }
    if (to < at) host.restartRun();
    at = to;
    spent = 0;
    host.quietly(() => {
      const run = host.run();
      if (paused) run.pause();
      else run.play();
      reachStep(run, step);
    });
    if (step.tab !== undefined) host.selectTab(step.tab);
    const line = step.ticketStage === undefined ? null : ticketLine(host.run().state(), step.ticketStage);
    total = stepMs(step, line);
    dim.show(step, line);
    host.announce(`${step.title}. ${step.text}`);
    arm();
  }

  return {
    begin() {
      paused = window.matchMedia(REDUCED_MOTION).matches;
      at = 0;
      go(0);
    },
    end() {
      stop();
      dim.hide();
    },
    back() {
      if (at > 0) go(at - 1);
    },
    next: () => go(at + 1),
    togglePause() {
      paused = !paused;
      if (paused) host.run().pause();
      else host.run().play();
      arm();
    },
    render() {
      dim.measure();
      const run = host.run();
      // The end of the slow part is an offer to a viewer who is not walking; here the walk goes on.
      if (run.state().offerSpeedUp && !paused) run.play();
    },
  };
}
