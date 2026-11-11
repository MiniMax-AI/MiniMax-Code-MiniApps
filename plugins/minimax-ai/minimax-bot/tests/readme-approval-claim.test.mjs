// @ts-check
// The approval claim in the README, written as executable assertions.
//
// The point of this file: the sentence that describes approval is checked, not read.
//
//   1. the Agent-turns bullet says the condition its claim depends on (the Host's
//      permission mode) and says what the plugin still guarantees — that when approval is
//      asked for it never approves by itself. Appending an "approved automatically"
//      qualifier while keeping the old promise fails, and so does flipping the claim to
//      "the plugin approves it by itself";
//   2. the plugin version is one value in the manifest, in package.json and in the
//      serverInfo the MCP server reports, so no release ships as three different things;
//   3. the README has a changelog entry for that version, after the 0.7.24 entry, with a
//      bullet of its own that talks about the approval claim — a renamed heading alone is
//      not an entry.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

/** @param {string} name */
const readText = (name) => readFileSync(join(root, name), 'utf8');

/** @param {string} name */
const readJson = (name) => JSON.parse(readText(name));

/**
 * The body of a numbered changelog section: its bullets, without the heading line, up to
 * the next `## ` heading.
 *
 * `heading` may be the start of a heading (`## 0.7.24 `) or its whole text including a
 * topic (`## 0.7.26 The approval claim`): a version number alone does not identify a
 * section, because two candidates can carry the same number and the first one found is
 * not necessarily the entry being checked.
 * @param {string} readme
 * @param {string} heading the heading prefix to match, e.g. `## 0.7.24 `
 */
function sectionOf(readme, heading) {
  const lines = readme.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  assert.notEqual(start, -1, `README has no section starting with ${JSON.stringify(heading)}`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const end = next === -1 ? lines.length : next;
  return { at: start, heading: lines[start], body: lines.slice(start + 1, end).join('\n') };
}

test('the Agent-turns bullet makes the approval claim conditional on the Host permission mode', () => {
  const readme = readText('README.md');
  const bullet = readme.split('\n').find((line) => line.startsWith('- **Agent turns**'));
  assert.ok(bullet, 'README has an Agent turns bullet');

  // It has to name the condition its claim depends on, in the README's own words: the
  // Host decides whether approval is asked for at all.
  assert.match(bullet, /the Host's permission mode/i);
  // And it has to keep the plugin's own side of the claim, as the reviewed clause: when
  // approval is asked for, the plugin never approves it by itself.
  assert.match(bullet, /when it is needed, the plugin never approves it by itself/i);
  // The old unconditional promise must be gone, including the variants that phrase the
  // same promise ("nothing is ever approved automatically", "nothing gets approved ...").
  assert.doesNotMatch(bullet, /\bnothing (?:is|is ever|gets) (?:ever )?approved automatically\b/i);
  // And the claim must not be flipped: the plugin does not approve the call by itself.
  assert.doesNotMatch(bullet, /plugin approves (?:it|the call|a call) by itself/i);
  // Same guard in the words a later edit would actually reach for. The reviewed sentence
  // uses neither, so these cannot fire on the text this test is written for: nothing in
  // the bullet says a call is approved without a person, and nothing says the plugin can
  // approve one.
  assert.doesNotMatch(bullet, /\bautomatically\b/i);
  assert.doesNotMatch(bullet, /(?:can|may|will|would|does)\s+approve/i);
});

test('the plugin version is the same value in the manifest, package.json and serverInfo', () => {
  const version = readJson('.minimax-plugin/plugin.json').version;
  assert.match(version, /^\d+\.\d+\.\d+$/);

  assert.equal(readJson('package.json').version, version);

  const server = readText('miniapp/node/mcp.mjs');
  const found = server.match(/serverInfo:\s*\{[^}]*version:\s*'([0-9]+\.[0-9]+\.[0-9]+)'/);
  assert.ok(found, 'mcp.mjs reports a serverInfo version');
  assert.equal(found[1], version);
});

test('the README has a changelog entry for this version, after the 0.7.24 one', () => {
  const readme = readText('README.md');
  const version = readJson('.minimax-plugin/plugin.json').version;

  const previous = sectionOf(readme, '## 0.7.24 ');
  // The release under review is found by its version alone, so a later release with a
  // topic of its own stays green.
  const current = sectionOf(readme, `## ${version} `);
  assert.ok(current.at > previous.at, `the ${version} entry comes after the 0.7.24 entry`);

  // The approval claim is pinned to this release's own section, named literally: it is
  // this changelog entry that has to talk about it, not whichever section a later
  // version happens to put first. A renamed heading alone is not an entry either — the
  // approval claim has to be talked about in a bullet, not in the heading.
  const documented = sectionOf(readme, '## 0.7.26 ');
  const bullets = documented.body.split('\n').filter((line) => line.startsWith('- '));
  assert.ok(bullets.length >= 1, 'the 0.7.26 entry has at least one bullet, not just a heading');
  assert.match(bullets.join('\n'), /approval/u);
});
