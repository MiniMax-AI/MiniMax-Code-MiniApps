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
  /** The model the turn was dispatched with; absent when no turn ran or the text was steered. */
  readonly model?: MiniAppAgentModelSelection;
  /**
   * `aborted` only when the Host confirmed the abort; an unconfirmed cancel rejects with
   * `result_unknown`. `steered` (only with `whenBusy`): the text joined the running turn
   * `turnId`, whose own call gets the reply, so there is no `text`.
   */
  readonly status: 'finished' | 'error' | 'aborted' | 'steered';
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
 * - `permission.requested`: a tool call waits for approval; decide it with `agent.reply`.
 * - `question.requested`: the turn paused on a questionnaire; continue with `agent.answer`.
 * - `turn.finished`: last unless the call ended `steered`; same `status`, `text`, and `error`
 *   as the run result.
 * Every event except `run.queued` names its `sessionId`, so `reply` works before the `run` that
 * created the session has returned. `answer` does not: call it after the paused `run` resolves,
 * or it rejects as busy.
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
  /**
   * Only with `sessionId`, when that session is already running a turn (otherwise it starts one as
   * usual). `queue`: the text runs as the next turn and this call follows it. `steer`: the
   * running turn reads the text at its next input point; the call resolves `steered`, or follows
   * the next turn when the running one answered before reading it. Omit to reject as `busy`.
   */
  readonly whenBusy?: 'queue' | 'steer';
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
 * Absent on older Hosts. `run` / `reply` / `answer` / `open` / `models` / `agents` / `create` reject
 * with `not_permitted` unless the manifest declares `agentAccess: ["session.run"]`; `observe` /
 * `sessions` need `"session.read"` for anything but this Mini App's own sessions (see
 * docs/agent.md). A new session uses the Agent of the chat this page is open in;
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
 * `busy` means the session already has a run in progress (never with `whenBusy`) or the wait
 * queue is full.
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
  /**
   * Watch the user's Agent at work (see `MiniAppAgentObserveTarget`). Pass a `requestId` to be
   * able to stop it with `cancel(requestId)`. Resolves when the subscription ended: cancelled, the
   * session was deleted, the page or Mini App stopped, or `session.read` was switched off. Rejects
   * with `invalid_request` (not exactly one target), `not_permitted`, `session_not_found`, or
   * `busy` past 4 observers per Mini App; observers use no run slots. Check
   * `capabilities?.has('agent.observe')` first: older Hosts lack it.
   */
  observe(
    target: MiniAppAgentObserveTarget & { readonly requestId?: string },
    options: { readonly onEvent: (event: MiniAppAgentObservedEvent) => void },
  ): Promise<void>;
  /** Check `capabilities?.has('agent.sessions')` first: older Hosts lack it. */
  sessions(): Promise<MiniAppAgentSessions>;
  /**
   * The chat this page is open in (needs `session.read`: it is the user's conversation, not this
   * Mini App's); undefined when the page is not in a chat tab. Check
   * `capabilities?.has('agent.session')` first.
   */
  session(): Promise<MiniAppAgentSessionDetail | undefined>;
  /** One conversation with its model and latest reply. */
  session(sessionId: string): Promise<MiniAppAgentSessionDetail>;
}

/**
 * Page entry for asking "always allow" ahead of time, while the user is present, so later Node
 * calls need no prompt. Listing and calling tools is Node `context.tool` only. Needs
 * `"toolAccess": ["call"]` and a running Node process; check
 * `capabilities.has('tool.request')`.
 */
export interface MiniAppToolRequestAPI {
  /**
   * Shows one Host prompt for the named tools (runtime names from Node `context.tool.list()`)
   * that are still `ask`; the user ticks which to always allow. Resolves each name's state
   * afterwards; the Host never trusts this map back. Only inside a user gesture
   * (`navigator.userActivation.isActive`), 1–10 distinct names, else `invalid_request`.
   * Other rejections: `not_permitted` (no `toolAccess`), `approval_required` (no Host window
   * can show the prompt), `runtime_unavailable` (Node process not running), `result_unknown`.
   */
  request(names: readonly string[]): Promise<Record<string, 'allow' | 'ask' | 'deny'>>;
}

export interface MiniAppClientAPI {
  readonly message: MiniAppMessageAPI;
  readonly agent?: MiniAppAgentAPI;
  /** Absent on Hosts without `tool.request`. */
  readonly tool?: MiniAppToolRequestAPI;
  /**
   * Proposed: shape may still change. Feature-detect with
   * `window.mcode?.miniapp?.window` before use.
   */
  readonly window?: MiniAppWindowHandle;
  /** Absent on older Hosts; check `capabilities.has('speech.transcribe')`. */
  readonly speech?: MiniAppSpeechAPI;
  /**
   * Synchronous probe of Host features, fixed per Host version; independent of this Mini App's
   * manifest or grants. Absent on older Hosts: check `window.mcode?.miniapp?.capabilities?.has`.
   */
  readonly capabilities?: MiniAppHostCapabilities;
}

export interface MiniAppHostCapabilities {
  has(name: string): boolean;
}

/**
 * The only PCM the Host transcribes. Capture at exactly this (an `AudioContext` created with
 * `sampleRate: 16000`, one channel, samples converted to `Int16Array`) and pass the object
 * verbatim; any other value is `invalid_request`. See `audio-capture.ts` for a capture helper.
 */
export interface MiniAppSpeechAudioFormat {
  readonly sampleRate: 16000;
  readonly channelCount: 1;
  readonly sampleFormat: 's16';
}

export interface MiniAppSpeechTranscribeInput {
  /**
   * One utterance of samples: an `Int16Array`, or the `ArrayBuffer` / view behind one. At least
   * one sample, at most 16,000,000 bytes (500 s). Not an encoded file: WAV, WebM, Ogg, FLAC and
   * MP3 are refused as `invalid_request`.
   */
  readonly audio: ArrayBuffer | ArrayBufferView;
  readonly format: MiniAppSpeechAudioFormat;
}

export interface MiniAppSpeechTranscribeOptions {
  /** The transcript so far while the Host is still transcribing; the final text is the result. */
  readonly onPartial?: (text: string) => void;
}

/**
 * Speech recognition of audio the page captured. Requires the manifest to declare
 * `deviceAccess: ["microphone"]` and the user's "Use the microphone" switch to be on (the same
 * switch that lets `getUserMedia` succeed); otherwise calls reject with `not_permitted`.
 * The Host transcribes after it has the whole utterance: decide the utterance boundary in the
 * page (release of a push-to-talk button, a stop button, a silence detector), then call once
 * per utterance. One call per Mini App runs at a time; a second is `busy`.
 * Failures reject with an `Error` whose `message` is `invalid_request`, `not_permitted`,
 * `audio_too_large`, `busy`, `runtime_unavailable` (speech recognition is disabled or the user
 * is signed out), `transcription_failed`, or `result_unknown`.
 */
export interface MiniAppSpeechAPI {
  transcribe(
    input: MiniAppSpeechTranscribeInput,
    options?: MiniAppSpeechTranscribeOptions,
  ): Promise<{ readonly text: string }>;
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
