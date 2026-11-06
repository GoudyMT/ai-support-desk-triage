// The words of Try a ticket, in one place so the privacy line can be read and checked as written.
import { MAX_TICKET_CHARS } from '../pipeline/intake';

export const TRY_HEADING = 'Try a ticket yourself';
export const TRY_LABEL = 'Type any support message. It stays in this page and is never sent or kept.';
export const TRY_SORT = 'Sort this ticket';
export const TRY_LOADING = 'Loading...';
export const TRY_RETRY = 'Retry';
export const TRY_CLOSE = 'Close';
export const TRY_PRIVACY =
  'Before the model reads a ticket, we hide email addresses, phone numbers, order numbers and card-like numbers. ' +
  'Names and street addresses are not hidden. Nothing you type is saved or sent.';
// The result's row names, in the order they are shown.
export const TRY_ROWS = ['Category', 'Priority', 'Team', 'Person needed'] as const;
export const TRY_WARNING = 'These are suggestions. A person must check them before anything reaches a customer.';
export const TRY_EMPTY = 'Type a support message first, then press Sort this ticket.';
export const TRY_TOO_LONG =
  `That message is over the ${MAX_TICKET_CHARS.toLocaleString('en-US')} character limit. ` +
  'Shorten it, then press Sort this ticket.';
export const TRY_LOAD_FAILED = 'The sorting model could not be loaded. Check your connection, then press Retry.';
