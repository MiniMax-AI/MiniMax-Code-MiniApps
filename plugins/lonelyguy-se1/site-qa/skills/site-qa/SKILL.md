---
name: site-qa
description: Check a local site project for SEO and accessibility gaps with Site QA. Use when the user asks to open Site QA, audit SEO, check accessibility on a site they are building, fix Site QA findings, or verify robots.txt / sitemap / meta tags on local HTML.
---

# Site QA

Site QA scans **local HTML** (plus `robots.txt` / `sitemap.xml`) for SEO and accessibility gaps. Prefer the Mini App for interactive review. Prefer the CLI when you should produce findings yourself in chat.

## Do this

1. Open the Mini App with the Host open action and `pluginId: "site-qa"` when the user wants the UI.
2. For an Agent-driven check, run the CLI against the site root (often `public/`, `dist/`, `docs/`, or the folder with `index.html`):

```bash
node "$HOME/.minimax/plugins/site-qa/skills/site-qa/run.mjs" "/absolute/path/to/site"
```

Add `--json` for machine-readable output.

3. Fix the highest-impact **errors** first in the real site source. Re-run the CLI (or ask the user to re-scan in the Mini App) after edits.
4. If the chat draft already contains a Site QA finding prompt (from the Mini App **Ask agent** buttons), do **only that item**, then stop.

## Do not do this

- Do not explore or rewrite the Site QA plugin source unless the user is debugging the plugin itself.
- Do not invent a separate Lighthouse / WAVE crawl. This tool is static HTML only.
- Do not claim WCAG conformance from a green scan.

## Paths

Default install: `~/.minimax/plugins/site-qa/`.
If `MINIMAX_DATA_DIR` is set, use `$MINIMAX_DATA_DIR/plugins/site-qa/` instead.
Dev checkout may live under `plugins/lonelyguy-se1/site-qa/` in the MiniApps repo; same `skills/site-qa/run.mjs` entry.
