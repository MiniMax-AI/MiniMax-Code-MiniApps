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

export interface MiniAppLogger {
  debug(message: string, fields?: JsonObject): void;
  info(message: string, fields?: JsonObject): void;
  warn(message: string, fields?: JsonObject): void;
  error(message: string, fields?: JsonObject): void;
}

export type MiniAppAgentRunStatus = 'finished' | 'error' | 'aborted';

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
  /** The model the turn was dispatched with; absent when no turn ran. */
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
 * - `run.queued`: all run slots are taken and the call waits at 1-based `position`; sent once,
 *   before the turn starts, so it has no `turnId` and names a session only when continuing one.
 * - `turn.started`: the Agent began the turn; `model` is the model it was dispatched with.
 * - `text.delta`: a piece of the reply as it streams.
 * - `message.committed`: one complete assistant message (a turn can have several).
 * - `tool.started` / `tool.finished`: a tool call by name; `ok` is false when it failed.
 * - `turn.finished`: always last; same `status`, `text`, and `error` as the run result.
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
      readonly status: MiniAppAgentRunStatus;
      readonly text?: string;
      readonly error?: { readonly code: string; readonly message: string };
    };

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
  /** Set on every `BUSY`: the session already has a run in flight, or the wait queue is full. */
  readonly reason?: 'session_busy' | 'queue_full';
}

/**
 * Present only when the manifest declares `agentAccess: ["session.run"]`.
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
 * `REQUEST_CANCELLED`.
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
  readonly hostConnector?: HostConnectorClient;
  readonly agent?: MiniAppAgentClient;
}

export interface MiniAppModule {
  /** Resolve only after the listener accepts connections and every route is installed. */
  start(context: MiniAppContext): Promise<void | MiniAppLifecycle>;
}
