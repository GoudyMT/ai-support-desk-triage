interface Targets {
  form: { focus(): void };
  center: { focusResult(): void };
  controls: { focusPrimary(): void };
}

// A control a viewer can still use: in the page, drawn, and not disabled.
function usable(node: Element | null): node is HTMLElement {
  return node instanceof HTMLElement && node !== document.body && node.isConnected && node.getClientRects().length > 0 && !node.matches(':disabled');
}

/**
 * Keeps keyboard focus on a control after every render. `before` runs just before the panels
 * render and notes where focus is; `after` runs once they have.
 *
 * A render can remove, hide or disable the control a viewer was on (the reviewer closes the card
 * whose Review button has focus; the busy day starts and Why this choice goes; the run completes
 * and Play is disabled). Focus would fall to the body, back to the top of the page for a keyboard
 * or screen reader user, so it moves to the next Review button, or else to the primary control.
 * It does nothing when nothing had focus, and nothing while the review form is open or a result
 * has just taken focus.
 */
export function createFocus(targets: Targets): { before(): void; after(reviewing: boolean, finished: boolean): void } {
  let held: Element | null = null;
  let wasReviewing = false;
  let wasFinished = false;
  return {
    before() {
      held = document.activeElement === document.body ? null : document.activeElement;
    },
    after(reviewing, finished) {
      if (reviewing && !wasReviewing) targets.form.focus();
      if (finished && !wasFinished) targets.center.focusResult();
      const lost = held !== null && !usable(document.activeElement);
      if (lost && !reviewing) {
        const next = document.querySelector<HTMLElement>('#outgoing .open button:not(:disabled)');
        if (usable(next)) next.focus();
        else targets.controls.focusPrimary();
      }
      wasReviewing = reviewing;
      wasFinished = finished;
      held = null;
    },
  };
}
