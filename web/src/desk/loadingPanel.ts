import { byId, setText } from '../page/dom';

// The panel Start opens while the larger model downloads: real progress, a way
// to start at once on the smaller model, and Retry when the download fails.

const BYTES_PER_MB = 1_000_000;

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
      panel.hidden = false;
      byId('loading-failed').hidden = true;
      retry.hidden = true;
      bar.hidden = false;
      bar.value = 0;
      // Until the first bytes arrive, which on a slow link takes a few seconds.
      setText(byId('loading-count'), 'Starting the download...');
    },
    progress(share, totalBytes) {
      // A download still finishing after another file failed changes nothing shown.
      if (!retry.hidden) return;
      bar.value = share;
      const total = Math.round(totalBytes / BYTES_PER_MB);
      setText(byId('loading-count'), `${Math.floor((share * totalBytes) / BYTES_PER_MB)} of ${total} MB`);
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
