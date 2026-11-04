import type { Segment } from './view';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error('E_PAGE_MARKUP');
  }
  return node;
}

// Writing a value the node already holds still makes the browser re-lay it out, so a render
// on every event only writes what changed.
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) {
    node.textContent = text;
  }
}

export function setClass(node: Element, className: string): void {
  if (node.className !== className) {
    node.className = className;
  }
}

// A chip, a rule word and a mask token each differ in shape as well as color (underline,
// outline, monospace), so none is shown by color alone.
export function segmentNodes(segments: readonly Segment[]): Node[] {
  return segments.map((segment) =>
    segment.kind === 'plain' ? document.createTextNode(segment.text) : el('span', segment.kind, segment.text),
  );
}

const KEPT = new WeakMap<HTMLElement, Map<string, HTMLElement>>();

/**
 * Makes `parent` hold one node per item, in item order, building a node only for a new key.
 *
 * A node already there is updated in place and moved only when it is out of place, because
 * a browser drops focus from a node that is removed and put back. That keeps a Review
 * button a viewer has focused while the list around it changes. `parent` must hold nothing
 * but the nodes this function made.
 */
export function reconcile<T>(
  parent: HTMLElement,
  items: readonly T[],
  key: (item: T) => string,
  make: (item: T) => HTMLElement,
  update: (node: HTMLElement, item: T) => void,
): void {
  const kept = KEPT.get(parent) ?? new Map<string, HTMLElement>();
  KEPT.set(parent, kept);
  const wanted = new Set(items.map(key));
  for (const [id, node] of kept) {
    if (!wanted.has(id)) {
      node.remove();
      kept.delete(id);
    }
  }
  items.forEach((item, at) => {
    const id = key(item);
    let node = kept.get(id);
    if (node === undefined) {
      node = make(item);
      kept.set(id, node);
    }
    update(node, item);
    if (parent.children[at] !== node) {
      parent.insertBefore(node, parent.children[at] ?? null);
    }
  });
}
