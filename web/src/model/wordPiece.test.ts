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

  // The row above proves the cut only while the cases file holds a ticket that reaches the limit.
  it('has a case long enough to reach the bundle limit', () => {
    expect(cases.find((item) => item.name === 'long ticket')?.ids.length).toBe(maxLength);
  });

  // A visitor can type up to 20,000 characters into Try a ticket, and the tokenizer runs on the page's main thread.
  // Long made-up words once took about 420 ms here; the page's own budget for a whole ticket is 50 ms. The bound is
  // loose so a busy machine does not fail it, and still far below the slow version.
  it('splits the longest ticket a visitor may type, made of long unknown words, quickly', () => {
    const word = 'qxzjvkw'.repeat(15).slice(0, 99);
    const text = Array.from({ length: 199 }, () => word).join(' ').slice(0, 20_000);
    const began = performance.now();
    tokenizer.encode(text);
    expect(performance.now() - began).toBeLessThan(100);
  });

  it('refuses a tokenizer it does not implement', () => {
    const json = tokenizerJson as { normalizer: object; model: object };
    expect(() => tokenizerFrom({ ...json, model: { ...json.model, type: 'BPE' } }, maxLength)).toThrow('E_SENTENCE_SHAPE');
    expect(() => tokenizerFrom({ ...json, normalizer: { ...json.normalizer, lowercase: false } }, maxLength)).toThrow('E_SENTENCE_SHAPE');
    expect(() => tokenizerFrom(null, maxLength)).toThrow('E_SENTENCE_SHAPE');
    expect(() => maxTokensOf({ max_length: 'many' })).toThrow('E_SENTENCE_SHAPE');
  });
});
