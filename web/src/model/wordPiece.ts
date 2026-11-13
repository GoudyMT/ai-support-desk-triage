// The sentence model reads token numbers, not text. This is the BERT WordPiece
// tokenizer its `tokenizer.json` describes, written out so the browser loads no
// tokenizer library: clean and lower the text, split it into words and
// punctuation, cut each word into the longest pieces the vocabulary knows, and
// wrap the result in [CLS] ... [SEP]. Its tests compare it, token for token, with
// the Python `tokenizers` library the model was trained with.

export interface WordPieceTokenizer {
  // The token numbers of one ticket, cut to the bundle's limit.
  encode(text: string): number[];
}

const SHAPE_ERROR = 'E_SENTENCE_SHAPE';
// [CLS] and [SEP] take two places of the limit.
const SPECIAL_COUNT = 2;
const SUBWORD_PREFIX = '##';
const NUL = 0;
const REPLACEMENT_CHAR = 0xfffd;

// Rust's char::is_whitespace, which the Python library uses, is the Unicode White_Space property.
const WHITESPACE = /\p{White_Space}/u;
// Every "Other" category (control, format, surrogate, private use, unassigned).
const OTHER = /\p{C}/u;
const KEPT_CONTROLS = new Set(['\t', '\n', '\r']);
const NONSPACING_MARKS = /\p{Mn}/gu;
// Every ASCII punctuation or symbol character, then every Unicode punctuation character.
const PUNCTUATION = /[!-/:-@[-`{-~]|\p{P}/u;
// The CJK Unified Ideograph blocks BERT puts spaces around.
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0xf900, 0xfaff],
  [0x2f800, 0x2fa1f],
];

interface Vocabulary {
  ids: Map<string, number>;
  unk: number;
  cls: number;
  sep: number;
  maxWordChars: number;
  // Tokens such as [MASK] that are matched in the raw text before anything else.
  special: { content: string; id: number }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Reads the token limit from a bundle's manifest.
 *
 * Args:
 *   manifest: the parsed `manifest.json`.
 *
 * Returns:
 *   The most tokens one ticket may have, [CLS] and [SEP] included.
 *
 * Throws:
 *   Error('E_SENTENCE_SHAPE') for a missing or unusable limit.
 */
export function maxTokensOf(manifest: unknown): number {
  const value = isRecord(manifest) ? manifest['max_length'] : undefined;
  if (!isCount(value) || value <= SPECIAL_COUNT) {
    throw new Error(SHAPE_ERROR);
  }
  return value;
}

// Only the exact settings this file implements are accepted; any other tokenizer
// would give different numbers without an error.
function vocabularyOf(json: unknown): Vocabulary {
  if (!isRecord(json) || !isRecord(json['normalizer']) || !isRecord(json['pre_tokenizer']) || !isRecord(json['model'])) {
    throw new Error(SHAPE_ERROR);
  }
  const { normalizer, pre_tokenizer: pre, model, post_processor: post, added_tokens: added } = json;
  const bertNormalizer =
    normalizer['type'] === 'BertNormalizer' &&
    normalizer['clean_text'] === true &&
    normalizer['handle_chinese_chars'] === true &&
    normalizer['lowercase'] === true &&
    (normalizer['strip_accents'] === null || normalizer['strip_accents'] === true);
  const wordPiece =
    model['type'] === 'WordPiece' && model['continuing_subword_prefix'] === SUBWORD_PREFIX && isCount(model['max_input_chars_per_word']);
  if (!bertNormalizer || pre['type'] !== 'BertPreTokenizer' || !wordPiece || !isRecord(post) || post['type'] !== 'TemplateProcessing') {
    throw new Error(SHAPE_ERROR);
  }
  const vocab = model['vocab'];
  if (!isRecord(vocab) || !Object.values(vocab).every(isCount) || !Array.isArray(added)) {
    throw new Error(SHAPE_ERROR);
  }
  const ids = new Map(Object.entries(vocab as Record<string, number>));
  const unk = ids.get(String(model['unk_token']));
  const cls = ids.get('[CLS]');
  const sep = ids.get('[SEP]');
  const special = added.filter(isRecord).map((token) => ({ content: token['content'], id: token['id'] }));
  if (unk === undefined || cls === undefined || sep === undefined || !special.every((token) => typeof token.content === 'string' && token.content !== '' && isCount(token.id))) {
    throw new Error(SHAPE_ERROR);
  }
  return {
    ids,
    unk,
    cls,
    sep,
    maxWordChars: model['max_input_chars_per_word'] as number,
    // Longest first, so a longer token wins over one it starts with.
    special: (special as { content: string; id: number }[]).sort((a, b) => b.content.length - a.content.length),
  };
}

function isCjk(codePoint: number): boolean {
  return CJK_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);
}

// Drops control characters, turns every space into ' ', spaces out Chinese
// characters, then strips accents and lowers the case.
function normalize(text: string): string {
  let cleaned = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? NUL;
    if (codePoint === NUL || codePoint === REPLACEMENT_CHAR || (OTHER.test(char) && !KEPT_CONTROLS.has(char))) {
      continue;
    }
    if (WHITESPACE.test(char)) {
      cleaned += ' ';
    } else {
      cleaned += isCjk(codePoint) ? ` ${char} ` : char;
    }
  }
  return cleaned.normalize('NFD').replace(NONSPACING_MARKS, '').toLowerCase();
}

// Words split on spaces, with every punctuation character a word of its own.
function words(text: string): string[] {
  const found: string[] = [];
  let word = '';
  for (const char of text) {
    if (WHITESPACE.test(char) || PUNCTUATION.test(char)) {
      if (word !== '') {
        found.push(word);
      }
      word = '';
      if (!WHITESPACE.test(char)) {
        found.push(char);
      }
    } else {
      word += char;
    }
  }
  if (word !== '') {
    found.push(word);
  }
  return found;
}

// The longest known piece first, then the longest "##" piece of the rest; a word
// with any part no piece covers becomes one [UNK].
function pieces(word: string, vocabulary: Vocabulary): number[] {
  const chars = Array.from(word);
  if (chars.length > vocabulary.maxWordChars) {
    return [vocabulary.unk];
  }
  const found: number[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let id: number | undefined;
    while (end > start) {
      const piece = chars.slice(start, end).join('');
      id = vocabulary.ids.get(start > 0 ? `${SUBWORD_PREFIX}${piece}` : piece);
      if (id !== undefined) {
        break;
      }
      end -= 1;
    }
    if (id === undefined) {
      return [vocabulary.unk];
    }
    found.push(id);
    start = end;
  }
  return found;
}

function encodeText(text: string, vocabulary: Vocabulary): number[] {
  return words(normalize(text)).flatMap((word) => pieces(word, vocabulary));
}

// Typed special tokens ("[MASK]" in a ticket) are matched in the raw text, case
// and all, before any cleaning, as the Python library does.
function encodeWithSpecials(text: string, vocabulary: Vocabulary): number[] {
  const ids: number[] = [];
  let plainStart = 0;
  let at = 0;
  while (at < text.length) {
    const token = vocabulary.special.find((candidate) => text.startsWith(candidate.content, at));
    if (token === undefined) {
      at += 1;
      continue;
    }
    ids.push(...encodeText(text.slice(plainStart, at), vocabulary), token.id);
    at += token.content.length;
    plainStart = at;
  }
  ids.push(...encodeText(text.slice(plainStart), vocabulary));
  return ids;
}

/**
 * Builds the tokenizer a bundle's `tokenizer.json` describes.
 *
 * Args:
 *   json: the parsed `tokenizer.json`.
 *   maxLength: the most tokens one ticket may have, [CLS] and [SEP] included.
 *
 * Returns:
 *   A tokenizer that cuts a long ticket at the limit, as the model was trained.
 *
 * Throws:
 *   Error('E_SENTENCE_SHAPE') for a tokenizer with any other settings.
 */
export function tokenizerFrom(json: unknown, maxLength: number): WordPieceTokenizer {
  const vocabulary = vocabularyOf(json);
  return {
    encode: (text) => [vocabulary.cls, ...encodeWithSpecials(text, vocabulary).slice(0, maxLength - SPECIAL_COUNT), vocabulary.sep],
  };
}
