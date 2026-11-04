/**
 * How many tool calls a conversation keeps.
 *
 * The phone shows the calls of a turn under the turn they belong to, and a chat can
 * hold a lot of them: one turn of the desktop's own engine used fifty-seven tools in a
 * single afternoon. The limit bounds what a phone is asked to hold and what the relay
 * is asked to carry in one frame.
 *
 * It is a limit on the calls of a conversation, not on the calls of a turn. A turn is
 * kept whole — a turn that showed only some of its calls would say that the Bot used
 * fewer tools than it did — so the limit is reached by dropping whole turns, and a
 * turn that is larger than the limit on its own is kept whole rather than under-reported.
 */
export const MAX_ACTIVITY_CALLS = 400;
/**
 * The turns of a thread, in the order the thread shows them.
 *
 * @param messages the messages of the thread, oldest first
 */
export function turnOrderOf(messages) {
    const turns = [];
    for (const message of messages) {
        const turnId = message?.turnId;
        if (typeof turnId === 'string' && turnId && !turns.includes(turnId))
            turns.push(turnId);
    }
    return turns;
}
/**
 * Keeps the tool calls of a conversation within a limit, without ever splitting a turn.
 *
 * The bridge and the phone both keep the calls, and they have to keep them the same
 * way: the phone would otherwise drop what the bridge sent, and the two would disagree
 * about how many tools a turn used. The rule therefore lives here, in the contract the
 * two share.
 *
 * Whole turns go, and the oldest go first. The newest turn is never dropped: it is the
 * one the reader is looking at, and a turn that is larger than the limit on its own is
 * kept whole rather than under-reported.
 *
 * @param list the calls, in any order
 * @param limit how many calls to keep
 * @param turnOrder the turns in the order they happened, oldest first
 * @param keepTurn a turn that stays whatever the limit says — a turn that is still running
 */
export function trimTurnActivity(list, limit, turnOrder = [], keepTurn) {
    if (list.length <= limit)
        return [...list];
    const turns = [];
    for (const entry of list)
        if (!turns.includes(entry.turnId))
            turns.push(entry.turnId);
    // The order the caller knows comes first; a turn it does not know keeps the order it
    // arrived in, behind the ones it does.
    const ranked = [
        ...turnOrder.filter((turnId) => turns.includes(turnId)),
        ...turns.filter((turnId) => !turnOrder.includes(turnId)),
    ];
    const newest = ranked[ranked.length - 1];
    const dropped = new Set();
    let kept = list.length;
    for (const turnId of ranked) {
        if (kept <= limit)
            break;
        if (turnId === newest)
            break;
        if (keepTurn?.(turnId))
            continue;
        const mine = list.filter((entry) => entry.turnId === turnId);
        dropped.add(turnId);
        kept -= mine.length;
    }
    return list.filter((entry) => !dropped.has(entry.turnId));
}
//# sourceMappingURL=activity.js.map