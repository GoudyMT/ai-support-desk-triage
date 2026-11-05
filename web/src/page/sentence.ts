import type { RunState } from '../run/engine';
import type { CenterView } from './view';

interface Held {
  ticket: string;
  text: string;
}

/**
 * The one plain sentence the center shows and the live region speaks.
 *
 * A later learn-pace ticket spends a quarter of a second in each stage, so its sentence is held until
 * the next one replaces it, and carries its ticket id once that ticket has left the center. The busy
 * day, while playing, has no sentences (they would be unreadable and would flood a screen reader);
 * Pause always has the current stage's.
 *
 * @returns `next` gives the sentence for this moment, or null for none; `reset` forgets what was held.
 */
export function createSentence(): { next(state: RunState, view: CenterView | undefined): string | null; reset(): void } {
  let held: Held | undefined;
  return {
    next(state, view) {
      if (state.act === 'complete' || (state.act === 2 && state.playing)) {
        held = undefined;
        return null;
      }
      if (view?.plain != null) {
        held = { ticket: view.id, text: view.plain };
      }
      if (held === undefined) {
        return null;
      }
      return held.ticket === view?.id ? held.text : `${held.ticket}: ${held.text}`;
    },
    reset() {
      held = undefined;
    },
  };
}
