const text = (value) => (typeof value === 'string' ? value : '');
const numberTime = (value) => {
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  return text(value);
};

export function stableHash(value) {
  const source = typeof value === 'string' ? value : JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function fragmentBlock(fragment) {
  const type = text(fragment?.type).toUpperCase();
  if (type === 'REQUEST' || type === 'RESPONSE') return { type: 'text', text: text(fragment.content) };
  if (type === 'THINK') return { type: 'reasoning', text: text(fragment.content), elapsedSecs: fragment.elapsed_secs ?? null };
  if (type === 'TOOL_SEARCH' || type === 'TOOL_IMAGE_SEARCH' || type === 'SEARCH') {
    return {
      type: 'search',
      queries: Array.isArray(fragment.queries) ? fragment.queries.map(text) : [],
      results: Array.isArray(fragment.results) ? fragment.results.map((item) => ({
        title: text(item?.title),
        url: text(item?.url || item?.source_page_url),
        snippet: text(item?.snippet),
      })) : [],
    };
  }
  if (type === 'TOOL_OPEN' || type === 'READ_LINK') return { type: 'search', queries: [], results: fragment.results ?? [fragment] };
  if (type === 'FILE') {
    return { type: 'attachment', files: Array.isArray(fragment.files) ? fragment.files.map((file) => ({
      id: text(file?.id), name: text(file?.file_name || file?.name), size: Number(file?.file_size || 0),
      sourcePath: text(file?.export_path),
      available: false,
    })) : [] };
  }
  if (fragment?.content != null) return { type: 'notice', label: type || 'UNKNOWN', text: text(fragment.content) };
  return null;
}

function normalizeMessage(raw, fallbackId) {
  const fragments = Array.isArray(raw?.fragments) ? raw.fragments : [];
  const blocks = fragments.map(fragmentBlock).filter(Boolean);
  if (!blocks.length && raw?.content != null) blocks.push({ type: 'text', text: text(raw.content) });
  if (raw?.thinking_content) blocks.unshift({ type: 'reasoning', text: text(raw.thinking_content), elapsedSecs: raw.thinking_elapsed_secs ?? null });
  if (Array.isArray(raw?.search_results) && raw.search_results.length) {
    blocks.push({ type: 'search', queries: [], results: raw.search_results.map((item) => ({
      title: text(item?.title), url: text(item?.url), snippet: text(item?.snippet),
    })) });
  }
  if (Array.isArray(raw?.files) && raw.files.length) {
    blocks.push({ type: 'attachment', files: raw.files.map((file) => ({
      id: text(file?.id), name: text(file?.file_name || file?.name), size: Number(file?.file_size || file?.size || 0), available: false,
    })) });
  }
  const inferred = fragments.some((item) => text(item?.type).toUpperCase() === 'REQUEST') ? 'user'
    : fragments.some((item) => text(item?.type).toUpperCase() === 'RESPONSE') ? 'assistant' : '';
  return {
    id: String(raw?.id ?? raw?.message_id ?? fallbackId),
    parentId: raw?.parent_id == null ? null : String(raw.parent_id),
    role: text(raw?.role).toLowerCase() || inferred || 'assistant',
    status: text(raw?.status || 'FINISHED'),
    createdAt: numberTime(raw?.inserted_at || raw?.created_at),
    blocks,
  };
}

function finalize(raw, messages, sourceSchema) {
  const id = text(raw?.id || raw?.chat_session?.id) || stableHash(raw);
  const currentMessageId = raw?.current_message_id ?? raw?.chat_session?.current_message_id ?? null;
  const conversation = {
    sourceSchema,
    sourceId: id,
    title: text(raw?.title || raw?.chat_session?.title) || 'Untitled conversation',
    createdAt: numberTime(raw?.inserted_at || raw?.created_at || raw?.chat_session?.inserted_at),
    updatedAt: numberTime(raw?.updated_at || raw?.chat_session?.updated_at),
    currentMessageId: currentMessageId == null ? null : String(currentMessageId),
    messages,
  };
  conversation.stableId = `${sourceSchema}:${id}:${stableHash(messages.map((message) => [message.id, message.parentId, message.blocks]))}`;
  conversation.approxChars = messages.reduce((sum, message) => sum + JSON.stringify(message.blocks).length, 0);
  conversation.turnCount = messages.filter((message) => message.role === 'user').length;
  conversation.branchCount = countBranches(messages);
  return conversation;
}

function countBranches(messages) {
  const counts = new Map();
  for (const message of messages) {
    if (message.parentId != null) counts.set(message.parentId, (counts.get(message.parentId) || 0) + 1);
  }
  return [...counts.values()].reduce((sum, value) => sum + Math.max(0, value - 1), 0);
}

export function activeBranch(conversation) {
  if (!conversation.messages.length) return [];
  const byId = new Map(conversation.messages.map((message) => [message.id, message]));
  let leaf = conversation.currentMessageId && byId.get(conversation.currentMessageId);
  if (!leaf) {
    const parents = new Set(conversation.messages.map((message) => message.parentId).filter(Boolean));
    leaf = [...conversation.messages].reverse().find((message) => !parents.has(message.id)) || conversation.messages.at(-1);
  }
  const path = [];
  const seen = new Set();
  while (leaf && !seen.has(leaf.id)) {
    path.push(leaf);
    seen.add(leaf.id);
    leaf = leaf.parentId == null ? null : byId.get(leaf.parentId);
  }
  return path.reverse();
}

const officialV3Parser = {
  id: 'deepseek-v3',
  detect(value) {
    return value?.export_format_version === 3 || (value?.id && Array.isArray(value?.messages) && value.messages.some((item) => Array.isArray(item?.fragments)));
  },
  parse(value) {
    const sessions = Array.isArray(value) ? value : value?.sessions ?? [value];
    return sessions.filter((item) => item?.id && Array.isArray(item?.messages))
      .map((item) => finalize(item, item.messages.map(normalizeMessage), this.id));
  },
};

const legacyMappingParser = {
  id: 'deepseek-mapping',
  detect(value) {
    const sample = Array.isArray(value) ? value[0] : value?.conversations?.[0] ?? value;
    return Boolean(sample?.mapping);
  },
  parse(value) {
    const conversations = Array.isArray(value) ? value : value?.conversations ?? [value];
    return conversations.filter((item) => item?.id && item?.mapping).map((item) => {
      const nodes = Object.values(item.mapping).filter((node) => node?.message);
      const messages = nodes.map((node, index) => normalizeMessage({
        ...node.message, id: node.id ?? node.message.id, parent_id: node.parent ?? node.message.parent_id,
      }, index + 1));
      const current = item.current_node ?? item.current_message_id;
      return finalize({ ...item, current_message_id: current }, messages, this.id);
    });
  },
};

const legacyFlatParser = {
  id: 'deepseek-flat',
  detect(value) {
    const sample = Array.isArray(value) ? value[0]?.data ?? value[0] : value?.data?.biz_data ?? value;
    return Boolean(sample?.chat_session && Array.isArray(sample?.chat_messages || sample?.messages));
  },
  parse(value) {
    const entries = Array.isArray(value) ? value : [value];
    return entries.map((entry) => entry?.data?.biz_data ?? entry?.data ?? entry)
      .filter((item) => item?.chat_session)
      .map((item) => finalize(item, (item.chat_messages || item.messages || []).map(normalizeMessage), this.id));
  },
};

const deepSeekParsers = [officialV3Parser, legacyMappingParser, legacyFlatParser];

export function parseDeepSeekExport(value) {
  for (const parser of deepSeekParsers) {
    if (parser.detect(value)) return parser.parse(value);
  }
  throw new Error('This JSON does not match a supported DeepSeek conversation export.');
}
