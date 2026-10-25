"use strict";
// Host lifecycle adapter. Upstream modules retain their existing process API;
// only processes created through this module are owned and stopped here.
const cp = require("node:child_process");
const active = new Set();
let stopped = false;
let stopping;

function assertRunning() {
  if (stopped) throw new Error("FableCut is stopping; media processing is unavailable");
}
function track(child) {
  active.add(child);
  child.once("close", () => active.delete(child));
  child.once("error", () => { if (!child.pid) active.delete(child); });
  return child;
}
function spawn(...args) { assertRunning(); return track(cp.spawn(...args)); }
function execFile(...args) { assertRunning(); return track(cp.execFile(...args)); }
function spawnSync(...args) { assertRunning(); return cp.spawnSync(...args); }
function shutdown() {
  if (stopping) return stopping;
  stopped = true;
  stopping = Promise.all([...active].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
      active.delete(child); resolve(); return;
    }
    let timer;
    const finish = () => { clearTimeout(timer); active.delete(child); resolve(); };
    child.once("close", finish);
    // Escalate only our own child if graceful termination does not finish.
    timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 1500);
    try { child.kill(); } catch { finish(); }
  }))).then(() => undefined);
  return stopping;
}
module.exports = { spawn, execFile, spawnSync, shutdown, assertRunning };
