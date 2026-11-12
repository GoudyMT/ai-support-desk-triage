import { CATEGORIES, type Category } from '../domain/labels';
import { TRAP_WORDS } from './hardCases';
import { CATEGORY_TRIGGER_WORDS, type Template } from './templates';
import type { Wording } from './wording';

// The rules every wording must keep for the generator to label its tickets
// correctly, as one check a test can run over any wording. Each problem names a
// list and a position, never the sentence, so the same check can run over
// wording that must stay unread.
const KNOWN_SLOTS = new Set(['product', 'plan', 'otherPlan', 'feature', 'amount', 'date', 'days', 'seconds']);
const GREETING_AT_START = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening|day)|to whom|greetings)\b/i;
const SIGN_OFF_ANYWHERE = /\b(?:thanks|thank you|cheers|regards|please advise|appreciate)\b/i;
const PERSONAL_DATA = /@|\b\d{3}[- .]\d{3,4}\b|\bORD-|\d{4} \d{4}/;
const SECURITY_ALARM_WORDS = ['hacked', 'unauthorized', 'breach', 'stolen'];
const MIN_GRIEVANCE = 3;
const FLAG_HOMES: Record<'severe' | 'billingDispute' | 'statusQuestion', readonly Category[]> = {
  severe: ['Billing', 'Technical Issue'],
  billingDispute: ['Billing'],
  statusQuestion: ['Shipping/Order Issue'],
};

export interface NamedText {
  name: string;
  text: string;
  body: boolean;
}

// Lower case with every run of other characters as one space: the same rule the
// dataset export uses to call two texts the same.
export function sameWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function namedTexts(wording: Wording): NamedText[] {
  const out: NamedText[] = [];
  const add = (list: string, items: readonly (Template | string)[], body: boolean): void => {
    items.forEach((item, index) => out.push({ name: `${list}[${index}]`, text: typeof item === 'string' ? item : item.text, body }));
  };
  for (const category of CATEGORIES) {
    add(`templates.${category}`, wording.templates[category], true);
    add(`trapTemplates.${category}`, wording.trapTemplates[category], true);
  }
  add('vagueTemplates', wording.vagueTemplates, true);
  add('politeSecurityTemplates', wording.politeSecurityTemplates, true);
  add('threatPhrases', wording.threatPhrases, false);
  add('twoIssueConnectors', wording.twoIssueConnectors, false);
  add('openers', wording.openers, false);
  add('closers', wording.closers, false);
  add('requests', wording.requests, false);
  return out;
}

function textProblems(wording: Wording): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { name, text, body } of namedTexts(wording)) {
    const key = sameWords(text);
    if (seen.has(key)) {
      problems.push(`${name}: repeats a sentence`);
    }
    seen.add(key);
    if (!/^[\x20-\x7e]+$/.test(text)) {
      problems.push(`${name}: not plain ASCII`);
    }
    if (![...text.matchAll(/\{([^}]*)\}/g)].every((match) => KNOWN_SLOTS.has(match[1] ?? ''))) {
      problems.push(`${name}: unknown slot`);
    }
    if (PERSONAL_DATA.test(text)) {
      problems.push(`${name}: carries personal data`);
    }
    if (body && (GREETING_AT_START.test(text) || SIGN_OFF_ANYWHERE.test(text))) {
      problems.push(`${name}: greets or thanks inside the body`);
    }
  }
  return problems;
}

function ruleProblems(wording: Wording): string[] {
  const problems: string[] = [];
  wording.vagueTemplates.forEach((template, index) => {
    if (CATEGORY_TRIGGER_WORDS.some((word) => template.text.toLowerCase().includes(word))) {
      problems.push(`vagueTemplates[${index}]: carries a category word`);
    }
  });
  wording.politeSecurityTemplates.forEach((template, index) => {
    if (SECURITY_ALARM_WORDS.some((word) => template.text.toLowerCase().includes(word))) {
      problems.push(`politeSecurityTemplates[${index}]: carries an alarm word`);
    }
  });
  for (const category of CATEGORIES) {
    wording.trapTemplates[category].forEach((template, index) => {
      const text = template.text.toLowerCase();
      if (!Object.entries(TRAP_WORDS).some(([word, suggested]) => text.includes(word) && suggested !== category)) {
        problems.push(`trapTemplates.${category}[${index}]: no trap word pointing elsewhere`);
      }
    });
    wording.templates[category].forEach((template, index) => {
      for (const flag of ['severe', 'billingDispute', 'statusQuestion'] as const) {
        if (template[flag] === true && !FLAG_HOMES[flag].includes(category)) {
          problems.push(`templates.${category}[${index}]: ${flag} set where no label rule reads it`);
        }
      }
    });
    if (wording.templates[category].filter((template) => template.grievance === true).length < MIN_GRIEVANCE) {
      problems.push(`templates.${category}: too few upset tickets for a threat to follow`);
    }
  }
  return problems;
}

// Every rule a wording breaks; empty when it breaks none.
export function wordingProblems(wording: Wording): string[] {
  return [...textProblems(wording), ...ruleProblems(wording)];
}

// The names of this wording's texts that another wording also holds. Greetings
// are left out: "Hello," names no category and people have only a handful.
export function sharedTexts(wording: Wording, other: Wording): string[] {
  const theirs = new Set(namedTexts(other).map(({ text }) => sameWords(text)));
  return namedTexts(wording)
    .filter(({ name, text }) => !name.startsWith('openers[') && theirs.has(sameWords(text)))
    .map(({ name }) => name);
}
