/**
 * Agent-facing Mini App runtime authoring declarations.
 *
 * Copy this file into a generated plugin for type checking. It contains no Host implementation;
 * the Host injects runtime values through start(context).
 * Keep the .ts filename: Electron packaging excludes .d.ts files from dependency assets.
 */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

declare const HOST_CONNECTOR_TOOL_REF: unique symbol;
export type HostConnectorToolRef = string & {
  readonly [HOST_CONNECTOR_TOOL_REF]: 'HostConnectorToolRef';
};

export interface HostConnectorTool {
  readonly toolRef: HostConnectorToolRef;
  readonly provider: string;
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonValue;
  readonly outputSchema?: JsonValue;
}

export interface HostConnectorListResult {
  readonly tools: readonly HostConnectorTool[];
  readonly partial: boolean;
}

export interface HostConnectorCallOptions {
  readonly signal?: AbortSignal;
}

export interface HostConnectorCallResult {
  readonly invocationId: string;
  /**
   * Raw provider result; it is not normalized by the Host and may be an object, array, or primitive.
   * A single text-block array is one provider shape, not a global Host transport contract.
   * Decode only a probe-observed envelope; preserve every other value, including direct strings.
   */
  readonly value: JsonValue;
}

export interface HostConnectorClient {
  /** Candidate-safe inventory only; available before and after activation. */
  list(options?: HostConnectorCallOptions): Promise<HostConnectorListResult>;
  /** Activation-only business dispatch; call from request handling, never start(context). */
  call(
    toolRef: HostConnectorToolRef,
    arguments_: JsonObject,
    options?: HostConnectorCallOptions,
  ): Promise<HostConnectorCallResult>;
}

export type HostConnectorErrorDisposition =
  | 'not_dispatched'
  | 'provider_reported'
  | 'unknown_after_dispatch';

export type HostConnectorErrorCode =
  | 'TOOL_REF_STALE'
  | 'SERVICE_RESTARTED'
  | 'REQUEST_CANCELLED'
  | 'CONNECTOR_TIMEOUT'
  | 'INVALID_ARGUMENTS'
  | 'CONNECTOR_PROVIDER_ERROR'
  | 'CONNECTOR_UNAVAILABLE'
  /** The user switched this provider off for the Mini App; not dispatched. */
  | 'CONNECTOR_NOT_PERMITTED'
  | 'CONNECTOR_OUTCOME_UNKNOWN';

export interface HostConnectorError extends Error {
  readonly code: HostConnectorErrorCode;
  readonly disposition: HostConnectorErrorDisposition;
  readonly retryable: boolean;
  readonly invocationId?: string;
  readonly diagnostic?: {
    readonly issues: readonly {
      readonly path: string;
      readonly constraint: string;
      readonly limit?: number;
    }[];
  };
}

/** What a call would meet now under the user's global permission rules; informational only. */
export type MiniAppToolPermission = 'allow' | 'ask' | 'deny';

/**
 * `name` is the runtime name an Agent sees (`mcp__<server>__<tool>`, `connector__<provider>__<tool>`).
 * Take it from `list()`; do not build it.
 */
export type MiniAppTool =
  | {
      readonly name: string;
      readonly kind: 'connector';
      readonly provider: string;
      readonly tool: string;
      readonly description?: string;
      readonly inputSchema: JsonValue;
      readonly permission: MiniAppToolPermission;
    }
  | {
      readonly name: string;
      readonly kind: 'mcp';
      /** Any installed MCP server: a Plugin's, the user's `mcp.json`, or a Host built-in one. */
      readonly server: string;
      readonly tool: string;
      readonly description?: string;
      readonly inputSchema: JsonValue;
      readonly permission: MiniAppToolPermission;
    };

export interface MiniAppToolListResult {
  readonly tools: readonly MiniAppTool[];
  /** A source could not be listed; the listed tools are still callable. */
  readonly partial: boolean;
}

export type MiniAppToolCallResult =
  | {
      readonly invocationId: string;
      readonly kind: 'connector';
      /** Raw provider result, as in `HostConnectorCallResult.value`. */
      readonly value: JsonValue;
    }
  | {
      readonly invocationId: string;
      readonly kind: 'mcp';
      /** The MCP tool reported its own failure; `content` keeps its error text. */
      readonly isError: boolean;
      /** MCP content blocks such as `{ type: 'text', text }`, passed through as JSON. */
      readonly content: readonly JsonValue[];
      readonly structuredContent?: JsonObject;
    };

