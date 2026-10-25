// @ts-check
// The shared state of one export job.
//
// A job lives in its own directory under the Mini App's private data dir:
//
//   <dataDir>/export-jobs/<jobId>/
//     job.json        the state (this file's subject)
//     project.json    the snapshot of the saved project
//     media/          copies of the media the snapshot uses
//     library/        copies of the library assets the snapshot uses
//     client/         a copy of the editor's client payload
//     runtime/        a copy of the FableCut runtime the renderer drives
//     runner/         a copy of this package's standalone runner
//     exports/        the finished files
//
// The state file is written atomically (temp file in the same directory, then
// rename), so a reader never sees half a document and a crash never leaves a
// truncated state behind.
//
// Nothing here knows about the Host. The Mini App side owns the job directory;
// the runner side owns the state file while it works.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** A job id is a short, boring, path-safe token. It is not a secret. */
export const JOB_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

/** Every status a job can be in. `prepared` is the first; nothing runs until a runner takes it. */
export const JOB_STATUSES = Object.freeze([
  'prepared',
  'running',
  'verifying',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);

/** Statuses a job never leaves. */
export const TERMINAL_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled', 'interrupted']);

/**
 * @param {string} dataDir
 * @returns {string} the directory that holds every export job
 */
export function jobsRoot(dataDir) {
  return path.join(dataDir, 'export-jobs');
}

/**
 * @param {string} dataDir
 * @param {string} id
 * @returns {string} the job's own directory
 */
export function jobDir(dataDir, id) {
  return path.join(jobsRoot(dataDir), id);
}

/**
 * A job id is only ever used to build a path inside the managed root, so it is
 * checked against a strict pattern and the result is verified to stay inside it.
 *
 * @param {string} dataDir
 * @param {unknown} id
 * @returns {string} the job directory
 * @throws {Error} when the id is not a job id this package made
 */
export function resolveJobDir(dataDir, id) {
  const wanted = String(id ?? '');
  if (!JOB_ID_PATTERN.test(wanted)) {
    throw new Error('job id must be a job id this package created (letters, digits, - and _)');
  }
  const root = path.resolve(jobsRoot(dataDir));
  const dir = path.resolve(jobDir(dataDir, wanted));
  if (path.dirname(dir) !== root) throw new Error('job id does not name a job inside the managed export-jobs root');
  return dir;
}

/**
 * @param {unknown} id
 * @returns {string} a fresh job id
 */
export function newJobId() {
  return `job_${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * @returns {string} a fresh attempt id — one run of one job
 */
export function newAttemptId() {
  return `att_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * @param {string} dir
 * @returns {Record<string, any> | null} the job's state, or null when there is none
 */
export function readJob(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'job.json'), 'utf8').replace(/^\uFEFF/u, '');
    const doc = JSON.parse(raw);
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Write the state atomically. The temp file sits in the same directory, so the
 * rename never crosses a filesystem boundary.
 *
 * @param {string} dir
 * @param {Record<string, any>} job
 */
export function writeJob(dir, job) {
  const target = path.join(dir, 'job.json');
  const temp = path.join(dir, `.job.json.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(temp, `${JSON.stringify(job, null, 2)}\n`);
  fs.renameSync(temp, target);
}

/**
 * @param {Record<string, any>} job
 * @returns {boolean} whether the job has reached a status it never leaves
 */
export function isTerminal(job) {
  return TERMINAL_STATUSES.includes(String(job?.status ?? ''));
}

/**
 * The clips a render actually draws.
 *
 * The saved document's `clips` are the open timeline. A composition clip
 * places a composition, and the editor flattens the composition's clips into
 * the timeline - depth first, so a composition inside a composition is drawn
 * too. The sequence that is open has its clips in `clips` as well; the
 * sequences that are not open are not rendered, so they are left out.
 *
 * @param {any} doc
 * @returns {any[]} every clip the render touches
 */
export function collectRenderClips(doc) {
  /** @type {any[]} */
  const out = [];
  if (!doc || typeof doc !== 'object') return out;

  /** @type {Map<string, any>} */
  const comps = new Map();
  for (const comp of Array.isArray(doc.comps) ? doc.comps : []) {
    if (comp && typeof comp === 'object' && typeof comp.id === 'string') comps.set(comp.id, comp);
  }

  const seen = new Set();
  /**
   * @param {any[]} clips
   * @param {number} depth
   */
  const walk = (clips, depth) => {
    if (!Array.isArray(clips) || depth > 16) return;
    for (const clip of clips) {
      if (!clip || typeof clip !== 'object') continue;
      out.push(clip);
      if (clip.kind !== 'comp' || typeof clip.compId !== 'string') continue;
      if (seen.has(clip.compId)) continue;
      seen.add(clip.compId);
      const comp = comps.get(clip.compId);
      walk(comp && Array.isArray(comp.clips) ? comp.clips : [], depth + 1);
    }
  };

  walk(Array.isArray(doc.clips) ? doc.clips : [], 0);

  // The open sequence's own entry, in case the document was written by a tool
  // and kept the two apart.
  const active = typeof doc.sequence === 'string' ? doc.sequence : null;
  for (const sequence of Array.isArray(doc.sequences) ? doc.sequences : []) {
    if (!sequence || typeof sequence !== 'object') continue;
    if (active && sequence.id !== active) continue;
    walk(Array.isArray(sequence.clips) ? sequence.clips : [], 0);
  }

  return out;
}

/**
 * @param {Record<string, any>} job
 * @returns {Record<string, any>} the fields an Agent may see — no paths outside the job, no secrets
 */
export function describeJob(job) {
  if (!job) return {};
  return {
    jobId: job.id ?? null,
    status: job.status ?? null,
    createdAt: job.createdAt ?? null,
    updatedAt: job.updatedAt ?? null,
    attempt: job.attempt
      ? {
          id: job.attempt.id ?? null,
          pid: Number.isFinite(job.attempt.pid) ? job.attempt.pid : null,
          startedAt: job.attempt.startedAt ?? null,
          heartbeatAt: job.attempt.heartbeatAt ?? null,
        }
      : null,
    progress: Number.isFinite(job.progress) ? job.progress : 0,
    project: job.project ?? null,
    spec: job.spec ?? null,
    outputs: Array.isArray(job.outputs) ? job.outputs : [],
    warnings: Array.isArray(job.warnings) ? job.warnings : [],
    error: job.error ?? null,
    notes: Array.isArray(job.notes) ? job.notes : [],
  };
}
