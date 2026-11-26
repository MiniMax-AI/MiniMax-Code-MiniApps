// The immersive mode: the chrome gets out of the way and the canvas takes
// the whole surface.
//
// One rule, one reader: the keyboard says what a key means, and the page
// does what that meaning is. If the page read the keys itself, the key on
// the keyboard and the key in the README would drift apart.

/**
 * What a key means for the immersive mode.
 *
 * `toggle` asks for the mode or leaves it, `exit` leaves it, and an empty
 * answer means the key is none of this mode's business.
 *
 * The mode is a mode and not an overlay, so its own key works whatever else
 * is open. Escape is the other way round: it closes whatever is open first,
 * and only then does it leave the mode.
 *
 * @param {{ key?: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} event
 * @param {{ immersive?: boolean }} state
 * @returns {'toggle' | 'exit' | ''}
 */
export function immersiveAction(event, state = {}) {
  if (!event) return '';
  const key = event.key ?? '';
  if (key === 'F11') return 'toggle';
  // The host may take F11 for itself, so the same verb has a second key.
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === 'f' || key === 'F')) {
    return 'toggle';
  }
  if (key === 'Escape' && state.immersive) return 'exit';
  return '';
}
