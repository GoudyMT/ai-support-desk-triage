import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, PRIORITIES, type Category, type Priority } from '../src/domain/labels';
import { CONFIDENCE_FLOOR } from '../src/pipeline/run';
import { tablePredict, type SavedAnswer } from '../src/pipeline/tableScorer';
import type { LabeledRow } from './measurePipeline';
import { measureRounds, measureSets, measureTwoModels, parseFloor, reportDifferences, type AnswersRecord } from './measureTwoModels';

// A question no keyword rule matches, so only the two models decide what happens to it.
const PLAIN = 'What sizes does the standard desk lamp come in?';
const SURE = 0.95;
const UNSURE = 0.3;
const FLOOR = 0.5;

function spread(classes: readonly string[], chosen: string, share: number): Record<string, number> {
  const rest = (1 - share) / (classes.length - 1);
  return Object.fromEntries(classes.map((name) => [name, name === chosen ? share : rest]));
}

function row(id: string, category: Category, priority: Priority, mustReview = false): LabeledRow {
  return { id, text: PLAIN, label: { category, priority, mustReview } };
}

function saved(id: string, category: Category, priority: Priority, share = SURE): SavedAnswer {
  return { id, category_probs: spread(CATEGORIES, category, share), priority_probs: spread(PRIORITIES, priority, share) };
}

describe('the gate model and the answer model together', () => {
  it('lets a ticket leave unchecked only when the gate allows it and both models give the same answer', () => {
    const rows = [row('same', 'Product Question', 'Low'), row('differ', 'Billing', 'Medium'), row('unsure', 'Product Question', 'Low')];
    const gate = [saved('same', 'Product Question', 'Low'), saved('differ', 'Product Question', 'Low'), saved('unsure', 'Product Question', 'Low', UNSURE)];
    const answer = [saved('same', 'Product Question', 'Low'), saved('differ', 'Billing', 'Medium'), saved('unsure', 'Product Question', 'Low')];
    const result = measureTwoModels(rows, gate, answer, FLOOR);
    expect(result.today.flagged).toBe(1);
    expect(result.both.flagged).toBe(2);
    expect(result.both).toMatchObject({ silentCategory: 0, silentPriority: 0 });
    // Today the "differ" ticket left unchecked with the gate model's wrong answer.
    expect(result.today).toMatchObject({ silentCategory: 1, silentPriority: 1 });
  });

  it('never releases a ticket on the answer model alone, however sure it is', () => {
    const rows = [row('a', 'Security Concern', 'Urgent', true)];
    const gate = [saved('a', 'Product Question', 'Low', UNSURE)];
    const answer = [saved('a', 'Product Question', 'Low')];
    const result = measureTwoModels(rows, gate, answer, FLOOR);
    expect(result.both).toMatchObject({ flagged: 1, highRiskMissed: 0, highUrgentOutLow: 0 });
  });

  it('counts a miss both models agree on, the one kind of error the pair cannot catch', () => {
    const rows = [row('a', 'Account Access', 'High')];
    const wrong = [saved('a', 'Product Question', 'Low')];
    const result = measureTwoModels(rows, wrong, wrong, FLOOR);
    expect(result.both).toMatchObject({ flagged: 0, highUrgentOutLow: 1, silentCategory: 1, silentPriority: 1 });
    expect(result.both).toEqual(result.today);
  });

  it('reports how often each model shows the reviewer the right answer on the tickets a person sees', () => {
    const rows = [row('a', 'Billing', 'Medium'), row('b', 'Account Access', 'High')];
    const gate = [saved('a', 'Product Question', 'Low', UNSURE), saved('b', 'Account Access', 'Low', UNSURE)];
    const answer = [saved('a', 'Billing', 'Medium'), saved('b', 'Account Access', 'Medium')];
    const result = measureTwoModels(rows, gate, answer, FLOOR);
    expect(result.reviewed).toBe(2);
    expect(result.suggestion.gate).toEqual({ category: 1, priority: 0, both: 0 });
    expect(result.suggestion.answer).toEqual({ category: 2, priority: 1, both: 1 });
  });

  // One row per field: the rule names both, and a rule that compared only one
  // would let a ticket leave on half an agreement.
  it.each([
    ['department', saved('a', 'Billing', 'Low')],
    ['priority', saved('a', 'Product Question', 'High')],
  ])('keeps a ticket for a person when the models differ on the %s alone', (_field, answer) => {
    const result = measureTwoModels([row('a', 'Product Question', 'Low')], [saved('a', 'Product Question', 'Low')], [answer], FLOOR);
    expect(result.today.flagged).toBe(0);
    expect(result.both.flagged).toBe(1);
  });

  // The answer model is compared, never used as a gate: its own low confidence
  // must not send a ticket to a person when it gives the gate's answer.
  it('lets a ticket leave when the answer model agrees, however unsure it is', () => {
    const result = measureTwoModels([row('a', 'Product Question', 'Low')], [saved('a', 'Product Question', 'Low')], [saved('a', 'Product Question', 'Low', UNSURE)], FLOOR);
    expect(result.both.flagged).toBe(0);
  });

  // The existing row passed an empty table; a table of another size is now
  // refused first (E_ANSWER_SET), so the missing ticket is shown with a table
  // of the right size that holds another ticket's answer.
  it('stops when either model has no answer for a ticket', () => {
    const rows = [row('a', 'Other', 'Low')];
    expect(() => measureTwoModels(rows, [saved('a', 'Other', 'Low')], [saved('b', 'Other', 'Low')], FLOOR)).toThrow('E_ANSWER_MISSING');
    expect(() => measureTwoModels(rows, [saved('b', 'Other', 'Low')], [saved('a', 'Other', 'Low')], FLOOR)).toThrow('E_ANSWER_MISSING');
  });

  it('stops when an answer table was made on another set of tickets', () => {
    const rows = [row('a', 'Other', 'Low')];
    const two = [saved('a', 'Other', 'Low'), saved('b', 'Other', 'Low')];
    expect(() => measureTwoModels(rows, two, [saved('a', 'Other', 'Low')], FLOOR)).toThrow('E_ANSWER_SET');
    expect(() => measureTwoModels(rows, [saved('a', 'Other', 'Low')], two, FLOOR)).toThrow('E_ANSWER_SET');
    expect(() => measureTwoModels(rows, [], [saved('a', 'Other', 'Low')], FLOOR)).toThrow('E_ANSWER_SET');
  });
});

