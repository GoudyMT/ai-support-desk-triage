import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadModel, score, type HeadName } from './scorer';

const MODEL_JSON_PATH = fileURLToPath(new URL('./model.json', import.meta.url));
const MODEL_ENV = 'PARITY_MODEL';
const PARITY_URL = new URL('../../../ml/data/generated/parity_predictions.jsonl', import.meta.url);
const HEADS: readonly HeadName[] = ['category', 'priority'];
const PROBABILITY_TOLERANCE = 1e-9;

interface HeadAnswer {
  label: string;
  probabilities: Record<string, number>;
}

// Ids repeat from fold to fold, so a row is named by its id and its fold
// (null for the hand-written rows).
type ParityRow = { id: string; fold: number | null; maskedText: string } & Record<HeadName, HeadAnswer>;

function readParityRows(): ParityRow[] {
  if (!existsSync(PARITY_URL)) {
    throw new Error(
      'E_PARITY_FILE_MISSING: make it with: npm --prefix web run export-data, then (from the ml folder) python -m triage.export_model',
    );
  }
  // Split on "\n" only: the export escapes U+2028, but this stays correct if it ever does not.
  return readFileSync(PARITY_URL, 'utf-8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ParityRow);
}

// CI scores the model it has just exported, the one its parity file was made
// from: a fit on another machine can differ from the committed file in the last
// digits (the solver stops early), and that is not a scorer error. An empty
// value counts as set, so a CI variable that expanded to nothing fails here.
function modelPath(env: NodeJS.ProcessEnv): string {
  return env[MODEL_ENV] ?? MODEL_JSON_PATH;
}

function readModelFile(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`E_PARITY_MODEL_MISSING: ${MODEL_ENV} names no file; unset it to score the committed model`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('which model file the parity test scores', () => {
  it('scores the committed model unless PARITY_MODEL names another', () => {
    expect(modelPath({})).toBe(MODEL_JSON_PATH);
    expect(modelPath({ [MODEL_ENV]: '/elsewhere/model.json' })).toBe('/elsewhere/model.json');
    // Empty counts as set, so a variable that expanded to nothing fails loudly.
    expect(modelPath({ [MODEL_ENV]: '' })).toBe('');
  });

  it('fails with a static code naming PARITY_MODEL when it names no file', () => {
    expect(() => readModelFile(`${MODEL_JSON_PATH}.missing`)).toThrow(`E_PARITY_MODEL_MISSING: ${MODEL_ENV}`);
  });
});

// Visitors get the TypeScript answer, the evaluation measured the Python one:
// they must be the same answer on every evaluation ticket.
describe('scorer parity with scikit-learn on the evaluation tickets', () => {
  const model = loadModel(readModelFile(modelPath(process.env)));

  it.each(HEADS)('gives the same %s class on every row and the same probabilities', (head) => {
    const rows = readParityRows();
    expect(rows.length).toBeGreaterThan(0);
    const differentClass: string[] = [];
    let maxDifference = 0;
    for (const row of rows) {
      const prediction = score(model, head, row.maskedText);
      if (prediction.label !== row[head].label) {
        differentClass.push(`${row.id} (fold ${row.fold ?? 'none'})`);
      }
      for (const [name, expected] of Object.entries(row[head].probabilities)) {
        maxDifference = Math.max(maxDifference, Math.abs((prediction.probabilities[name] ?? Infinity) - expected));
      }
    }
    console.log(`parity ${head}: ${rows.length} rows, max probability difference ${maxDifference}`);
    expect(differentClass).toEqual([]);
    expect(maxDifference).toBeLessThanOrEqual(PROBABILITY_TOLERANCE);
  });
});
