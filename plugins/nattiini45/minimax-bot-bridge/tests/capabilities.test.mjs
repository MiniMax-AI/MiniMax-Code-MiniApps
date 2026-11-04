import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  frontmatter,
  hostHome,
  readCapabilities,
} from '../miniapp/node/capabilities.mjs';

/**
 * What the desktop can do.
 *
 * The phone shows the desktop's skills, plugins and agents, so the user can ask for one
 * by name from the phone. The list is read from the Host's own installation, and
 * nothing is run from the phone: the bridge reads, it never writes.
 */

/**
 * A Home directory that looks like the Host's.
 *
 * @param {(home: string) => Promise<void>} [build]
 */
async function homeWith(build) {
  const home = await mkdtemp(join(tmpdir(), 'minimax-home-'));
  await mkdir(join(home, 'v2', 'plugin-data', 'liveboards', 'minimax-bot-bridge'), {
    recursive: true,
  });
  if (build) await build(home);
  return home;
}

/**
 * Writes a file, making its folder first.
 *
 * @param {string} file
 * @param {string} text
 */
async function put(file, text) {
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, text, 'utf8');
}

test("the Host's home is found from the bridge's own data directory", async () => {
  const home = await homeWith();
  try {
    const context = {
      dataDir: join(home, 'v2', 'plugin-data', 'liveboards', 'minimax-bot-bridge'),
    };
    assert.equal(hostHome(context), home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a bridge that does not know where it is does not guess', () => {
  assert.equal(hostHome({}), '');
  assert.equal(hostHome(undefined), '');
});

test('the front matter of a skill is read, quotes and all', () => {
  const meta = frontmatter(
    ['---', 'name: expo', 'description: "A long description.', 'It runs over lines."', 'license: MIT', '---', '', '# expo'].join(
      '\n',
    ),
  );

  assert.equal(meta.name, 'expo');
  assert.equal(meta.description, 'A long description. It runs over lines.');
  assert.equal(meta.license, 'MIT');
});

test('a file without front matter has none', () => {
  assert.deepEqual(frontmatter('# just a heading'), {});
  assert.deepEqual(frontmatter(''), {});
});

test('the skills, plugins and agents of the desktop are listed', async () => {
  const home = await homeWith(async (dir) => {
    await put(
      join(dir, 'skills', 'expo', 'SKILL.md'),
      ['---', 'name: expo', 'description: "Everything Expo."', '---', '', '# expo'].join('\n'),
    );
    await put(
      join(dir, 'skills', 'writing', 'SKILL.md'),
      ['---', 'name: writing', 'description: "Writes things."', '---'].join('\n'),
    );
    // A folder that is not a skill is not one.
    await put(join(dir, 'skills', 'notes', 'readme.md'), 'not a skill');
    await put(
      join(dir, 'plugins', 'minimax-bot-bridge', '.minimax-plugin', 'plugin.json'),
      JSON.stringify({ name: 'minimax-bot-bridge', displayName: 'MiniMax Bot Bridge', version: '0.1.0', description: 'The bridge.' }),
    );
    await put(
      join(dir, 'v2', 'plugin-cache', 'official', 'sha256-tree-v1-abc', '.minimax-plugin', 'plugin.json'),
      JSON.stringify({ name: 'pdf', displayName: 'PDF', version: '1.0.4', description: 'PDFs.' }),
    );
    // The cache and the marketplaces are folders, not plugins.
    await put(join(dir, 'plugins', 'cache', 'note.txt'), 'not a plugin');
    await put(join(dir, 'plugins', 'marketplaces', 'note.txt'), 'not a plugin');
    await put(join(dir, 'agents', 'worker', 'config.yaml'), '{}\n');
  });

  try {
    const context = {
      dataDir: join(home, 'v2', 'plugin-data', 'liveboards', 'minimax-bot-bridge'),
    };
    const capabilities = await readCapabilities(context);

    assert.deepEqual(capabilities.skills, [
      { id: 'expo', name: 'expo', description: 'Everything Expo.', source: 'user' },
      { id: 'writing', name: 'writing', description: 'Writes things.', source: 'user' },
    ]);
    assert.deepEqual(capabilities.plugins, [
      {
        id: 'minimax-bot-bridge',
        name: 'MiniMax Bot Bridge',
        description: 'The bridge.',
        source: 'installed',
        version: '0.1.0',
      },
      {
        id: 'pdf',
        name: 'PDF',
        description: 'PDFs.',
        source: 'official',
        version: '1.0.4',
      },
    ]);
    assert.deepEqual(capabilities.agents, [
      { id: 'worker', name: 'worker', source: 'installed' },
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('the skills the Host carries itself are listed next to the user\'s own', async () => {
  const home = await homeWith(async (dir) => {
    await put(
      join(dir, 'skills', 'expo', 'SKILL.md'),
      ['---', 'name: expo', 'description: "Everything Expo."', '---'].join('\n'),
    );
    await put(
      join(dir, '.builtin-skills', 'pdf', 'SKILL.md'),
      ['---', 'name: pdf', 'description: "PDFs."', '---'].join('\n'),
    );
  });

  try {
    const capabilities = await readCapabilities({
      dataDir: join(home, 'v2', 'plugin-data', 'liveboards', 'minimax-bot-bridge'),
    });

    assert.deepEqual(capabilities.skills, [
      { id: 'expo', name: 'expo', description: 'Everything Expo.', source: 'user' },
      { id: 'pdf', name: 'pdf', description: 'PDFs.', source: 'built-in' },
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('the MCP servers the desktop has are listed', async () => {
  const home = await homeWith(async (dir) => {
    await put(
      join(dir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          expo: { type: 'stdio', enabled: true, description: 'The Expo MCP.' },
          'shared-memory': { type: 'stdio', enabled: true, builtin: true },
        },
      }),
    );
  });

  try {
    const capabilities = await readCapabilities({
      dataDir: join(home, 'v2', 'plugin-data', 'liveboards', 'minimax-bot-bridge'),
    });

    assert.deepEqual(capabilities.mcp, [
      { id: 'expo', name: 'expo', description: 'The Expo MCP.', source: 'user' },
      { id: 'shared-memory', name: 'shared-memory', source: 'built-in' },
    ]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a desktop with nothing to list is not an error', async () => {
  const home = await homeWith();
  try {
    const context = {
      dataDir: join(home, 'v2', 'plugin-data', 'liveboards', 'minimax-bot-bridge'),
    };
    const capabilities = await readCapabilities(context);

    assert.deepEqual(capabilities, { skills: [], plugins: [], agents: [], mcp: [] });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
