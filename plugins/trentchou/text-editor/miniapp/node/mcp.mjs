// @ts-check
// Mini App-managed Streamable HTTP MCP endpoint: lets the Agent read, write, create and save
// files through the same buffers the user sees in the editor.
import { EditorError } from './editor-service.mjs';

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const pathProp = {
  type: 'string',
  description: 'Absolute path inside one of the editor folders (preferred), or a path relative to the primary (first) folder. The primary folder follows the most recently active conversation, so it may not be your workspace; use absolute paths.',
};

const TOOLS = [
  {
    name: 'get_editor_state',
    description:
      'Get the text editor state shared with the user: sidebar folders (the only locations these tools can access; the first is the primary folder), open tabs with unsaved/conflict flags and highlight counts, the active file, the user\'s current selection, and the user\'s highlight settings. Call this first to learn which file the user is looking at.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_directory',
    description: 'List files and subdirectories of a directory inside the editor folders.',
    inputSchema: {
      type: 'object',
      properties: { path: { ...pathProp, description: `${pathProp.description} Defaults to the primary folder.` } },
      additionalProperties: false,
    },
  },
  {
    name: 'read_file',
    description:
      'Read a UTF-8 text file. If the file is open in the editor, this returns the live buffer including the user\'s unsaved edits; otherwise it reads from disk. Returns at most 2000 lines per call; use start_line/end_line (1-based, inclusive) for other ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_file',
    description:
      'Create a new file on disk inside the editor folders (fails if it already exists; missing parent directories are created) and open it in an editor tab.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        content: { type: 'string', description: 'Initial content. Defaults to empty.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    description:
      'Replace the whole content of an existing file in its editor buffer. The user sees the change live; it stays unsaved until save_file is called or save is true. Prefer edit_file for small changes.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        content: { type: 'string' },
        save: { type: 'boolean', description: 'Also save to disk after writing. Defaults to false.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact text snippet in the editor buffer of a file (the buffer includes unsaved edits). old_text must match exactly once unless replace_all is true. The change stays unsaved unless save is true.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        old_text: { type: 'string' },
        new_text: { type: 'string' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence. Defaults to false.' },
        save: { type: 'boolean', description: 'Also save to disk after editing. Defaults to false.' },
      },
      required: ['path', 'old_text', 'new_text'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_file',
    description:
      'Save a file\'s editor buffer to disk. Fails with CONFLICT if another program changed the file on disk since it was loaded, unless overwrite_external_changes is true.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        overwrite_external_changes: { type: 'boolean' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'open_in_editor',
    description:
      'Show something to the user. For a file inside the editor folders: open and focus its tab, optionally at a line. For a directory: add it to the sidebar as the primary folder so the other tools can access it. Call this with your workspace directory to bind the editor to your project.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file or directory path.' },
        line: { type: 'integer', minimum: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'highlight_code',
    description:
      'Highlight code for the user, e.g. findings during a code review. Highlights are editor overlays only: they never change the buffer or the file on disk. ' +
      'Each entry targets whole lines (start_line/end_line), a character range (add start_column/end_column; 1-based, end inclusive), or an exact snippet (text) that must occur exactly once in the current buffer. ' +
      'An optional note is shown as a comment under the highlighted code, coloured by kind. Opens the file in a tab; reveal (default true) scrolls the editor to the first new highlight. ' +
      'Lifetime is the user\'s choice: by default a highlight disappears once its code is edited or the file is closed; if the user keeps highlights, they stay until cleared. Use list_highlights to see which remain.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        highlights: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              start_line: { type: 'integer', minimum: 1 },
              end_line: { type: 'integer', minimum: 1, description: 'Last highlighted line. Defaults to start_line.' },
              start_column: { type: 'integer', minimum: 1, description: 'Highlight characters instead of whole lines, starting at this column of start_line.' },
              end_column: { type: 'integer', minimum: 1, description: 'Last highlighted column of end_line (inclusive). Defaults to the end of that line.' },
              text: { type: 'string', description: 'Exact snippet to highlight instead of line numbers; must match exactly once.' },
              kind: { type: 'string', enum: ['info', 'warning', 'error', 'success'], description: 'Colour / severity. Defaults to info.' },
              note: { type: 'string', maxLength: 2000, description: 'Plain-text comment shown under the highlighted code.' },
            },
            additionalProperties: false,
          },
        },
        replace: { type: 'boolean', description: 'Remove this file\'s existing highlights first. Defaults to false.' },
        reveal: { type: 'boolean', description: 'Scroll the editor to the first new highlight. Defaults to true.' },
      },
      required: ['path', 'highlights'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_highlights',
    description: 'List the code highlights that still exist (the user may have dismissed some, or edited the code so they disappeared), with ids and current line ranges.',
    inputSchema: {
      type: 'object',
      properties: { path: { ...pathProp, description: `${pathProp.description} Omit to list every file.` } },
      additionalProperties: false,
    },
  },
  {
    name: 'clear_highlights',
    description: 'Remove code highlights: the given ids, or all highlights of one file (path), or every highlight when neither is given.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        path: pathProp,
      },
      additionalProperties: false,
    },
  },
];

