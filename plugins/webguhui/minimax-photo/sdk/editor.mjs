// Transport-independent programmatic client. The caller supplies the host's real
// MCP tool invocation function; this SDK never discovers private Host endpoints.
export function createEditorClient(callTool) {
  if (typeof callTool !== 'function') throw Error('需要实际 MCP 工具调用函数');
  async function call(name, args = {}) {
    const response = await callTool(name, args);
    if (response.isError)
      throw Error(response.content?.find((x) => x.type === 'text')?.text || '编辑工具失败');
    const text = response.content?.find((x) => x.type === 'text')?.text;
    if (!text) throw Error('编辑工具返回格式无效');
    return { value: JSON.parse(text), images: response.content.filter((x) => x.type === 'image') };
  }
  async function inspect(editorId) {
    return (await call('editor_inspect', { editorId })).value;
  }
  async function wait(jobId, { timeoutMs = 30000 } = {}) {
    const deadline = Date.now() + Math.min(60000, Math.max(0, timeoutMs));
    for (;;) {
      const result = await call('editor_job', { jobId });
      if (
        !['queued', 'running', 'prepared'].includes(result.value.status) ||
        Date.now() >= deadline
      )
        return result;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  async function submit(
    name,
    editorId,
    extra,
    { requestId = crypto.randomUUID(), expectedVersion } = {},
  ) {
    const version = expectedVersion ?? (await inspect(editorId)).version;
    return (await call(name, { editorId, expectedVersion: version, requestId, ...extra })).value;
  }
  return {
    capabilities: async () => (await call('editor_capabilities')).value,
    list: async () => (await call('editor_list')).value.editors,
    inspect,
    wait,
    job: (jobId) => call('editor_job', { jobId }),
    preview: (editorId, options = {}, request = {}) =>
      submit('editor_preview', editorId, { options }, request),
    create: (editorId, document, request = {}) =>
      submit('editor_create', editorId, document, request),
    export: (editorId, request = {}) => submit('editor_export', editorId, {}, request),
    async edit(editorId, plan, request = {}) {
      const state = await inspect(editorId);
      const operations = typeof plan === 'function' ? await plan(state.document) : plan;
      return submit(
        'editor_batch',
        editorId,
        { operations },
        { ...request, expectedVersion: request.expectedVersion ?? state.version },
      );
    },
  };
}
