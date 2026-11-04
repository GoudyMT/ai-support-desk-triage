import { setText } from './dom';

/**
 * The polite live region. It holds exactly the sentence the center shows, and says it again only when
 * the sentence changes. With no sentence shown (the busy day) it is emptied and stays quiet, so it
 * never holds a sentence the viewer cannot see.
 */
export function createSpeech(region: HTMLElement): { say(sentence: string | null): void; reset(): void } {
  let said = '';
  return {
    say(sentence) {
      const text = sentence ?? '';
      if (text !== said) {
        setText(region, text);
        said = text;
      }
    },
    reset() {
      setText(region, '');
      said = '';
    },
  };
}