const INSTRUCTIONS =
  'Text editor shared live with the user. Tools can only access files inside the editor sidebar folders (see get_editor_state; add your workspace with open_in_editor). Credential files such as .env, .secrets/ and private keys are not readable or writable through these tools. write_file and edit_file change the buffer the user sees and stay unsaved until save_file. To point the user at code (reviews, explanations), use highlight_code: highlights never modify files.';

/** @param {unknown} value */
const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

/** @param {import('./editor-service.mjs').EditorService} service */
function pageNote(service) {
  return service.pageCount === 0
    ? '\nNote: no editor page is open, so the user cannot see this yet. Ask the host to open the text-editor Mini App.'
    : '';
}

/** @param {import('./editor-service.mjs').EditorService} service */
function highlightNote(service) {
  const { highlightsVisible, highlightsPersist } = service.settings;
  const lifetime = highlightsPersist
    ? 'The user keeps highlights until they or you clear them.'
    : 'With the user\'s current setting, a highlight disappears once its code is edited or its file is closed.';
  return `${lifetime}${highlightsVisible ? '' : ' The user has hidden highlights right now; they are kept and reappear when the user shows them again.'}`;
}

/** @param {ReturnType<import('./editor-service.mjs').EditorService['describeHighlight']>} h */
function describe(h) {
  const where = h.lines
    ? (h.startLine === h.endLine ? `line ${h.startLine}` : `lines ${h.startLine}-${h.endLine}`)
    : `${h.startLine}:${h.startColumn}-${h.endLine}:${h.endColumn} (line:column)`;
  const note = h.note ? ` — ${h.note.length > 160 ? `${h.note.slice(0, 160)}…` : h.note}`.replace(/\n/g, ' ') : '';
  return `- ${h.id} [${h.kind}] ${where}${h.fileClosed ? ' (file closed)' : ''}${note}`;
}

/**
 * @param {import('./editor-service.mjs').EditorService} service
 * @param {string} name
 * @param {any} args
 */
