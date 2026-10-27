// @ts-check
// The `cutline_export` tool, added next to the upstream ones.
//
// The upstream dispatcher is not touched: the wrapper answers the two messages
// that concern the new tool and passes everything else on. The upstream tools
// keep their names, their schemas and their behaviour.
//
// The tool does not render. It prepares a job and hands back the path of a
// standalone runner that the Agent starts itself — see export/prepare.mjs and
// export/export-mcp.mjs.

/**
 * @param {{
 *   handleMessage: (message: any) => Promise<any>,
 *   tool: { name: string, description: string, inputSchema: Record<string, unknown> },
 *   handleTool: (args: Record<string, any>) => Promise<{ text: string, structured?: Record<string, unknown> }> | { text: string, structured?: Record<string, unknown> },
 * }} options
 */
export function withExportTool({ handleMessage, tool, handleTool }) {
  /**
   * @param {any} message
   * @returns {Promise<any>}
   */
  return async function handleMessageWithExportTool(message) {
    const method = message?.method;

    if (method === 'tools/list') {
      const reply = await handleMessage(message);
      const tools = reply?.result?.tools;
      if (Array.isArray(tools) && !tools.some((entry) => entry?.name === tool.name)) {
        tools.push(tool);
      }
      return reply;
    }

    if (method === 'tools/call' && message?.params?.name === tool.name) {
      const id = message?.id;
      try {
        const answer = await handleTool(message.params.arguments || {});
        /** @type {Record<string, any>} */
        const result = { content: [{ type: 'text', text: String(answer.text) }] };
        // The structured fields travel with the text: the absolute paths and
        // the argument list, for an Agent that builds the command itself.
        if (answer.structured) result.structuredContent = answer.structured;
        return { jsonrpc: '2.0', id, result };
      } catch (error) {
        const message_ = error instanceof Error ? error.message : String(error);
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Error: ${message_}` }], isError: true },
        };
      }
    }

    return handleMessage(message);
  };
}
