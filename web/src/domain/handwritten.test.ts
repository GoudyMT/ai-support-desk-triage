import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES, RISK_ORDER, type Category, type Priority, type ReviewReason } from './labels';

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
interface Row {
  id: string;
  category: Category;
  secondary: Category | null;
  priority: Priority;
  mustReview: boolean;
  reviewReason: ReviewReason | null;
  hardCase: string | null;
}

const rows = raw.trimEnd().split('\n').map((line) => JSON.parse(line) as Row);

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

  it('gives every row its own id', () => {
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// The rows must also obey the labeling rules, so a frozen answer that contradicts
// them (and would quietly cap or inflate a score) fails here even with the hash re-pinned.
describe('hand-written set follows the labeling rules', () => {
  // A threat or a vague ticket overrides the category rules; every other row follows
  // the per-category tables below.
  const threats = rows.filter((row) => row.hardCase === 'threatening');
  const vagues = rows.filter((row) => row.hardCase === 'vague');
  const ordinary = rows.filter((row) => row.hardCase !== 'threatening' && row.hardCase !== 'vague');

  // Priority each category can have; Billing and Technical Issue rise to High for
  // words of loss or blocking, Shipping/Order Issue drops to Low for a status question.
  const ALLOWED_PRIORITIES: Record<Category, Priority[]> = {
    'Security Concern': ['Urgent'],
    'Accessibility Support': ['High'],
    'Account Access': ['High'],
    'Urgent Complaint': ['High'],
    Billing: ['Medium', 'High'],
    'Technical Issue': ['Medium', 'High'],
    'Shipping/Order Issue': ['Low', 'Medium'],
    'Product Question': ['Low'],
    Other: ['Low'],
  };
  // Only a billing dispute needs review among Billing tickets.
  const ALLOWED_REASONS: Record<Category, (ReviewReason | null)[]> = {
    'Security Concern': ['security incident'],
    'Accessibility Support': ['accessibility issue'],
    'Urgent Complaint': ['escalated complaint'],
    Billing: ['billing dispute', null],
    'Account Access': [null],
    'Technical Issue': [null],
    'Shipping/Order Issue': [null],
    'Product Question': [null],
    Other: [null],
  };

  it('labels a threat Urgent Complaint / Urgent, and only a threat carries threatening language', () => {
    for (const row of threats) {
      expect(row.category, row.id).toBe('Urgent Complaint');
      expect(row.priority, row.id).toBe('Urgent');
      expect(row.reviewReason, row.id).toBe('threatening language');
      expect(row.secondary, row.id).not.toBe('Urgent Complaint');
    }
    expect(rows.filter((row) => row.reviewReason === 'threatening language')).toEqual(threats);
  });

  it('labels a vague ticket Other / Medium with no secondary, and only a vague one carries that reason', () => {
    for (const row of vagues) {
      expect(row.category, row.id).toBe('Other');
      expect(row.priority, row.id).toBe('Medium');
      expect(row.secondary, row.id).toBeNull();
      expect(row.reviewReason, row.id).toBe('vague ticket');
    }
    expect(rows.filter((row) => row.reviewReason === 'vague ticket')).toEqual(vagues);
  });

  it('gives every other row a priority its category can have', () => {
    for (const row of ordinary) expect(ALLOWED_PRIORITIES[row.category], row.id).toContain(row.priority);
  });

  it('gives every other row the review reason its category calls for', () => {
    for (const row of ordinary) expect(ALLOWED_REASONS[row.category], row.id).toContain(row.reviewReason);
  });

  it('puts the riskier of two issues first, so a secondary ranks below the category', () => {
    for (const row of ordinary) {
      if (row.secondary === null) continue;
      expect(RISK_ORDER.indexOf(row.secondary), row.id).toBeGreaterThan(RISK_ORDER.indexOf(row.category));
    }
  });
});
