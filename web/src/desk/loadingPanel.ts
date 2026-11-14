import { byId, setText } from '../page/dom';

// The panel Start opens while the larger model downloads: real progress, a way
// to start at once on the smaller model, and Retry when the download fails.

const BYTES_PER_MB = 1_000_000;
const DOWNLOADED = 'Downloaded. Getting the run ready...';

export interface LoadingPanel {
  show(): void;
  progress(share: number, totalBytes: number): void;
  failed(): void;
  isFailed(): boolean;
  hide(): void;
}

export function createLoadingPanel(actions: { retry: () => void; smallerOnly: () => void }): LoadingPanel {
  const panel = byId('loading');
  const bar = byId('loading-bar') as HTMLProgressElement;
  const retry = byId('loading-retry') as HTMLButtonElement;
  retry.addEventListener('click', actions.retry);
  byId('loading-small').addEventListener('click', actions.smallerOnly);
  return {
    show() {
      // The panel goes where the viewer can see it: under the intro at rest, and under the finished run once one has
      // played, whose screen hides the rest view. Below the run, not above it, so the lists do not slide under the
      // pointer when it closes, which would hold the new run as if the viewer were reading.
      const rest = byId('rest');
      if (rest.hidden) byId('run').append(panel);
      else rest.querySelector('.intro')?.append(panel);
      panel.hidden = false;
      byId('loading-failed').hidden = true;
      retry.hidden = true;
      bar.hidden = false;
      bar.value = 0;
      // Until the first bytes arrive, which on a slow link takes a few seconds.
      setText(byId('loading-count'), 'Starting the download...');
      // Start and Retry are switched off or hidden under the viewer's focus, so it moves to the panel's title, which a
      // screen reader then reads out.
      const title = byId('loading-title');
      title.focus({ preventScroll: true });
      title.scrollIntoView({ block: 'nearest' });
    },
    progress(share, totalBytes) {
      // A download still finishing after another file failed changes nothing shown.
      if (!retry.hidden) return;
      bar.value = share;
      // Once every byte is in, the larger model still reads the run's tickets before it starts.
      if (share >= 1) {
        setText(byId('loading-count'), DOWNLOADED);
        return;
      }
      const megabytes = (bytes: number): number => Math.round(bytes / BYTES_PER_MB);
      setText(byId('loading-count'), `${megabytes(share * totalBytes)} of ${megabytes(totalBytes)} MB`);
    },
    failed() {
      bar.hidden = true;
      setText(byId('loading-count'), '');
      byId('loading-failed').hidden = false;
      retry.hidden = false;
      retry.focus();
    },
    isFailed: () => !panel.hidden && !retry.hidden,
    hide() {
      panel.hidden = true;
    },
  };
}
