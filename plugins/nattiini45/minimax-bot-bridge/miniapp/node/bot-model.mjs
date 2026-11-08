/**
 * The model a Bot's turn runs on.
 *
 * The roster names a Bot's model as `providerId/modelId` and its effort as a level, but
 * the Host's agent takes a *selection*: the catalog entry, plus the effort to run it at.
 * The official engine resolves the same way — the model the Bot names, at the Bot's
 * effort, and nothing at all on a Host that does not let a run pick its model — so a
 * hosted turn runs on the Bot's own model instead of on whatever the session happens to
 * carry.
 *
 * The catalog is asked for at most once a minute: a busy thread must not ask the Host
 * for the same list on every turn.
 */

/** How long the catalog is kept before it is asked for again. */
const CATALOG_TTL_MS = 60000;

/**
 * A catalog entry as the Host's composer would select it.
 *
 * Thinking is turned on when the model offers it, at the model's own default effort.
 *
 * @param {any} entry
 */
function toSelection(entry) {
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    ...(entry.variants?.includes('thinking') ? { variant: 'thinking' } : {}),
    ...(entry.thinking?.default ? { thinking: { effort: entry.thinking.default } } : {}),
  };
}

/**
 * The efforts a catalog entry offers.
 *
 * @param {any} entry
 * @returns {string[]}
 */
function effortOptions(entry) {
  const levels = Array.isArray(entry?.thinking?.efforts)
    ? entry.thinking.efforts.filter((level) => typeof level === 'string')
    : [];
  return entry?.variants?.includes('') ? [...levels, 'off'] : levels;
}

/**
 * The selection that runs `entry` at `effort`.
 *
 * `off` is thinking turned off; every other effort is a level the model offers.
 *
 * @param {any} entry
 * @param {string} effort
 * @returns {any | undefined} undefined when the model does not offer that effort
 */
function withEffort(entry, effort) {
  if (!entry || !effortOptions(entry).includes(effort)) return undefined;
  if (effort === 'off') return { providerId: entry.providerId, modelId: entry.modelId, variant: '' };
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    ...(entry.variants?.includes('thinking') ? { variant: 'thinking' } : {}),
    thinking: { effort },
  };
}

/**
 * A catalog entry as the phone needs it.
 *
 * The id is the `provider/model` the team tool takes, and the efforts are the levels
 * this model actually offers — a phone cannot offer an effort the model does not have.
 *
 * @param {any} entry
 * @returns {{id: string, name: string, providerId: string, modelId: string, efforts: string[], defaultEffort?: string} | undefined}
 */
function describeEntry(entry) {
  if (!entry?.providerId || !entry?.modelId) return undefined;
  return {
    id: `${entry.providerId}/${entry.modelId}`,
    name: String(entry.displayName ?? entry.modelId),
    providerId: String(entry.providerId),
    modelId: String(entry.modelId),
    efforts: effortOptions(entry),
    ...(entry.thinking?.default ? { defaultEffort: String(entry.thinking.default) } : {}),
  };
}

/**
 * Picks the model a Bot's turn runs on.
 */
export class ModelPicker {
  /**
   * @param {any} context the Mini App context, read afresh because the Host hands the
   *   agent in with the context and a run may outlive it
   */
  constructor(context) {
    this.context = context;
    /** @type {{at: number, value: Promise<any>} | undefined} */
    this.cache = undefined;
  }

  /** Whether this Host lets a run pick its model. */
  get supported() {
    return typeof this.context?.agent?.models === 'function';
  }

  /**
   * The Host's model catalog, kept for a minute.
   *
   * @returns {Promise<any | undefined>}
   */
  async catalog() {
    if (!this.supported) return undefined;
    const now = Date.now();
    if (!this.cache || now - this.cache.at > CATALOG_TTL_MS) {
      const value = Promise.resolve(this.context.agent.models());
      this.cache = { at: now, value };
      // A failed lookup is not served from the cache for the next minute.
      value.catch(() => {
        if (this.cache?.value === value) this.cache = undefined;
      });
    }
    return this.cache.value;
  }

  /**
   * The catalog as the phone needs it: the models on offer and the efforts each one
   * has.
   *
   * A Host that does not let a run pick its model says so instead of sending an empty
   * list, so the phone can say that the model cannot be chosen here instead of showing
   * an empty list that looks like a broken one.
   *
   * @returns {Promise<{supported: boolean, default?: any, models: any[]}>}
   */
  async describe() {
    if (!this.supported) return { supported: false, models: [] };
    const catalog = await this.catalog().catch(() => undefined);
    if (!catalog) return { supported: false, models: [] };
    const entries = Array.isArray(catalog.models) ? catalog.models : [];
    const models = entries.map((entry) => describeEntry(entry)).filter(Boolean);
    // The default is named the way the catalog names it, not by its bare id.
    const wanted = catalog.default;
    const fallback = wanted
      ? entries.find(
          (entry) =>
            entry?.providerId === wanted.providerId && entry?.modelId === wanted.modelId,
        )
      : undefined;
    return {
      supported: true,
      ...(describeEntry(fallback ?? wanted) ? { default: describeEntry(fallback ?? wanted) } : {}),
      models,
    };
  }

  /**
   * The selection a Bot's turn runs on.
   *
   * The Bot's own model wins; its effort is folded into it. A model the catalog does not
   * offer, or an effort it does not offer, falls back to the plain model rather than
   * failing the turn: a stale setting should not cost the user their conversation.
   *
   * @param {{model?: string, effort?: string}} bot
   * @returns {Promise<any | undefined>} undefined when the Host does not let a run pick
   *   its model, in which case the session keeps the model it already has
   */
  async selectionFor(bot) {
    if (!this.supported) return undefined;
    const catalog = await this.catalog();
    if (!catalog) return undefined;
    const models = Array.isArray(catalog.models) ? catalog.models : [];
    const wanted = String(bot?.model ?? '').trim();
    const effort = String(bot?.effort ?? '').trim().toLowerCase();
    const entry = !wanted || /^(default|默认)$/i.test(wanted)
      ? catalog.default
      : (models.find((model) => `${model.providerId}/${model.modelId}`.toLowerCase() === wanted.toLowerCase()) ??
        models.find((model) => String(model.modelId).toLowerCase() === wanted.toLowerCase()) ??
        models.find((model) => String(model.displayName ?? '').toLowerCase() === wanted.toLowerCase()));
    if (!entry) return undefined;
    if (!effort || effort === 'default') return toSelection(entry);
    return withEffort(entry, effort) ?? toSelection(entry);
  }
}
