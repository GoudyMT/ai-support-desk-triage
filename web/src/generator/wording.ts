import type { Category } from '../domain/labels';
import type { Template } from './templates';

// Every list of words the generator draws from to write a ticket's text, as one
// value. A ticket stream built from a different Wording shares no sentence with
// the stream the models train on, which is what a test of unseen wording needs.
// The named slots (product, plan, feature, month) and the fake personal data are
// not wording: they are the same fictional product in every stream.
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