/**
 * Thrown with the `HostConnectorError` shape; Connector tools keep their Connector codes too. The
 * code names the cause; `disposition` alone says whether the tool may have run (`TOOL_TIMEOUT` and
 * `REQUEST_CANCELLED` can be either `not_dispatched` or `unknown_after_dispatch`).
 */
export type MiniAppToolErrorCode =
  | HostConnectorErrorCode
  | 'INVALID_ARGUMENTS'
  | 'TOOL_NOT_PERMITTED'
  | 'TOOL_APPROVAL_REQUIRED'
  | 'TOOL_REF_STALE'
  | 'TOOL_UNAVAILABLE'
  | 'TOOL_TIMEOUT'
  | 'TOOL_RESULT_TOO_LARGE'
  | 'TOOL_OUTCOME_UNKNOWN'
  | 'MCP_SERVER_UNAVAILABLE'
  | 'REQUEST_CANCELLED'
  | 'SERVICE_RESTARTED';

/**
 * Present whenever the manifest declares `"toolAccess": ["call"]`, even when the user switched
 * `tool:call` off: calls then fail with `TOOL_NOT_PERMITTED`. Every `call` is judged by the user's
 * global permission rules: `deny` is `TOOL_NOT_PERMITTED`, `ask` shows a Host prompt, and nobody to
 * ask is `TOOL_APPROVAL_REQUIRED`. `list` works before activation; call `call` only from request
 * handling after activation. Connector tools time out after 30 s and MCP tools after at most 120 s,
 * counted after any prompt. The Host never retries; reconcile an `unknown_after_dispatch` outcome
 * before repeating a write.
 */
export interface MiniAppToolClient {
  list(options?: HostConnectorCallOptions): Promise<MiniAppToolListResult>;
  call(
    name: string,
    arguments_: JsonObject,
    options?: HostConnectorCallOptions,
  ): Promise<MiniAppToolCallResult>;
  /**
   * One Host prompt for the named tools (1–10, from `list()`) still at `ask`; the user ticks which
   * to always allow. Resolves every name's state afterwards (for your UI only). When nobody can be
   * asked it rejects with `TOOL_APPROVAL_REQUIRED` whose error carries `permissions`. With
   * `tool:call` switched off it answers `deny` for every name without a prompt.
   * Needs `capabilities.has('tool.request')`.
   */
  request(
    names: readonly string[],
    options?: HostConnectorCallOptions,
  ): Promise<Record<string, MiniAppToolPermission>>;
}

export interface MiniAppLogger {
  debug(message: string, fields?: JsonObject): void;
  info(message: string, fields?: JsonObject): void;
  warn(message: string, fields?: JsonObject): void;
  error(message: string, fields?: JsonObject): void;
}

/**
 * How the call's text ended: in its own turn (`finished` / `error` / `aborted`), or, only with
 * `whenBusy`, joined into the turn that was already running (`steered`; that turn's own
 * call gets the reply).
 */
export type MiniAppAgentRunStatus = 'finished' | 'error' | 'aborted' | 'steered';

/**
 * The Desktop composer's follow-up behaviours while a session runs a turn. `queue`: the text runs
 * as the next turn and the call follows it. `steer`: the running turn reads the text at its next
 * input point (the call resolves `steered`), or, if it answered first, the text runs as the next
 * turn and the call follows it.
 */
export type MiniAppAgentWhenBusy = 'queue' | 'steer';

export type MiniAppAgentQuestionMode = 'questionnaire' | 'feature-enable' | 'plan';

export interface MiniAppAgentQuestionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface MiniAppAgentQuestionStep {
  readonly id: string;
  readonly header?: string;
  readonly question: string;
  readonly description?: string;
  readonly selectionMode: 'single' | 'multiple';
  readonly options: readonly MiniAppAgentQuestionOption[];
  /** Free-text "other" is always accepted; see `MiniAppAgentQuestionAnswer.otherText`. */
  readonly allowOther: true;
}

/** Same questionnaire the Host chat renders; render every step and answer each one. */
export interface MiniAppAgentQuestionnaire {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly title?: string;
  readonly steps: readonly MiniAppAgentQuestionStep[];
  readonly mode?: MiniAppAgentQuestionMode;
  /** Plan review Markdown and other mode-specific data. */
  readonly modePayload?: JsonObject;
  /** Unix ms; the request is withdrawn after this. */
  readonly expiresAt?: number;
}

