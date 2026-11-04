import { setText } from './dom';
import type { CenterView } from './view';

/**
 * The polite live region. It says exactly what the center shows: the ticket's sentence, once
 * for each stage. With no sentence shown (later tickets between stages, the busy day) it is
 * emptied and stays quiet, so it never holds a sentence the viewer cannot see.
 */
export function createSpeech(region: HTMLElement): { say(view: CenterView | undefined): void; reset(): void } {
  let said = '';
  return {
    say(view) {
      const text = view?.plain ?? null;
      if (view === undefined || text === null) {
        setText(region, '');
        said = '';
        return;
      }
      const key = `${view.id}|${view.stageName}`;
      if (key !== said) {
        setText(region, text);
        said = key;
      }
    },
    reset() {
      setText(region, '');
      said = '';
    },
  };
}
