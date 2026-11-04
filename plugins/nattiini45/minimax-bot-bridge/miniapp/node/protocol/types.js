/**
 * Wire contract for the MiniMax Bot mobile client.
 *
 * Three roles sit on this protocol:
 *  - `app`    — the Expo client (phone / tablet / web).
 *  - `bridge` — the MiniMax Code Mini App plugin that owns the team.
 *  - `relay`  — the Cloudflare Worker + Durable Object that pipes frames between them.
 *
 * The relay never interprets a payload. It stamps a monotonic `seq` on every event it
 * forwards from the bridge and replays from a ring buffer when a client resumes, so the
 * phone is always a projection of bridge-owned truth.
 */
export const PROTOCOL_VERSION = 1;
/**
 * The WebSocket close codes the relay uses to say why a peer was refused.
 *
 * The relay accepts the upgrade first and closes the socket with one of these, so
 * the peer learns *why* it was refused. Answering the handshake with an HTTP error
 * instead would hide the reason behind a generic "connection failed" — a phone that
 * had been unpaired cannot tell that apart from a relay that is simply down.
 */
export const CLOSE_CODE = {
    /** The credential was not accepted. */
    unauthorized: 4001,
    /** Another peer took this peer's place. */
    replaced: 4000,
    /** The device was unpaired on the desktop. */
    deviceRevoked: 4003,
};
export const OP_TYPES = [
    'op.list_team',
    'op.bot_avatar',
    'op.send_message',
    'op.abort_turn',
    'op.dispatch',
    'op.list_tasks',
    'op.cancel_task',
    'op.list_helpers',
    'op.start_helper',
    'op.stop_helper',
    'op.recall',
    'op.remember',
    'op.forget',
    'op.create_bot',
    'op.update_bot',
    'op.delete_bot',
    'op.set_bot_mode',
    'op.create_group',
    'op.update_group',
    'op.delete_group',
    'op.list_schedules',
    'op.create_schedule',
    'op.delete_schedule',
    'op.get_usage',
    'op.respond_permission',
    'op.answer_question',
    'op.react',
    'op.list_history',
    'op.list_models',
    'op.list_capabilities',
];
export const EVENT_TYPES = [
    'evt.team_snapshot',
    'evt.turn_started',
    'evt.message_chunk',
    'evt.message_committed',
    'evt.tool_started',
    'evt.tool_finished',
    'evt.turn_finished',
    'evt.permission_requested',
    'evt.permission_resolved',
    'evt.question_requested',
    'evt.question_answered',
    'evt.task_updated',
    'evt.helper_updated',
    'evt.schedule_updated',
    'evt.bridge_status',
    'evt.reaction_added',
];
export function isOpType(type) {
    return OP_TYPES.includes(type);
}
export function isEventType(type) {
    return EVENT_TYPES.includes(type);
}
/**
 * Checks a client-chosen message id.
 *
 * The bridge accepts the id and stores it as the committed message id, so it is
 * restricted to a short, unambiguous set of characters and a bounded length. A client
 * that sends anything else simply gets an id chosen for it.
 */
export function isValidClientMessageId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
/**
 * Maps an operation to the team tool that implements it.
 *
 * The bridge prefers this table to reach a tool, and falls back to a name match on
 * `mcp__minimax-bot__<tool>`. Keeping it here means the client, the relay and the bridge
 * agree on which tool backs which operation.
 */
export const OP_TOOL = {
    'op.list_team': 'list_team',
    'op.dispatch': 'dispatch_tasks',
    'op.list_tasks': 'get_tasks',
    'op.cancel_task': 'cancel_tasks',
    'op.list_helpers': 'list_helpers',
    'op.start_helper': 'start_helper',
    'op.stop_helper': 'stop_helper',
    'op.recall': 'recall',
    'op.remember': 'remember',
    'op.forget': 'forget',
    'op.create_bot': 'create_bot',
    'op.update_bot': 'update_bot',
    'op.delete_bot': 'delete_bot',
    'op.create_group': 'create_group',
    'op.update_group': 'update_group',
    'op.delete_group': 'delete_group',
    'op.list_schedules': 'list_schedules',
    'op.create_schedule': 'create_schedule',
    'op.delete_schedule': 'delete_schedule',
};
/**
 * Operations the bridge routes to the team by the chat the turn belongs to.
 *
 * A turn is addressed to a Bot or to a group, and the chat id says which. The bridge
 * hands the turn to the team itself, so the Bot that answers is the Bot the phone
 * picked — with that Bot's own instructions, model, effort and session.
 */
export const TEAM_ROUTED_OPS = ['op.send_message', 'op.abort_turn'];
/**
 * Operations the bridge answers from its own agent rather than from a team tool.
 *
 * These are the Host's own questions — a tool call waiting for a decision, a
 * questionnaire waiting for an answer — which only the agent that started the turn can
 * answer.
 */
export const AGENT_BACKED_OPS = ['op.respond_permission', 'op.answer_question'];
/**
 * Operations the bridge answers itself, without a team tool and without the agent.
 *
 * Together with {@link OP_TOOL}, {@link TEAM_ROUTED_OPS} and {@link AGENT_BACKED_OPS}
 * this accounts for every operation, so a consumer can ask "how is this op served?" and
 * get an answer.
 */
export const BRIDGE_LOCAL_OPS = [
    'op.get_usage',
    'op.react',
    'op.list_history',
    'op.bot_avatar',
    'op.set_bot_mode',
    'op.list_models',
    'op.list_capabilities',
];
/**
 * The team tools that run a turn.
 *
 * `message_bot` hands work to a Bot and runs it in that Bot's own chat; `post_group`
 * posts to a group and runs the group's discussion. The bridge calls them itself, on
 * the phone's behalf, so the Bot that answers is the Bot the phone picked.
 */
export const TURN_ROUTING_TOOLS = ['message_bot', 'post_group'];
/**
 * How the chat a turn belongs to decides which team tool runs it.
 *
 * `bot:` is a Bot's own private chat and `group:` is a group. The bridge reads the
 * prefix of the chat id and calls the matching tool, so the client, the relay and the
 * bridge agree on where a turn goes.
 */
export const CHAT_ROUTING = {
    'bot:': 'message_bot',
    'group:': 'post_group',
};
const _everyOpIsClassified = true;
void _everyOpIsClassified;
/**
 * The complete `@minimax-bot` team tool surface: 21 tools.
 *
 * Every tool the MCP server exposes is either client-invokable ({@link OP_TOOL}) or
 * runs a turn ({@link TURN_ROUTING_TOOLS}). A tool that appears in neither would be
 * unreachable, and one appearing in both would be ambiguous.
 */
export const TEAM_TOOLS = [...Object.values(OP_TOOL), ...TURN_ROUTING_TOOLS];
//# sourceMappingURL=types.js.map