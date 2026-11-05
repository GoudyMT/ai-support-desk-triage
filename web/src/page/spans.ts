export interface Span {
  start: number;
  end: number;
}

// The scorer's token rule (web/src/model/scorer.ts keeps its own copy, unexported):
// two or more ASCII word characters. The scorer lower-cases first and so does this,
// character by character, so the offsets below stay in the written text.
const TOKEN = /\b\w\w+\b/g;

interface Token {
  word: string;
  start: number;
  end: number;
}

// Lower-casing can change a text's length (a dotted capital I becomes two
// characters), so each lower-cased character remembers the written one it came from.
function tokensOf(text: string): Token[] {
  let lowered = '';
  const from: number[] = [];
  const to: number[] = [];
  let at = 0;
  for (const char of text) {
    const lower = char.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      from.push(at);
      to.push(at + char.length);
    }
    lowered += lower;
    at += char.length;
  }
  const tokens: Token[] = [];
  for (const found of lowered.matchAll(TOKEN)) {
    const start = from[found.index];
    const end = to[found.index + found[0].length - 1];
    if (start !== undefined && end !== undefined) {
      tokens.push({ word: found[0], start, end });
    }
  }
  return tokens;
}

/**
 * Finds where a model term or a rule word is written in a ticket's masked text.
 *
 * A term is matched the way the scorer builds it: a one-word term is one token, a
 * pair is two adjacent tokens. A word the scorer never sees as a token (a
 * one-letter word such as "I") sits inside the span of a pair that straddles it.
 *
 * @param maskedText The masked ticket text.
 * @param term A top word, a word pair or a rule word, in any letter case.
 * @returns Every occurrence in text order, as character offsets with `end` exclusive;
 *   empty when the term is not written in the text.
 */
export function findSpans(maskedText: string, term: string): Span[] {
  const wanted = term.toLowerCase().match(TOKEN) ?? [];
  if (wanted.length === 0) {
    return [];
  }
  const tokens = tokensOf(maskedText);
  const spans: Span[] = [];
  for (const [i, first] of tokens.entries()) {
    const last = tokens[i + wanted.length - 1];
    if (last !== undefined && wanted.every((word, k) => tokens[i + k]?.word === word)) {
      spans.push({ start: first.start, end: last.end });
    }
  }
  return spans;
}
