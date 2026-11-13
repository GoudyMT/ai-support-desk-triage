import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import cases from './bundle.cases.json';
import { maxTokensOf, tokenizerFrom } from './wordPiece';

// The sentence model only answers well on the token numbers it was trained with,
// so the browser's tokenizer must give exactly the numbers the Python library
// gives. The cases file is written by `python -m triage_v2.token_cases` from the
// bundle's own tokenizer; each case reaches a different rule (accents, Chinese
// characters, control characters, typed special tokens, a word too long to split,
// a ticket past the token limit).

const BUNDLE = new URL('../../../ml/models/bundle_v2/', import.meta.url);
const tokenizerJson: unknown = JSON.parse(readFileSync(new URL('tokenizer.json', BUNDLE), 'utf8'));
const maxLength = maxTokensOf(JSON.parse(readFileSync(new URL('manifest.json', BUNDLE), 'utf8')));

describe('tokenizerFrom', () => {
  const tokenizer = tokenizerFrom(tokenizerJson, maxLength);

  it.each(cases.map((item) => [item.name, item] as const))('gives the Python token numbers for %s', (_name, item) => {
    expect(tokenizer.encode(item.text)).toEqual(item.ids);
  });

  it('cuts a long ticket at the bundle limit and still ends it', () => {
    const long = cases.find((item) => item.name === 'long ticket');
    expect(long?.ids.length).toBe(maxLength);
    expect(tokenizer.encode(long?.text ?? '').at(-1)).toBe(long?.ids.at(-1));
  });

  it('refuses a tokenizer it does not implement', () => {
    const json = tokenizerJson as { normalizer: object; model: object };
    expect(() => tokenizerFrom({ ...json, model: { ...json.model, type: 'BPE' } }, maxLength)).toThrow('E_SENTENCE_SHAPE');
    expect(() => tokenizerFrom({ ...json, normalizer: { ...json.normalizer, lowercase: false } }, maxLength)).toThrow('E_SENTENCE_SHAPE');
    expect(() => tokenizerFrom(null, maxLength)).toThrow('E_SENTENCE_SHAPE');
    expect(() => maxTokensOf({ max_length: 'many' })).toThrow('E_SENTENCE_SHAPE');
  });
});
