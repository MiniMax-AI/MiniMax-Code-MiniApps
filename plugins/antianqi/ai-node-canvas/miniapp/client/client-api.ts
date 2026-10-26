/**
 * Copyable Mini App Client declarations for TypeScript and JavaScript/JSDoc authoring.
 * No Host implementation or runtime import: Electron preload provides window.mcode.
 * Keep the .ts filename because Electron dependency packaging filters out .d.ts assets.
 * Node start(context) uses miniapp-api.ts instead. See docs/client.md for usage and errors.
 */
export interface MiniAppMessageAPI {
  /**
   * Ask the user to append plain text to this Mini App's conversation input.
   * Accepts at most 100,000 UTF-16 code units and preserves spaces, tabs, and newlines.
   * An empty string still requires confirmation and leaves the draft unchanged.
   * Resolves after the confirmed append; rejects on cancellation or failure.
   * Does not send a message or insert, edit, or delete sent chat history.
   */
  append(text: string): Promise<void>;
}

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
  readonly modePayload?: { readonly [key: string]: unknown };
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
  /** What a session without a host chat model starts with. */
  readonly default: MiniAppAgentModelSelection;
  /** The host chat's current model (the default when the chat has none); only when opened from a chat. */
  readonly host?: MiniAppAgentModelSelection;
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

/** Final outcome of one Agent turn. */
export interface MiniAppAgentRunResult {
  /** Pass back in `run({ sessionId })` to continue the same conversation. */
  readonly sessionId: string;
  /** Absent when no turn ran: an `answer` accepted without starting a continuation. */
  readonly turnId?: string;
  /** The model the turn was dispatched with; absent when no turn ran. */
  readonly model?: MiniAppAgentModelSelection;
  /** `aborted` only when the Host confirmed the abort; an unconfirmed cancel rejects with `result_unknown`. */
  readonly status: 'finished' | 'error' | 'aborted';
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
 * - `permission.requested`: a tool call waits for approval; decide it with `agent.reply`.
 * - `question.requested`: the turn paused on a questionnaire; continue with `agent.answer`.
 * - `turn.finished`: always last; same `status`, `text`, and `error` as the run result.
 * Every event except `run.queued` names its `sessionId`, so `reply` works before the `run` that
 * created the session has returned. `answer` does not: call it after the paused `run` resolves,
 * or it rejects as busy.
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
      readonly status: 'finished' | 'error' | 'aborted';
      readonly text?: string;
      readonly error?: { readonly code: string; readonly message: string };
    };

export interface MiniAppAgentRunInput {
  /** Plain text, at most 100,000 UTF-16 code units. */
  readonly text: string;
  /** Continue a session this Mini App created earlier; omit to start a new one. */
  readonly sessionId?: string;
  /**
   * Switch the session to this model before the turn (validated like the composer validates a new
   * session's model: it must be one `models()` lists; unusable is `invalid_request`, missing BYOK
   * credentials end the turn with `status: 'error'`); the session keeps it. Omit to use the session's current model.
   */
  readonly model?: MiniAppAgentModelSelection;
  /**
   * Only when starting a session (no `sessionId`): an agent `name` from `agents()`. A session
   * never changes its agent, so passing it with `sessionId` is `invalid_request`.
   */
  readonly agent?: string;
  /** Your id for `cancel(requestId)`; 1-128 characters, unique among this page's active runs. */
  readonly requestId?: string;
}

export interface MiniAppAgentReplyInput {
  readonly sessionId: string;
  /** `requestId` of the `permission.requested` event. */
  readonly requestId: string;
  /** No `allowAlways`: a Mini App never writes the user's global rules. */
  readonly decision: 'allowOnce' | 'deny';
}

export interface MiniAppAgentAnswerInput {
  readonly sessionId: string;
  /** `requestId` of the `question.requested` event or of `result.pendingQuestion`. */
  readonly questionId: string;
  /** One answer per questionnaire step. */
  readonly answers: readonly MiniAppAgentQuestionAnswer[];
  /** Same as `MiniAppAgentRunInput.model`, applied before the continuation turn. */
  readonly model?: MiniAppAgentModelSelection;
  /** Your id for `cancel(requestId)`, as in `run`. */
  readonly requestId?: string;
}

export interface MiniAppAgentRunOptions {
  readonly onEvent?: (event: MiniAppAgentRunEvent) => void;
}

/**
 * Absent on older Hosts. Calls reject with `not_permitted` unless the manifest declares
 * `agentAccess: ["session.run"]`. A new session uses the Agent of the chat this page is open in;
 * a page without a host chat uses the primary Agent unless `run({ agent })` / `create({ agent })`
 * names one from `agents()`. Continuing a session keeps its Agent.
 * The Agent works in the host chat's project directory when it has one, otherwise in this Mini
 * App's own Agent directory; a continued session keeps its directory. A new session takes the
 * model and thinking level of the host chat (the runtime default when the chat has none) and keeps
 * them; `run` / `answer` with `model` switch the session's model first.
 * It runs one turn with that Agent's full capabilities (files, shell, Skills, MCP including this
 * Mini App's own), and resolves when it ends.
 *
 * Interaction is yours to render: handle `permission.requested` with `reply` and
 * `question.requested` with `answer`. A permission request waits only while this run passed
 * `onEvent` or the session is open in a chat side panel through `open`; otherwise it is denied
 * and the model is told why. A run with `onEvent` that does not handle the request waits until
 * `cancel` or the page closes; there is no timeout. Up to `agentConcurrency` runs (default 4) per
 * Mini App run at once, one per session; further `run` / `answer` calls wait in order (up to four
 * times that many, see `run.queued`), and `cancel` on a waiting call rejects it with `cancelled`.
 * `busy` means the session already has a run in progress or the wait queue is full.
 * Failures reject with an `Error` whose `message` is `invalid_request`, `not_permitted`, `busy`,
 * `session_not_found`, `runtime_unavailable`, `cancelled`, `result_unknown`, or
 * `request_not_found`. `runtime_unavailable` means nothing was started; `result_unknown` means
 * the turn may have run (or ended without the Host knowing whether a question is pending), so
 * never repeat it automatically.
 */
