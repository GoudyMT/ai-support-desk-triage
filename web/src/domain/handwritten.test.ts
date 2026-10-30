import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES } from './labels';

// The hand-written set is the one evaluation the model never saw in any form: it was
// written and labeled by hand before the first training run, then frozen with the
// owner's approval. Any edit, even a fix, must fail here so a score can never be
// raised by quietly changing the answers.
const SET_URL = new URL('../../../ml/data/handwritten.jsonl', import.meta.url);
const FROZEN_SHA256 = '4a12c1b6e8cba58b92e3ee5d3f891950e189abbc24683c2694f2c4a149d15025';
const SET_SIZE = 48;
const REVIEW_REASONS = ['security incident', 'accessibility issue', 'billing dispute', 'threatening language', 'escalated complaint', 'vague ticket'];
const HARD_CASES = ['vague', 'threatening', 'two-issues', 'typos', 'keyword-trap', 'polite-security'];
const KEYS = ['category', 'hardCase', 'id', 'mustReview', 'priority', 'reviewReason', 'secondary', 'source', 'text'];

// Line endings are normalised so a Windows checkout and the CI checkout hash the same.
const raw = readFileSync(SET_URL, 'utf8').replace(/\r/g, '');
const rows = raw.trimEnd().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

describe('hand-written evaluation set', () => {
  it('is unchanged since the owner approved it', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(FROZEN_SHA256);
  });

  it('holds 48 rows with valid labels', () => {
    expect(rows).toHaveLength(SET_SIZE);
    for (const row of rows) {
      expect(Object.keys(row).sort(), String(row.id)).toEqual(KEYS);
      expect(CATEGORIES, String(row.id)).toContain(row.category);
      expect(PRIORITIES, String(row.id)).toContain(row.priority);
      expect(row.mustReview, String(row.id)).toBe(row.reviewReason !== null);
      if (row.reviewReason !== null) expect(REVIEW_REASONS, String(row.id)).toContain(row.reviewReason);
      if (row.hardCase !== null) expect(HARD_CASES, String(row.id)).toContain(row.hardCase);
      if (row.secondary !== null) expect(CATEGORIES, String(row.id)).toContain(row.secondary);
    }
  });
});
