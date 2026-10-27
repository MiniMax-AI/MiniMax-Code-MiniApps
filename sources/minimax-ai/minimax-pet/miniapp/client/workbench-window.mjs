const fail = (code) => ({ ok: false, code });
const positive = (value) => Number.isFinite(value) && value > 0;
const errorCode = (error) => typeof error?.code === 'string' ? error.code
  : typeof error?.message === 'string' ? error.message : 'result_unknown';

function boundsOf(state) {
  const bounds = state?.window;
  return state?.mode === 'window' && bounds && positive(bounds.width) && positive(bounds.height)
    && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) ? bounds : null;
}

function resizePatch(bounds, size, rect) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)
    || !positive(rect.width) || !positive(rect.height)) return fail('screen_unavailable');
  if (!positive(size?.width) || !positive(size?.height)) return fail('invalid_size');
  const minWidth = positive(bounds.minWidth) ? Math.ceil(bounds.minWidth) : 1;
  const minHeight = positive(bounds.minHeight) ? Math.ceil(bounds.minHeight) : 1;
  const width = Math.max(minWidth, Math.min(Math.round(size.width), Math.floor(rect.width)));
  const height = Math.max(minHeight, Math.min(Math.round(size.height), Math.floor(rect.height)));
  if (width > rect.width || height > rect.height) return fail('screen_too_small');
  // Work areas can start left of or above the primary display. Clamp to that
  // rectangle, retaining the current bottom-right anchor whenever it fits.
  const x = Math.round(Math.max(rect.x, Math.min(bounds.x + bounds.width - width, rect.x + rect.width - width)));
  const y = Math.round(Math.max(rect.y, Math.min(bounds.y + bounds.height - height, rect.y + rect.height - height)));
  return { ok: true, patch: { x, y, width, height } };
}

/**
 * Geometry only: callers own panel visibility, focus and click-through. A
 * rejected resize leaves the remembered compact size and expansion unchanged.
 * screenRect must describe the current display's available area; when unknown
 * no geometry is guessed or written.
 */
export function createWorkbenchWindow({
  windowAPI,
  screenRect,
  isCurrent = () => true,
  expandedSize = { width: 300, height: 340 },
} = {}) {
  let disposed = false, expanded = false, compactSize = null;
  let intent = 0, lifetime = 0, queue = Promise.resolve();
  const active = (generation) => !disposed && generation === lifetime && isCurrent();
  const invalidateWindow = () => {
    lifetime += 1;
    intent += 1;
    expanded = false;
    compactSize = null;
  };
  const subscription = windowAPI?.onDidChangeState?.((state) => {
    if (state?.mode === 'inline') invalidateWindow();
  });

  async function apply(target, request, generation) {
    try {
      if (!active(generation)) return fail('cancelled');
      if (request !== intent) return fail('superseded');
      if (typeof windowAPI?.getState !== 'function' || typeof windowAPI?.update !== 'function') return fail('unsupported');
      const state = await windowAPI.getState();
      if (!active(generation)) return fail('cancelled');
      if (request !== intent) return fail('superseded');
      if (state?.mode === 'inline') { invalidateWindow(); return fail('inline_mode'); }
      const bounds = boundsOf(state);
      if (!bounds) return fail('invalid_state');
      if (expanded === target) return { ok: true };
      if (bounds.resizable === false) return fail('not_permitted');
      const originalSize = compactSize || { width: bounds.width, height: bounds.height };
      const geometry = resizePatch(bounds, target ? expandedSize : originalSize, screenRect?.());
      if (!geometry.ok) return geometry;
      if (!active(generation)) return fail('cancelled');
      if (request !== intent) return fail('superseded');
      const updated = await windowAPI.update(geometry.patch);
      if (!active(generation)) return fail('cancelled');
      if (updated?.mode === 'inline') { invalidateWindow(); return fail('inline_mode'); }
      if (!boundsOf(updated)) return fail('invalid_state');
      // An update already sent to the Host cannot be recalled. Remember its
      // accepted size even if a newer close arrived, so the serialized close
      // restores the compact size from the actual new bottom-right position.
      compactSize = originalSize;
      expanded = target;
      return request === intent ? { ok: true } : fail('superseded');
    } catch (error) {
      return disposed || generation !== lifetime ? fail('cancelled') : fail(errorCode(error));
    }
  }

  return {
    setExpanded(target) {
      if (disposed) return Promise.resolve(fail('cancelled'));
      if (typeof target !== 'boolean') return Promise.resolve(fail('invalid_request'));
      const request = ++intent, generation = lifetime;
      const pending = queue.then(() => apply(target, request, generation));
      // All API/callback failures are explicit results, so the next deliberate
      // intent can run without an automatic retry or a hidden rejected chain.
      queue = pending.then(() => undefined);
      return pending;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidateWindow();
      subscription?.dispose();
    },
  };
}
