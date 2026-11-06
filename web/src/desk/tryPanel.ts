// Try a ticket: a box, a Sort button and the result. Every value goes in with textContent, because the visitor's words
// are data. What was typed is read once into a local variable and the box is then replaced by a new one holding the
// masked text, so the typed words are not left on screen, in the page or in the old box's undo history.
import type { Model } from '../model/scorer';
import { button, el } from '../page/dom';
import { fetchShipped } from '../page/fetchModel';
import {
  TRY_CLOSE,
  TRY_EMPTY,
  TRY_HEADING,
  TRY_LABEL,
  TRY_LOAD_FAILED,
  TRY_LOADING,
  TRY_PRIVACY,
  TRY_RETRY,
  TRY_ROWS,
  TRY_SORT,
  TRY_TOO_LONG,
  TRY_WARNING,
} from './copy';
import { refusal, tryTicket } from './tryTicket';

export interface TryModal {
  open(): void;
  isOpen(): boolean;
}

// The text-hiding style of a screen-reader-only element, as the demo's shared class sets it.
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 'var(--sr-size)',
  height: 'var(--sr-size)',
  margin: 'calc(-1 * var(--sr-size))',
  padding: '0',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};

// Loaded the first time a valid ticket is sorted and kept for the page; a failed load leaves it unset so Retry asks again.
let shipped: Model | undefined;

export function createTryPanel(): HTMLElement {
  const title = el('h2', 'try-title', TRY_HEADING);
  title.id = 'try-title';
  const label = el('label', undefined, TRY_LABEL);
  label.htmlFor = 'try-text';
  let box = el('textarea');
  box.id = 'try-text';
  box.rows = 4;
  box.autocomplete = 'off';
  // Some browsers send a box's text to a service to check its spelling.
  box.spellcheck = false;
  box.setAttribute('aria-describedby', 'try-error try-privacy');
  const field = el('div', 'field');
  field.append(label, box);
  const error = el('p', 'try-error');
  error.id = 'try-error';
  error.setAttribute('role', 'alert');
  const sort = button('btn', TRY_SORT);
  const privacy = el('p', 'try-privacy', TRY_PRIVACY);
  privacy.id = 'try-privacy';
  const result = el('dl', 'try-result');
  result.hidden = true;
  const values = TRY_ROWS.map((name) => {
    const value = el('dd');
    result.append(el('dt', undefined, name), value);
    return value;
  });
  const warning = el('p', 'try-warning', TRY_WARNING);
  warning.hidden = true;
  // The result as one sentence for a screen reader. It lives in the panel, which moves into the dialog, because the
  // desk's own live region is behind the dialog while it is open. The desk's shared hidden-text class is in a
  // stylesheet this page does not load, so the style is set here.
  const spoken = el('p');
  spoken.setAttribute('role', 'status');
  Object.assign(spoken.style, VISUALLY_HIDDEN);
  const section = el('section', 'try');
  section.setAttribute('aria-labelledby', title.id);
  section.append(title, field, error, sort, privacy, result, warning, spoken);

  // An old answer is never left beside a message about the new ticket.
  function refuse(message: string): void {
    error.textContent = message;
    result.hidden = true;
    warning.hidden = true;
    spoken.textContent = '';
    sort.textContent = TRY_SORT;
  }

  async function sortTicket(): Promise<void> {
    const typed = box.value;
    const refused = refusal(typed);
    if (refused !== undefined) {
      refuse(refused === 'empty' ? TRY_EMPTY : TRY_TOO_LONG);
      return;
    }
    error.textContent = '';
    if (shipped === undefined) {
      const hadFocus = document.activeElement === sort;
      sort.disabled = true;
      sort.textContent = TRY_LOADING;
      box.readOnly = true;
      try {
        shipped = await fetchShipped();
        sort.textContent = TRY_SORT;
      } catch {
        refuse(TRY_LOAD_FAILED);
        sort.textContent = TRY_RETRY;
      } finally {
        sort.disabled = false;
        box.readOnly = false;
        if (hadFocus) sort.focus();
      }
      if (shipped === undefined) return;
    }
    const view = tryTicket(typed, shipped);
    // A box that is only given new text keeps its edit history, and undo and redo would bring the typed words back.
    const masked = box.cloneNode(false) as HTMLTextAreaElement;
    masked.value = view.text;
    box.replaceWith(masked);
    box = masked;
    spoken.textContent = view.spoken;
    [view.category, view.priority, view.team, view.person].forEach((text, at) => {
      const value = values[at];
      if (value !== undefined) value.textContent = text;
    });
    result.hidden = false;
    warning.hidden = false;
  }

  sort.addEventListener('click', () => {
    void sortTicket();
  });
  return section;
}

// The panel in a modal over the desk, for use during a run. The panel is moved into the modal while it is open and back
// to `home` when it closes, so there is one box and one set of ids. Escape and Close both end in the dialog's close
// event.
export function createTryModal(panel: HTMLElement, home: HTMLElement, onClose: () => void): TryModal {
  const close = button('btn', TRY_CLOSE);
  const actions = el('div', 'try-actions');
  actions.append(close);
  const dialog = el('dialog', 'try-dialog');
  dialog.setAttribute('aria-labelledby', 'try-title');
  document.body.append(dialog);
  close.addEventListener('click', () => {
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    home.append(panel);
    onClose();
  });
  return {
    open() {
      dialog.replaceChildren(panel, actions);
      dialog.showModal();
    },
    isOpen: () => dialog.open,
  };
}