export interface MiniAppAgentQuestionAnswer {
  readonly stepId: string;
  readonly selectedOptionIds: readonly string[];
  readonly selectedOther: boolean;
  readonly otherText?: string;
  readonly skipped?: boolean;
}

/** A model as the Host's composer selects it; take the values from `models()`. */
export interface MiniAppAgentModelSelection {
  readonly providerId: string;
  readonly modelId: string;
  /** `''` means thinking is off; it is preserved, distinct from an absent `variant`. */
  readonly variant?: string;
  readonly thinking?: { readonly effort: string };
}

/** One model this user can use. */
export interface MiniAppAgentModelOption {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly variants?: readonly string[];
  readonly thinking?: { readonly efforts: readonly string[]; readonly default?: string };
}

export interface MiniAppAgentModels {
  readonly models: readonly MiniAppAgentModelOption[];
  /** What a Node-created session starts with. */
  readonly default: MiniAppAgentModelSelection;
}

export interface MiniAppAgentAgentOption {
  /** Canonical name; what `agent` takes. */
  readonly name: string;
  readonly displayName: string;
  /** The default agent. */
  readonly primary: boolean;
}

export interface MiniAppAgentAgents {
  readonly agents: readonly MiniAppAgentAgentOption[];
}

export interface MiniAppAgentRunResult {
  /** Pass back in `run({ sessionId })` to continue the same conversation. */
  readonly sessionId: string;
  /** Absent when no turn ran: an `answer` accepted without starting a continuation. */
  readonly turnId?: string;
  /** The model the turn was dispatched with; absent when no turn ran or the text was steered. */
  readonly model?: MiniAppAgentModelSelection;
  /** `aborted` only when the Host confirmed the abort; an unconfirmed one rejects with `AGENT_OUTCOME_UNKNOWN`. */
  readonly status: MiniAppAgentRunStatus;
  /** Final assistant reply; absent when the turn produced none or did not finish. */
  readonly text?: string;
  readonly error?: { readonly code: string; readonly message: string };
  /** Set when the turn ended waiting on a questionnaire; render `request` and continue with `agent.answer`. */
  readonly pendingQuestion?: {
    readonly requestId: string;
    readonly mode: MiniAppAgentQuestionMode;
    readonly request: MiniAppAgentQuestionnaire;
  };
}

/**
 * Progress of one run. `turnId` matches the result's, except that a `permission.requested` raised
 * by a delegated child session carries that child's own `sessionId` and `turnId`; `reply` with
 * those, and do not filter events by the root turn. Ignore unknown `type` values: new event
 * types may be added without notice.
 * - `run.queued`: the call waits at 1-based `position`, for a run slot or, with
 *   `whenBusy: 'queue'`, in the session queue (a `whenBusy` call can get both); sent before the
 *   turn starts, so it has no `turnId` and names a session only when continuing one.
 * - `message.pending` / `message.steered`: with `whenBusy: 'steer'`, the text was handed to the
 *   running turn, then read by it; `message.steered` is the call's last event.
 * - `turn.started`: the Agent began the turn; `model` is the model it was dispatched with.
 * - `text.delta`: a piece of the reply as it streams.
 * - `message.committed`: one complete assistant message (a turn can have several).
 * - `tool.started` / `tool.finished`: a tool call by name; `ok` is false when it failed.
 * - `turn.finished`: last unless the call ended `steered`; same `status`, `text`, and `error`
 *   as the run result.
 */
/**
 * Every event except `run.queued` names its session, so `reply` can be called from `onEvent` even
 * before the `run` that created the session has returned. `answer` cannot: the paused `run` still holds the
 * session's single-run slot while `question.requested` is delivered, so call `answer` only after
 * that `run` resolves (an earlier call rejects with `BUSY`). Ignore event types you do not know.
 */
