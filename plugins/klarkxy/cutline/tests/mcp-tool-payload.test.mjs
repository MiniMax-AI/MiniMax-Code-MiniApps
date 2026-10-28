// @ts-check
// The size of the tool list the Host injects into every session.
//
// The Host puts the whole `tools/list` result into the model's context, so
// the tool descriptions are a standing cost on every conversation. This test
// measures the real list — nineteen upstream `fablecut_*` tools, the package's
// project-folder import tool, and its own `cutline_export` — and keeps it inside
// a budget, so a description that grows back into a manual is caught here.
//
// The budget is a byte count, not a token count: no tokenizer is involved, so
// the number does not drift with the model.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mcpRaw, mcpSession, startApp } from './helpers.mjs';
import { EXPORT_TOOL } from '../miniapp/node/export/export-mcp.mjs';

/** The largest the injected tool list may be. */
const BUDGET_BYTES = 16_000;

/** Nineteen upstream tools, the local project import, and cutline_export. */
const UPSTREAM_TOOL_COUNT = 19;
const EXPECTED_TOOL_COUNT = 21;

const app = await startApp();

test.after(async () => {
  await app.dispose();
});

/**
 * The tool list the Host actually receives.
 *
 * @returns {Promise<any[]>}
 */
async function listTools() {
  const { sessionId } = await mcpSession(app.base);
  const reply = await mcpRaw(
    app.base,
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { headers: { 'mcp-session-id': sessionId } },
  );
  assert.equal(reply.status, 200);
  const tools = reply.json?.result?.tools;
  assert.ok(Array.isArray(tools), 'the server answers tools/list with an array');
  return tools;
}

test('the injected tool list stays inside its byte budget', async () => {
  const tools = await listTools();
  assert.equal(tools.length, EXPECTED_TOOL_COUNT);

  const bytes = Buffer.byteLength(JSON.stringify(tools), 'utf8');
  assert.ok(
    bytes <= BUDGET_BYTES,
    `the tool list is ${bytes} bytes; the budget is ${BUDGET_BYTES}. Trim the tool descriptions, not the schema.`,
  );
});

test('the measured list is the upstream tools, project import and cutline_export', async () => {
  const tools = await listTools();
  const projectImport = tools.find((/** @type {any} */ tool) => tool.name === 'fablecut_import_project');
  assert.ok(projectImport, 'the package project-import tool is offered');
  const upstream = tools.filter((/** @type {any} */ tool) =>
    tool.name.startsWith('fablecut_') && tool.name !== 'fablecut_import_project',
  );
  assert.equal(upstream.length, UPSTREAM_TOOL_COUNT, 'all upstream tools are offered');

  const offered = tools.find((/** @type {any} */ tool) => tool.name === EXPORT_TOOL.name);
  assert.ok(offered, 'cutline_export is offered');
  assert.deepEqual(offered, EXPORT_TOOL, 'the offered export tool is the one the package defines');
});

test('the descriptions that stop a destructive mistake are still there', async () => {
  const tools = await listTools();
  const byName = new Map(
    tools.map((/** @type {any} */ tool) => [tool.name, tool]),
  );

  // A write needs the revision it was planned against, or a concurrent change
  // in the editor is overwritten instead of reported.
  const setProject = byName.get('fablecut_set_project');
  assert.ok(setProject, 'fablecut_set_project is offered');
  assert.match(setProject.description, /baseRevision/);
  assert.match(setProject.description, /CONFLICT/);
  assert.deepEqual(setProject.inputSchema.required.sort(), ['baseRevision', 'project']);

  const patchProject = byName.get('fablecut_patch_project');
  assert.ok(patchProject, 'fablecut_patch_project is offered');
  assert.match(patchProject.description, /baseRevision/);
  assert.match(patchProject.description, /CONFLICT/);

  // A render runs in the editor the user has open; a background browser
  // cannot load the editor's own origin.
  const exportTool = byName.get('fablecut_export');
  assert.ok(exportTool, 'fablecut_export is offered');
  assert.match(exportTool.description, /editor tab/i);
  assert.deepEqual(
    exportTool.inputSchema.properties.where.enum,
    ['auto', 'tab', 'headless'],
    'its where enum is unchanged',
  );

  // A lock the user set is only broken on the user's own request.
  const force = byName.get('fablecut_set_project').inputSchema.properties.force;
  assert.match(force.description, /only on request/i);

  // The Agent starts the standalone render itself.
  const cutlineExport = byName.get('cutline_export');
  assert.ok(cutlineExport, 'cutline_export is offered');
  assert.match(cutlineExport.description, /prepare/);
  assert.match(cutlineExport.description, /status/);
  assert.match(cutlineExport.description, /cancel/);
  assert.deepEqual(cutlineExport.inputSchema.properties.action.enum, ['prepare', 'status', 'cancel']);

  const frame = byName.get('fablecut_frame');
  assert.ok(frame);
  assert.match(frame.inputSchema.properties.path.description, /absolute file path/);
  assert.match(frame.inputSchema.properties.path.description, /read in place/);

  const reference = byName.get('fablecut_analyze_reference');
  assert.ok(reference);
  assert.match(reference.description, /external local paths must be audio\/video/);

  const importMedia = byName.get('fablecut_import_media');
  assert.ok(importMedia);
  assert.match(importMedia.description, /remote SVG is refused/);

  const range = exportTool.inputSchema.properties.range.description;
  assert.match(range, /when either marker is set, otherwise entire/);
});

test('every tool still carries a description', async () => {
  const tools = await listTools();
  for (const tool of tools) {
    assert.ok(tool.description, `${tool.name} has a description`);
    assert.equal(tool.inputSchema?.type, 'object', `${tool.name} has an object schema`);
  }
});
