/**
 * What the desktop can do beyond answering in a chat.
 *
 * The desktop's own skills, plugins and agents are read from the Host's installation
 * and nothing else. The bridge never runs them and never writes to them: it tells the
 * phone what is there, so the user can ask for one by name — a skill the way the
 * desktop writes it, `/name`.
 *
 * Everything here is best effort. A directory the Host does not have is simply not
 * listed, because one missing folder must not turn the whole list into an error.
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** How many entries of one kind are listed. */
const LIMIT = 300;

/** The folders under the plugins directory that are not plugins themselves. */
const NOT_PLUGINS = new Set(['cache', 'marketplaces']);

/**
 * The Host's home directory, found from the bridge's own data directory.
 *
 * The bridge's data lives in `<home>/v2/plugin-data/liveboards/<plugin>`, so the home
 * is four levels up.
 *
 * @param {any} context
 * @returns {string} the home directory, or '' when the bridge does not know where it is
 */
export function hostHome(context) {
  const dataDir = String(context?.dataDir ?? '');
  if (!dataDir) return '';
  return resolve(dataDir, '..', '..', '..', '..');
}

/**
 * The front matter of a Markdown file: the block between the first two `---` lines.
 *
 * A value may be quoted over several lines, which is how the longer descriptions are
 * written, so a quote that is not closed yet takes the lines that follow it.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function frontmatter(text) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  if (!block) return {};
  /** @type {Record<string, string>} */
  const out = {};
  const lines = block[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[index]);
    if (!pair) continue;
    let value = pair[2].trim();
    if (value.startsWith('"') && !value.endsWith('"')) {
      const parts = [value.slice(1)];
      while (index + 1 < lines.length) {
        index += 1;
        const next = lines[index].trim();
        parts.push(next);
        if (next.endsWith('"')) {
          parts[parts.length - 1] = next.slice(0, -1);
          break;
        }
      }
      value = parts.join(' ').trim();
    } else if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      value = value.slice(1, -1);
    }
    out[pair[1]] = value;
  }
  return out;
}

/**
 * The directories in a folder, or none when the folder cannot be read.
 *
 * A junction counts as a folder: the Host keeps the skills it installed as junctions
 * into the user's own skill folders, and a reader that only accepts real folders would
 * miss most of them.
 *
 * @param {string} dir
 * @returns {Promise<import('node:fs').Dirent[]>}
 */
async function directories(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter(
    (entry) => entry.isDirectory() || entry.isSymbolicLink(),
  );
}

/**
 * The skills the desktop has.
 *
 * A skill is a folder with a `SKILL.md` in it; its name and its description are in the
 * file's front matter. Two places are read: the skills the user installed, and the ones
 * the Host carries itself.
 *
 * @param {string} home
 * @returns {Promise<Array<{id: string, name: string, description?: string, source: string}>>}
 */
export async function readSkills(home) {
  if (!home) return [];
  const roots = [
    { dir: resolve(home, 'skills'), source: 'user' },
    { dir: resolve(home, '.builtin-skills'), source: 'built-in' },
  ];
  const skills = [];
  const seen = new Set();
  for (const root of roots) {
    for (const folder of await directories(root.dir)) {
      if (folder.name.startsWith('.')) continue;
      const text = await readFile(resolve(root.dir, folder.name, 'SKILL.md'), 'utf8').catch(() => '');
      if (!text) continue;
      const meta = frontmatter(text);
      const id = meta.name || folder.name;
      if (seen.has(id)) continue;
      seen.add(id);
      skills.push({
        id,
        name: meta.name || folder.name,
        ...(meta.description ? { description: meta.description } : {}),
        source: root.source,
      });
    }
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id)).slice(0, LIMIT);
}

/**
 * The plugins the desktop has.
 *
 * Two sources are read: the plugins installed under the Host's home, and the official
 * ones the Host keeps in its cache. Both carry the same manifest.
 *
 * @param {string} home
 * @returns {Promise<Array<{id: string, name: string, description?: string, source: string, version?: string}>>}
 */
export async function readPlugins(home) {
  if (!home) return [];
  const roots = [
    { dir: resolve(home, 'plugins'), source: 'installed' },
    { dir: resolve(home, 'v2', 'plugin-cache', 'official'), source: 'official' },
  ];
  const plugins = [];
  for (const root of roots) {
    for (const folder of await directories(root.dir)) {
      if (root.source === 'installed' && NOT_PLUGINS.has(folder.name)) continue;
      const manifest = await readFile(
        resolve(root.dir, folder.name, '.minimax-plugin', 'plugin.json'),
        'utf8',
      ).catch(() => '');
      if (!manifest) continue;
      let meta;
      try {
        meta = JSON.parse(manifest);
      } catch {
        continue;
      }
      const id = String(meta.name ?? folder.name);
      plugins.push({
        id,
        name: String(meta.displayName ?? meta.name ?? folder.name),
        ...(meta.description ? { description: String(meta.description) } : {}),
        source: root.source,
        ...(meta.version ? { version: String(meta.version) } : {}),
      });
    }
  }
  // The same plugin can be installed and cached; the installed one is the one that runs.
  const byId = new Map();
  for (const plugin of plugins) {
    const known = byId.get(plugin.id);
    if (!known || plugin.source === 'installed') byId.set(plugin.id, plugin);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, LIMIT);
}

/**
 * The agents the desktop has.
 *
 * An agent is a worker the desktop can hand a task to. Its own folder carries only its
 * settings, so what the phone gets is the name it is called by.
 *
 * @param {string} home
 * @returns {Promise<Array<{id: string, name: string, description?: string, source: string}>>}
 */
export async function readAgents(home) {
  if (!home) return [];
  const root = resolve(home, 'agents');
  const folders = await directories(root);
  const agents = [];
  for (const folder of folders) {
    if (folder.name.startsWith('.')) continue;
    const settings = await readFile(resolve(root, folder.name, 'config.yaml'), 'utf8').catch(() => '');
    const description = settings.match(/description:\s*(.+)/)?.[1]?.trim();
    agents.push({
      id: folder.name,
      name: folder.name,
      ...(description ? { description } : {}),
      source: 'installed',
    });
  }
  return agents.sort((a, b) => a.id.localeCompare(b.id)).slice(0, LIMIT);
}

/**
 * The MCP servers the desktop has.
 *
 * A Bot's turn can call the tools of these servers; the phone cannot call them itself,
 * so the list is what the desktop can do, shown next to its skills and plugins.
 *
 * @param {string} home
 * @returns {Promise<Array<{id: string, name: string, description?: string, source: string}>>}
 */
export async function readMcpServers(home) {
  if (!home) return [];
  const registry = await readFile(resolve(home, 'mcp.json'), 'utf8').catch(() => '');
  if (!registry) return [];
  let servers;
  try {
    servers = JSON.parse(registry)?.mcpServers;
  } catch {
    return [];
  }
  if (!servers || typeof servers !== 'object') return [];
  return Object.entries(servers)
    .map(([id, server]) => ({
      id,
      name: id,
      ...(server?.description ? { description: String(server.description) } : {}),
      source: server?.builtin ? 'built-in' : 'user',
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, LIMIT);
}

/**
 * Everything the desktop can be asked to use.
 *
 * @param {any} context
 * @returns {Promise<{skills: any[], plugins: any[], agents: any[], mcp: any[]}>}
 */
export async function readCapabilities(context) {
  const home = hostHome(context);
  const [skills, plugins, agents, mcp] = await Promise.all([
    readSkills(home),
    readPlugins(home),
    readAgents(home),
    readMcpServers(home),
  ]);
  return { skills, plugins, agents, mcp };
}
