import type { RunState } from '../run/engine';
import { setText } from './dom';

const BUSY_STARTED = 'The busy day has started.';
const RUN_COMPLETE = 'Run complete.';

/**
 * The polite live region. It holds exactly the sentence the center shows, and says it again only when
 * the sentence changes. On the busy day, while playing, there are no sentences (they would flood a
 * screen reader), so it says once that the busy day has started and keeps that until a sentence comes
 * back with Pause. It says once that the run is complete.
 */
export function createSpeech(region: HTMLElement): {
  say(sentence: string | null, moment: Pick<RunState, 'act' | 'playing'>): void;
  reset(): void;
} {
  let said = '';
  let busyTold = false;
  let completeTold = false;

  // A notice is spoken the first time it applies; after that it stays only while it is what the region holds.
  function notice(text: string, told: boolean): string {
    return told && said !== text ? '' : text;
  }

  return {
    say(sentence, { act, playing }) {
      let text = sentence ?? '';
      if (act === 'complete') {
        text = notice(RUN_COMPLETE, completeTold);
        completeTold = true;
      } else if (act === 2 && playing) {
        text = notice(BUSY_STARTED, busyTold);
        busyTold = true;
      }
      if (text !== said) {
        setText(region, text);
        said = text;
      }
    },
    reset() {
      setText(region, '');
      said = '';
      busyTold = false;
      completeTold = false;
    },
  };
}
