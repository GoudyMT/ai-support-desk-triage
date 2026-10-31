import type { Priority, ReviewReason } from '../domain/labels';
import { MASK_TOKENS } from '../privacy/mask';
import { NOT_A_SLIP, REVIEW_RULES, SHORT_HELP_CUES, SHORT_TICKET_CUE_WORDS } from './ruleWords';

// The word lists live in ruleWords.ts; this file is the matching.
export { REVIEW_RULES };

// The priority a rule raises a ticket to: the lowest priority the labeling
// rules give that kind of ticket. A rule only ever raises a priority; it never
// lowers one the model already set higher.
export const RULE_PRIORITY: Record<ReviewReason, Priority> = {
  'security incident': 'Urgent',
  'accessibility issue': 'High',
  'billing dispute': 'Medium',
  'threatening language': 'Urgent',
  'escalated complaint': 'High',
  'vague ticket': 'Medium',
};

// Reasons in the order of the ReviewReason union, which REVIEW_RULES follows.
const REASON_ORDER = Object.keys(REVIEW_RULES) as ReviewReason[];

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
// Curly quotes (U+2018 and U+2019) are what phones and word processors type
// for an apostrophe; they are built from code points to keep this file ASCII.
const CURLY_APOSTROPHE = new RegExp(
  `[${String.fromCharCode(0x2018)}${String.fromCharCode(0x2019)}]`,
  'g',
);

// The masker's tokens (such as [CARD_NUMBER]) hold words like "card" and
// "number" that the customer never wrote. They are blanked before matching.
const MASK_TOKEN_PATTERN = new RegExp(
  Object.values(MASK_TOKENS)
    .map((token) => token.replace(REGEX_SPECIALS, '\\$&'))
    .join('|'),
  'gi',
);

