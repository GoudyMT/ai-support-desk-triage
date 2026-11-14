import type { V0Result } from '../baseline/v0';
import type { Category, Priority, ReviewReason } from '../domain/labels';
import type { Prediction } from '../model/scorer';
import type { MaskKind } from '../privacy/mask';

export type FlagReason =
  | { kind: 'rule'; reason: ReviewReason; words: string[] }
  | { kind: 'category'; category: Category }
  | { kind: 'low confidence'; confidence: number };

export interface IntakeRecord {
  id: string;
  receivedAt: number;
  text: string;
}

export interface GuardResult {
  flagged: boolean;
  reasons: FlagReason[];
  priority: Priority;
  clearedBySecondCheck: boolean;
}

export interface ReviewInput {
  id: string;
  maskedText: string;
  suggestion: { category: Category; priority: Priority };
  reasons: FlagReason[];
}

export interface ReviewDecision {
  category: Category;
  priority: Priority;
  route: string;
  reason?: string;
}

export interface Reviewer {
  decide(input: ReviewInput): ReviewDecision;
}

export interface TicketTrail {
  id: string;
  receivedAt: number;
  maskedText: string;
  found: MaskKind[];
  category: Prediction;
  priority: Prediction;
  guard: GuardResult;
  review?: ReviewDecision;
  final: { category: Category; priority: Priority; route: string; by: 'model' | 'reviewer' };
  // On the desk, each model's own answer; the sentence model's is the suggestion a person sees.
  models?: { word: { category: Category; priority: Priority }; sentence: { category: Category; priority: Priority } };
  v0: V0Result;
  ms: number;
}
