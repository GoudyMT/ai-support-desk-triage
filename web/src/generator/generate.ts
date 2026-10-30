import { CATEGORIES, type Category, type TicketLabel } from '../domain/labels';
import { labelTicket, primaryCategory, type TicketFacts } from '../domain/labelRules';
import { FAKE_DATA_SHARE, fakeSnippet } from './fakeData';
import {
  HARD_CASE_SHARES,
  POLITE_SECURITY_TEMPLATES,
  THREAT_PHRASES,
  TRAP_TEMPLATES,
  TWO_ISSUE_CONNECTORS,
  VAGUE_TEMPLATES,
  introduceTypos,
  type HardCase,
} from './hardCases';
import { createRng, ticketSeed, type Rng } from './rng';
import { CATEGORY_SHARES, CATEGORY_TRIGGER_WORDS, CLOSERS, OPENERS, TEMPLATES, fillSlots, type Template } from './templates';

export { CATEGORY_SHARES, CATEGORY_TRIGGER_WORDS, FAKE_DATA_SHARE, HARD_CASE_SHARES };
export type { HardCase };

export interface Ticket {
  id: string;
  seed: number;
  index: number;
  text: string;
  label: TicketLabel;
  hardCase?: HardCase;
  hasFakeData: boolean;
}

// What a test needs beyond the ticket: the facts the label was computed from,
// and the category drawn from CATEGORY_SHARES before any hard case ran.
export interface TicketDetail {
  ticket: Ticket;
  facts: TicketFacts;
  baseCategory: Category;
}

const NO_HARD_CASE = 'none';
const OPENER_CHANCE = 0.4;
const CLOSER_CHANCE = 0.4;
// Some people type in lower case with no care for capitals.
const CASUAL_CHANCE = 0.1;

interface Body {
  text: string;
  facts: TicketFacts;
  // The category the text is about, which picks the kind of fake data to add.
  topic: Category;
}

function factsFor(issues: Category[], template: Template): TicketFacts {
  return {
    issues,
    threatening: false,
    vague: false,
    billingDispute: template.billingDispute === true,
    severe: template.severe === true,
    statusQuestion: template.statusQuestion === true,
  };
}

function drawHardCase(rng: Rng): HardCase | undefined {
  const plainShare = 1 - Object.values(HARD_CASE_SHARES).reduce((sum, share) => sum + share, 0);
  const drawn = rng.weighted<HardCase | typeof NO_HARD_CASE>({ ...HARD_CASE_SHARES, [NO_HARD_CASE]: plainShare });
  return drawn === NO_HARD_CASE ? undefined : drawn;
}

function buildTwoIssues(rng: Rng, base: Category): Body {
  const others = CATEGORIES.filter((category) => category !== base && category !== 'Other');
  const second = rng.pick(others);
  const first = rng.pick(TEMPLATES[base]);
  const other = rng.pick(TEMPLATES[second]);
  const text = [fillSlots(first.text, rng), rng.pick(TWO_ISSUE_CONNECTORS), fillSlots(other.text, rng)].join(' ');
  const issues = [base, second];
  // Priority and review flags belong to the issue that decides the category.
  const deciding = primaryCategory(issues) === base ? first : other;
  return { text, facts: factsFor(issues, deciding), topic: base };
}

function buildBody(rng: Rng, hardCase: HardCase | undefined, base: Category): Body {
  switch (hardCase) {
    case 'vague': {
      const template = rng.pick(VAGUE_TEMPLATES);
      return { text: fillSlots(template.text, rng), facts: { ...factsFor(['Other'], template), vague: true }, topic: 'Other' };
    }
    case 'threatening': {
      const template = rng.pick(TEMPLATES[base]);
      const text = `${fillSlots(template.text, rng)} ${rng.pick(THREAT_PHRASES)}`;
      return { text, facts: { ...factsFor([base], template), threatening: true }, topic: base };
    }
    case 'two-issues':
      return buildTwoIssues(rng, base);
    case 'keyword-trap': {
      const template = rng.pick(TRAP_TEMPLATES[base]);
      return { text: fillSlots(template.text, rng), facts: factsFor([base], template), topic: base };
    }
    case 'polite-security': {
      const template = rng.pick(POLITE_SECURITY_TEMPLATES);
      const issues: Category[] = ['Security Concern'];
      return { text: fillSlots(template.text, rng), facts: factsFor(issues, template), topic: 'Security Concern' };
    }
    case 'typos':
    case undefined: {
      const template = rng.pick(TEMPLATES[base]);
      return { text: fillSlots(template.text, rng), facts: factsFor([base], template), topic: base };
    }
  }
}

// Greeting, sign-off and the odd all-lower-case message vary the voice without
// touching what the ticket is about. A threat ends the message, so no
// "Thanks." follows it, and a polite security report already greets and thanks
// in its own words. The greeting sits on its own line, as in an email.
function addVoice(rng: Rng, body: string, hardCase: HardCase | undefined): string {
  if (hardCase === 'polite-security') {
    return body;
  }
  const opener = rng.chance(OPENER_CHANCE) ? rng.pick(OPENERS) : '';
  const closer = hardCase !== 'threatening' && rng.chance(CLOSER_CHANCE) ? rng.pick(CLOSERS) : '';
  const text = [rng.chance(CASUAL_CHANCE) ? body.toLowerCase() : body, closer].filter((part) => part !== '').join(' ');
  return opener === '' ? text : `${opener}\n${text}`;
}

export function generateTicketDetail(seed: number, index: number): TicketDetail {
  // Only (seed, index) feeds the generator, so ticket i never depends on the
  // tickets before it.
  const rng = createRng(ticketSeed(seed, index));
  const hardCase = drawHardCase(rng);
  // Drawn for every ticket, even when a hard case replaces the text, so the
  // category shares hold whatever the hard cases do.
  const baseCategory = rng.weighted(CATEGORY_SHARES);
  const hasFakeData = rng.chance(FAKE_DATA_SHARE);

  const body = buildBody(rng, hardCase, baseCategory);
  let text = addVoice(rng, body.text, hardCase);
  if (hardCase === 'typos') {
    text = introduceTypos(rng, text);
  }
  // Added last so a typo can never damage an email, number or card.
  if (hasFakeData) {
    text = `${text} ${fakeSnippet(rng, body.topic)}`;
  }

  const ticket: Ticket = {
    id: `T-${seed}-${index}`,
    seed,
    index,
    text,
    label: labelTicket(body.facts),
    hasFakeData,
  };
  if (hardCase !== undefined) {
    ticket.hardCase = hardCase;
  }
  return { ticket, facts: body.facts, baseCategory };
}

export function generateTicket(seed: number, index: number): Ticket {
  return generateTicketDetail(seed, index).ticket;
}

export function generateTickets(seed: number, count: number): Ticket[] {
  return Array.from({ length: count }, (_, index) => generateTicket(seed, index));
}