export type MiniAppAgentRunEvent =
  | { readonly type: 'run.queued'; readonly sessionId?: string; readonly position: number }
  | {
      readonly type: 'message.pending' | 'message.steered';
      readonly sessionId: string;
      readonly turnId: string;
    }
  | {
      readonly type: 'turn.started';
      readonly sessionId: string;
      readonly turnId: string;
      readonly model: MiniAppAgentModelSelection;
    }
  | {
      readonly type: 'text.delta';
      readonly sessionId: string;
      readonly turnId: string;
      readonly text: string;
    }
  | {
      readonly type: 'message.committed';
      readonly sessionId: string;
      readonly turnId: string;
      readonly text: string;
    }
  | {
      readonly type: 'tool.started';
      readonly sessionId: string;
      readonly turnId: string;
      readonly name: string;
    }
  | {
      readonly type: 'tool.finished';
      readonly sessionId: string;
      readonly turnId: string;
      readonly name: string;
      readonly ok: boolean;
    }
  /** A tool call is waiting for approval; decide it with `agent.reply`. */
  | {
      readonly type: 'permission.requested';
      readonly sessionId: string;
      /** Absent when the runtime did not attribute the ask to a turn. */
      readonly turnId?: string;
      readonly requestId: string;
      readonly toolName: string;
      readonly toolInput?: string;
      readonly reason: string;
    }
  /** The turn paused on a questionnaire; continue with `agent.answer`. */
  | {
      readonly type: 'question.requested';
      readonly sessionId: string;
      readonly turnId?: string;
      readonly requestId: string;
      readonly mode: MiniAppAgentQuestionMode;
      readonly request: MiniAppAgentQuestionnaire;
    }
  | {
      readonly type: 'turn.finished';
      readonly sessionId: string;
      readonly turnId: string;
      readonly status: Exclude<MiniAppAgentRunStatus, 'steered'>;
      readonly text?: string;
      readonly error?: { readonly code: string; readonly message: string };
    };

/** `observe({ all: true })` only: the conversation's title, when it has one. */
interface MiniAppAgentObservedTitle {
  readonly title?: string;
}

type MiniAppAgentRunEventOf<T extends MiniAppAgentRunEvent['type']> = Extract<
  MiniAppAgentRunEvent,
  { readonly type: T }
>;

/**
 * What an observer receives: the run events without `run.queued` and without asks, which reach
 * only the run that owns them. `turn.started.model` is present only when the Host could read it.
 * Ignore unknown `type` values.
 */
export type MiniAppAgentObservedEvent =
  | (Omit<MiniAppAgentRunEventOf<'turn.started'>, 'model'> & {
      readonly model?: MiniAppAgentModelSelection;
    } & MiniAppAgentObservedTitle)
  | MiniAppAgentRunEventOf<'text.delta' | 'tool.started' | 'tool.finished'>
  | (MiniAppAgentRunEventOf<'message.committed'> & MiniAppAgentObservedTitle)
  | (MiniAppAgentRunEventOf<'turn.finished'> & MiniAppAgentObservedTitle);

/**
 * `{ all: true }`: `turn.started`, `message.committed` (the final reply) and `turn.finished` of
 * every user conversation, with its `title`. `{ sessionId }`: every progress event of that
 * session, turn after turn. Exactly one of the two.
 */
export type MiniAppAgentObserveTarget = { readonly sessionId: string } | { readonly all: true };

/** One of the user's conversations; `running` while a turn is in flight. */
export interface MiniAppAgentSessionSummary {
  readonly sessionId: string;
  readonly title?: string;
  /** The Agent the session runs. */
  readonly agent: string;
  readonly status: 'idle' | 'running' | 'error' | 'aborted';
  /** The conversation's project directory (absolute) as recorded; it may no longer exist. */
  readonly workspaceDir: string;
  /** True when the conversation has no project and runs in the default workspace. */
  readonly isDefaultWorkspace: boolean;
  /** Unix ms. */
  readonly createdAtMs: number;
  /** Unix ms. */
  readonly updatedAtMs: number;
}

export interface MiniAppAgentSessionDetail extends MiniAppAgentSessionSummary {
  /** The conversation's current model; absent when the Host has none recorded. */
  readonly model?: MiniAppAgentModelSelection;
  /** Only while `status` is `error` and the Host recorded a message. */
  readonly error?: { readonly message: string };
  /** Final text of the latest Agent reply, if any. */
  readonly lastAssistantText?: string;
}

export interface MiniAppAgentSessions {
  /** The 50 most recently updated user conversations (no Mini App, scheduled or sub-Agent ones). */
  readonly sessions: readonly MiniAppAgentSessionSummary[];
}

export interface MiniAppAgentRunOptions {
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: MiniAppAgentRunEvent) => void;
}

