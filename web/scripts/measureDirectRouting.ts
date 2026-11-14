import { readFileSync } from 'node:fs';
import { CATEGORIES, PRIORITIES } from '../src/domain/labels';
import { loadModel, score } from '../src/model/scorer';
import { CONFIDENCE_FLOOR, SECOND_CHECK_ON, runTicketWith, type Predict } from '../src/pipeline/run';
import { tablePredict } from '../src/pipeline/tableScorer';
import { isRunAsCommand } from './exportDataset';
import { parseRows, type LabeledRow } from './measurePipeline';

// Measures a flow the desk does not use, as evidence for the next version's design: a ticket flagged only by a word
// rule or an always-checked department, that both models agree on and that is already High or Urgent, goes straight to
// its department marked as needing a person; triage keeps the tickets the models disagree on or the word model is
// unsure of. Prints, per set, the triage share before and after and how often a direct ticket reaches the right
// department. Run from the project root: npm --prefix web exec --no -- tsx web/scripts/measureDirectRouting.ts

const HIGH = new Set(['High', 'Urgent']);
const AGREEING_REVIEWER = { decide: (input: { suggestion: { category: string; priority: string } }) => ({ ...input.suggestion, route: '', reason: 'reviewed' }) };

export interface RoutingCounts {
  tickets: number;
  today: number;
  triage: number;
  direct: number;
  directRight: number;
  directRisky: number;
  directRiskyRight: number;
  // Wrong-department direct tickets, by what flagged them: a word rule, or an always-checked department alone.
  wrongByRule: number;
  wrongByDepartment: number;
}

/**
 * Counts the triage queue and the direct routes for one set.
 *
 * Args:
 *   rows: the tickets with their true labels.
 *   word: the word model's scorer.
 *   sentence: the sentence model's scorer.
 *
 * Returns:
 *   The counts.
 */
export function measureDirectRouting(rows: readonly LabeledRow[], word: Predict, sentence: Predict): RoutingCounts {
  const base = { reviewer: AGREEING_REVIEWER as never, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };
  const c: RoutingCounts = { tickets: rows.length, today: 0, triage: 0, direct: 0, directRight: 0, directRisky: 0, directRiskyRight: 0, wrongByRule: 0, wrongByDepartment: 0 };
  for (const row of rows) {
    const gate = runTicketWith(row.text, row.id, word, { ...base, floor: CONFIDENCE_FLOOR });
    const answer = runTicketWith(row.text, row.id, sentence, { ...base, floor: 0 });
    const agree = answer.final.category === gate.final.category && answer.final.priority === gate.final.priority;
    if (!gate.guard.flagged && !answer.guard.flagged && agree) continue;
    c.today += 1;
    const kinds = new Set(gate.guard.reasons.map((reason) => reason.kind));
    if (!agree || kinds.has('low confidence') || !HIGH.has(gate.final.priority)) {
      c.triage += 1;
      continue;
    }
    c.direct += 1;
    const right = gate.final.category === row.label.category;
    c.directRight += right ? 1 : 0;
    if (row.label.mustReview) {
      c.directRisky += 1;
      c.directRiskyRight += right ? 1 : 0;
    }
    if (!right) {
      if (kinds.has('rule')) c.wrongByRule += 1;
      else c.wrongByDepartment += 1;
    }
  }
  return c;
}

export interface WhySent {
  tickets: number;
  // Tickets whose true label says a person must see them.
  mustReview: number;
  sent: number;
  // Each ticket sent to a person, by the first reason the desk gives: a word rule, an always-checked department, the
  // word model under 50% sure, or (none of those) the two models disagreeing; with how many did not need a person.
  rule: { sent: number; notNeeded: number };
  department: { sent: number; notNeeded: number };
  // Under 50% sure: also the risky tickets that no rule or department caught, which only this check sends.
  unsure: { sent: number; notNeeded: number; riskyOnlyHere: number };
  disagree: number;
  // The escalated-complaint rule, wherever it fires among the reasons.
  escalated: { fires: number; notNeeded: number };
}

/**
 * Counts why the desk's two-model rule sends each ticket to a person, against whether it truly needed one.
 *
 * Args:
 *   rows: the tickets with their true labels.
 *   word: the word model's scorer.
 *   sentence: the sentence model's scorer.
 *
 * Returns:
 *   The counts.
 */
