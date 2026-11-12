/**
 * Where the clip strip goes.
 *
 * The clip strip is the material itself, so it belongs to the card: it sits
 * under the card, centred on it, the way the reference product puts its
 * trimming strip under the node. It never lands on the card — a strip that
 * covers the picture it is about to cut hides the very thing the user is
 * choosing from.
 *
 * When there is no room under the card the strip goes above it instead, so
 * it always stays on screen.
 */

const GAP = 8;
const MARGIN = 8;

/**
 * The box a panel hangs off.
 *
 * A clip panel hangs off the card it belongs to; every other panel hangs
 * off the button that opened it, right under it.
 *
 * The rule is here so the page and the tests read the same one: the clip
 * panel used to be placed by the button, and the button sits above the card,
 * so the panel dropped straight onto the picture it was about to cut.
 */
export function panelAnchor({ isClip = false, card = null, button = null } = {}) {
  if (isClip && card) return { kind: 'card', card };
  if (button) return { kind: 'button', button };
  return { kind: 'viewport' };
}

/**
 * The spot a clip strip takes on the screen.
 */
export function clipPlacement({ card, size, viewport }) {
  if (!card || !size || !viewport) return { left: MARGIN, top: MARGIN, side: 'below' };
  const width = Math.max(1, Number(size.width) || 0);
  const height = Math.max(1, Number(size.height) || 0);

  // Centred on the card, then kept inside the window: a card near the edge
  // must not push half the strip off screen.
  const centred = card.left + (card.width - width) / 2;
  const left = Math.min(
    Math.max(centred, MARGIN),
    Math.max(MARGIN, viewport.width - width - MARGIN),
  );

  const below = card.bottom + GAP;
  const above = card.top - height - GAP;
  const fitsBelow = below + height <= viewport.height - MARGIN;
  const side = fitsBelow ? 'below' : 'above';
  const top = side === 'below' ? below : Math.max(MARGIN, above);

  return { left, top, side };
}
