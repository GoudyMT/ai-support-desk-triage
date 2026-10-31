import { describe, expect, it } from 'vitest';
import type { ReviewReason } from '../domain/labels';
import { matchRules, RULE_PRIORITY } from './rules';

// One plain sentence per reason, as a customer would write it. Each must fire
// its own reason and no other, so a rule list that bleeds into a neighbour's
// topic shows up here.
const PLAIN_SENTENCES: [ReviewReason, string, string[]][] = [
  ['security incident', 'someone hacked my account last night', ['hacked']],
  ['accessibility issue', 'the screen reader skips the checkout button', ['screen reader']],
  ['billing dispute', 'i want a refund for this month', ['refund']],
  ['threatening language', 'fix this or i will sue you', ['sue']],
  ['escalated complaint', 'this is unacceptable', ['unacceptable']],
  ['vague ticket', 'something is wrong with it', ['something is wrong']],
];

describe('matchRules', () => {
  it.each(PLAIN_SENTENCES)(
    'a plain %s sentence fires that reason alone, with the words it used',
    (reason, sentence, words) => {
      // The pipeline flags on these; a missed reason is a sensitive ticket nobody reviews.
      expect(matchRules(sentence)).toEqual([{ reason, words }]);
    },
  );

  it('does not read the word "card" inside a masked card number', () => {
    // Masked text carries tokens such as [CARD_NUMBER]; their inner words are
    // the masker's, not the customer's, and must never trigger a rule.
    expect(matchRules('my [CARD_NUMBER] was saved')).toEqual([]);
  });

  it('does not read "charge" inside "charger" as a billing dispute', () => {
    // A customer asking about a phone charger is not disputing a bill.
    expect(matchRules('is my charger covered?')).toEqual([]);
  });

  it('does not read "hack" inside "hackathon" as a security incident', () => {
    // A hackathon event is not a break-in; it would flag as Urgent for nothing.
    expect(matchRules('we are hosting a hackathon')).toEqual([]);
  });

  it.each([
    ['curly right quote', 0x2019],
    ['curly left quote', 0x2018],
  ])('reads a %s as an apostrophe', (_name, codePoint) => {
    // Phones and word processors turn typed apostrophes into curly ones; the
    // customer who writes it that way must flag like the one who does not.
    // Built from a code point so this file stays ASCII.
    const text = `i didn${String.fromCharCode(codePoint)}t log in`;
    expect(matchRules(text)).toEqual([{ reason: 'security incident', words: ["didn't log in"] }]);
  });

  it.each([
    ['a hyphen', 'the screen-reader skips the button'],
    ['a line break', 'the screen\nreader skips the button'],
  ])('matches a phrase written with %s between its words', (_name, text) => {
    // Pasted tickets wrap lines and people hyphenate; the phrase must still fire.
    expect(matchRules(text)).toEqual([{ reason: 'accessibility issue', words: ['screen reader'] }]);
  });

  it.each([
    ['i was charged twice', ['charged', 'charged twice']],
    ['i paid twice for my plan', ['paid twice']],
    ['i was double charged', ['charged', 'double charged']],
  ])('flags a duplicate charge: %s', (text, words) => {
    // The labeling rules count a duplicate charge as a billing dispute.
    expect(matchRules(text)).toEqual([{ reason: 'billing dispute', words }]);
  });

  it('files "useless" under a complaint, not a threat', () => {
    // A product called useless is an unhappy customer; calling it a threat
    // would raise the ticket to Urgent.
    expect(matchRules('the export button is useless when the file is large')).toEqual([
      { reason: 'escalated complaint', words: ['useless'] },
    ]);
  });

  it.each([
    'after switching to dark mode the app crashes',
    'how do i go about cancelling my order?',
    'in contrast to last month, the page loads slowly',
    'i use a password manager and autofill fails on login',
  ])('does not flag an everyday sentence: %s', (text) => {
    // Each uses a word that reads as a leaving, accessibility or manager cue in
    // other sentences; here it is routine and must not be flagged.
    expect(matchRules(text)).toEqual([]);
  });

  it('returns both reasons for a threat inside a billing dispute, in union order', () => {
    // Billing comes before threatening language in ReviewReason; the pipeline
    // records every reason and the higher priority must win later.
    expect(matchRules('refund my money or i will sue you')).toEqual([
      { reason: 'billing dispute', words: ['refund'] },
      { reason: 'threatening language', words: ['sue'] },
    ]);
  });

  it('matches regardless of letter case', () => {
    // Customers shout; "HACKED" must flag like "hacked".
    expect(matchRules('SOMEONE HACKED MY ACCOUNT')).toEqual([
      { reason: 'security incident', words: ['hacked'] },
    ]);
  });
});

describe('RULE_PRIORITY', () => {
  it('holds the priority each reason raises a ticket to', () => {
    // These are the owner-set floors shown before a reviewer sees the ticket.
    expect(RULE_PRIORITY).toEqual({
      'security incident': 'Urgent',
      'threatening language': 'Urgent',
      'accessibility issue': 'High',
      'escalated complaint': 'High',
      'billing dispute': 'Medium',
      'vague ticket': 'Medium',
    });
  });
});