export function whySent(rows: readonly LabeledRow[], word: Predict, sentence: Predict): WhySent {
  const base = { reviewer: AGREEING_REVIEWER as never, secondCheckOn: SECOND_CHECK_ON, now: () => 0 };
  const c: WhySent = {
    tickets: rows.length,
    mustReview: rows.filter((row) => row.label.mustReview).length,
    sent: 0,
    rule: { sent: 0, notNeeded: 0 },
    department: { sent: 0, notNeeded: 0 },
    unsure: { sent: 0, notNeeded: 0, riskyOnlyHere: 0 },
    disagree: 0,
    escalated: { fires: 0, notNeeded: 0 },
  };
  for (const row of rows) {
    const gate = runTicketWith(row.text, row.id, word, { ...base, floor: CONFIDENCE_FLOOR });
    const answer = runTicketWith(row.text, row.id, sentence, { ...base, floor: 0 });
    const agree = answer.final.category === gate.final.category && answer.final.priority === gate.final.priority;
    if (!gate.guard.flagged && !answer.guard.flagged && agree) continue;
    c.sent += 1;
    const needed = row.label.mustReview;
    const reasons = gate.guard.reasons;
    if (reasons.some((reason) => reason.kind === 'rule' && reason.reason === 'escalated complaint')) {
      c.escalated.fires += 1;
      c.escalated.notNeeded += needed ? 0 : 1;
    }
    const kinds = new Set(reasons.map((reason) => reason.kind));
    if (kinds.has('rule')) {
      c.rule.sent += 1;
      c.rule.notNeeded += needed ? 0 : 1;
    } else if (kinds.has('category')) {
      c.department.sent += 1;
      c.department.notNeeded += needed ? 0 : 1;
    } else if (kinds.has('low confidence')) {
      c.unsure.sent += 1;
      c.unsure.notNeeded += needed ? 0 : 1;
      c.unsure.riskyOnlyHere += needed ? 1 : 0;
    } else {
      c.disagree += 1;
    }
  }
  return c;
}

function chosenTable(answers: readonly (readonly [string, string, string])[]): Predict {
  const whole = (classes: readonly string[], choice: string) => Object.fromEntries(classes.map((name) => [name, name === choice ? 1 : 0]));
  return tablePredict(answers.map(([id, category, priority]) => ({ id, category_probs: whole(CATEGORIES, category), priority_probs: whole(PRIORITIES, priority) })));
}

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  const print = (name: string, c: RoutingCounts) =>
    console.log(`${name}: triage ${c.today} -> ${c.triage} of ${c.tickets}; direct ${c.directRight} of ${c.direct} right (risky ${c.directRiskyRight} of ${c.directRisky}); wrong by rule ${c.wrongByRule}, by department alone ${c.wrongByDepartment}`);
  const folds = JSON.parse(read('../../ml/reports/sentence_fold_answers.json')) as Record<string, { answers: [string, string, string][] }>;
  for (const [fold, { answers }] of Object.entries(folds)) {
    const model = loadModel(JSON.parse(read(`../public/models/fold_${fold}.json`)));
    print(`fold ${fold}`, measureDirectRouting(parseRows(read(`../../ml/data/generated/heldout_${fold}.jsonl`)), (head, text) => score(model, head, text), chosenTable(answers)));
  }
  const shipped = loadModel(JSON.parse(read('../src/model/model.json')));
  const record = JSON.parse(read('../../ml/reports/bundle_v2_answers.json')) as { sets: Record<string, { file: string; answers: [string, string, string][] }> };
  for (const [name, { file, answers }] of Object.entries(record.sets)) {
    const rows = parseRows(read(`../../ml/data/generated/${file}`));
    const word: Predict = (head, text) => score(shipped, head, text);
    print(name, measureDirectRouting(rows, word, chosenTable(answers)));
    const why = whySent(rows, word, chosenTable(answers));
    console.log(
      `${name}, why sent: ${why.sent} of ${why.tickets} sent, ${why.mustReview} truly need a person; first reason rule ${why.rule.sent} ` +
        `(${why.rule.notNeeded} not needed), department ${why.department.sent} (${why.department.notNeeded}), under 50% ` +
        `${why.unsure.sent} (${why.unsure.notNeeded}; ${why.unsure.riskyOnlyHere} risky caught only here), disagree ${why.disagree}; ` +
        `escalated complaint fires ${why.escalated.fires} (${why.escalated.notNeeded} not needed)`,
    );
  }
}
