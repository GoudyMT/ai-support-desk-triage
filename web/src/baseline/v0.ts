import type { Category, Priority } from '../domain/labels';

export interface V0Result {
  category: Category;
  priority: Priority;
  mustReview: boolean;
}

// The keyword rules of the original course prototype page, kept exactly - including
// the quirks - because the model is measured against what that page really did.
// Each block overwrites the one before it, and only billing, security and
// accessibility ever set the review flag, so a later block can change the category
// and leave an earlier flag standing. Do not fix anything here.
export function v0Triage(text: string): V0Result {
  const lower = text.trim().toLowerCase();
  let category: Category = 'Other';
  let priority: Priority = 'Medium';
  let mustReview = false;
  if (!lower) return { category, priority, mustReview };

  if (
    lower.includes('charge') ||
    lower.includes('billed') ||
    lower.includes('billing') ||
    lower.includes('subscription') ||
    lower.includes('refund')
  ) {
    category = 'Billing';
    priority = 'Medium';
    mustReview = true;
  }
  if (
    lower.includes('access') ||
    lower.includes('login') ||
    lower.includes('password') ||
    lower.includes('account') ||
    lower.includes('credentials')
  ) {
    category = 'Account Access';
    priority = 'High';
    if (
      lower.includes('someone') ||
      lower.includes('unauthorized') ||
      lower.includes('hacked') ||
      lower.includes('permission')
    ) {
      category = 'Security Concern';
      priority = 'Urgent';
      mustReview = true;
    }
  }
  if (
    lower.includes('crash') ||
    lower.includes('error') ||
    lower.includes('bug') ||
    lower.includes('upload') ||
    lower.includes('not working')
  ) {
    category = 'Technical Issue';
    priority = 'High';
  }
  if (lower.includes('screen reader') || lower.includes('accessibility') || lower.includes('ada')) {
    category = 'Accessibility Support';
    priority = 'High';
    mustReview = true;
  }

  return { category, priority, mustReview };
}
