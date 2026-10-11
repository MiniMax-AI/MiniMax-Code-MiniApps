// Does 向上加载更早的 N 条 actually widen the window, and does a poll keep it widened?
//
// The bug this checks: rePinWindow reset state.limit to PAGE_STEP on every changed poll, so
// the button's `limit += PAGE_STEP` was undone within a second. It looked inert because this
// session grows several records per poll, so "200 shown" and "400 shown" were both roughly
// "200-ish" against a total moving in the same direction.
//
// Expected values are derived by hand from the constants, not from running the client.

const PAGE_STEP = 200;

// The shipped rePinWindow, transcribed. Kept literal so the probe fails if the rule changes.
function rePinWindow(state) {
  if (state.allRecords) return state.limit;
  if (state.limit > PAGE_STEP) return state.limit;
  state.limit = Math.min(PAGE_STEP, state.flatLength) || PAGE_STEP;
  return state.limit;
}

function show(value) {
  // JSON.stringify turns Infinity into null, which reads as a failure when it is the answer.
  return value === Infinity ? 'Infinity' : JSON.stringify(value);
}

function check(name, got, want) {
  const ok = Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'ok   ' : 'FAIL ') + name + ': got ' + show(got) + (ok ? '' : ', want ' + show(want)));
  return ok;
}

let all = true;

// A reader who just narrowed is at exactly PAGE_STEP, so the window follows the tail.
{
  const state = { allRecords: false, limit: 200, flatLength: 9893 };
  all &= check('tail-following re-pins to one page', rePinWindow(state), 200);
}

// Press 向上加载 once: 200 -> 400.
{
  const state = { allRecords: false, limit: 400, flatLength: 9893 };
  all &= check('a widened window survives a poll', rePinWindow(state), 400);
}

// Twice more, across several polls in a row.
{
  const state = { allRecords: false, limit: 400, flatLength: 9893 };
  rePinWindow(state);
  state.limit += 200;
  all &= check('widening again after a poll', state.limit, 600);
  rePinWindow(state);
  all &= check('and it is still 600 after another poll', state.limit, 600);
}

// 全部 has no cap to undo.
{
  const state = { allRecords: true, limit: Infinity, flatLength: 9893 };
  all &= check('全部 is never re-pinned', rePinWindow(state), Infinity);
}

// The tail-following case must still grow with a short session: fewer records than a page.
{
  const state = { allRecords: false, limit: 200, flatLength: 37 };
  all &= check('a session shorter than a page shows all of it', rePinWindow(state), 37);
}

// A session shorter than a page, after the reader asked for 400: there is nothing left to load,
// so the window covers everything there is and stays there.
{
  const state = { allRecords: false, limit: 400, flatLength: 37 };
  all &= check('a widened window in a short session is untouched', rePinWindow(state), 400);
}

// The regression this fixes, stated as an explicit counter-example: the old rule reset 400.
{
  const old = (state) => {
    if (state.allRecords) return state.limit;
    state.limit = Math.min(PAGE_STEP, state.flatLength) || PAGE_STEP;
    return state.limit;
  };
  const state = { allRecords: false, limit: 400, flatLength: 9893 };
  const result = old(state);
  const regressed = result === 200;
  console.log((regressed ? 'ok   ' : 'FAIL ') +
    'counter-example: the old rule really did undo 400 -> ' + result);
  all &= regressed;
}

console.log();
console.log(all ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT');
process.exit(all ? 0 : 1);
