import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isRunAsCommand } from './exportDataset';
import { approveRunTickets } from './measurePipeline';

// Writes the tickets of the 40 Approve runs for the sentence model's fold rounds
// (ml/triage_v2/sentence_folds.py) to answer before the runs are replayed.
// Run from the project root: npm --prefix web exec --no -- tsx web/scripts/exportApproveTickets.ts

const OUT = fileURLToPath(new URL('../../ml/data/generated/approve_runs.jsonl', import.meta.url));

if (isRunAsCommand(process.argv[1], import.meta.url)) {
  const tickets = approveRunTickets();
  writeFileSync(OUT, tickets.map((ticket) => JSON.stringify(ticket)).join('\n') + '\n', 'utf8');
  console.log(`    ${tickets.length.toLocaleString('en-US')} tickets written to ml/data/generated/approve_runs.jsonl`);
}
