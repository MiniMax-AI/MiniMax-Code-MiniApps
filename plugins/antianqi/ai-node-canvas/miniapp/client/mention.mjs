// Pure helpers for the inline mention editor.
//
// The caret maths lives here as a plain tree walk so it can be unit tested
// without a browser: `textIndexBefore` only needs `nodeType`, `textContent`,
// `childNodes` and `dataset`, which a tiny fake tree can provide.
//
// A mention chip counts as one character of prompt text.

const TEXT = 3;
const ELEMENT = 1;

function isMentionChip(node) {
  return node?.nodeType === ELEMENT && Boolean(node?.dataset?.mentionNodeId);
}

// Number of prompt characters that precede the caret.
//
// `root` is the editor element, `startContainer` the node holding the caret and
// `startOffset` the offset inside it. When the caret sits in a text node, the
// characters of that node before the caret count; the rest of the tree is
// walked in document order.
export function textIndexBefore(root, startContainer, startOffset) {
  let index = 0;
  const walk = (node) => {
    if (node === startContainer) {
      if (node.nodeType === TEXT) index += startOffset ?? 0;
      return true;
    }
    if (node.nodeType === TEXT) {
      index += (node.textContent ?? '').length;
      return false;
    }
    if (isMentionChip(node)) {
      index += 1;
      return false;
    }
    const children = node.childNodes ?? [];
    for (const child of children) {
      if (walk(child)) return true;
    }
    return false;
  };
  walk(root);
  return index;
}

// Parse an editor's DOM into prompt segments.
//
// A text node contributes a text segment; a mention chip contributes a mention
// segment. Adjacent text segments are merged.
export function parseSegments(editor) {
  const segments = [];
  for (const child of editor.childNodes ?? []) {
    if (child.nodeType === TEXT) {
      const text = child.textContent ?? '';
      if (!text) continue;
      const last = segments[segments.length - 1];
      if (last && last.type === 'text') last.text += text;
      else segments.push({ type: 'text', text });
    } else if (isMentionChip(child)) {
      segments.push({
        type: 'mention',
        nodeId: child.dataset.mentionNodeId,
        kind: child.dataset.mentionKind || 'image',
      });
    }
  }
  return segments;
}

// Flatten segments back into plain prompt text, as a human would read it.
// A mention renders as `@<nodeId>`.
export function plainText(segments) {
  return (segments ?? [])
    .map((segment) => (segment.type === 'text' ? segment.text : `@${segment.nodeId}`))
    .join('');
}

// Flatten segments into the coordinate space the caret maths uses.
// A mention chip is a single token, so it counts as exactly one character.
// Mixing this representation with `plainText` would misalign every offset.
export const MENTION_PLACEHOLDER = '￼';

export function caretText(segments) {
  return (segments ?? [])
    .map((segment) => (segment.type === 'text' ? segment.text : MENTION_PLACEHOLDER))
    .join('');
}

// Detect an in-progress `@` mention before the caret.
// Returns the query string, or null when there is no mention being typed.
export function detectMention(segments, caretIndex) {
  const before = caretText(segments).slice(0, caretIndex);
  const match = /@([^\s@]*)$/.exec(before);
  return match ? match[1] : null;
}