async function callTool(service, name, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  switch (name) {
    case 'get_editor_state':
      return text(service.editorState());
    case 'list_directory': {
      const result = await service.agentList(a.path);
      const lines = result.entries.map((e) => `${e.kind === 'dir' ? 'dir ' : e.kind === 'file' ? 'file' : e.kind}  ${e.name}${e.kind === 'dir' ? '/' : ''}`);
      return text(`${result.path}\n${lines.join('\n') || '(empty directory)'}${result.truncated ? '\n(list truncated)' : ''}`);
    }
    case 'read_file': {
      const r = await service.agentRead(a.path, a.start_line, a.end_line);
      const more = r.endLine < r.totalLines ? ` Use start_line=${r.endLine + 1} to continue.` : '';
      const header = `File: ${r.path}\nSource: ${r.source}${r.dirty ? ' (has unsaved edits)' : ''}\nLines ${r.startLine}-${r.endLine} of ${r.totalLines}.${more}${r.clipped ? ' Output clipped by size.' : ''}`;
      return text(`${header}\n----\n${r.content}`);
    }
    case 'create_file': {
      const r = await service.agentCreate(a.path, a.content, true);
      return text(`Created ${r.path} and opened it in the editor.${pageNote(service)}`);
    }
    case 'write_file': {
      const r = await service.agentWrite(a.path, a.content, a.save);
      const state = r.saved ? 'saved to disk' : r.dirty ? 'unsaved in the editor (call save_file to persist)' : 'identical to disk';
      return text(`${r.changed ? 'Updated' : 'No change to'} ${r.path}; now ${state}.${pageNote(service)}`);
    }
    case 'edit_file': {
      const r = await service.agentEdit(a.path, a.old_text, a.new_text, a.replace_all, a.save);
      const state = r.saved ? 'saved to disk' : r.dirty ? 'unsaved in the editor (call save_file to persist)' : 'identical to disk';
      return text(`Replaced ${r.replacements} occurrence(s) in ${r.path}; now ${state}.${pageNote(service)}`);
    }
    case 'save_file': {
      const r = await service.agentSave(a.path, a.overwrite_external_changes);
      return text(r.saved ? `Saved ${r.path} (${r.bytes} bytes).` : `${r.path} has no unsaved changes; nothing to save.`);
    }
    case 'open_in_editor': {
      const r = await service.agentOpen(a.path, a.line);
      const message = r.kind === 'folder'
        ? `${r.added ? 'Added' : 'Moved'} ${r.path} as the primary editor folder.`
        : `Opened ${r.path}${r.line ? ` at line ${r.line}` : ''}.`;
      return text(`${message}${pageNote(service)}`);
    }
    case 'highlight_code': {
      const r = await service.agentHighlight(a.path, a.highlights, { replace: a.replace, reveal: a.reveal });
      const replaced = r.replaced ? ` (removed ${r.replaced} earlier highlight(s) first)` : '';
      return text(`Highlighted ${r.items.length} range(s) in ${r.path}${replaced}:\n${r.items.map(describe).join('\n')}\n${highlightNote(service)}${pageNote(service)}`);
    }
    case 'list_highlights': {
      const r = service.agentListHighlights(a.path);
      if (!r.files.length) return text(`No highlights${a.path ? ' in this file' : ''}. ${highlightNote(service)}`);
      const body = r.files.map((f) => `${f.path}\n${f.items.map(describe).join('\n')}`).join('\n\n');
      return text(`${body}\n\n${highlightNote(service)}`);
    }
    case 'clear_highlights': {
      const removed = service.agentClearHighlights(a.ids, a.path);
      return text(`Removed ${removed} highlight(s).`);
    }
    default:
      return null;
  }
}

/** @param {string} name @param {{ version: string }} info @param {import('./editor-service.mjs').EditorService} service */
export function createMcpHandler(service, name, info) {
  /** @param {any} msg */
  async function handleMessage(msg) {
    const hasId = msg && typeof msg === 'object' && 'id' in msg && msg.id !== null && msg.id !== undefined;
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return hasId ? rpcError(msg.id, -32600, 'Invalid Request') : null;
    }
    if (!hasId) return null; // notifications (initialized, cancelled, ...) need no response
    switch (msg.method) {
      case 'initialize': {
        const requested = msg.params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
        return rpcResult(msg.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name, version: info.version },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return rpcResult(msg.id, {});
      case 'tools/list':
        return rpcResult(msg.id, { tools: TOOLS });
      case 'tools/call': {
        const toolName = msg.params?.name;
        if (!TOOLS.some((t) => t.name === toolName)) return rpcError(msg.id, -32602, `Unknown tool: ${toolName}`);
        try {
          return rpcResult(msg.id, await callTool(service, toolName, msg.params?.arguments));
        } catch (error) {
          if (error instanceof EditorError) {
            const extra = error.extra?.folders ? `\nEditor folders: ${JSON.stringify(error.extra.folders)}` : '';
            return rpcResult(msg.id, { ...text(`${error.code}: ${error.message}${extra}`), isError: true });
          }
          throw error;
        }
      }
      default:
        return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  /** @param {unknown} body @returns {Promise<{ status: number, payload?: unknown }>} */
  return async function handle(body) {
    if (Array.isArray(body)) {
      if (!body.length) return { status: 400, payload: rpcError(null, -32600, 'Empty batch') };
      const responses = (await Promise.all(body.map(handleMessage))).filter(Boolean);
      return responses.length ? { status: 200, payload: responses } : { status: 202 };
    }
    const response = await handleMessage(body);
    return response ? { status: 200, payload: response } : { status: 202 };
  };
}

/** @param {unknown} id @param {unknown} result */
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
/** @param {unknown} id @param {number} code @param {string} message */
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
