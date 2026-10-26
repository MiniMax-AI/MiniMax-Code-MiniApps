// The workflows that are ready to use.
//
// A template is a **skeleton**: the steps, the lines between them, the
// prompts and the parameters — and nothing of what a run leaves behind. A
// template that carried results and uploaded material would hand the next
// person a canvas full of somebody else's files, so the skeleton keeps the
// steps and drops the现场.
//
// A template is a list of **actions**, the same actions the Agent asks for
// and the page performs. So a template is applied by performing them, and
// the rules that place a node, carry a line or refuse one are the same rules
// either way.
//
// The nodes a template creates are named by their order: `@1` is the first
// node the template makes, `@2` the second, and the lines point at those
// names. The real ids are handed out when the template is applied, so the
// same template can be applied twice on one canvas.
//
// The templates that ship with the MiniApp are **files**, not code. A
// template is data, and the user tunes his own by opening one, changing it
// and keeping it — so the shipped ones are written the same way: a file says
// the whole of it (the title, what it is for, the group it belongs to and
// the steps), and nobody has to touch the code to change one.
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the templates that ship with the MiniApp are kept. */
const BUILTIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/**
 * The templates that ship with the MiniApp.
 *
 * The files are read in the order of their names, so the panel shows the
 * templates in the order the names give. A file that cannot be read is not a
 * template: the package would be broken, and a half-read template is worse
 * than a missing one.
 */
function readBuiltinTemplates() {
  let names = [];
  try {
    names = readdirSync(BUILTIN_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      try {
        const parsed = JSON.parse(readFileSync(join(BUILTIN_DIR, name), 'utf8'));
        return Array.isArray(parsed?.actions) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export const BUILTIN_TEMPLATES = readBuiltinTemplates();

/**
 * The templates a machine carries of its own.
 *
 * They live under the runtime's own data directory, not in the package: a
 * template is the user's own, and it survives a new version of the MiniApp.
 */
export function templatesDir(dataDir) {
  return join(dataDir, 'templates');
}

/**
 * The name of a template of the user's own.
 *
 * One rule, shared by keeping a template and taking one away: a name is a
 * plain name — letters, digits, dot, underscore and dash — and it is never a
 * dot segment, so a name can only ever be a file inside the template folder.
 */
export function templateIdOf(value) {
  const name = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) return null;
  // A name that is only dots is a dot segment in another dress.
  if (/^\.+$/.test(name)) return null;
  return name;
}

/**
 * Keep a template of the user's own.
 *
 * It lives under the runtime's own data directory, not in the package: a
 * template is the user's own, and it survives a new version of the MiniApp.
 *
 * A template that is already there is not written over: the file is made
 * once, so the one that is there is kept and the new one is refused.
 */
export async function saveTemplate(dataDir, template) {
  const id = templateIdOf(template?.id);
  if (!id) return { ok: false, reason: 'bad_id' };
  const dir = templatesDir(dataDir);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${id}.json`);
  const body = `${JSON.stringify({ ...template, id }, null, 2)}\n`;
  try {
    // The file is written only into a name that is free.
    await writeFile(file, body, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') return { ok: false, reason: 'taken' };
    throw error;
  }
  return { ok: true, path: file, id };
}

/**
 * The built-in templates and the user's own, one list.
 *
 * A template of the user's own is listed by the file it is in: that name is
 * the name it is taken away by, and the two can never be different.
 */
export async function readTemplates(dataDir) {
  const own = [];
  try {
    for (const entry of await readdir(templatesDir(dataDir))) {
      if (!entry.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await readFile(join(templatesDir(dataDir), entry), 'utf8'));
        if (!Array.isArray(parsed?.actions)) continue;
        own.push({ ...parsed, id: entry.slice(0, -'.json'.length), own: true });
      } catch {
        // A template that cannot be read is one that is not there.
      }
    }
  } catch {
    // No folder yet: there are no templates of the user's own.
  }
  return [...BUILTIN_TEMPLATES.map((item) => ({ ...item, own: false })), ...own];
}

/**
 * Take a template of the user's own away.
 *
 * The name is the name of the file under the template folder, judged by the
 * one rule that also judges keeping a template: so a request cannot walk out
 * of the folder it belongs to, and it cannot take a built-in template away
 * either — those are not in this folder.
 */
export async function removeTemplate(dataDir, id) {
  const name = templateIdOf(id);
  if (!name) return false;
  const file = join(templatesDir(dataDir), `${name}.json`);
  try {
    // The link itself is looked at: a link that points at nothing is still a
    // file that is there, and it is taken away as one.
    await lstat(file);
  } catch {
    return false;
  }
  try {
    await rm(file, { force: true });
    return true;
  } catch {
    return false;
  }
}
