/**
 * Called only after manual pop-out. The safe interaction patch must settle in its own frame:
 * an invalid geometry patch is atomically rejected along with every field merged into that frame.
 */
export async function restoreWindowPosition(handle, position, { isCurrent = () => true } = {}) {
  const result = { restored: false, interactive: false, cancelled: false, error: null, state: null };
  if (!isCurrent()) return { ...result, cancelled: true };
  try {
    const safeState = await handle.update({ clickThrough: false });
    if (!isCurrent()) return { ...result, interactive: true, cancelled: true };
    result.interactive = true;
    result.state = safeState;
    if (!position) return result;
    const state = await handle.update({ x: position.x, y: position.y });
    if (!isCurrent()) return { ...result, cancelled: true };
    return { ...result, restored: true, state };
  } catch (error) {
    if (!isCurrent()) return { ...result, cancelled: true };
    return { ...result, error: error?.code || error?.message || 'result_unknown' };
  }
}

/** Fit the complete transparent content area, not only the Host's minimum overlap. */
export async function fitWindowToScreen(handle, { screenRect, isCurrent = () => true } = {}) {
  const cancelled = () => ({ cancelled: true, error: null, state: null });
  if (!isCurrent()) return cancelled();
  try {
    const state = await handle.getState();
    if (!isCurrent()) return cancelled();
    const bounds = state?.window, rect = screenRect?.();
    if (state?.mode !== 'window') return cancelled();
    const finite = (value) => Number.isFinite(value);
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(finite)
      || bounds.width <= 0 || bounds.height <= 0) return { error: 'invalid_state' };
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite)
      || rect.width <= 0 || rect.height <= 0) return { error: 'screen_unavailable' };
    if (bounds.width > rect.width || bounds.height > rect.height) return { error: 'screen_too_small' };
    const x = Math.ceil(Math.max(rect.x, Math.min(bounds.x, rect.x + rect.width - bounds.width)));
    const y = Math.ceil(Math.max(rect.y, Math.min(bounds.y, rect.y + rect.height - bounds.height)));
    if (x === bounds.x && y === bounds.y) return { state, error: null };
    const updated = await handle.update({ x, y });
    if (!isCurrent() || updated?.mode !== 'window') return cancelled();
    return { state: updated, error: null };
  } catch (error) {
    return isCurrent() ? { error: error?.code || error?.message || 'result_unknown' } : cancelled();
  }
}
