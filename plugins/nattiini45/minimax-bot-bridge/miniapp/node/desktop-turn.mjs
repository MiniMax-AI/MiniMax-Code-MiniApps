/**
 * The desktop's own record of a turn, in the phone's shape.
 *
 * The desktop keeps one record for a turn, and that record holds the whole exchange:
 * what the Bot said while it worked, which tools it used, and the answer it ended with.
 * The desktop draws one bubble for every part of it, so the phone has to be given the
 * same parts — the same words, in the same order — or the two surfaces show different
 * conversations.
 *
 * The record's own `text` is only the answer the turn ended with. The narration lives
 * in `parts`, and it is the parts that make up the exchange.
 *
 * This module is pure: it turns a record into what the phone shows. Reading the file
 * is `desktop-team.mjs`'s job, so that the mapping can be tested without a desktop.
 */

/** How a tool call can have ended in the desktop's own record. */
const TOOL_STATES = new Set(['ok', 'failed', 'unknown']);

/**
 * The state of a tool call, as the desktop recorded it.
 *
 * A call the desktop never saw report back is `unknown`, which is not the same as a
 * failure, so it keeps its own name instead of being folded into `failed`.
 */
function toolState(state) {
  return typeof state === 'string' && TOOL_STATES.has(state) ? state : 'unknown';
}

/**
 * The messages a turn's record holds, in the desktop's own order.
 *
 * Every part of the record that the desktop draws as a bubble becomes one message on
 * the phone. The answer the turn ended with keeps the record's own id, so a reaction
 * given to it belongs to the same message on both surfaces.
 *
 * @param {any} record one record of the desktop's own transcript
 * @returns {{messages: Array<import('./contracts.d.ts').ChatMessage>, activity: Array<import('./contracts.d.ts').TurnActivity>}}
 */
export function desktopTurn(record) {
  const chatId = typeof record?.chatId === 'string' ? record.chatId : '';
  const id = typeof record?.id === 'string' ? record.id : '';
  // The task the turn ran under names the turn itself, and it is the one name both
  // surfaces know the turn by.
  const turnId = typeof record?.taskId === 'string' && record.taskId ? record.taskId : id;
  const ts = typeof record?.ts === 'number' ? record.ts : 0;
  const authorId = typeof record?.botId === 'string' && record.botId ? record.botId : undefined;
  const answer = typeof record?.text === 'string' ? record.text : '';
  const parts = Array.isArray(record?.parts) ? record.parts : [];

  const messages = [];
  const activity = [];
  /** The index of the part that holds the answer the turn ended with. */
  let answerIndex = -1;

  parts.forEach((part, index) => {
    if (!part || typeof part !== 'object') return;
    if (part.type === 'text') {
      const text = typeof part.text === 'string' ? part.text : '';
      // The desktop drops the parts that hold nothing, and so does this.
      if (!text.trim()) return;
      // The last part that holds the answer is the answer: the desktop ends a turn with
      // it, and it is what the record's own text is.
      if (text.trim() === answer.trim()) answerIndex = messages.length;
      messages.push({
        messageId: `${id}#p${index}`,
        chatId,
        role: 'assistant',
        text,
        ts,
        ...(authorId ? { authorId } : {}),
        turnId,
      });
      return;
    }
    if (part.type === 'tool') {
      const toolName = typeof part.name === 'string' ? part.name : '';
      if (!toolName) return;
      activity.push({
        turnId,
        callId: `${id}#t${index}`,
        toolName,
        status: toolState(part.state),
      });
      return;
    }
    // An 'event' part is the desktop's own bookkeeping — a Bot was created, a group was
    // posted to — and the phone has no counterpart for it, so it is left out rather
    // than turned into something the desktop never said.
  });

  if (answerIndex >= 0) {
    messages[answerIndex] = { ...messages[answerIndex], messageId: id, text: answer };
  } else if (answer.trim()) {
    // A record with no parts at all still holds an answer, and the desktop draws it.
    messages.push({
      messageId: id,
      chatId,
      role: 'assistant',
      text: answer,
      ts,
      ...(authorId ? { authorId } : {}),
      turnId,
    });
  }

  return { messages, activity };
}

/**
 * A message of the desktop's own record that is not a Bot's answer.
 *
 * The desktop calls a Bot's own answer 'bot', a message that arrived from somewhere
 * else 'relay', and a message the user typed there 'user'. The phone calls the first
 * an assistant message and the other two the user's.
 *
 * @param {any} record one record of the desktop's own transcript
 * @param {string} chatId the conversation the record belongs to
 * @returns {import('./contracts.d.ts').ChatMessage}
 */
export function desktopMessage(record, chatId) {
  const id = typeof record?.id === 'string' ? record.id : '';
  const authorId = typeof record?.botId === 'string' && record.botId ? record.botId : undefined;
  return {
    messageId: id,
    chatId,
    role: record?.role === 'bot' ? 'assistant' : 'user',
    text: typeof record?.text === 'string' ? record.text : '',
    ts: typeof record?.ts === 'number' ? record.ts : 0,
    ...(authorId ? { authorId } : {}),
    // A message the user typed on the desktop is marked, so the phone can say where it
    // came from. A message that arrived here from the phone is the user's own, and the
    // desktop already says that it came from elsewhere.
    ...(record?.role === 'user' ? { origin: 'desktop' } : {}),
  };
}
