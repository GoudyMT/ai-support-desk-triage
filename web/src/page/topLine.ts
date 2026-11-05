import type { RunState } from '../run/engine';
import { TOP_LINE_WORDS } from './copy';
import { setClass, setText } from './dom';
import { paceSpeededUp, topLineView } from './view';

// How long "busy-day speed is back" stays before the purpose returns: wall time, not the run's.
const BUSY_NOTICE_MS = 6000;

/**
 * The line under the title. The page's purpose shows in Learn and while the run is at rest; in See a
 * run that plays slowly says so, and a run that has just gone to full speed says that for a few seconds.
 * The bar's status already says the same, so nothing here goes to the live region.
 */
export function mountTopLine(purpose: HTMLElement, notice: HTMLElement): { render(view: 'learn' | 'see', state: RunState): void } {
  let paceBefore: RunState['pace'] | undefined;
  let busyJustStarted = false;
  let timer: number | undefined;
  let latest: { view: 'learn' | 'see'; state: RunState } | undefined;

  function draw(): void {
    if (latest === undefined) return;
    const shows = topLineView(latest.view, latest.state, busyJustStarted);
    setClass(purpose, shows === 'purpose' ? '' : 'off');
    setClass(notice, shows === 'purpose' ? 'purpose-notice off' : 'purpose-notice');
    if (shows !== 'purpose') setText(notice, TOP_LINE_WORDS[shows]);
  }

  function stopBusyNotice(): void {
    window.clearTimeout(timer);
    busyJustStarted = false;
  }

  return {
    render(view, state) {
      latest = { view, state };
      // A pace change only counts when it is watched: in Learn, or after a restart, there is nothing to announce.
      if (view !== 'see') {
        paceBefore = undefined;
        stopBusyNotice();
      } else {
        if (state.pace === 'slow') stopBusyNotice();
        if (paceSpeededUp(paceBefore, state.pace)) {
          stopBusyNotice();
          busyJustStarted = true;
          timer = window.setTimeout(() => {
            busyJustStarted = false;
            draw();
          }, BUSY_NOTICE_MS);
        }
        paceBefore = state.pace;
      }
      draw();
    },
  };
}
