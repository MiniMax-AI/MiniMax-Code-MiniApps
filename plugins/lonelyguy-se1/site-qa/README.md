# Site QA (`site-qa`)

Check the website project you are building for on-page SEO and accessibility gaps. Pick a site root, review findings, press **Ask agent** to put a fix prompt in the chat draft. You review it, press Send, and the Agent does that item.

Author: [LonelyGuySE1](https://github.com/LonelyGuy-SE1) · Version: `1.2.0`

Static HTML checklist aligned with Google-style SEO starter signals, Lighthouse SEO-style audits, and WCAG items that can be judged from markup. About 60 automated rules across document, SEO, and accessibility. Not a hosted Lighthouse / WAVE clone and not a WCAG conformance claim.

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
- Verified while developing on Linux (Node.js 22 package tests + local install at `~/.minimax/plugins/site-qa/` against a sample site project).
- macOS and Windows MiniMax Code installs are not verified in this package yet.
- Package tests cover HTML rules, site-root discovery, path guards, scan discovery, HTTP entry, CLI output, and fix-prompt text.

## Data & access

- **Files:** reads HTML under the chosen site root (or project-folder candidates). Also reads `robots.txt` / `sitemap.xml` / `sitemap_index.xml` at that root when present. Skips `node_modules`, VCS and cache directories, and hidden directories. Refuses home, filesystem roots, and MiniMax data dirs. Writes nothing outside its own runtime. The CLI uses the same scanner.
- **Network:** none.
- **Processes:** none beyond the Mini App Node runtime / CLI process you start.
- **Agent turns:** none started by this Mini App (`session.run` not declared). The skill may instruct the Agent to run the CLI in a shell.
- **Conversations:** `session.read` only for the current project folder (`workspaceDir`). Does not list conversations, observe turns, or read message text.
- **Chat draft:** **Ask agent** / **Ask agent to fix** call `message.append` with Host confirmation.
- **Tools / microphone / camera / notifications / current page:** not used. No `toolAccess`, `deviceAccess`, or `hostAccess`.

## Checks included

**Document:** doctype, charset, favicon, `target="_blank"` without `rel="noopener"`, oversized HTML skip.

**SEO (on-page + site files):**
- Title: missing, too short/long, generic wording, cross-page duplicates
- Meta description: missing, multiple, too short/long, cross-page duplicates
- Viewport missing / weak
- Robots meta `noindex` / `nofollow`
- Canonical: missing, multiple, empty, non-absolute
- hreflang validity and absolute URLs
- Open Graph: `og:title`, `og:description`, `og:image`, `og:url`, `og:type`, absolute `og:image`
- Twitter card
- JSON-LD: missing, invalid JSON, missing `@type`
- H1 missing / multiple / empty; thin homepage copy
- Crawlable anchors (`#` / empty / `javascript:`), generic link text (“click here”, “read more”, …)
- `robots.txt`: missing, blocks all (`Disallow: /`), missing `Sitemap:`, suspicious content
- `sitemap.xml` / `sitemap_index.xml`: missing or empty

**Accessibility:**
- `lang` missing / invalid
- Heading level skips and empty headings
- Image `alt` missing / too long
- Link / button / ARIA-role accessible names
- Form labels for `input` / `textarea` / `select`
- iframe title
- `<main>` landmark, skip-to-content link
- `aria-hidden` on focusable controls, positive `tabindex`
- Video captions / subtitles track

## License

[MIT](./LICENSE)
