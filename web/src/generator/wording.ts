import type { Category } from '../domain/labels';
import type { Template } from './templates';

// Every list of words the generator draws from to write a ticket's text, as one
// value. A stream built from a second Wording is meant to share no ticket
// sentence with the stream the models train on, which is what a test of unseen
// wording needs; a wording's own test proves it, greetings aside. The named
// slots (product, plan, feature, month) and the fake personal data are not
// wording: they are the same fictional product in every stream.
export interface Wording {
  templates: Record<Category, readonly Template[]>;
  trapTemplates: Record<Category, readonly Template[]>;
  vagueTemplates: readonly Template[];
  politeSecurityTemplates: readonly Template[];
  threatPhrases: readonly string[];
  twoIssueConnectors: readonly string[];
  openers: readonly string[];
  closers: readonly string[];
  requests: readonly string[];
}
