// @ts-check
// Read-only view of the examples shipped with the anatomy skill.
// A standalone install (from before the gallery, or installed later) always wins, so people who
// already use anatomy keep their own copy and version. The copy bundled in this package
// (skills/anatomy, upstream wheresryan22/anatomy @ bc943e4) is used only when none is installed.
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SKILL_ROOTS = [
  '.minimax/skills/anatomy',
  '.agents/skills/anatomy',
  '.claude/skills/anatomy',
  '.codex/skills/anatomy',
  '.config/opencode/skills/anatomy',
];

/** @param {string} path */
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** @param {string} path */
async function readTitle(path) {
  const head = (await readFile(path, 'utf8')).slice(0, 200_000);
  const titles = [...head.matchAll(/<title>([^<]{1,120})<\/title>/gi)].map((m) => m[1].trim());
  return titles.find((title) => !title.includes('${')) ?? '';
}

/**
 * Where the anatomy skill lives right now. Checked on every run, so installing or removing a
 * standalone copy takes effect without restarting the gallery.
 * @param {string} [pluginRoot] the gallery package root, which carries the bundled copy
 * @returns {Promise<{ root: string, bundled: boolean } | null>}
 */
export async function resolveSkill(pluginRoot) {
  for (const relative of SKILL_ROOTS) {
    const root = join(homedir(), relative);
    if (await isFile(join(root, 'SKILL.md'))) return { root, bundled: false };
  }
  if (pluginRoot) {
    const root = join(pluginRoot, 'skills', 'anatomy');
    if (await isFile(join(root, 'SKILL.md'))) return { root, bundled: true };
  }
  return null;
}

/** @param {string} [pluginRoot] */
export function createExamples(pluginRoot) {
  /** @type {Promise<{ root: string | null, items: any[] }> | null} */
  let cache = null;

  async function discover() {
    const root = (await resolveSkill(pluginRoot))?.root ?? null;
    if (!root) return { root: null, items: [] };
    const examplesDir = join(root, 'examples');
    const assetsDir = join(root, '.github', 'assets');
    let names = [];
    try {
      names = (await readdir(examplesDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => /^[a-z0-9-]+$/.test(name))
        .sort();
    } catch {
      return { root, items: [] };
    }
    let assets = [];
    try {
      assets = await readdir(assetsDir);
    } catch {
      assets = [];
    }
    const items = [];
    for (const name of names) {
      const dark = join(examplesDir, name, `${name}.html`);
      if (!(await isFile(dark))) continue; // React examples have no standalone page.
      const light = join(examplesDir, name, `${name}-light.html`);
      const previewName =
        assets.find((file) => file === `${name}.webp`) ?? assets.find((file) => file.startsWith(`${name}-`) && file.endsWith('.webp'));
      items.push({
        name,
        title: (await readTitle(dark)) || name,
        dark,
        light: (await isFile(light)) ? light : null,
        preview: previewName ? join(assetsDir, previewName) : null,
      });
    }
    return { root, items };
  }

  async function load() {
    cache ??= discover().catch((error) => {
      cache = null;
      throw error;
    });
    return cache;
  }

  return {
    load,
    /** Public listing without filesystem paths. */
    async list() {
      const { root, items } = await load();
      return {
        installed: !!root,
        items: items.map((item) => ({
          name: item.name,
          title: item.title,
          hasLight: !!item.light,
          hasPreview: !!item.preview,
        })),
      };
    },
    /** @param {string} name */
    async get(name) {
      const { items } = await load();
      return items.find((item) => item.name === name) ?? null;
    },
  };
}