describe('the confidence floor given on the command line', () => {
  it('is the desk floor when none is given, and the number when one is', () => {
    expect(parseFloor(undefined)).toBe(CONFIDENCE_FLOOR);
    expect(parseFloor('0.7')).toBe(0.7);
    expect(parseFloor('0')).toBe(0);
  });

  // "Number('o.5')" is NaN, and no confidence is below NaN: the floor would be off.
  it.each(['o.5', '', '1.5', '-0.1', 'Infinity'])('refuses %j, which would switch the floor off or mean nothing', (value) => {
    expect(() => parseFloor(value)).toThrow('E_BAD_FLOOR');
  });
});

describe('the practice rounds measured from their answer files', () => {
  const PAIRS: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];

  // One ticket per fold, each with its own id, so a round read from another
  // fold's file has no answer for its ticket. The gate run is unsure and the
  // answer run is sure and right: swapped, nothing would be flagged today.
  function practiceDir(skip?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'rounds-'));
    for (let fold = 0; fold < 4; fold += 1) {
      const ticket = { id: `t-${fold}`, text: PLAIN, category: 'Product Question', priority: 'Low', mustReview: false };
      writeFileSync(join(dir, `held_${fold}.jsonl`), `${JSON.stringify(ticket)}\n`, 'utf8');
    }
    for (const [a, b] of PAIRS) {
      for (const fold of [a, b]) {
        const files: [string, SavedAnswer][] = [
          [`gate_tune_${a}_${b}_answers_fold_${fold}.json`, saved(`t-${fold}`, 'Product Question', 'Low', UNSURE)],
          [`answer_tune_${a}_${b}_answers_fold_${fold}.json`, saved(`t-${fold}`, 'Product Question', 'Low')],
        ];
        for (const [name, answer] of files) {
          if (name !== skip) {
            writeFileSync(join(dir, name), JSON.stringify([answer]), 'utf8');
          }
        }
      }
    }
    return dir;
  }

  it('pairs each round with its own tickets and keeps the gate run and the answer run apart', () => {
    const dir = practiceDir();
    try {
      const records = measureRounds({ answersDir: dir, gateKey: 'gate', answerKey: 'answer', dataDir: dir, heldoutPrefix: 'held' }, FLOOR);
      expect(records.map(({ train, fold }) => `${train}:${fold}`)).toEqual(PAIRS.flatMap(([a, b]) => [`${a}_${b}:${a}`, `${a}_${b}:${b}`]));
      expect(records.every((record) => record.today.flagged === 1 && record.both.flagged === 1)).toBe(true);
      expect(records.every((record) => record.suggestion.answer.both === 1)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stops at a round whose answer file is missing, never skipping it', () => {
    const dir = practiceDir('answer_tune_1_3_answers_fold_3.json');
    try {
      expect(() => measureRounds({ answersDir: dir, gateKey: 'gate', answerKey: 'answer', dataDir: dir, heldoutPrefix: 'held' }, FLOOR)).toThrow(/ENOENT/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the judged sets measured from the recorded answers', () => {
  const ROWS: Record<string, LabeledRow[]> = {
    'desk.jsonl': [row('d1', 'Product Question', 'Low'), row('d2', 'Billing', 'Medium')],
    'hand.jsonl': [row('h1', 'Account Access', 'High')],
  };
  const RECORD: AnswersRecord = {
    bundle_fingerprint: 'abc123',
    sets: {
      desk: { file: 'desk.jsonl', answers: [['d1', 'Product Question', 'Low'], ['d2', 'Billing', 'Medium']] },
      handwritten: { file: 'hand.jsonl', answers: [['h1', 'Account Access', 'High']] },
    },
  };
  // A gate that is sure, right on d1 and h1, and wrong on d2.
  const GATE = tablePredict([saved('d1', 'Product Question', 'Low'), saved('d2', 'Product Question', 'Low'), saved('h1', 'Account Access', 'High')]);
  const readRows = (file: string): LabeledRow[] => ROWS[file] ?? [];

  it('counts each set under its published name and carries the fingerprint of the bundle that answered', () => {
    const report = measureSets(RECORD, readRows, GATE, FLOOR);
    expect(Object.keys(report.sets)).toEqual(['desk-only wording', 'hand-written (seen)']);
    expect(report.answer.bundle_fingerprint).toBe('abc123');
    expect(report.sets['desk-only wording']).toMatchObject({ file: 'desk.jsonl', reviewed: 1, today: { flagged: 0, silentCategory: 1 }, both: { flagged: 1, silentCategory: 0 } });
    expect(report.sets['hand-written (seen)']?.both.flagged).toBe(0);
  });

  it('stops when the recorded answers are not one per ticket in the tickets\' order', () => {
    const swapped: AnswersRecord = { ...RECORD, sets: { desk: { file: 'desk.jsonl', answers: [['d2', 'Billing', 'Medium'], ['d1', 'Product Question', 'Low']] } } };
    const short: AnswersRecord = { ...RECORD, sets: { desk: { file: 'desk.jsonl', answers: [['d1', 'Product Question', 'Low']] } } };
    expect(() => measureSets(swapped, readRows, GATE, FLOOR)).toThrow('E_ANSWER_SET');
    expect(() => measureSets(short, readRows, GATE, FLOOR)).toThrow('E_ANSWER_SET');
  });

  // A misspelt class would otherwise read as "no class chosen" and fall to the first one.
  it('stops at a recorded answer that names no known department or priority', () => {
    const misspelt: AnswersRecord = { ...RECORD, sets: { handwritten: { file: 'hand.jsonl', answers: [['h1', 'Account Acces', 'High']] } } };
    expect(() => measureSets(misspelt, readRows, GATE, FLOOR)).toThrow('E_ANSWER_SHAPE');
  });

  it('names what differs when the report in the repo is not the one the recorded answers give', () => {
    const built = measureSets(RECORD, readRows, GATE, FLOOR);
    expect(reportDifferences(structuredClone(built), built)).toEqual([]);
    const edited = structuredClone(built);
    const desk = edited.sets['desk-only wording'];
    expect(desk).toBeDefined();
    if (desk !== undefined) {
      desk.both.silentCategory += 1;
    }
    expect(reportDifferences(edited, built)).toEqual(['desk-only wording']);
    expect(reportDifferences({ ...built, answer: { bundle_fingerprint: 'other' } }, built)).toEqual(['bundle_fingerprint']);
    const { 'hand-written (seen)': _dropped, ...fewer } = built.sets;
    expect(reportDifferences({ ...built, sets: fewer }, built)).toEqual(['hand-written (seen)']);
  });
});
