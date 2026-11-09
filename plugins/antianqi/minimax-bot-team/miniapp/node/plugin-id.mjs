// @ts-check

/**
 * The identity of this plugin, in one place.
 *
 * The MCP endpoint path, the name the tools are published under and the version the Host
 * shows all come from here, so a published package carries its own name without a second
 * copy of the same string somewhere else.
 */

/** The plugin id: the MCP server name and the endpoint path. */
export const PLUGIN_ID = 'minimax-bot-team';

/** The version the Host and the MCP tools report. */
export const PLUGIN_VERSION = '1.0.0';
