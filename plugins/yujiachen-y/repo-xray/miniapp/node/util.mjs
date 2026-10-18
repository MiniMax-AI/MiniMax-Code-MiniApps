// @ts-check
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DAY = 86_400_000;

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date (YYYY-MM-DD) for a timestamp or Date. */
export function ymd(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Whole days from a to b (b - a). */
export function dayDiff(a, b) {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / DAY);
}

export function mondayOf(s) {
  const d = parseYmd(s);
  return addDays(s, -((d.getDay() + 6) % 7));
}

export function weekday(s) {
  return parseYmd(s).getDay(); // 0 = Sunday
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

/** File-system safe segment for ids and usernames. */
export function safeSegment(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, (c) => `~${c.charCodeAt(0).toString(16)}`).slice(0, 120);
}

export const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve(undefined);
    }, { once: true });
  });

/** Run fn over items with bounded concurrency. Never rejects; returns settled results. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (error) {
        results[idx] = { ok: false, error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export const USERNAME_RE = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;
