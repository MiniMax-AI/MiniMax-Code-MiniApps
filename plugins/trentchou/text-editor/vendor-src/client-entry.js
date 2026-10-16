// Client-side CodeMirror bundle for the text-editor Mini App.
// Namespaced re-exports avoid ambiguous star exports across packages.
export * as state from '@codemirror/state';
export * as view from '@codemirror/view';
export * as commands from '@codemirror/commands';
export * as language from '@codemirror/language';
export * as search from '@codemirror/search';
export * as autocomplete from '@codemirror/autocomplete';
export * as collab from '@codemirror/collab';
export { tags } from '@lezer/highlight';
export { showMinimap } from '@replit/codemirror-minimap';
export { indentationMarkers } from '@replit/codemirror-indentation-markers';

import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { xml } from '@codemirror/lang-xml';
import { sql } from '@codemirror/lang-sql';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';

export const langs = { json, yaml, javascript, python, markdown, html, css, xml, sql, rust, go, java, cpp, php };

import { toml } from '@codemirror/legacy-modes/mode/toml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { r } from '@codemirror/legacy-modes/mode/r';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { csharp, scala, kotlin, dart, objectiveC } from '@codemirror/legacy-modes/mode/clike';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { julia } from '@codemirror/legacy-modes/mode/julia';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { sass } from '@codemirror/legacy-modes/mode/sass';

export const legacy = {
  toml, shell, dockerFile, properties, diff, lua, ruby, swift, perl, r, nginx, protobuf, powerShell,
  csharp, scala, kotlin, dart, objectiveC, haskell, erlang, groovy, julia, cmake, sass,
};
