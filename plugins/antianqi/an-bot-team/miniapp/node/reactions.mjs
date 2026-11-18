import { canReact, EMOJI_SET } from '../client/emoji-data.js';
import { t } from './i18n.mjs';

export class ReactionError extends Error {
  constructor(code, key) {
    super(t(key));
    this.code = code;
  }
}

export function validateReaction(message, emoji, selected) {
  if (!message) throw new ReactionError('not_found', 'err.reactionMessageGone');
  if (!canReact(message)) throw new ReactionError('invalid', 'err.reactionBotOnly');
  if (!EMOJI_SET.has(emoji) || typeof selected !== 'boolean') {
    throw new ReactionError('invalid', 'err.reactionInvalid');
  }
}
