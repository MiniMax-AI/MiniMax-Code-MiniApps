/**
 * The brief a Bot is given when it answers the phone.
 *
 * A Bot is who it is because of its instructions, its role and its name, and the brief
 * is where those reach the model. The bridge builds the brief from the same record the
 * desktop keeps, so the Bot that answers from the phone is the Bot that answers from
 * the desktop: same name, same role, same instructions.
 *
 * The model's own settings do not travel in the brief: the run itself carries the Bot's
 * model and effort, resolved out of the Host's catalog (see `bot-model.mjs`).
 *
 * The team's own engine builds a longer brief — with the group's rules, the team's
 * roster and the memory it selected. A turn the team runs carries all of that; a turn
 * the bridge runs carries what makes the Bot itself. That is the trade: a turn the
 * bridge runs can be approved from the phone, and it is not written into the desktop
 * Bot app's own list of messages.
 */

/**
 * @param {any} bot the Bot's record: name, id, role, instructions, isMain
 * @param {string} text what the user said
 * @returns {string}
 */
export function buildBotBrief(bot, text) {
  const name = String(bot?.name ?? 'the Bot');
  const id = String(bot?.id ?? bot?.botId ?? '');
  const role = String(bot?.role ?? '').trim();
  const instructions = String(bot?.instructions ?? '').trim();
  const lines = [
    '<minimax-bot-context>',
    id ? `You are ${name} (${id}) on the user's MiniMax Bot team.` : `You are ${name} on the user's MiniMax Bot team.`,
    role ? `Your role: ${role}.` : '',
    bot?.isMain ? 'You are the main Bot of the team.' : '',
    '',
    'Your instructions:',
    instructions || '(none)',
    '',
    'This is a private chat with the user.',
    'Answer as yourself, in your own voice, and do the work that was asked of you.',
    '</minimax-bot-context>',
    '',
    String(text ?? ''),
  ];
  return lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n');
}
