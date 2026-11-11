import { describe, expect, it } from 'vitest';
import { DESK_WORDING } from './deskFrames';
import { EXTRA_WORDING } from './extraFrames';
import { CATEGORY_TRIGGER_WORDS, type Template } from './templates';
import type { Wording } from './wording';
import { sharedTexts, wordingProblems } from './wordingTestKit';

// The kit is the only reader of the blind wording, which no person or model
// may read before the final scoring. A kit that found nothing would pass that
// wording whatever it held, so each rule is shown to catch a planted break.

function withText(list: readonly Template[], index: number, text: string): Template[] {
  return list.map((template, at) => (at === index ? { ...template, text } : template));
}

function withBillingText(text: string): Wording {
  return { ...EXTRA_WORDING, templates: { ...EXTRA_WORDING.templates, Billing: withText(EXTRA_WORDING.templates.Billing, 0, text) } };
}

describe('the wording rules check', () => {
  it('finds nothing in a wording that keeps the rules', () => {
    expect(wordingProblems(EXTRA_WORDING)).toEqual([]);
  });

  it.each([
    ['an email address', 'Send the corrected invoice to pat@mail.example.net', 'templates.Billing[0]: carries personal data'],
    ['a slot the generator cannot fill', 'My {gadget} was charged twice', 'templates.Billing[0]: unknown slot'],
    ['a greeting inside a ticket body', 'Hello, my invoice shows the wrong total', 'templates.Billing[0]: greets or thanks inside the body'],
    ['a character outside plain ASCII', `My invoice shows the wrong total ${String.fromCodePoint(0x2013)} again`, 'templates.Billing[0]: not plain ASCII'],
  ])('names the list and position of %s', (_what, text, problem) => {
    expect(wordingProblems(withBillingText(text))).toContain(problem);
  });

  it('names a sentence that is in the wording twice, whatever its case or punctuation', () => {
    const first = EXTRA_WORDING.vagueTemplates[0]?.text ?? '';
    const twice = { ...EXTRA_WORDING, vagueTemplates: withText(EXTRA_WORDING.vagueTemplates, 1, `${first.toUpperCase()} !`) };
    expect(first).not.toBe('');
    expect(wordingProblems(twice)).toContain('vagueTemplates[1]: repeats a sentence');
  });

  // A vague ticket must give a model nothing to route on. A category word in
  // it would make the "vague" hard case easy.
  it('names a vague ticket that carries a category word', () => {
    const word = CATEGORY_TRIGGER_WORDS[0] ?? '';
    const leaking = { ...EXTRA_WORDING, vagueTemplates: withText(EXTRA_WORDING.vagueTemplates, 2, `Something about my ${word} is off`) };
    expect(word).not.toBe('');
    expect(wordingProblems(leaking)).toContain('vagueTemplates[2]: carries a category word');
  });
});

describe('the shared sentence check', () => {
  it('names a ticket sentence two wordings share, whatever its case or punctuation', () => {
    const theirs = DESK_WORDING.templates.Billing[3]?.text ?? '';
    expect(theirs).not.toBe('');
    expect(sharedTexts(withBillingText(`  ${theirs.toUpperCase()} `), DESK_WORDING)).toEqual(['templates.Billing[0]']);
  });

  it('lets two wordings share a greeting, which names no category', () => {
    const opener = DESK_WORDING.openers[0] ?? '';
    const greeting: Wording = { ...EXTRA_WORDING, openers: [opener, ...EXTRA_WORDING.openers.slice(1)] };
    expect(opener).not.toBe('');
    expect(sharedTexts(greeting, DESK_WORDING)).toEqual([]);
  });
});
