import { describe, expect, it } from 'vitest';
import { tokenize } from '../model/scorer';
import { findSpans } from './spans';

function written(text: string, term: string): string[] {
  return findSpans(text, term).map(({ start, end }) => text.slice(start, end));
}

describe('findSpans', () => {
  it('spans a word pair across the one-letter word the model never sees', () => {
    const text = 'so I cannot follow';
    expect(findSpans(text, 'so cannot')).toEqual([{ start: 0, end: 'so I cannot'.length }]);
  });

  it('gives no span for a rule word that is a list entry and is not written in the text', () => {
    expect(findSpans('The video has no captions', 'subtitles')).toEqual([]);
    expect(findSpans('The video has no captions', 'no subtitles')).toEqual([]);
  });

  it('spans a pair whose first word sits before a mask token', () => {
    const text = 'Ring me on [PHONE_NUMBER] any weekday';
    expect(written(text, 'me on')).toEqual(['me on']);
  });

  it('spans a pair whose second token is the mask token, as the scorer builds it', () => {
    const text = 'Ring me on [PHONE_NUMBER] any weekday';
    expect(tokenize(text)).toContain('on phone_number');
    expect(written(text, 'on phone_number')).toEqual(['on [PHONE_NUMBER']);
  });

  it('spans the mask token as one word, but never finds its parts as separate words', () => {
    const text = 'Ring [PHONE_NUMBER] today';
    expect(written(text, 'phone_number')).toEqual(['PHONE_NUMBER']);
    expect(findSpans(text, 'phone')).toEqual([]);
    expect(findSpans(text, 'phone number')).toEqual([]);
  });

  it('finds every occurrence, in text order', () => {
    const text = 'Cannot log in. I cannot reset it either.';
    const second = text.indexOf('cannot');
    expect(second).toBe(17);
    expect(findSpans(text, 'cannot')).toEqual([
      { start: 0, end: 6 },
      { start: second, end: second + 'cannot'.length },
    ]);
  });

  it('matches whatever the letter case of the text and of the term', () => {
    expect(written('CaNNot sign in', 'CANNOT')).toEqual(['CaNNot']);
  });

  it('does not match a word inside a longer word', () => {
    expect(findSpans('cannotx and xcannot and cannot_y', 'cannot')).toEqual([]);
  });

  it('does not join two words that are not next to each other', () => {
    expect(findSpans('so can cannot', 'so cannot')).toEqual([]);
  });

  it('keeps offsets in the written text when lower-casing changes a letter length', () => {
    const dotted = String.fromCodePoint(0x130);
    const text = `${dotted} cannot`;
    expect(findSpans(text, 'cannot')).toEqual([{ start: 2, end: 8 }]);
  });

  it('finds every term the scorer builds from a text', () => {
    const text = 'Ring me on [PHONE_NUMBER] so I cannot follow, so I cannot pay';
    for (const term of tokenize(text)) {
      const spans = findSpans(text, term);
      expect(spans.length, term).toBeGreaterThan(0);
      for (const { start, end } of spans) {
        expect(tokenize(text.slice(start, end)), term).toContain(term);
      }
    }
  });
});
