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

/** Fit the complete transparent content area; on pop-out keep the bottom-centered pet visible even when it cannot all fit. */
export async function fitWindowToScreen(handle, { screenRect, isCurrent = () => true, size, keepPetVisible = false } = {}) {
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
    const { width, height } = size ?? bounds;
    const spareX = rect.width - width;
    const spareY = rect.height - height;
    if (!keepPetVisible && (spareX < 0 || spareY < 0)) return { error: 'screen_too_small' };
    // The sprite is centered at the bottom of the window. On small work areas, keep that
    // edge on-screen instead of clamping the top and pushing the sprite below the display.
    const x = spareX < 0 ? Math.round(rect.x + spareX / 2) : Math.ceil(Math.max(rect.x, Math.min(bounds.x, rect.x + spareX)));
    const y = spareY < 0 ? Math.floor(rect.y + spareY) : Math.ceil(Math.max(rect.y, Math.min(bounds.y, rect.y + spareY)));
    if (x === bounds.x && y === bounds.y && width === bounds.width && height === bounds.height) return { state, error: null };
    // Pop-out has a known design size. Include it with the move instead of relying on
    // a position-only update to preserve the pre-correction dimensions.
    const updated = await handle.update(size ? { x, y, width, height } : { x, y });
    if (!isCurrent() || updated?.mode !== 'window') return cancelled();
    return { state: updated, error: null };
  } catch (error) {
    return isCurrent() ? { error: error?.code || error?.message || 'result_unknown' } : cancelled();
  }
}
