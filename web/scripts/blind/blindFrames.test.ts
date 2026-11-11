import { describe, expect, it } from 'vitest';
import { CATEGORIES, type Category } from '../../src/domain/labels';
import { BUILT_IN_WORDING, CATEGORY_TRIGGER_WORDS, generateTickets } from '../../src/generator/generate';
import { TRAP_WORDS } from '../../src/generator/hardCases';
import type { Template } from '../../src/generator/templates';
import type { Wording } from '../../src/generator/wording';
import { normalizeText } from '../exportDataset';
import { BLIND_WORDING } from './blindFrames';

// Failure messages name a list and a position, never the sentence: the blind
// wording is only a fair test while the people and tools that shape the model
// have not read it.
const KNOWN_SLOTS = new Set(['product', 'plan', 'otherPlan', 'feature', 'amount', 'date', 'days', 'seconds']);
const GREETING_AT_START = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening|day)|to whom|greetings)\b/i;
const SIGN_OFF_ANYWHERE = /\b(?:thanks|thank you|cheers|regards|please advise|appreciate)\b/i;
const SECURITY_ALARM_WORDS = ['hacked', 'unauthorized', 'breach', 'stolen'];
const MIN_GRIEVANCE = 3;
const STREAM_SIZE = 3000;

function named(wording: Wording): [string, string][] {
  const out: [string, string][] = [];
  const add = (list: string, items: readonly (Template | string)[]): void => {
    items.forEach((item, index) => out.push([`${list}[${index}]`, typeof item === 'string' ? item : item.text]));
  };
  for (const category of CATEGORIES) {
    add(`templates.${category}`, wording.templates[category]);
    add(`trapTemplates.${category}`, wording.trapTemplates[category]);
  }
  add('vagueTemplates', wording.vagueTemplates);
  add('politeSecurityTemplates', wording.politeSecurityTemplates);
  add('threatPhrases', wording.threatPhrases);
  add('twoIssueConnectors', wording.twoIssueConnectors);
  add('openers', wording.openers);
  add('closers', wording.closers);
  add('requests', wording.requests);
  return out;
}

const BLIND = named(BLIND_WORDING);

function failing(check: (text: string, name: string) => boolean): string[] {
  return BLIND.filter(([name, text]) => !check(text, name)).map(([name]) => name);
}

describe('the blind wording', () => {
  // Greetings are left out: "Hello," is the same two syllables whoever writes
  // it, it names no category, and people have only a handful of them.
  it('shares no sentence with the wording the models train on, greetings aside', () => {
    const builtIn = new Set(named(BUILT_IN_WORDING).map(([, text]) => normalizeText(text)));
    expect(failing((text, name) => name.startsWith('openers[') || !builtIn.has(normalizeText(text)))).toEqual([]);
  });

  it('repeats no sentence of its own', () => {
    const seen = new Set<string>();
    expect(
      failing((text) => {
        const key = normalizeText(text);
        const fresh = !seen.has(key);
        seen.add(key);
        return fresh;
      }),
    ).toEqual([]);
  });

  it('is plain ASCII and uses only slots the generator can fill', () => {
    expect(failing((text) => /^[\x20-\x7e]+$/.test(text))).toEqual([]);
    expect(failing((text) => [...text.matchAll(/\{([^}]*)\}/g)].every((match) => KNOWN_SLOTS.has(match[1] ?? '')))).toEqual([]);
  });

  it('carries no personal data of its own, which only the generator may add', () => {
    expect(failing((text) => !/@|\b\d{3}[- .]\d{3,4}\b|\bORD-|\d{4} \d{4}/.test(text))).toEqual([]);
  });

  it('keeps greetings and thanks out of the ticket bodies, so they come only from the shared lists', () => {
    const bodies = (name: string): boolean => /^(?:templates|trapTemplates|vagueTemplates|politeSecurityTemplates)/.test(name);
    expect(failing((text, name) => !bodies(name) || (!GREETING_AT_START.test(text) && !SIGN_OFF_ANYWHERE.test(text)))).toEqual([]);
  });

  it('keeps every category word out of the vague tickets', () => {
    const vague = BLIND_WORDING.vagueTemplates.map((template) => template.text.toLowerCase());
    const hits = vague.flatMap((text, index) => (CATEGORY_TRIGGER_WORDS.some((word) => text.includes(word)) ? [index] : []));
    expect(hits).toEqual([]);
  });

  it('gives every trap ticket a trap word that points at another category', () => {
    const misses: string[] = [];
    for (const category of CATEGORIES) {
      BLIND_WORDING.trapTemplates[category].forEach((template, index) => {
        const text = template.text.toLowerCase();
        const pointsElsewhere = Object.entries(TRAP_WORDS).some(([word, suggested]) => text.includes(word) && suggested !== category);
        if (!pointsElsewhere) {
          misses.push(`${category}[${index}]`);
        }
      });
    }
    expect(misses).toEqual([]);
  });

  it('writes polite security reports that no alarm word gives away', () => {
    const hits = BLIND_WORDING.politeSecurityTemplates.flatMap((template, index) =>
      SECURITY_ALARM_WORDS.some((word) => template.text.toLowerCase().includes(word)) ? [index] : [],
    );
    expect(hits).toEqual([]);
  });

  it('sets each flag only where the label rules can use it', () => {
    const wrong: string[] = [];
    const allowed: Record<'severe' | 'billingDispute' | 'statusQuestion', readonly Category[]> = {
      severe: ['Billing', 'Technical Issue'],
      billingDispute: ['Billing'],
      statusQuestion: ['Shipping/Order Issue'],
    };
    for (const category of CATEGORIES) {
      BLIND_WORDING.templates[category].forEach((template, index) => {
        for (const flag of ['severe', 'billingDispute', 'statusQuestion'] as const) {
          if (template[flag] === true && !allowed[flag].includes(category)) {
            wrong.push(`${category}[${index}].${flag}`);
          }
        }
      });
    }
    expect(wrong).toEqual([]);
  });

  it('has an upset ticket in every category for a threat to follow', () => {
    const short = CATEGORIES.filter(
      (category) => BLIND_WORDING.templates[category].filter((template) => template.grievance === true).length < MIN_GRIEVANCE,
    );
    expect(short).toEqual([]);
  });

  it('builds a full stream without an error and with every category and priority in it', () => {
    const tickets = generateTickets(301, STREAM_SIZE, 'all', BLIND_WORDING);
    expect(new Set(tickets.map((ticket) => ticket.label.category)).size).toBe(CATEGORIES.length);
    expect(new Set(tickets.map((ticket) => ticket.label.priority))).toEqual(new Set(['Low', 'Medium', 'High', 'Urgent']));
  });
});
