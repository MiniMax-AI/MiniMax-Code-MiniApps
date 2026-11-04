/**
 * A fake desktop agent.
 *
 * The Host's agent API is what a hosted turn runs on: the bridge owns the run, so the
 * questions the run raises — a permission check, a questionnaire — are raised here and
 * can be answered here. The fake speaks the same events the Host does, so a test that
 * passes here is a test of the same contract.
 */

/**
 * @param {object} [options]
 * @param {Array<any>} [options.script] the events the run reports, in order
 * @param {string} [options.sessionId] the session a run continues
 * @param {string} [options.status] how the run ends
 * @param {string} [options.text] the run's answer
 * @param {any} [options.catalog] the model catalog, when the Host lets a run pick its model
 * @param {any} [options.pendingQuestion] the result marker for a turn paused on a questionnaire
 */
export function createFakeAgent({ script = [], sessionId, status = 'finished', text = '', catalog, pendingQuestion } = {}) {
  /** The runs the bridge started. */
  const runs = [];
  /** The answers the bridge gave. */
  const replies = [];
  /** The questionnaires the bridge answered. */
  const answers = [];

  const agent = {
    runs,
    replies,
    answers,
    async run(input, options) {
      runs.push({ input, options });
      const turnId = `turn_${runs.length}`;
      const session = input.sessionId ?? sessionId ?? `sess_${runs.length}`;
      for (const event of script) {
        options?.onEvent?.({ turnId, sessionId: session, ...event });
      }
      return { sessionId: session, turnId, status, text, ...(pendingQuestion ? { pendingQuestion } : {}) };
    },
    async reply(input) {
      replies.push(input);
    },
    async answer(input) {
      answers.push(input);
      return { sessionId: input.sessionId, status: 'finished' };
    },
  };

  // The Host lets a run pick its model on some hosts and not on others, and a run that
  // names a model the host does not take is refused before it starts.
  if (catalog) {
    agent.models = async () => catalog;
  }
  return agent;
}