export type MiniAppAgentErrorCode =
  | 'NOT_PERMITTED'
  | 'BUSY'
  | 'SESSION_NOT_FOUND'
  | 'INVALID_ARGUMENTS'
  | 'AGENT_UNAVAILABLE'
  | 'REQUEST_CANCELLED'
  | 'AGENT_OUTCOME_UNKNOWN'
  | 'REQUEST_NOT_FOUND';

export interface MiniAppAgentError extends Error {
  readonly code: MiniAppAgentErrorCode;
  /**
   * True when nothing was started and the same call may be retried later.
   * `AGENT_OUTCOME_UNKNOWN` is never retryable: the turn may have run.
   */
  readonly retryable: boolean;
  /**
   * Set on every `BUSY`: the session already has a run in flight, the wait queue is full, the
   * per-minute start cap was hit, or `observe` found 4 observers already running.
   */
  readonly reason?: 'session_busy' | 'queue_full' | 'rate_limited' | 'observer_limit';
}

/**
 * Present when the manifest declares `agentAccess` (`"session.run"` and/or `"session.read"`).
 * `run` / `reply` / `answer` / `models` / `agents` / `create` need `session.run`; `observe` and
 * `sessions` need `session.read` except for this Mini App's own sessions (see
 * docs/agent.md).
 * A new Node session uses the primary Agent unless `agent` names one from `agents()`, and works in
 * this Mini App's own Agent directory and on the runtime default model;
 * continuing a session keeps its Agent, directory and model (unless `model` switches it), including
 * one a page created using its host chat's Agent, project directory and model; a session never
 * changes its Agent. Runs one turn with that Agent's full capabilities
 * (files, shell, Skills, MCP including this Mini App's own), and resolves when the turn ends.
 *
 * Interaction is yours to render: pass `onEvent` and handle `permission.requested` with
 * `reply` and `question.requested` with `answer`. A permission request waits only while
 * someone can answer it: this run passed `onEvent`, or a page of this Mini App currently has
 * the session open in a chat side panel via `open`. Otherwise it is denied (the model is told
 * why), and a questionnaire ends the turn with `result.pendingQuestion`. A run waiting on a
 * permission is released by `cancel`/abort, process exit or republish. Up to `agentConcurrency`
 * runs (default 4) per Mini App run at once; further `run` / `answer` calls wait in order (up to
 * four times that many, see `run.queued`), and aborting a waiting call rejects it with
 * `REQUEST_CANCELLED`. A `whenBusy` call on a session that already has a call in flight shares
 * that call's slot. Cancelling a queued `whenBusy` text removes it (`REQUEST_CANCELLED`); a steered
 * text cannot be withdrawn (`AGENT_OUTCOME_UNKNOWN`, the running turn goes on).
 */
