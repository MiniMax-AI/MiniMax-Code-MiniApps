// @ts-check
// The hand-over between a Mini App Bot and the Host's memory.
//
// A Mini App session is not captured by the Host's memory: its purpose is miniapp:<plugin>, and
// the Host captures the main conversation. So what a Bot concludes never reaches the Host on
// its own, and a Bot cannot call the Host's memory tools - they are not in a Mini App session's
// tool surface. This module is the hand-over that closes that gap:
//
//   1. A Bot marks a conclusion in its reply: [[note: ...]]
//   2. The plugin keeps it here until someone asks for it.
//   3. The main conversation asks (the memory_pending tool); the answer - the text itself -
//      lands in that conversation, where the Host's own capture takes it from there.
//
// The queue is the plugin's own runtime state, not a memory: it holds what a Bot said until the
// main conversation has taken it. Nothing here writes into the Host's memory files.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** How a Bot marks a conclusion it wants kept. */
export const BRIDGE_MARK = '[[note:';
/** The end of such a mark. */
export const BRIDGE_MARK_END = ']]';
/** How many conclusions are kept at once; the oldest is dropped when there are more. */
export const BRIDGE_MAX_ENTRIES = 20;
/** How long one conclusion may be. */
export const BRIDGE_MAX_TEXT = 1200;
/** How many delivered conclusions are kept for the audit. */
export const BRIDGE_MAX_DELIVERED = 40;
/** The modules the helper carries, so it does not depend on where the Host unpacked the package. */
export const BRIDGE_MODULES = ['host-memory.mjs', 'memory-query.mjs'];

const NOTE_PATTERN = /\[\[note:\s*([\s\S]*?)\]\]/g;

/**
 * Split a reply into the conclusions it marks and the text the reader sees.
 * @param {string} text
 * @returns {{ notes: string[], clean: string }}
 */
export function splitNotes(text) {
  const notes = [];
  const clean = String(text ?? '').replace(NOTE_PATTERN, (_, body) => {
    const note = String(body).trim();
    if (note) notes.push(note);
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { notes, clean };
}

/**
 * The queue of conclusions waiting for the main conversation.
 * @param {any} store the plugin store; the queue lives in its state
 */
export class MemoryBridge {
  /** @param {any} store */
  constructor(store) {
    this.store = store;
  }

  /** @returns {{ entries: any[], delivered: any[] }} */
  state() {
    const state = this.store.state;
    if (!state.memoryBridge || typeof state.memoryBridge !== 'object') state.memoryBridge = {};
    const bridge = state.memoryBridge;
    if (!Array.isArray(bridge.entries)) bridge.entries = [];
    if (!Array.isArray(bridge.delivered)) bridge.delivered = [];
    return bridge;
  }

  /**
   * Keep a conclusion until the main conversation asks for it.
   * @param {{ botId?: string, botName?: string, chatId?: string, text: string }} entry
   */
  async add(entry) {
    const text = String(entry?.text ?? '').trim().slice(0, BRIDGE_MAX_TEXT);
    if (!text) return undefined;
    const bridge = this.state();
    const record = {
      id: 'note_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      botId: entry.botId ?? '',
      botName: entry.botName ?? '',
      chatId: entry.chatId ?? '',
      at: new Date().toISOString(),
      text,
    };
    bridge.entries.push(record);
    if (bridge.entries.length > BRIDGE_MAX_ENTRIES) {
      bridge.entries.splice(0, bridge.entries.length - BRIDGE_MAX_ENTRIES);
    }
    await this.store.save();
    return record;
  }

  /**
   * Take the conclusions that were not taken yet. Taking them is the delivery: the caller puts
   * them into its own conversation, and from there the Host's capture does the rest.
   * @param {number} [limit]
   */
  async take(limit = BRIDGE_MAX_ENTRIES) {
    const bridge = this.state();
    const count = Math.max(1, Math.min(Number(limit) || BRIDGE_MAX_ENTRIES, BRIDGE_MAX_ENTRIES));
    const entries = bridge.entries.slice(-count);
    if (!entries.length) return [];
    const taken = new Set(entries.map((entry) => entry.id));
    bridge.entries = bridge.entries.filter((entry) => !taken.has(entry.id));
    bridge.delivered.push(...entries.map((entry) => ({ ...entry, deliveredAt: new Date().toISOString() })));
    if (bridge.delivered.length > BRIDGE_MAX_DELIVERED) {
      bridge.delivered.splice(0, bridge.delivered.length - BRIDGE_MAX_DELIVERED);
    }
    await this.store.save();
    return entries;
  }

  /** The conclusions waiting, without taking them. */
  list() {
    return this.state().entries.slice();
  }

  /** How many are waiting, and how many were taken. */
  stats() {
    const bridge = this.state();
    return { waiting: bridge.entries.length, delivered: bridge.delivered.length };
  }
}

/**
 * Write the helper a Bot runs to search the Host's memory.
//
// A Bot reaches the Host's memory files through this one script: it is the only way in, so the
// search stays bounded and every excerpt keeps its source. The script is regenerated on every
// start, because it names the deployed path of the module it calls.
 * @param {{ dataDir: string, pluginRoot: string }} options
 * @returns {Promise<string>} the path of the helper
 */
export async function writeBridgeHelper({ dataDir, pluginRoot }) {
  const dir = join(dataDir, 'memory-bridge');
  await mkdir(dir, { recursive: true });
  // The Host runs a package from a directory it unpacks per run, so the helper must not import
  // from there: it would break at the next restart. It carries its own copy of the two modules
  // it needs, and both are written again on every start.
  for (const name of BRIDGE_MODULES) {
    const source = await readFile(join(pluginRoot, 'miniapp', 'node', name), 'utf8');
    await writeFile(join(dir, name), source, 'utf8');
  }
  const helper = [
    '// Generated by the MiniMax Bot plugin. Do not edit: it is rewritten on every start.',
    "const mod = await import('./host-memory.mjs');",
    "const query = process.argv.slice(2).join(' ');",
    "const result = await mod.searchHostMemory(query);",
    "process.stdout.write(JSON.stringify(result, null, 2));",
    ''
  ].join('\n');
  const path = join(dir, 'search.mjs');
  await writeFile(path, helper, 'utf8');
  return path;
}