// A word matches only when no letter or digit touches it on either side, so
// "charge" never matches "charger" and "hack" never matches "hackathon".
// Underscore is not counted as a word character here on purpose: the mask
// blanking above is what keeps token words out, not a quirk of the regex.
// An apostrophe in an entry is optional in the text: "didnt" is "didn't"
// typed fast on a phone.
function wholeWordPattern(entry: string): RegExp {
  const body = entry
    .replace(REGEX_SPECIALS, '\\$&')
    .replace(/ /g, '[\\s-]+')
    .replace(/'/g, "'?");
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
}

// Slipped spellings. People type fast, so a word of 6 or more letters also
// matches a word one slip away: a letter dropped, doubled or two swapped
// ("hakced", "accesibility"). A word of 8 or more may also have one letter
// replaced ("compromized", "unnacceptable"). Shorter words stay exact because
// one letter turns them into everyday words ("sue" and "use", "scam" and
// "scan"), and shorter words are not replaced either: "charged" and "changed"
// are one letter apart. The first letter must be right, which people rarely get
// wrong and which keeps "reach" away from "breach". Only the word that slipped
// counts: a phrase needs every other word exactly, and one slip in total.
// Everyday words that sit one slip from a rule word are listed in NOT_A_SLIP.
const SLIP_MIN_LENGTH = 6;
const SLIP_REPLACE_MIN_LENGTH = 8;

function isOneSlip(wanted: string, written: string): boolean {
  if (wanted[0] !== written[0] || NOT_A_SLIP.has(written)) return false;
  const lengthGap = written.length - wanted.length;
  if (Math.abs(lengthGap) > 1) return false;
  let first = 0;
  while (wanted[first] === written[first] && first < Math.min(wanted.length, written.length)) {
    first += 1;
  }
  if (lengthGap !== 0) {
    const [longer, shorter] = lengthGap > 0 ? [written, wanted] : [wanted, written];
    return longer.slice(first + 1) === shorter.slice(first);
  }
  if (first === wanted.length) return false;
  if (wanted[first] === written[first + 1] && wanted[first + 1] === written[first]) {
    return wanted.slice(first + 2) === written.slice(first + 2);
  }
  return (
    wanted.length >= SLIP_REPLACE_MIN_LENGTH && wanted.slice(first + 1) === written.slice(first + 1)
  );
}

interface TextWord {
  word: string;
  start: number;
  end: number;
}

// Words as the customer wrote them, apostrophes dropped ("don't" is "dont"),
// with where each sits so a phrase can demand that only spaces or a hyphen
// separate its words.
function wordsOf(text: string): TextWord[] {
  return [...text.matchAll(/[a-z0-9]+(?:'[a-z0-9]+)*/g)].map((found) => ({
    word: found[0].replace(/'/g, ''),
    start: found.index,
    end: found.index + found[0].length,
  }));
}

// True when the entry's words appear in a row with exactly one slipped word.
function matchesWithOneSlip(entryWords: string[], text: string, written: TextWord[]): boolean {
  for (let from = 0; from + entryWords.length <= written.length; from += 1) {
    let slips = 0;
    let fits = true;
    for (const [offset, wanted] of entryWords.entries()) {
      const here = written[from + offset];
      const before = written[from + offset - 1];
      if (!here || (offset > 0 && before && !/^[\s-]+$/.test(text.slice(before.end, here.start)))) {
        fits = false;
        break;
      }
      if (here.word === wanted) continue;
      if (wanted.length < SLIP_MIN_LENGTH || !isOneSlip(wanted, here.word)) {
        fits = false;
        break;
      }
      slips += 1;
    }
    if (fits && slips === 1) return true;
  }
  return false;
}

// A vague ticket says something is wrong without saying what. When the whole
// message is only a few words and one of them is "problem", "issue" or the
// like, there is nothing more to read, whatever the exact words.
const SHORT_TICKET_MAX_WORDS = 12;
const SHORT_HELP_MAX_WORDS = 5;
const SHORT_TICKET_WORD = 'short ticket without detail';
const SHORT_TICKET_CUES = SHORT_TICKET_CUE_WORDS.map(wholeWordPattern);
const SHORT_HELP_PATTERNS = SHORT_HELP_CUES.map(wholeWordPattern);

// Uses of those words that say nothing is wrong, or say what failed: "no
// issues", "issue a credit note" (a verb) and "trouble resetting" (names the
// task). They are blanked before the cues are looked for.
const NOT_A_COMPLAINT = new RegExp(
  '(?<![a-z0-9])(?:' +
    '(?:no|not|without|never)[\\s-]+(?:any[\\s-]+)?(?:problems?|issues?|trouble|glitch)' +
    '|(?:to|i|we|you|please)[\\s-]+issue' +
    '|issue[\\s-]+(?:a|an|the|my|your|our|credit|refund|invoice|receipt)' +
    '|trouble[\\s-]+[a-z]+ing' +
    ')(?![a-z0-9])',
  'g',
);

function isShortAndVague(text: string, wordCount: number): boolean {
  if (wordCount <= SHORT_HELP_MAX_WORDS && SHORT_HELP_PATTERNS.some((cue) => cue.test(text))) {
    return true;
  }
  if (wordCount > SHORT_TICKET_MAX_WORDS) return false;
  const detail = text.replace(NOT_A_COMPLAINT, ' ');
  return SHORT_TICKET_CUES.some((cue) => cue.test(detail));
}

const COMPILED_RULES = REASON_ORDER.map((reason) => ({
  reason,
  entries: REVIEW_RULES[reason].map((word) => {
    const entryWords = word.replace(/'/g, '').split(' ');
    const canSlip = entryWords.some((part) => part.length >= SLIP_MIN_LENGTH) && /^[a-z0-9' ]+$/.test(word);
    return { word, pattern: wholeWordPattern(word), entryWords: canSlip ? entryWords : null };
  }),
}));

// Never throws and never echoes its input: an empty or odd text just matches nothing.
export function matchRules(maskedText: string): { reason: ReviewReason; words: string[] }[] {
  const text = maskedText
    .replace(MASK_TOKEN_PATTERN, ' ')
    .toLowerCase()
    .replace(CURLY_APOSTROPHE, "'");
  const written = wordsOf(text);
  const hits: { reason: ReviewReason; words: string[] }[] = [];
  for (const { reason, entries } of COMPILED_RULES) {
    let words = entries.filter(({ pattern }) => pattern.test(text)).map(({ word }) => word);
    // A slipped spelling is only a fallback: where a rule word was written
    // right, its neighbours ("hacker" beside "hackers") add nothing to show.
    if (words.length === 0) {
      words = entries
        .filter(({ entryWords }) => entryWords && matchesWithOneSlip(entryWords, text, written))
        .map(({ word }) => word);
    }
    if (words.length === 0 && reason === 'vague ticket' && isShortAndVague(text, written.length)) {
      words = [SHORT_TICKET_WORD];
    }
    if (words.length > 0) hits.push({ reason, words });
  }
  return hits;
}
