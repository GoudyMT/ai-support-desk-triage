import type { Category, Priority, ReviewReason, TicketLabel } from './labels';
import { RISK_ORDER } from './labels';

// What the generator knows about a ticket it wrote. `issues` holds one or two
// categories and never Urgent Complaint for a threat: the threat is the flag.
export interface TicketFacts {
  issues: Category[];
  threatening: boolean;
  vague: boolean;
  billingDispute: boolean;
  severe: boolean;
  statusQuestion: boolean;
}

export function primaryCategory(issues: Category[]): Category {
  const primary = RISK_ORDER.find((category) => issues.includes(category));
  if (primary === undefined) {
    throw new Error('E_NO_ISSUES');
  }
  return primary;
}

function priorityFor(category: Category, facts: TicketFacts): Priority {
  switch (category) {
    case 'Security Concern':
      return 'Urgent';
    case 'Accessibility Support':
    case 'Account Access':
    case 'Urgent Complaint':
      return 'High';
    case 'Billing':
    case 'Technical Issue':
      return facts.severe ? 'High' : 'Medium';
    case 'Shipping/Order Issue':
      return facts.statusQuestion ? 'Low' : 'Medium';
    case 'Product Question':
    case 'Other':
      return 'Low';
  }
}

function reviewReasonFor(category: Category, facts: TicketFacts): ReviewReason | undefined {
  switch (category) {
    case 'Security Concern':
      return 'security incident';
    case 'Accessibility Support':
      return 'accessibility issue';
    case 'Billing':
      return facts.billingDispute ? 'billing dispute' : undefined;
    case 'Urgent Complaint':
      return 'escalated complaint';
    default:
      return undefined;
  }
}

export function labelTicket(facts: TicketFacts): TicketLabel {
  if (facts.threatening) {
    const underlying = primaryCategory(facts.issues);
    const threatLabel: TicketLabel = {
      category: 'Urgent Complaint',
      priority: 'Urgent',
      mustReview: true,
      reviewReason: 'threatening language',
    };
    // A secondary equal to the category says nothing, so it is left out.
    if (underlying !== 'Urgent Complaint') {
      threatLabel.secondary = underlying;
    }
    return threatLabel;
  }
  if (facts.vague) {
    return {
      category: 'Other',
      priority: 'Medium',
      mustReview: true,
      reviewReason: 'vague ticket',
    };
  }

  const category = primaryCategory(facts.issues);
  const secondary = facts.issues.find((issue) => issue !== category);
  const reviewReason = reviewReasonFor(category, facts);
  const label: TicketLabel = {
    category,
    priority: priorityFor(category, facts),
    mustReview: reviewReason !== undefined,
  };
  if (secondary !== undefined) {
    label.secondary = secondary;
  }
  if (reviewReason !== undefined) {
    label.reviewReason = reviewReason;
  }
  return label;
}
