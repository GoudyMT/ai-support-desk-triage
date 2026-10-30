export const CATEGORIES = [
  'Billing',
  'Technical Issue',
  'Account Access',
  'Security Concern',
  'Accessibility Support',
  'Product Question',
  'Urgent Complaint',
  'Shipping/Order Issue',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;

export type Priority = (typeof PRIORITIES)[number];

// When a ticket raises two issues, the one earlier here is its category.
// Ordered by the harm of answering it wrongly, highest first.
export const RISK_ORDER: readonly Category[] = [
  'Security Concern',
  'Accessibility Support',
  'Urgent Complaint',
  'Billing',
  'Account Access',
  'Technical Issue',
  'Shipping/Order Issue',
  'Product Question',
  'Other',
];

export type ReviewReason =
  | 'security incident'
  | 'accessibility issue'
  | 'billing dispute'
  | 'threatening language'
  | 'escalated complaint'
  | 'vague ticket';

export const ROUTES: Record<Category, string> = {
  Billing: 'Billing Team',
  'Technical Issue': 'Technical Support',
  'Account Access': 'Account Support',
  'Security Concern': 'Security Team',
  'Accessibility Support': 'Accessibility Team',
  'Product Question': 'Product Specialists',
  'Urgent Complaint': 'Escalations Team',
  'Shipping/Order Issue': 'Fulfillment Team',
  Other: 'General Support',
};

export interface TicketLabel {
  category: Category;
  secondary?: Category;
  priority: Priority;
  mustReview: boolean;
  reviewReason?: ReviewReason;
}
