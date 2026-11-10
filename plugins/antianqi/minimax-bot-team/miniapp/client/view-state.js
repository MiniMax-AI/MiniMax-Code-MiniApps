// @ts-check
// Keep stable message parts mounted. A streaming update should not restart a player,
// close a disclosure or replace an unrelated questionnaire the user is answering.
const children = new WeakMap();

/** @typedef {{ key: string, signature: string, create: () => HTMLElement, update?: (node: HTMLElement) => HTMLElement }} View */

/** @param {HTMLElement} parent @param {View} view */
export function reconcileChild(parent, view) {
  const entries = children.get(parent) ?? new Map();
  const previous = entries.get(view.key);
  let node = previous?.node?.parentNode === parent ? previous.node : undefined;
  const created = !node;
  if (!node || previous.signature !== view.signature) {
    const old = node;
    node = old && view.update ? view.update(old) : view.create();
    if (old && node !== old) {
      if (old.tagName === 'DETAILS' && node.tagName === 'DETAILS') node.open = old.open;
      for (const disclosure of old.querySelectorAll('details[data-disclosure]')) {
        const next = [...node.querySelectorAll('details[data-disclosure]')].find((candidate) => candidate.dataset.disclosure === disclosure.dataset.disclosure);
        if (next) next.open = disclosure.open;
      }
      old.replaceWith(node);
    }
  }
  entries.set(view.key, { signature: view.signature, node });
  children.set(parent, entries);
  if (created) parent.append(node);
  return { node, created };
}

/** @param {HTMLElement} parent @param {View[]} views */
export function reconcileChildren(parent, views) {
  const keep = new Set();
  let previous = null;
  for (const view of views) {
    const { node } = reconcileChild(parent, view);
    keep.add(view.key);
    // Reconciliation may replace the node that occupied this position. Resolve the
    // anchor afterwards, from the last node already placed in the desired order.
    const anchor = previous ? previous.nextSibling : parent.firstChild;
    if (node !== anchor) parent.insertBefore(node, anchor);
    previous = node;
  }
  let cursor = previous ? previous.nextSibling : parent.firstChild;
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
  const entries = children.get(parent);
  if (entries) for (const key of entries.keys()) if (!keep.has(key)) entries.delete(key);
}
