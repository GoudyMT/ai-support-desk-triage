// Info icons. A tip is a small button with its words in a box the page already holds, hidden; this only shows, hides and
// places that box, so the words never pass through script. One tip is open at a time. It opens on hover, on keyboard
// focus and on a tap, and closes on Escape, on blur, when the pointer leaves, on a tap elsewhere and on a second tap.

export type TipEvent =
  | { kind: 'show'; id: string }
  | { kind: 'hide'; id: string }
  | { kind: 'tap'; id: string; wasOpen: boolean }
  | { kind: 'escape' };

// Which tip is open after an event. A tip that is left closes only if it is the open one: a blur can arrive after the next
// tip has opened, and must not close that one.
export function nextTip(open: string | undefined, event: TipEvent): string | undefined {
  switch (event.kind) {
    case 'show':
      return event.id;
    case 'hide':
      return open === event.id ? undefined : open;
    case 'tap':
      return event.wasOpen ? undefined : event.id;
    case 'escape':
      return undefined;
  }
}

// The gap kept between a box and the screen's edge, and between a box and its icon.
const EDGE_PX = 8;
const GAP_PX = 6;

const iconOf = (node: EventTarget | null): HTMLElement | null => (node instanceof Element ? node.closest<HTMLElement>('.tip') : null);

// The id of the box a node belongs to, whether the node is the icon (which names its box) or the box itself.
function tipId(node: EventTarget | null): string | undefined {
  const id = iconOf(node)?.getAttribute('aria-describedby') ?? (node instanceof Element ? node.closest('.tipbox')?.id : undefined);
  return id === '' ? undefined : id;
}

// The box goes below its icon, or above when there is no room below, and sideways to stay on the screen, which a list or
// panel scrolled under the icon cannot change. It is fixed to the screen, so it takes no room in the page and no list or
// panel can cut it off.
function place(icon: HTMLElement, box: HTMLElement): void {
  box.hidden = false;
  const at = icon.getBoundingClientRect();
  const wide = document.documentElement.clientWidth;
  const below = at.bottom + GAP_PX;
  const room = window.innerHeight - box.offsetHeight - EDGE_PX;
  const top = below <= room ? below : at.top - GAP_PX - box.offsetHeight;
  box.style.left = `${Math.max(EDGE_PX, Math.min(at.left, wide - box.offsetWidth - EDGE_PX))}px`;
  box.style.top = `${Math.max(EDGE_PX, Math.min(top, room))}px`;
}

export function initTips(): void {
  let open: string | undefined;
  let anchor: HTMLElement | null = null;
  // Whether the tip was open when the pointer went down on its icon: the press itself gives the icon focus, which opens
  // it, so only this says whether the tap that follows is a first tap or a second.
  let wasOpen = false;

  function send(event: TipEvent, icon?: HTMLElement | null): void {
    const before = open;
    open = nextTip(before, event);
    if (before !== undefined && before !== open) {
      const shut = document.getElementById(before);
      if (shut !== null) shut.hidden = true;
    }
    if (open !== before && icon) anchor = icon;
    follow();
  }

  function follow(): void {
    const box = open === undefined ? null : document.getElementById(open);
    if (box !== null && anchor !== null) place(anchor, box);
  }

  const close = (): void => send({ kind: 'escape' });
  const onShow = (event: Event): void => {
    const id = tipId(event.target);
    if (id !== undefined && id !== open) send({ kind: 'show', id }, iconOf(event.target));
  };

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'touch') onShow(event);
  });
  document.addEventListener('pointerout', (event) => {
    const id = tipId(event.target);
    if (id !== undefined && id !== tipId(event.relatedTarget)) send({ kind: 'hide', id });
  });
  document.addEventListener('focusin', onShow);
  document.addEventListener('focusout', (event) => {
    const id = tipId(event.target);
    if (id !== undefined) send({ kind: 'hide', id });
  });
  document.addEventListener('pointerdown', (event) => {
    const id = tipId(event.target);
    if (id === undefined) close();
    wasOpen = id !== undefined && id === open;
  });
  document.addEventListener('click', (event) => {
    const icon = iconOf(event.target);
    const id = tipId(event.target);
    // A key press has no pointer going down before it, and the icon is open already from its focus.
    const was = event.detail === 0 ? id === open : wasOpen;
    wasOpen = false;
    if (icon !== null && id !== undefined) send({ kind: 'tap', id, wasOpen: was }, icon);
  });
  // In the capture phase and before a review card or form underneath hears the key: Escape closes the tip and nothing else.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || open === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    },
    true,
  );
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
}