export interface MiniAppAgentAPI {
  run(
    input: MiniAppAgentRunInput,
    options?: MiniAppAgentRunOptions,
  ): Promise<MiniAppAgentRunResult>;
  /** Decide a pending permission request; `request_not_found` when it is unknown or settled. */
  reply(input: MiniAppAgentReplyInput): Promise<void>;
  /**
   * Answer a questionnaire; the continuation turn is observed like `run`. Rejects with
   * `result_unknown` when the answer was recorded but the continuation turn was not observed.
   */
  answer(
    input: MiniAppAgentAnswerInput,
    options?: MiniAppAgentRunOptions,
  ): Promise<MiniAppAgentRunResult>;
  /** Ask the Host to stop an active run or answer; unknown or finished ids are ignored. */
  cancel(requestId: string): void;
  /**
   * Show one of this Mini App's sessions as a tab in the side panel of the chat the
   * Mini App is open in, where the user can read the conversation and answer
   * permission and question cards themselves. Permission requests wait for the tab only
   * while it stays open; once the user closes it, handle `permission.requested` yourself
   * or call `open` again. Any session this Mini App owns can be opened, whichever chat
   * created it; `session_not_found` otherwise.
   */
  open(sessionId: string): Promise<void>;
  /**
   * Returns the model catalog, runtime `default` and optional chat `host`. Pass `default` / `host`
   * directly as `model` to `run` / `answer`. For a catalog entry, extract `providerId` / `modelId`,
   * add a selected `variant` if needed and preserve `variant: ''`. If thinking is supported,
   * select an effort from `thinking.efforts` and pass `thinking: { effort }`.
   */
  models(): Promise<MiniAppAgentModels>;
  /** The agents the user has configured; `agent` of `create` / a first `run` must be one of them. */
  agents(): Promise<MiniAppAgentAgents>;
  /**
   * Create a session bound to this chat (agent, project directory, model) without running a
   * turn, and return its `sessionId`; continue it with `run({ sessionId })` here or hand it to
   * Node code. `agent` picks the session's agent from `agents()`; a session never changes it.
   * Takes no run slot. If the Host's 60 s deadline passes it rejects with `runtime_unavailable`
   * although the session may already exist.
   */
  create(input?: { readonly agent?: string }): Promise<{ readonly sessionId: string }>;
}

export interface MiniAppClientAPI {
  readonly message: MiniAppMessageAPI;
  readonly agent?: MiniAppAgentAPI;
  /**
   * Proposed: shape may still change. Feature-detect with
   * `window.mcode?.miniapp?.window` before use.
   */
  readonly window?: MiniAppWindowHandle;
}

/** Live state of the popped-out window: current position, size, and flags — not the manifest declaration. */
export interface MiniAppWindowOptions {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly resizable: boolean;
  readonly frame: boolean;
  readonly transparent: boolean;
  readonly alwaysOnTop: boolean;
  readonly clickThrough: boolean;
  readonly skipTaskbar: boolean;
}

export type MiniAppWindowState =
  | { readonly mode: 'inline' }
  | { readonly mode: 'window'; readonly window: MiniAppWindowOptions };

/** Every field is optional; omitted fields are left unchanged. */
export type MiniAppWindowPatch = Partial<{
  mode: 'inline' | 'window';
  width: number;
  height: number;
  x: number;
  y: number;
  visible: boolean;
  resizable: boolean;
  alwaysOnTop: boolean;
  clickThrough: boolean;
  skipTaskbar: boolean;
}>;

export interface MiniAppWindowDisposable {
  dispose(): void;
}

/**
 * Page-side handle for this Mini App's own window (proposed). Separate from
 * `message`; the Host injects both under the same `mcode.miniapp` namespace.
 */
export interface MiniAppWindowHandle {
  /** Opaque and stable across pop-out and return; never a Session or launch identifier. */
  readonly id: string;
  getState(): Promise<MiniAppWindowState>;
  /**
   * `update({ mode: ... })` or `focus()` require the call to originate from a
   * user gesture (`navigator.userActivation.isActive`); otherwise they reject
   * with `not_permitted` before any Host round trip.
   */
  update(patch: MiniAppWindowPatch): Promise<MiniAppWindowState>;
  focus(): Promise<void>;
  /** Returns a disposable; call `dispose()` to stop receiving updates. */
  onDidChangeState(listener: (state: MiniAppWindowState) => void): MiniAppWindowDisposable;
}

export interface McodeClientAPI {
  readonly miniapp: MiniAppClientAPI;
}

declare global {
  interface Window {
    /** Absent outside a supported managed Mini App main page. Check before use. */
    readonly mcode?: McodeClientAPI;
  }
}
