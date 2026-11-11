import { playheadMs, stripMsAt, stripMsShift } from './node-ui.mjs';

/**
 * The playhead on the strip.
 *
 * The strip is the thing the user presses: pressing it moves the material
 * to that point, and dragging keeps it there. The mark on the strip is
 * where the material is - the mark follows the material, and the hand
 * moves the material.
 *
 * The mark can also be taken by the hand: it is a thin line with a wide
 * place to hold it, so a hand can grab it and carry it. A hand that took
 * the mark moves it by the distance it travels, so the mark does not jump
 * under the finger; a hand that presses the strip puts the material where
 * it pressed.
 *
 * The mark is a slider as well: a keyboard moves it a step at a time.
 *
 * The ends of the range keep their own drag, so the press never reaches
 * here when a handle is grabbed: the handle stops it on its way up.
 */
export function wirePlayhead({
  track,
  playhead = null,
  getRange,
  getDurationMs,
  getCurrentMs = () => 0,
  seek,
  paint,
  onPress = null,
  onRelease = null,
  win = window,
}) {
  // The moment of the material a press on the strip means.
  const pointAt = (clientX) => {
    const rect = track.getBoundingClientRect();
    return playheadMs({
      ms: stripMsAt({ clientX, rectLeft: rect.left, rectWidth: rect.width, durationMs: getDurationMs() }),
      range: getRange(),
    });
  };

  // The moment of the material a hand that took the mark arrives at.
  const shiftAt = (baseMs, deltaX) => {
    const rect = track.getBoundingClientRect();
    return playheadMs({
      ms: stripMsShift({ baseMs, deltaX, rectWidth: rect.width, durationMs: getDurationMs() }),
      range: getRange(),
    });
  };

  // The drag that is going on, if there is one. There is only ever one:
  // a second press ends the first.
  let dragging = null;

  const press = (event) => {
    event.preventDefault();
    event.stopPropagation();
    // A press while another drag is going on ends that one.
    dragging?.();
    // A hand that took the mark itself carries the mark; a hand on the
    // strip puts the material where it pressed.
    const grabbed = Boolean(playhead)
      && (event.target === playhead || playhead.contains?.(event.target));
    // The mark is a slider: a hand that takes it takes the focus too, so
    // the keyboard can carry on from there. The press stops the default
    // focus of a click, so the focus is asked for by hand.
    if (grabbed) playhead?.focus?.();
    const startX = event.clientX;
    const baseMs = grabbed ? Number(getCurrentMs() || 0) : 0;
    const follow = (moveEvent) => {
      seek(grabbed ? shiftAt(baseMs, moveEvent.clientX - startX) : pointAt(moveEvent.clientX));
      paint();
    };
    // The material stops while the hand holds it, so the mark and the
    // material do not fight each other.
    onPress?.();
    // The press itself is a move: the material goes to where the hand
    // pointed, and the drag only keeps it there.
    follow(event);
    const stop = () => {
      win.removeEventListener('pointermove', follow);
      win.removeEventListener('pointerup', stop);
      win.removeEventListener('pointercancel', stop);
      if (dragging === stop) dragging = null;
      onRelease?.();
    };
    dragging = stop;
    win.addEventListener('pointermove', follow);
    win.addEventListener('pointerup', stop);
    win.addEventListener('pointercancel', stop);
  };

  // The mark is a slider too: a keyboard moves it a step at a time.
  const keydown = (event) => {
    const total = Number(getDurationMs() || 0);
    if (!total) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const now = Number(getCurrentMs() || 0);
    let ms = now;
    if (event.key === 'Home') ms = 0;
    else if (event.key === 'End') ms = total;
    else {
      const back = ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key);
      // A page is a second, a held shift is a second, a plain arrow is a
      // tenth of a second: the mark moves by what the key says.
      const step = event.key.startsWith('Page') || event.shiftKey ? 1000 : 10;
      ms = now + (back ? -step : step);
    }
    seek(playheadMs({ ms, range: getRange() }));
    paint();
  };

  const dispose = () => {
    dragging?.();
    track.removeEventListener('pointerdown', press);
    playhead?.removeEventListener?.('keydown', keydown);
  };

  track.addEventListener('pointerdown', press);
  playhead?.addEventListener?.('keydown', keydown);
  return dispose;
}