export interface MiniAppAgentClient {
  run(
    input: {
      readonly text: string;
      readonly sessionId?: string;
      /**
       * Switch the session to this model before the turn (validated like the composer validates a
       * new session's model: it must be one `models()` lists; unusable is `INVALID_ARGUMENTS`,
       * missing BYOK credentials end the turn with `status: 'error'`); the session keeps it. Omit to use the session's current model.
       */
      readonly model?: MiniAppAgentModelSelection;
      /**
       * Only when starting a session (no `sessionId`): an agent `name` from `agents()`. Passing it
       * with `sessionId` is `INVALID_ARGUMENTS`.
       */
      readonly agent?: string;
      /**
       * Only with `sessionId`: what to do when that session is already running a turn; on an idle
       * session the call starts a turn as usual. Omit to reject with `BUSY` (`session_busy`).
       */
      readonly whenBusy?: MiniAppAgentWhenBusy;
    },
    options?: MiniAppAgentRunOptions,
  ): Promise<MiniAppAgentRunResult>;
  /**
   * Decide a pending permission request. Never writes the user's global rules. Node replies
   * have 16 separate pending slots; `run` / `answer` / `models` / `agents` / `create` and Connector
   * requests share another 16. Filling that ordinary budget still permits replies. A full reply
   * budget rejects with retryable `AGENT_UNAVAILABLE`.
   */
  reply(input: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly decision: 'allowOnce' | 'deny';
  }): Promise<void>;
  /**
   * Answer a questionnaire; the continuation turn is observed like `run`. Rejects with
   * `AGENT_OUTCOME_UNKNOWN` when the answer was recorded but the continuation turn was not observed.
   */
  answer(
    input: {
      readonly sessionId: string;
      readonly requestId: string;
      readonly answers: readonly MiniAppAgentQuestionAnswer[];
      /** Same as `run`'s `model`, applied before the continuation turn. */
      readonly model?: MiniAppAgentModelSelection;
    },
    options?: MiniAppAgentRunOptions,
  ): Promise<MiniAppAgentRunResult>;
  /**
   * Returns the model catalog and runtime `default`. Pass `default` directly as `model` to
   * `run` / `answer`. For a catalog entry, extract `providerId` / `modelId`, add a selected `variant`
   * if needed and preserve `variant: ''`. If thinking is supported, select an effort from
   * `thinking.efforts` and pass `thinking: { effort }`.
   */
  models(): Promise<MiniAppAgentModels>;
  /** The agents the user has configured; `agent` of `create` / a first `run` must be one of them. */
  agents(): Promise<MiniAppAgentAgents>;
  /**
   * Create a session (agent, this Mini App's Agent directory, the runtime default model) without
   * running a turn, and return its `sessionId`; continue it with `run({ sessionId })`. A page's
   * `create` binds the session to its chat instead, and its `sessionId` can be continued here.
   * Takes no Host run slot but uses the ordinary Node request budget. `agent` picks the session's
   * agent from `agents()`; a session never changes it.
   */
  create(input?: { readonly agent?: string }): Promise<{ readonly sessionId: string }>;
  /**
   * Watch the user's Agent at work (see `MiniAppAgentObserveTarget`). No request timeout; abort
   * `signal` to stop, after which `onEvent` gets nothing more. Resolves when the subscription
   * ended: `signal` aborted, the session was deleted, the process is stopping or being replaced,
   * or `session.read` was switched off.
   * Rejects with a `MiniAppAgentError` when it could not start or failed: `INVALID_ARGUMENTS` (not
   * exactly one target), `NOT_PERMITTED`, `SESSION_NOT_FOUND`, retryable `BUSY` past 4 observers
   * per Mini App (`reason: 'observer_limit'`) or `AGENT_UNAVAILABLE`. Observers use no run slots
   * and no ordinary request budget. Check `context.capabilities?.has('agent.observe')` first.
   */
  observe(
    target: MiniAppAgentObserveTarget,
    options: {
      readonly onEvent: (event: MiniAppAgentObservedEvent) => void;
      readonly signal?: AbortSignal;
    },
  ): Promise<void>;
  /** Check `context.capabilities?.has('agent.sessions')` first. */
  sessions(): Promise<MiniAppAgentSessions>;
  /**
   * One conversation with its model and latest reply. `sessionId` is required: Node serves every
   * tab, so it has no current chat; a page passes its chat's id (from its own `session()`).
   * Check `context.capabilities?.has('agent.session')`.
   */
  session(sessionId: string): Promise<MiniAppAgentSessionDetail>;
}

export interface MiniAppLifecycle {
  dispose(): void | Promise<void>;
}

export interface MiniAppContext {
  readonly pluginId: string;
  readonly pluginRoot: string;
  readonly dataDir: string;
  readonly listen: Readonly<{ readonly host: '127.0.0.1'; readonly port: number }>;
  readonly signal: AbortSignal;
  readonly logger: MiniAppLogger;
  /**
   * Synchronous probe of Host features, fixed per Host version. It says nothing about this
   * Mini App's manifest or authorization: `has('agent.run')` is true on a Host that supports the
   * Agent API even when `context.agent` is absent because `agentAccess` was not declared.
   * Older Hosts do not inject `capabilities`; check `context.capabilities?.has(...)`.
   */
  readonly capabilities?: MiniAppHostCapabilities;
  /**
   * Present when the manifest declares a `hostConnectorAccess` provider; a provider the user
   * switched off is missing from `list()` and its calls fail with `CONNECTOR_NOT_PERMITTED`.
   */
  readonly hostConnector?: HostConnectorClient;
  /** Installed MCP and Connector tools, each call judged by the user's permission rules. */
  readonly tool?: MiniAppToolClient;
  /**
   * Present when the manifest declares `agentAccess: ["session.run"]`; while the user has it
   * switched off, calls fail with `NOT_PERMITTED`.
   */
  readonly agent?: MiniAppAgentClient;
}

export interface MiniAppHostCapabilities {
  has(name: string): boolean;
}

export interface MiniAppModule {
  /** Resolve only after the listener accepts connections and every route is installed. */
  start(context: MiniAppContext): Promise<void | MiniAppLifecycle>;
}
