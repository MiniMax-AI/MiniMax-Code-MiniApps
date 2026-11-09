# Site QA (`site-qa`)

Check the website project you are building for on-page SEO and accessibility gaps. Pick a site root, review findings, press **Ask agent** to put a fix prompt in the chat draft. You review it, press Send, and the Agent does that item.

Author: [LonelyGuySE1](https://github.com/LonelyGuy-SE1) · Version: `1.2.0`

Static HTML checklist aligned with common SEO starter guidance, Lighthouse-style signals, and WCAG items that can be judged from markup. Not a hosted Lighthouse / WAVE clone and not a WCAG conformance claim.

## Install

Copy this directory, including the hidden `.minimax-plugin/` directory, to:

```text
<dataDir>/plugins/site-qa/
```

`<dataDir>` defaults to `~/.minimax`. Restart MiniMax Code, then ask the Agent to “Open Site QA”, or open it from the plugin list. Prefer opening it from the conversation that owns the site project so the site-root menu can fill itself.

## Use

1. Open from the project chat. Site QA reads the project folder and lists likely site roots (`public/`, `dist/`, `docs/`, folders with `index.html`, etc.).
2. It auto-checks when a site root is ready. You can also press **Check site**.
3. Filter findings by severity or category. Press **Ask agent** on one finding, or **Ask agent to fix** for the top set. Confirm the Host append dialog, then press Send in chat.
4. The Agent can also run the same checks headlessly via the bundled skill / CLI (see below).

## Agent skill / CLI

The package ships `skills/site-qa/SKILL.md`. The Agent should open the Mini App for interactive review, or run:

```bash
node ~/.minimax/plugins/site-qa/skills/site-qa/run.mjs /absolute/path/to/site
```

Use `--json` for machine-readable output. The skill tells the Agent not to dig through plugin source just to invent a parallel audit.

## Tested environment

- MiniMax Code 3.1.6 or later is required (`session.read` + `surface.window`).
- Package tests on Node.js 22 cover HTML rules, site-root discovery, path guards, scan discovery, HTTP entry, CLI output, and fix-prompt text.

## Data & access

- **Files:** reads HTML under the chosen site root (or project-folder candidates). Skips `node_modules`, VCS and cache directories, and hidden directories. Refuses home, filesystem roots, and MiniMax data dirs. Writes nothing outside its own runtime. The CLI uses the same scanner.
- **Network:** none.
- **Processes:** none beyond the Mini App Node runtime / CLI process you start.
- **Agent turns:** none started by this Mini App (`session.run` not declared). The skill may instruct the Agent to run the CLI in a shell.
- **Conversations:** `session.read` only for the current project folder.
- **Chat draft:** **Ask agent** / **Ask agent to fix** call `message.append` with Host confirmation.

## Checks included

**Document:** doctype, charset, favicon, `target=_blank` + `noopener`.

**SEO:** title (presence, length, generic wording, cross-page duplicates), meta description (presence, length, duplicates), viewport, robots `noindex`/`nofollow`, canonical, hreflang validity, Open Graph + Twitter card, JSON-LD presence/parse/`@type`, H1, thin homepage copy, crawlable anchors, generic link text (“click here”), `robots.txt` (missing / blocks all / Sitemap line), `sitemap.xml`.

**Accessibility:** `lang`, heading hierarchy / empty headings, image `alt`, link/button/ARIA-role names, form labels (`input`/`textarea`/`select`), iframe titles, `main` landmark, skip link, `aria-hidden` on focusable controls, positive `tabindex`, video captions track.

## License

[MIT](./LICENSE)
