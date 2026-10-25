// Runtime smoke test for the AI Node Canvas MiniApp.
//
// The official package validator only checks static contract. This exercises
// the actual runtime: the Node entry, the loopback API, canvas persistence,
// the Agent path, the capability surface, server-side reference limits, and
// the permission branch where the user must decide.
//
// Run with: node --test "tests/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer } from 'node:http';

import { start } from '../miniapp/node/server.mjs';
import { palette, resolveLimits, resolutionsForDuration } from '../miniapp/node/capabilities.mjs';
import { applyAction, materializeResults, runSpecFor } from '../miniapp/client/actions.mjs';
import { createActionQueue, OWNER_TTL_MS } from '../miniapp/node/action-queue.mjs';
import { decodeHostConnectorValue } from '../miniapp/node/host-connector-value.mjs';
import { findMediaTool, RETIRED_TOOLS, TOOL_ACCEPTS, TOOL_PRODUCES, delogoRect } from '../miniapp/node/media-tools.mjs';
import { cropRectAfterDrag, fanOutParams, NODE_GAP, toolPrompt } from '../miniapp/client/tools.mjs';
import { scanFiles } from './scan-undefined.mjs';

// The provider's asset host cannot be reached from a test, and a real request
// to it may hang on a DNS lookup. A closed port on the loopback fails at
// once, so the run finishes the same way every time.
const ASSET_HOST = 'http://127.0.0.1:9';

// The ports the fetch standard refuses to talk to, for safety reasons that
// predate the browser (ftp, IRC, SMB and friends). Node's fetch enforces
// the same list and throws "bad port" before it opens a socket.
const BLOCKED_FETCH_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
  1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6679, 6697, 10080,
]);

function isBlockedFetchPort(port) {
  return BLOCKED_FETCH_PORTS.has(port);
}

function createMockAgent(options = {}) {
  const calls = [];
  // One entry per waiting run: the Host holds a permission request open
  // until the user decides, and every run holds its own request.
  const pending = new Map();

  const cancelled = () =>
    Object.assign(new Error('请求已取消'), { code: 'REQUEST_CANCELLED' });

  // A questionnaire the Host pauses on, the way a real turn does.
  const questionnaire = (requestId) => ({
    schemaVersion: 2,
    id: 'q_1',
    title: '确认一下',
    steps: [
      {
        id: 'step_1',
        header: '选一个',
        question: '用哪种语气？',
        selectionMode: 'single',
        allowOther: true,
        options: [{ id: 'a', label: '正式' }, { id: 'b', label: '轻松' }],
      },
    ],
  });

  return {
    calls,
    async models() {
      return {
        models: [
          { providerId: 'minimax', modelId: 'minimax-M3' },
          { providerId: 'minimax', modelId: 'minimax-M2.7', variant: 'fast' },
          { providerId: 'openai', modelId: 'gpt-oss' },
        ],
        default: 'minimax-M3',
      };
    },
    async create() {
      return { sessionId: 'sess_1' };
    },
    async run(payload, runOptions = {}) {
      calls.push({ kind: 'run', payload });
      const onEvent = runOptions.onEvent;
      const sessionId = payload.sessionId ?? 'sess_1';

      // A turn that pauses on a question ends the turn with the question
      // still pending; it is not a finished run.
      if (options.questionnaire) {
        const requestId = 'q_1';
        const request = questionnaire(requestId);
        onEvent?.({ type: 'question.requested', sessionId, requestId, mode: 'questionnaire', request });
        return {
          sessionId,
          status: 'finished',
          text: '',
          pendingQuestion: { requestId, mode: 'questionnaire', request },
        };
      }

      const requestId = `req_${calls.filter((call) => call.kind === 'run').length}`;
      onEvent?.({ type: 'turn.started', sessionId, model: { providerId: 'minimax', modelId: 'minimax-M3' } });
      onEvent?.({ type: 'text.delta', sessionId, text: '生成结果：' });
      onEvent?.({ type: 'text.delta', sessionId, text: 'https://cdn.example.com/out.png' });
      onEvent?.({ type: 'tool.started', sessionId, name: 'image_gen' });
      onEvent?.({ type: 'tool.finished', sessionId, name: 'image_gen', ok: true });
      onEvent?.({
        type: 'permission.requested',
        sessionId,
        requestId,
        toolName: 'bash',
        reason: '需要执行命令',
      });
      await new Promise((resolve, reject) => {
        pending.set(requestId, resolve);
        // The Host drops a run whose call is aborted.
        const signal = runOptions.signal;
        if (!signal) return;
        const onAbort = () => {
          pending.delete(requestId);
          reject(cancelled());
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      onEvent?.({ type: 'turn.finished', sessionId, status: 'finished' });
      return {
        sessionId,
        status: 'finished',
        text: '生成结果：\n![out](https://cdn.example.com/out.png)',
      };
    },
    async reply(payload) {
      calls.push({ kind: 'reply', payload });
      if (options.replyFails) {
        throw Object.assign(new Error('回复没送到'), { code: options.replyFails });
      }
      const resolve = pending.get(payload.requestId);
      if (resolve) {
        pending.delete(payload.requestId);
        resolve();
      }
      return {};
    },
    async answer(payload, answerOptions = {}) {
      calls.push({ kind: 'answer', payload });
      // The answer is a call of its own, so it can be aborted like a run.
      if (options.hangOnAnswer) {
        await new Promise((resolve, reject) => {
          const signal = answerOptions.signal;
          if (!signal) return;
          const onAbort = () => reject(cancelled());
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return { sessionId: payload.sessionId, status: 'finished', text: '已回答' };
    },
  };
}

// A stand-in for the Host connector client. The Node service must read the
// voice catalogue through it instead of shipping a made-up list.
function createMockHostConnector(voices = [
  { voice_id: 'male-qn-qingse', voice_name: '青涩青年音色' },
  { voice_id: 'female-shaonv', voice_name: '少女音色' },
], options = {}) {
  const calls = [];
  // How many provider calls were in flight at the same time. The Host gives
  // every call a window of its own, so two calls that share the machine are
  // the two that run over it. The count is kept per tool: a quick read does
  // not have to wait for a slow picture.
  const state = { inFlight: 0, maxInFlight: 0, concurrentByTool: {}, toolSeq: {}, listCalls: 0, staleServed: false };
  const tool = (name) => ({
    toolRef: `ref-matrix-${name.replace(/_/g, '-')}`,
    provider: 'matrix',
    name: `matrix_${name}`,
    inputSchema: { type: 'object', properties: {} },
  });
  return {
    calls,
    state,
    async list() {
      state.listCalls += 1;
      return {
        tools: [
          tool('get_voice_list'),
          tool('generate_image'),
          tool('submit_video_generation'),
          tool('query_video_generation'),
          tool('synthesize_speech'),
          tool('batch_text_to_music'),
          tool('videos_understand'),
          tool('describe_images'),
          tool('get_asset_url'),
          tool('upload_temp_url'),
        ],
        partial: false,
      };
    },
    async call(toolRef, args) {
      const record = { toolRef, args };
      calls.push(record);
      // The number of this call. A batch runs its calls at the same time, so
      // the number cannot be "how many have happened so far".
      const seq = calls.length;
      const name = toolRef.replace(/^ref-matrix-/, '').replace(/-/g, '_');
      // How many calls of this tool are on the machine right now.
      const seen = (state.concurrentByTool[name] ??= { current: 0, max: 0 });
      seen.current += 1;
      seen.max = Math.max(seen.max, seen.current);
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, options.callDelayMs ?? 15));
        // The tool reference belongs to the Host: it goes stale when the
        // service restarts. The Host says so with this code.
        if (options.staleRefOnce && !state.staleServed) {
          state.staleServed = true;
          throw Object.assign(new Error('tool reference is stale'), { code: 'TOOL_REF_STALE' });
        }
        // The Host stops a call that takes too long, and the call it stops
        // leaves nothing behind: the outcome is unknown.
        const toolSeq = (state.toolSeq[name] = (state.toolSeq[name] ?? 0) + 1);
        if (options.timeoutCall && options.timeoutCall.tool === name && options.timeoutCall.nth === toolSeq) {
          throw Object.assign(new Error('The connector call timed out'), { code: 'CONNECTOR_OUTCOME_UNKNOWN' });
        }
        return await respond(name, args, seq, record);
      } finally {
        state.inFlight -= 1;
        seen.current -= 1;
      }
    },
  };

  // What the provider answers. The tracking above is about the machine, this
  // is about the provider.
  async function respond(name, args, seq, record) {
    if (name === 'upload_temp_url') {
      // The provider cannot read this machine's disk: it is told what the
      // file is, and it answers with a signed form the bytes go to.
      if (typeof args?.filename !== 'string' || !args.filename) {
        throw new Error('Connector arguments are invalid');
      }
      if (typeof args?.mime_type !== 'string' || !args.mime_type) {
        throw new Error('Connector arguments are invalid');
      }
      return {
        invocationId: 'invocation-test',
        value: [{
          type: 'text',
          text: JSON.stringify({
            code: 0,
            message: 'ok',
            upload_host: options.uploadHost ?? 'https://upload.example.com/upload',
            fields: { key: 'value', policy: 'strict' },
            file_field_name: 'file',
            temp_url: 'https://cdn.example.com/temp/sample.png',
            max_bytes: 10 * 1024 * 1024,
            expires_in_seconds: 600,
          }),
        }],
      };
    }
    if (name === 'get_voice_list') {
      return {
        invocationId: 'invocation-test',
        value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', available_voices: voices, total: voices.length }) }],
      };
    }
    if (name === 'get_asset_url') {
      // A video has no drive asset: the provider keeps the file on its task
      // and gives the link with the task's own answer. Asking for a video by
      // its file id is refused.
      if (String(args?.node_id ?? '').startsWith('video-')) {
        return {
          invocationId: 'invocation-test',
          value: [{ type: 'text', text: JSON.stringify({ code: 500, message: 'video has no drive asset' }) }],
        };
      }
      return {
        invocationId: 'invocation-test',
        // The provider's asset host cannot be reached from a test, and a
        // real request to it may hang on a DNS lookup. A closed port on the
        // loopback fails at once, so the run finishes the same way every
        // time.
        value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', node_id: args.node_id, download_url: `${ASSET_HOST}/${args.node_id}` }) }],
      };
    }
    if (name === 'generate_image') {
      if (options.failImage) {
        return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 402, message: '账户余额不足' }) }] };
      }
      // The provider is called once per asset, so every call answers with an
      // item of its own.
      const imageCalls = calls.filter((call) => call.toolRef.endsWith('generate-image'));
      // Which call of the batch this is. The calls run at the same time, so
      // the place of this call among them is what counts.
      const position = imageCalls.indexOf(record) + 1;
      // One call of a batch can fail on its own.
      if (options.failImageCall && position === options.failImageCall) {
        return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 500, message: '这一张没出来' }) }] };
      }
      const items = (Array.isArray(args?.requests) ? args.requests : []).map(() => ({ node_id: `node-${seq}`, file_name: 'a.png' }));
      return {
        invocationId: 'invocation-test',
        value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', success_items: items }) }],
      };
    }
    if (name === 'submit_video_generation') {
      return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', task_id: 'task-9' }) }] };
    }
    if (name === 'query_video_generation') {
      if (options.videoState === 'succeeded') {
        // A finished video answers with its own link. The file id points at a
        // drive asset that does not exist, so the link in the answer is the
        // only way to the file.
        return {
          invocationId: 'invocation-test',
          value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', status: 'succeeded', file_id: 'video-1', video_url: 'https://cdn.example.com/video-1.mp4' }) }],
        };
      }
      if (options.videoState === 'succeeded-without-link') {
        // The task is done but the answer carries no link at all.
        return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', status: 'succeeded', file_id: 'video-1' }) }] };
      }
      return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', status: 'running' }) }] };
    }
    if (name === 'synthesize_speech') {
      // One clip per call, so a batch of clips is a few calls.
      return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', node_id: `node-${seq}`, file_name: 'a.mp3' }) }] };
    }
    if (name === 'batch_text_to_music') {
      const items = (Array.isArray(args?.requests) ? args.requests : []).map(() => ({ node_id: `node-${seq}`, file_name: 'a.mp3' }));
      return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', success_items: items }) }] };
    }
    if (name === 'videos_understand') {
      // What the provider makes of the video. The runtime asks for it before
      // the Agent writes the prompt.
      const items = (Array.isArray(args?.video_info) ? args.video_info : []).map((item) => ({
        description: `视频内容：${item.url}`,
      }));
      return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', results: items }) }] };
    }
    if (name === 'describe_images') {
      // And the same for a picture.
      const items = (Array.isArray(args?.image_info) ? args.image_info : []).map((item) => ({
        description: `图片内容：${item.url}`,
      }));
      return { invocationId: 'invocation-test', value: [{ type: 'text', text: JSON.stringify({ code: 0, message: 'ok', results: items }) }] };
    }
    throw new Error(`unexpected tool ${name}`);
  }
}

// Windows keeps a file busy for a moment after the runtime wrote it, so a
// plain delete can fail with ENOTEMPTY. The retries turn that into a short
// wait instead of a failed test.
async function removeDir(dir) {
  await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 60 });
}

async function createHarness(options = {}) {
  const ownsDataDir = !options.dataDir;
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'nxc-test-')));
  const controller = new AbortController();
  const agent = options.agent ?? createMockAgent(options.agentOptions);
  const hostConnector = options.hostConnector === null ? undefined : (options.hostConnector ?? createMockHostConnector());
  const context = {
    pluginId: 'ai-node-canvas',
    pluginRoot: fileURLToPath(new URL('..', import.meta.url)),
    dataDir,
    signal: controller.signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    agent,
    hostConnector,
  };

  // The kernel picks the port while it binds, so nothing can take it in
  // between the probe and the listen. Probing a port first and using it
  // afterwards is a race, and it made the suite fail now and then.
  //
  // This machine hands out dynamic ports from 1024 upwards, and that range
  // contains the ports the fetch standard refuses to talk to (2049, 3659,
  // 4045, 5060, 6000, 6665-6669, 10080 ...). The kernel picks one of them
  // every few dozen runs and every request in that harness fails with
  // "bad port" — a flake that looks like a product bug and hides real
  // failures. So: take the port the kernel gave, and if it is one of those,
  // give it back and ask again.
  let lifecycle = null;
  let port = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      lifecycle = await start({ ...context, listen: { host: '127.0.0.1', port: 0 } });
      port = lifecycle.port;
      if (port > 0 && !isBlockedFetchPort(port)) break;
      // The runtime did not report a usable port. Start again rather than
      // talking to a port that does not exist, or one fetch refuses.
      await lifecycle.dispose();
      lifecycle = null;
      port = 0;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  if (!lifecycle) throw new Error('no free port for the test runtime');
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    agent,
    hostConnector,
    dataDir,
    async cleanup() {
      await lifecycle.dispose();
      if (ownsDataDir) await removeDir(dataDir);
    },
  };
}

async function getJson(base, path, init) {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// One call to the hosted MCP server. The Host speaks Streamable HTTP, so the
// headers are the ones it sends.
async function mcpCall(base, message, init = {}) {
  const response = await fetch(`${base}/mcp/canvas`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

// The answer of a tool call, parsed out of the content the tool returned.
function toolResult(reply) {
  assert.ok(reply?.body?.result?.content, 'the tool must answer with content');
  return JSON.parse(reply.body.result.content[0].text);
}

test('serves the page and its assets on the declared surface path', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const page = await fetch(`${h.base}/canvas`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /节点画布/);
  assert.match(html, /\/app\.js/);
  assert.match(html, /\/styles\.css/);

  const script = await fetch(`${h.base}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type') ?? '', /javascript/);

  const style = await fetch(`${h.base}/styles.css`);
  assert.equal(style.status, 200);

  const missing = await fetch(`${h.base}/nope`);
  assert.equal(missing.status, 404);
});

test('bootstrap lists MiniMax models first', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const { status, body } = await getJson(h.base, '/api/bootstrap');
  assert.equal(status, 200);
  assert.equal(body.agentAvailable, true);
  assert.ok(body.models.length >= 3);
  const firstModel = body.models.find((m) => m.key !== 'default');
  assert.equal(firstModel.miniMax, true);
  assert.equal(firstModel.providerId, 'minimax');
});

test('capability surface differs per generation mode', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const image = await getJson(h.base, '/api/capabilities?mode=image');
  assert.equal(image.status, 200);
  // These enums are copied from the live connector schema, not guessed.
  assert.deepEqual(image.body.capabilities.ratios, ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']);
  assert.deepEqual(image.body.capabilities.resolutions, ['1K', '2K', '4K']);
  assert.equal(image.body.capabilities.maxImages, 9);
  assert.equal(image.body.capabilities.supportsDuration, false);

  const video = await getJson(h.base, '/api/capabilities?mode=video');
  assert.equal(video.body.capabilities.supportsDuration, true);
  assert.ok(video.body.capabilities.durations.includes(15));
  assert.equal(video.body.capabilities.maxVideos, 3);
  // Per-model restrictions come from the connector's conditional schema.
  const models = video.body.capabilities.models;
  const h3 = models.find((m) => m.id === 'MiniMax-H3');
  const h3max = models.find((m) => m.id === 'MiniMax-H3-Max');
  const hailuo = models.find((m) => m.id === 'MiniMax-Hailuo-2.3');
  assert.equal(h3.supportsReferences, true);
  assert.equal(h3max.supportsReferences, false);
  assert.equal(hailuo.supportsLastFrame, false);
  assert.deepEqual(hailuo.durations, [6, 10]);
  // The ratio belongs to the H3 family: H3 and H3-Max take one, Hailuo is not
  // in the family and takes none. Whether the card offers it is the mode's
  // business — the two keyframe requests follow the frame.
  assert.ok(h3.ratios.includes('adaptive'));
  assert.ok(h3max.ratios.includes('adaptive'));
  assert.deepEqual(hailuo.ratios, []);
  // Which requests each model can be asked for. The reference collection is
  // H3's alone, and the first+last frame request is not Hailuo's.
  assert.deepEqual(h3.paths, ['keyframe', 'firstLast', 'lastFrame', 'collection']);
  assert.deepEqual(h3max.paths, ['keyframe', 'firstLast', 'lastFrame']);
  assert.deepEqual(hailuo.paths, ['keyframe']);
  // One picture is the first frame; the reference collections are H3's alone.
  assert.equal(h3.maxImages, 9);
  assert.equal(h3max.maxImages, 1);
  assert.equal(hailuo.maxImages, 1);

  // Narrowing by model changes the effective limits.
  const narrowed = await getJson(
    h.base,
    `/api/capabilities?mode=video&model=${encodeURIComponent(JSON.stringify({ modelId: 'MiniMax-Hailuo-2.3' }))}`,
  );
  // Hailuo takes one picture — the first frame — so the run is not refused.
  assert.equal(narrowed.body.capabilities.maxImages, 1);
  assert.deepEqual(narrowed.body.capabilities.durations, [6, 10]);

  const audio = await getJson(h.base, '/api/capabilities?mode=audio');
  assert.equal(audio.body.capabilities.supportsEmotion, true);

  const text = await getJson(h.base, '/api/capabilities?mode=text');
  // A text node may look at an upstream image, so the reference limit is not
  // zero even though the mode has no picture parameters.
  assert.equal(text.body.capabilities.maxImages, 9);
  assert.equal(text.body.capabilities.supportsMentionImages, true);
});

test('bootstrap exposes the connector tools the MiniApp knows how to drive', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const { body } = await getJson(h.base, '/api/bootstrap');
  const tools = body.connectorTools ?? [];
  assert.ok(tools.length > 0);
  assert.ok(tools.some((t) => t.tool === 'connector__matrix__generate_image'));
});

test('mentions compile into provider-specific reference syntax', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_1',
      mode: 'image',
      segments: [
        { type: 'text', text: '照着 ' },
        { type: 'mention', nodeId: 'n_0', kind: 'image' },
        { type: 'text', text: ' 的风格画' },
      ],
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'minimax-M3' }),
      references: [
        {
          id: 'n_0',
          title: '素材',
          kind: 'image',
          text: '',
          media: [{ url: 'https://cdn.example.com/ref.png', kind: 'image' }],
        },
      ],
    }),
  });
  assert.equal(started.status, 202);
  const run = started.body.run;
  // minimax family uses @图片N
  assert.match(run.compiledPrompt, /@图片1/);
  assert.deepEqual(run.assets.images, ['https://cdn.example.com/ref.png']);
  assert.equal(run.assets.videos.length, 0);
});

test('a mention whose asset is gone becomes the provider missing marker', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_1',
      mode: 'image',
      segments: [{ type: 'mention', nodeId: 'ghost', kind: 'image' }],
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'minimax-M3' }),
      references: [],
    }),
  });
  assert.equal(started.status, 202);
  assert.match(started.body.run.compiledPrompt, /@图片\?/);
  assert.equal(started.body.run.assets.images.length, 0);
});

test('canvas create, save, load and delete round-trip through the API', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '测试画布' }),
  });
  assert.equal(created.status, 200);
  const id = created.body.canvas.id;
  assert.equal(created.body.canvas.title, '测试画布');
  assert.equal(created.body.canvas.nodes.length, 0);

  const payload = {
    id,
    title: '测试画布',
    nodes: [
      {
        id: 'n_1',
        type: 'image',
        title: '图片节点',
        position: { x: 10, y: 20 },
        width: 300,
        height: 320,
        metadata: {
          segments: [
            { type: 'text', text: '画一张海报，参考 ' },
            { type: 'mention', nodeId: 'n_0', kind: 'image' },
          ],
          model: 'minimax-M3',
          ratio: '3:4',
        },
      },
      { id: 'n_0', type: 'image', title: '素材', position: { x: 400, y: 20 } },
      {
        id: 'n_2',
        type: 'style',
        title: '风格',
        position: { x: 400, y: 420 },
        metadata: { styleText: '极简白底、真实自然光', templateId: 'product-main' },
      },
    ],
    connections: [{ id: 'c_1', fromNodeId: 'n_0', toNodeId: 'n_1' }],
    backgroundMode: 'dots',
    viewport: { x: 12, y: 34, k: 1.5 },
  };
  const saved = await getJson(h.base, `/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.canvas.nodes.length, 3);
  assert.equal(saved.body.canvas.connections.length, 1);
  assert.equal(saved.body.canvas.viewport.k, 1.5);

  // Segments are the source of truth; prompt and mentions are derived from them.
  const node = saved.body.canvas.nodes.find((item) => item.id === 'n_1');
  assert.equal(node.metadata.segments.length, 2);
  assert.equal(node.metadata.segments[1].kind, 'image');
  assert.match(node.metadata.prompt, /画一张海报/);
  assert.deepEqual(node.metadata.mentions, [{ nodeId: 'n_0', kind: 'image' }]);

  const loaded = await getJson(h.base, `/api/canvases/${id}`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.canvas.nodes.length, 3);
  assert.equal(loaded.body.canvas.nodes[1].position.x, 400);
  assert.equal(loaded.body.canvas.backgroundMode, 'dots');
  // A style node from an older canvas becomes an input node that holds text:
  // the style was a text source all along.
  const style = loaded.body.canvas.nodes.find((n) => n.id === 'n_2');
  assert.equal(style.type, 'input');
  assert.equal(style.metadata.kind, 'text');
  assert.equal(style.metadata.prompt, '极简白底、真实自然光');

  const list = await getJson(h.base, '/api/canvases');
  assert.ok(list.body.canvases.some((c) => c.id === id));

  const removed = await getJson(h.base, `/api/canvases/${id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const gone = await getJson(h.base, `/api/canvases/${id}`);
  assert.equal(gone.status, 404);
});

test('server drops connections that point at unknown nodes', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'x' }),
  });
  const id = created.body.canvas.id;
  const saved = await getJson(h.base, `/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      nodes: [{ id: 'n_1', type: 'text', position: { x: 0, y: 0 } }],
      connections: [
        { id: 'c_ok', fromNodeId: 'n_1', toNodeId: 'n_1' },
        { id: 'c_bad', fromNodeId: 'n_1', toNodeId: 'ghost' },
      ],
    }),
  });
  assert.equal(saved.body.canvas.connections.length, 0);
});

test('a text node run executes on the Agent, injects references and extracts media', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_1',
      // Text has no connector tool, so it keeps the Agent turn; the media
      // modes go straight to the connector.
      mode: 'text',
      prompt: '画一张海报',
      mentions: [{ nodeId: 'n_0', kind: 'image' }],
      params: { ratio: '3:4', resolution: '2K' },
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'minimax-M3' }),
      sessionId: null,
      references: [
        { id: 'n_0', title: '上游', kind: 'image', text: '主体是章鱼', media: [] },
      ],
    }),
  });
  assert.equal(started.status, 202);
  const runId = started.body.run.id;

  let run = null;
  for (let i = 0; i < 40 && !run?.pendingPermission; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
  }
  assert.ok(run.pendingPermission, 'run should surface a permission request');
  assert.equal(run.pendingPermission.toolName, 'bash');

  const runCall = h.agent.calls.find((c) => c.kind === 'run');
  assert.ok(runCall.payload.text.includes('章鱼'), 'upstream output must be injected');
  assert.ok(runCall.payload.text.includes('画一张海报'));
  // The text mode has no picture parameters, so none are passed through.
  assert.ok(!runCall.payload.text.includes('3:4'));
  assert.deepEqual(runCall.payload.model, { providerId: 'minimax', modelId: 'minimax-M3' });

  const denied = await getJson(h.base, `/api/runs/${runId}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'deny' }),
  });
  assert.equal(denied.status, 200);
  const replyCall = h.agent.calls.find((c) => c.kind === 'reply');
  assert.equal(replyCall.payload.decision, 'deny');

  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
    if (run.status === 'finished' || run.status === 'done') break;
  }
  assert.equal(run.status, 'done');
  assert.ok(run.text.includes('生成结果'));
  assert.equal(run.media.length, 1);
  assert.equal(run.media[0].url, 'https://cdn.example.com/out.png');
  assert.equal(run.media[0].kind, 'image');
});

test('the status vocabulary the page sees is the one the page understands', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // The Host Agent reports "finished"; the page only knows "done". If the
  // server leaks the Host vocabulary, a run spins forever in the UI.
  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_1', mode: 'image', prompt: 'x' }),
  });
  const runId = started.body.run.id;

  let run = null;
  for (let i = 0; i < 40 && !run?.pendingPermission; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
  }
  await getJson(h.base, `/api/runs/${runId}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'deny' }),
  });

  const PAGE_STATUSES = new Set(['running', 'waiting-question', 'done', 'error', 'aborted']);
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
    if (run.status !== 'running' && run.status !== 'waiting-question') break;
  }
  assert.ok(PAGE_STATUSES.has(run.status), `page received unknown status: ${run.status}`);
  assert.notEqual(run.status, 'finished', 'the Host vocabulary must not leak to the page');
});

test('the server enforces the reference limits before starting a run', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const oneImage = [
    {
      id: 'n_0',
      title: '素材',
      kind: 'image',
      text: '',
      media: [{ url: 'https://cdn.example.com/ref.png', kind: 'image' }],
    },
  ];

  // MiniMax-Hailuo-2.3 takes one picture — the first frame — so a run with
  // one picture is not refused.
  const accepted = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_1',
      mode: 'video',
      prompt: 'x',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'MiniMax-Hailuo-2.3' }),
      references: oneImage,
    }),
  });
  assert.equal(accepted.status, 202);

  // A second picture is too many for it: it takes one first frame, not a
  // collection.
  const rejected = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_2',
      mode: 'video',
      prompt: 'x',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'MiniMax-Hailuo-2.3' }),
      references: [...oneImage, { ...oneImage[0], id: 'n_0b' }],
    }),
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.message, /参考图片超过上限/);

  // MiniMax-H3-Max is the same: one picture, and it is the first frame.
  const maxAccepted = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_2b',
      mode: 'video',
      prompt: 'x',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'MiniMax-H3-Max' }),
      references: oneImage,
    }),
  });
  assert.equal(maxAccepted.status, 202);
  const maxRejected = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_2c',
      mode: 'video',
      prompt: 'x',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'MiniMax-H3-Max' }),
      references: [...oneImage, { ...oneImage[0], id: 'n_0c' }],
    }),
  });
  assert.equal(maxRejected.status, 400);
  assert.match(maxRejected.body.message, /参考图片超过上限/);

  // The same amount is fine with MiniMax-H3, which allows 9.
  const nine = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_3',
      mode: 'video',
      prompt: 'x',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'MiniMax-H3' }),
      references: Array.from({ length: 9 }, (_, index) => ({
        ...oneImage[0],
        id: `n_${index}`,
      })),
    }),
  });
  assert.equal(nine.status, 202);

  // And ten is one too many for it.
  const ten = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_4',
      mode: 'video',
      prompt: 'x',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'MiniMax-H3' }),
      references: Array.from({ length: 10 }, (_, index) => ({
        ...oneImage[0],
        id: `n_${index}`,
      })),
    }),
  });
  assert.equal(ten.status, 400);
  assert.match(ten.body.message, /参考图片超过上限/);

  // The global reference cap applies regardless of model. It is the provider's
  // own ceiling — a collection holds twelve items in all — so a request with
  // thirteen is refused before it is sent.
  const tooMany = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_limits',
      mode: 'image',
      prompt: 'x',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'minimax-M3' }),
      references: Array.from({ length: 13 }, (_, index) => ({
        id: `n_${index}`,
        title: `素材 ${index}`,
        kind: 'image',
        text: '',
        media: [{ url: `https://cdn.example.com/${index}.png`, kind: 'image' }],
      })),
    }),
  });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.message, /参考素材超过 12 个/);
  // And twelve is not refused by the cap: the cap was a number of our own
  // before, and it took a request the provider would have taken. A collection
  // of nine pictures and three clips is twelve items, and H3 takes twelve.
  const twelve = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_twelve',
      mode: 'video',
      nodeMode: 'image2video',
      prompt: 'x',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'MiniMax-H3' }),
      references: [
        ...Array.from({ length: 9 }, (_, index) => ({
          id: `n_i${index}`,
          title: `图 ${index}`,
          kind: 'image',
          text: '',
          media: [{ url: `https://cdn.example.com/${index}.png`, kind: 'image' }],
        })),
        ...Array.from({ length: 3 }, (_, index) => ({
          id: `n_v${index}`,
          title: `片 ${index}`,
          kind: 'video',
          text: '',
          media: [{ url: `https://cdn.example.com/${index}.mp4`, kind: 'video' }],
        })),
      ],
    }),
  });
  assert.doesNotMatch(String(twelve.body?.message ?? ''), /参考素材超过/);
});

test('the server refuses to forward anything but allowOnce or deny', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // The permission contract belongs to the Agent path; the media modes go
  // straight to the connector, which is authorised by the manifest grant.
  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_1', mode: 'text', prompt: 'x' }),
  });
  const runId = started.body.run.id;

  let run = null;
  for (let i = 0; i < 40 && !run?.pendingPermission; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
  }
  assert.ok(run.pendingPermission);

  // A page that tries to smuggle in "always allow" must be downgraded to deny.
  await getJson(h.base, `/api/runs/${runId}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'alwaysAllow' }),
  });
  const replyCall = h.agent.calls.find((c) => c.kind === 'reply');
  assert.equal(replyCall.payload.decision, 'deny');
  assert.ok(!('alwaysAllow' in replyCall.payload));
});

test('an approval card stays until the reply goes through', async (t) => {
  // The card is the user's only way to decide, so it may not disappear
  // before the Host has the answer. A reply that did not get through leaves
  // the card where it is; only the Host saying the request is no longer
  // pending takes it away.
  const h = await createHarness({ agentOptions: { replyFails: 'app_call_failed' } });
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_1', mode: 'text', prompt: 'x' }),
  });
  assert.equal(started.status, 202);
  const runId = started.body.run.id;

  let run = null;
  for (let i = 0; i < 40 && !run?.pendingPermission; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
  }
  assert.ok(run.pendingPermission, 'run should surface a permission request');
  const requestId = run.pendingPermission.requestId;

  // The reply does not get through: the card stays, so the user can decide.
  const failed = await getJson(h.base, `/api/runs/${runId}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'allowOnce' }),
  });
  assert.ok(failed.status >= 400, '回复失败要说出来');
  run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
  assert.ok(run.pendingPermission, '回复没送到时，批准卡必须还在');
  assert.equal(run.pendingPermission.requestId, requestId);
  assert.ok(!run.log.some((line) => line.includes('你批准了')), '没批准成就不该记成批准了');

  // The Host says the request is no longer pending: then the card goes away.
  const gone = await createHarness({ agentOptions: { replyFails: 'REQUEST_NOT_FOUND' } });
  t.after(() => gone.cleanup());
  const other = await getJson(gone.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_1', mode: 'text', prompt: 'x' }),
  });
  const otherId = other.body.run.id;
  let otherRun = null;
  for (let i = 0; i < 40 && !otherRun?.pendingPermission; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    otherRun = (await getJson(gone.base, `/api/runs/${otherId}`)).body.run;
  }
  await getJson(gone.base, `/api/runs/${otherId}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'allowOnce' }),
  });
  otherRun = (await getJson(gone.base, `/api/runs/${otherId}`)).body.run;
  assert.equal(otherRun.pendingPermission, null, '宿主说不再等待时，批准卡就该收走');
});

test('the served page and client match the installed files on disk', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const page = await fetch(`${h.base}/canvas`);
  const html = await page.text();

  // The server injects a build fingerprint so a stale page can reload itself.
  const buildMatch = /window\.__NXC_BUILD__="([0-9a-f]{12})"/.exec(html);
  assert.ok(buildMatch, 'page must carry a build fingerprint');
  const build = buildMatch[1];
  assert.match(html, new RegExp(`/app\\.js\\?v=${build}`), 'script must be cache-busted');

  const bootstrap = await getJson(h.base, '/api/bootstrap');
  assert.equal(bootstrap.body.clientBuild, build, 'page and API must agree on the build');
  assert.match(bootstrap.body.pluginVersion, /^\d+\.\d+\.\d+$/);

  // The client actually served must be the file that is installed, not a copy
  // frozen when the process started.
  const script = await fetch(`${h.base}/app.js?v=${build}`);
  const served = await script.text();
  const installed = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  assert.equal(served.length, installed.length, 'served client must match the installed file');
  assert.ok(served.includes('nxc-node__comet'), 'served client must be the current build');
});

test('the mention caret maths counts the text before the caret', async (t) => {
  // The editor is a contentEditable, so the caret maths is pure tree walking.
  // It is exercised here with a fake tree rather than a live browser.
  const { textIndexBefore, parseSegments, plainText, caretText, detectMention } = await import(
    '../miniapp/client/mention.mjs'
  );

  const text = (value) => ({ nodeType: 3, textContent: value, childNodes: [] });
  const chip = (nodeId, kind = 'image') => ({
    nodeType: 1,
    dataset: { mentionNodeId: nodeId, mentionKind: kind },
    childNodes: [],
  });

  // Caret at the end of a single text node: everything before it counts.
  const body = text('参考 @');
  const editor = { nodeType: 1, childNodes: [body] };
  assert.equal(textIndexBefore(editor, body, body.textContent.length), 4);
  assert.equal(textIndexBefore(editor, body, 0), 0);

  // Text before a chip counts, and the chip itself counts as one character.
  const head = text('看这个 ');
  const mention = chip('n_1');
  const tail = text(' 继续');
  const mixed = { nodeType: 1, childNodes: [head, mention, tail] };
  assert.equal(textIndexBefore(mixed, mention, 0), head.textContent.length);
  assert.equal(textIndexBefore(mixed, tail, 0), head.textContent.length + 1);

  // Parsing and mention detection.
  assert.deepEqual(parseSegments(mixed), [
    { type: 'text', text: '看这个 ' },
    { type: 'mention', nodeId: 'n_1', kind: 'image' },
    { type: 'text', text: ' 继续' },
  ]);
  assert.equal(plainText(parseSegments(mixed)), '看这个 @n_1 继续');
  // The caret space counts a chip as one character, the prompt text does not.
  assert.equal(caretText(parseSegments(mixed)).length, 8);
  assert.equal(detectMention(parseSegments(editor), 4), '');
  assert.equal(detectMention(parseSegments(editor), 2), null);
  // A chip followed by a typed "@" must still be detected.
  // caret space: '看这个 '(4) + chip(1) + ' @'(2) = 7, so the caret sits at 7.
  const after = text(' @');
  const withChip = { nodeType: 1, childNodes: [head, mention, after] };
  assert.equal(caretText(parseSegments(withChip)).length, 7);
  assert.equal(detectMention(parseSegments(withChip), 7), '');
  assert.equal(detectMention(parseSegments(withChip), 6), null);
});

test('the preview box follows the ratio of the media it shows', async () => {
  const { fitMediaBox } = await import('../miniapp/client/tools.mjs');

  // A generated asset comes in many ratios. The preview box has to keep the
  // asset's own ratio, or the preview is letterboxed inside a fixed frame.
  const wide = fitMediaBox(16 / 9, 302);
  assert.ok(Math.abs(wide.width / wide.height - 16 / 9) < 0.05, 'a wide asset is not shown at its own ratio');

  const tall = fitMediaBox(9 / 16, 302);
  assert.ok(Math.abs(tall.width / tall.height - 9 / 16) < 0.05, 'a tall asset is not shown at its own ratio');
  // A tall asset is narrower than the card, so it does not blow the card up.
  assert.ok(tall.height <= 420, 'a tall asset is not bounded');
  assert.ok(tall.width <= 302, 'a tall asset is wider than the card');

  const square = fitMediaBox(1, 302);
  assert.ok(Math.abs(square.width - square.height) < 2, 'a square asset is not shown square');

  // A very tall asset cannot keep its ratio inside the bounds, so the bounds
  // win: the card may not grow without limit.
  const veryTall = fitMediaBox(0.2, 302);
  assert.ok(veryTall.height <= 420, 'a very tall asset is not bounded');
  assert.ok(veryTall.width >= 160, 'a very tall asset collapses to nothing');

  // A ratio that still fits keeps its own ratio.
  const tallish = fitMediaBox(1 / 2.5, 302);
  assert.ok(Math.abs(tallish.width / tallish.height - 0.4) < 0.05, 'a tall asset is not shown at its own ratio');

  // A degenerate ratio still produces a usable box.
  const broken = fitMediaBox(0, 302);
  assert.ok(broken.width > 0 && broken.height > 0);
});

test('the watermark rectangle is inset so ffmpeg accepts it', () => {
  // ffmpeg's delogo refuses a rectangle that touches the frame edge ("Logo
  // area is outside of the frame"). The default rectangle sits in the top
  // left corner, so the area has to be inset and clipped.
  const info = { width: 1376, height: 768 };
  const corner = delogoRect(info, 0, 0, 200, 80);
  assert.ok(corner.x >= 1, 'the rectangle still touches the left edge');
  assert.ok(corner.y >= 1, 'the rectangle still touches the top edge');
  assert.ok(corner.x + corner.w <= info.width - 1, 'the rectangle runs past the right edge');
  assert.ok(corner.y + corner.h <= info.height - 1, 'the rectangle runs past the bottom edge');

  // A rectangle well inside the frame keeps the size it was given.
  const inner = delogoRect(info, 100, 100, 200, 80);
  assert.deepEqual(inner, { x: 100, y: 100, w: 200, h: 80 });

  // A rectangle that runs past the frame is clipped rather than failing.
  const over = delogoRect(info, 1300, 700, 400, 200);
  assert.ok(over.x + over.w <= info.width - 1);
  assert.ok(over.y + over.h <= info.height - 1);
  assert.ok(over.w > 0 && over.h > 0);
});

test('only a scratch file may be thrown away', async (t) => {
  // The last line of defence: the scratch cleanup may only remove a file in
  // the working folder. A published file belongs to the canvas that points
  // at it, and nobody may throw it away.
  const { createMediaStore } = await import('../miniapp/node/media-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'nxc-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createMediaStore({ dataDir: dir });

  const published = await store.publishBytes(Buffer.from([1, 2, 3]), '.png');
  const path = store.localPathOf(published.url);
  assert.ok(path, 'the published file has no path');
  const removed = await store.discard(path);
  assert.equal(removed, false, 'the scratch cleanup took a published file');
  assert.ok((await stat(path)).size > 0, 'the published file is gone');

  // A file in the working folder is scratch, and it goes away.
  const scratch = join(dir, 'work', 'in_scratch.png');
  await writeFile(scratch, Buffer.from([1, 2, 3]));
  assert.equal(await store.discard(scratch), true, 'a scratch file was not thrown away');
  let gone = false;
  try {
    await stat(scratch);
  } catch {
    gone = true;
  }
  assert.ok(gone, 'the scratch file is still there');
});

test('a tool does not take the picture it worked on with it', async (t) => {
  // The source of a tool is a picture the canvas still points at. Running a
  // tool on it must not delete it: the node keeps its own material, and the
  // second use of the tool has something to work on.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const state = (await getJson(h.base, '/api/media/status')).body.media;
  if (!state.available) return; // no ffmpeg here: the tools say so instead

  // A green picture, published as a real file — the same shape a generated
  // picture has.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAl0lEQVR4nO3SsQ0AMAzDsBTo/ycX/SB6gFy9CT7zhsXdRgRKHhQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAs/vTyQH8APl2oAAAAABJRU5ErkJggg==',
    'base64',
  );
  const published = await fetch(`${h.base}/api/media/publish?name=source.png`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: png,
  });
  assert.equal(published.status, 200);
  const url = (await published.json()).url;

  const response = await getJson(h.base, '/api/tools/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tool: 'resize',
      sources: [{ url, kind: 'image' }],
      params: { width: 48, height: 32 },
    }),
  });
  assert.equal(response.status, 200, `工具跑不动：${response.body?.message ?? ''}`);

  // The picture the tool worked on is still there.
  const after = await fetch(`${h.base}${url}`);
  assert.equal(after.status, 200, '工具把它的源图删掉了');
});

test('the image tools under a picture really run on this machine', async (t) => {
  // The buttons under a picture are only worth having if they produce
  // something. These are the local ones: they run ffmpeg on this machine, so
  // they are asked for a real file and the answer is a real file.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const state = (await getJson(h.base, '/api/media/status')).body.media;
  if (!state.available) {
    // No ffmpeg here: the tools say so instead of pretending.
    assert.equal(state.available, false);
    return;
  }

  // A solid green picture, so the chroma key has something to key on.
  const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAl0lEQVR4nO3SsQ0AMAzDsBTo/ycX/SB6gFy9CT7zhsXdRgRKHhQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAQaAgUBAoCBQECgIFgYJAs/vTyQH8APl2oAAAAABJRU5ErkJggg==';
  const picture = { url: source, kind: 'image' };
  const cases = [
    { tool: 'cutout', params: { color: 'green', tolerance: 0.3 } },
    { tool: 'enhance', params: { scale: 2 } },
    { tool: 'resize', params: { width: 48, height: 32 } },
    { tool: 'idPhoto', params: { size: '一寸' } },
  ];
  for (const item of cases) {
    const response = await getJson(h.base, '/api/tools/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: item.tool, sources: [picture], params: item.params }),
    });
    assert.equal(response.status, 200, `${item.tool} 跑不动：${response.body?.message ?? ''}`);
    const artifacts = response.body.artifacts ?? [];
    assert.ok(artifacts.length > 0, `${item.tool} 没有产出`);
    assert.ok(artifacts[0].url, `${item.tool} 的产出没有地址`);
  }

  // A one-second clip, so the video tools have a real file to work on.
  const clip = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAACGRtZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMyAwNDgwY2IwIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTIgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEwIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAD82WIhAF/8XmtV8X8DyL9TYa7rMc/QS90zACbN7PBT993t2RwSkp4k1frv7iKPFOsQCvKjVGmXR/8Adk0kZD2NKyod2FYbUbOis1dATUokx+rk/NwTr13b4A043vWI0MAAAMBMh9Z/gwFP+R/YVbslcY86aNDLnUfUFHVZSfVy0PU9+DHv+HFdOyVmHLfwe2jAb8NPi8FDTHqgfubziAC9bOZ/3l/buRJ+GC1qiv3itVfFDCSdxPkTyupPe702WmWGsaGsYHrKPr+r2uanj+v335UTNUipxaeCAts32n004Dn8ffjAfaHEHvjWenrdnOsGU7YYZhxSV/4A0fKvtOZHLaLZmEPhcn2jw5AjwpSKdQoabjLRM4rykuvYSwqOLclMo2USyh5548r01DIluUhJmxsEo1wkDT51FNVAm6KWFl2To2QqBXVuWKvHNmyLgXKvF6SuWc5S/Hbr0Ier2pPxSA5oHdLTq0mnkR6kBbnR7uaT7W8weD9BJPkgMSRH0XHbr1Fz/863aI0RoGLc2cmUekoUe4veuZPjqAapN/xtGZVf5OCRIdX8iWEx2WiNFeUudg8DuaSDNJ3aiQmfFUEUYc0Zi/uymFuitE3ro3Lejc68AlDKuIAKfIUYnoTtFp6n31naNzjL0dMS/I6zrIr5c4UQDpQXnuMd9wNTsdQ3HFXsXL28SF7nSy0lQ3hqVZFldK7GyDomL/3VcnfEl3F2YRCgkGdVO7jYBxCBHjmzpoMZJJrVhYlHYf2LK7i2lNWnif4pWfHBH9vJ2dDFV/QQvqypm6xrssYesE3pX2Jk+Xtd9LzBGPfP8SyTxC6GmaD2agwB9NnfoLVaxKErQh72kf2HM3lkeXXv8ZyC3NPQe3+K5jV7LGbc/wlfqS5HCNo+MyHDH3VHt7REfLnmnPvXeMc+k5zooMWnVrCtEIbhobgcOQq/k3AX0ZsAEeC38JJ/ZU6T+u+iTGab4IcExCyW0AGHcfMJ5r2UM/18wQbm8Q1k82ROLoQPxm5oN3ekt71UEtDDTPeIbpnEHrwLRqhmMDZrIjwj6zSEyTV2KtTah5FFyJVrhzGRv/fSfkVZVQz6HDiGLUd6CnyipNf/msi/Qbk3V78Um1a+Bhg4NBr+GRh/n42PdYpgXFydREizBGK3WHnJ63qiQYnBG2kw4eoZ82P7GP0GlRv2J4z8SGVVcyjvKv0nBMfgTxIWwWNM6Ttzm1j9puQw6BMFkeCpwKlljAsjdpmpW1+NnKT4BQnRoTGiG+YEvgLQJ+F4tX4yhP/W3Td7TJGoUphYyK0QFnu1DvLPduz563xV+xdG47ROQ8S4Y4dqAOvrW5hUKKEzc6vY+0SnQAAAJBBmiRsSf8AwJJtvjT4IvEhOuRC/ceE1RmadshxcvH12SjLilZP/TwYCIt4u+UlcryLHtCyaGtWjtYKlBT1VJdv6dysn67VhyIprRPAZgiEGuudZC/hIjaQ9lE0s19oItIPCHMLHfdcZY7dR+et0LIucDxwz7/5aqpWM55o5qExtXyFPj28gGQV7Ook1VHA2ycAAAAZQZ5CeIr/QmYgR1CqYVJeDZLOytIi35bJwQAAAA0BnmF0R39QjFeCyjG0AAAACQGeY2pHf07SeQAAAHFBmmhJqEFomUwIrwN1n6Gff5eXSMVZKNm9O5CKtXLUd3woRBJbsfNpbjiv8sdWNSQJJ1AR/rpLxOBTnk/D7VZacPDtTxy4l9t0mVkV+6BJvxOs/D1bxLY/TH//ffxLZvu5BD18YW/HbhYSs6753xl9ZQAAAB1BnoZFESxXQqVipvbALIw1DDef3SVxUq2AcbO3GQAAAAgBnqV0R387oQAAAAgBnqdqR387oAAAADJBmqlJqEFsmUwI7wXtfQttqZLgmIaaCJ3OXLTpWo+TNWwpOqv008i4G5fkSR65EwqmaQAAA7Ftb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAD6AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAC3HRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAYAAAAEAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAA+gAAAgAAAEAAAAAAlRtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAACgAAAAoAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAH/bWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABv3N0YmwAAAC/c3RzZAAAAAAAAAABAAAAr2F2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAYABAAEgAAABIAAAAAAAAAAEUTGF2YzYzLjEuMTAyIGxpYngyNjQAAAAAAAAAAAAAAAAY//8AAAA1YXZjQwFkAAr/4QAYZ2QACqzZRibARAAAAwAEAAADAFA8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAELgAAAAAAAAABhzdHRzAAAAAAAAAAEAAAAKAAAEAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAYGN0dHMAAAAAAAAACgAAAAEAAAgAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAAAgAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAKAAAAAQAAADxzdHN6AAAAAAAAAAAAAAAKAAAGqQAAAJQAAAAdAAAAEQAAAA0AAAB1AAAAIQAAAAwAAAAMAAAANgAAABRzdGNvAAAAAAAAAAEAAAAwAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMg==';
  const video = { url: clip, kind: 'video' };
  const videoCases = [
    { tool: 'frame', params: { count: 2 } },
    { tool: 'frameGrid', params: { cols: 2, rows: 2 } },
    { tool: 'trim', params: { start: 0, end: 0.5 } },
    { tool: 'cropVideo', params: { x: 0, y: 0, w: 48, h: 32 } },
    { tool: 'autoSegment', params: { threshold: 0.3 } },
    { tool: 'splitAv', params: {} },
    { tool: 'merge', params: {} },
    { tool: 'eraseSubtitle', params: { x: 0, y: 0, w: 8, h: 8 } },
    { tool: 'removeWatermark', params: { x: 0, y: 0, w: 8, h: 8 } },
    { tool: 'removeBg', params: { color: 'green' } },
  ];
  for (const item of videoCases) {
    const sources = item.tool === 'merge' ? [video, video] : [video];
    const response = await getJson(h.base, '/api/tools/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: item.tool, sources, params: item.params }),
    });
    assert.equal(response.status, 200, `${item.tool} 跑不动：${response.body?.message ?? ''}`);
    assert.ok((response.body.artifacts ?? []).length > 0, `${item.tool} 没有产出`);
  }
  // The four tools that were taken out are gone: the runtime does not know
  // them any more, so a stale page cannot call them.
  for (const tool of ['collage', 'poster', 'deWatermark', 'recolor']) {
    const response = await getJson(h.base, '/api/tools/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool, sources: [picture], params: {} }),
    });
    assert.notEqual(response.status, 200, `${tool} 下线了却还能跑`);
    assert.match(String(response.body?.message ?? ''), /未知工具/, `${tool} 的报错说不清`);
  }
});

test('the media tool run reports the ffmpeg state instead of crashing', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const state = (await getJson(h.base, '/api/media/status')).body.media;
  // A one pixel PNG, so the request has a real source to work on.
  const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const response = await getJson(h.base, '/api/tools/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'trim', sources: [{ url: source, kind: 'video' }], params: { start: 0, end: 2 } }),
  });

  if (!state.available) {
    // No ffmpeg on this machine: the tool has to say so plainly.
    assert.equal(response.status, 503);
    assert.match(response.body.message, /ffmpeg/);
    assert.equal(response.body.error, 'FFMPEG_UNAVAILABLE');
  } else {
    // ffmpeg is present, so the run gets past the check and fails on the
    // media itself rather than on a missing binary.
    assert.notEqual(response.body.error, 'FFMPEG_UNAVAILABLE');
  }
});

test('a media tool run refuses an unknown tool', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const response = await getJson(h.base, '/api/tools/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool: 'notATool', sources: [{ url: 'data:image/png;base64,AAAA' }] }),
  });
  // An unknown tool is a bad request, not a server failure.
  assert.equal(response.status, 400);
  assert.match(response.body.message, /未知工具/);
});

test('the palette serves the whole capability surface in one call', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const { status, body } = await getJson(h.base, '/api/palette');
  assert.equal(status, 200);
  assert.equal(body.agentAvailable, true);
  assert.ok(body.nodeTypes.includes('image'));
  assert.ok(body.nodeTypes.includes('input'));
  assert.ok(body.nodeTypes.includes('group'));
  // The style node is gone: a style was a text input with a template, and
  // the node table says so.
  assert.ok(!body.nodeTypes.includes('style'));
  assert.deepEqual(body.dataKinds, ['text', 'image', 'video', 'audio']);
  assert.ok(body.sizes.image.width > 0);
  assert.ok(body.modes.video.models.length >= 3, 'video models carry per-model limits');
  assert.ok(body.templates.length >= 2, 'style templates are served');
  assert.ok(body.connectorTools.length > 0);
  // The tool registry is part of the palette, with an explicit ready/pending
  // state so the UI can show 「（待接入）」 instead of hiding what is missing.
  assert.ok(body.tools.length >= 4);
  const split = body.tools.find((tool) => tool.key === 'gridSplit');
  assert.equal(split.status, 'ready');
  assert.equal(split.run, 'local');
  assert.ok(split.params.length >= 2);
  const viral = body.tools.find((tool) => tool.key === 'viral');
  assert.equal(viral.status, 'ready');
  assert.equal(viral.run, 'understand');
  // The local media tools travel with the palette, so the page can render
  // them before it learns whether ffmpeg is on the machine.
  const trim = body.tools.find((tool) => tool.key === 'trim');
  assert.equal(trim.status, 'ready');
  assert.equal(trim.run, 'ffmpeg');
  assert.ok(body.models.length > 0);
});

test('the media status says whether the local tools can run', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // The answer depends on the machine, so the test only checks the shape:
  // the page has to be able to tell "no ffmpeg" from "ffmpeg found".
  const { status, body } = await getJson(h.base, '/api/media/status');
  assert.equal(status, 200);
  assert.equal(typeof body.media.available, 'boolean');
  assert.equal(typeof body.media.version, 'string');
});

test('the text of an input upstream is prepended to the downstream prompt', async (t) => {
  const connector = createMockHostConnector();
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_1',
      mode: 'image',
      prompt: '一只章鱼',
      references: [
        // An input node that holds text: the style preset of the old card is
        // simply the text of an input node now.
        { id: 'n_style', title: '风格', kind: 'text', role: 'input', text: '极简白底、真实自然光', media: [] },
      ],
    }),
  });
  assert.equal(started.status, 202);
  // The media modes go straight to the provider, so the text has to reach
  // the provider's prompt, not only an Agent turn.
  const imageCall = await waitForCall(connector.calls, (call) => call.toolRef.endsWith('generate-image'));
  assert.ok(imageCall, 'generate_image was not called');
  const providerPrompt = imageCall.args.requests[0].prompt;
  assert.ok(providerPrompt.includes('极简白底、真实自然光'), 'the text must reach the prompt');
  assert.ok(
    providerPrompt.indexOf('极简白底') < providerPrompt.indexOf('一只章鱼'),
    'the preset must come before the user prompt',
  );
});

test('the same node refuses to run twice while other nodes may run', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // The text mode waits for the permission, so the run stays in flight: an
  // image run can come back before the second request even arrives, and then
  // there is nothing to refuse.
  const first = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_1', mode: 'text', prompt: 'x' }),
  });
  assert.equal(first.status, 202);

  const same = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_1', mode: 'text', prompt: 'y' }),
  });
  assert.equal(same.status, 409);
  assert.match(same.body.message, /正在生成中/);

  // A different node may run at the same time.
  const other = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_2', mode: 'text', prompt: 'z' }),
  });
  assert.equal(other.status, 202);

  const active = await getJson(h.base, '/api/tasks');
  assert.equal(active.status, 200);
  assert.equal(active.body.tasks.length, 2);
  assert.ok(active.body.tasks.every((task) => typeof task.elapsedMs === 'number'));
});

test('style and group nodes cannot be generated', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const style = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_1', mode: 'style', prompt: 'x' }),
  });
  assert.equal(style.status, 400);
  assert.match(style.body.message, /不能生成内容/);
});

test('a run records a progress log', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_1', mode: 'image', prompt: 'x' }),
  });
  const runId = started.body.run.id;
  await new Promise((resolve) => setTimeout(resolve, 120));
  const polled = await getJson(h.base, `/api/runs/${runId}`);
  assert.ok(Array.isArray(polled.body.run.log));
  assert.ok(polled.body.run.log.length > 0, 'the run must expose progress lines');
  assert.ok(polled.body.run.log.some((line) => line.includes('开始生成')));
});

test('the grid split plan maps source pixels onto child nodes', async () => {
  const { planGridSplit, clampGridSize, clampCropRect, toolPrompt } = await import(
    '../miniapp/client/tools.mjs'
  );

  const plan = planGridSplit({ width: 900, height: 600, rows: 3, cols: 3, originX: 100, originY: 50 });
  assert.equal(plan.count, 9);
  assert.equal(plan.cellWidth, 300);
  assert.equal(plan.cellHeight, 200);
  assert.deepEqual(
    { sx: plan.cells[0].sx, sy: plan.cells[0].sy, sw: plan.cells[0].sw, sh: plan.cells[0].sh },
    { sx: 0, sy: 0, sw: 300, sh: 200 },
  );
  // The last cell covers the bottom-right corner of the source.
  const last = plan.cells[8];
  assert.deepEqual([last.sx, last.sy, last.sw, last.sh], [600, 400, 300, 200]);
  // Nodes are laid out left to right, top to bottom, and the distance between
  // them is the tile card's own size: cards that are a few pixels apart cover
  // each other, and the pictures are then hidden under their neighbours.
  assert.deepEqual([plan.cells[0].x, plan.cells[0].y], [100, 50]);
  assert.deepEqual([plan.cells[1].x, plan.cells[1].y], [100 + 240 + 80, 50]);
  assert.deepEqual([plan.cells[3].x, plan.cells[3].y], [100, 50 + 300 + 80]);

  // No two tiles overlap.
  for (let a = 0; a < plan.cells.length; a += 1) {
    for (let b = a + 1; b < plan.cells.length; b += 1) {
      const one = plan.cells[a];
      const two = plan.cells[b];
      const apart = one.x + 240 <= two.x || two.x + 240 <= one.x
        || one.y + 300 <= two.y || two.y + 300 <= one.y;
      assert.ok(apart, `第 ${a + 1} 块和第 ${b + 1} 块压在一起了`);
    }
  }

  // Grid size is clamped to a sane range.
  assert.equal(clampGridSize(0), 1);
  assert.equal(clampGridSize(99), 8);
  assert.equal(clampGridSize('3'), 3);
  assert.equal(clampGridSize('x'), 1);

  // A crop rectangle stays inside the image and keeps a usable size.
  const crop = clampCropRect({ x: -1, y: 0.5, w: 5, h: 0.9 });
  assert.equal(crop.x, 0);
  assert.ok(crop.w <= 1 && crop.h <= 1);
  assert.ok(crop.w >= 0.02 && crop.h >= 0.02);

  // A tool prompt carries only the parameters the user actually filled in.
  const prompt = toolPrompt(
    { prompt: '保持主体一致。', params: [{ key: 'angles', label: '角度' }, { key: 'style', label: '光线' }] },
    { angles: ['正面', '背面'], style: '' },
  );
  assert.ok(prompt.includes('保持主体一致。'));
  assert.ok(prompt.includes('角度：正面、背面'));
  assert.ok(!prompt.includes('光线'));
});

test('a marquee band selects the nodes it overlaps', async () => {
  const { bandSelection } = await import('../miniapp/client/tools.mjs');

  const nodes = [
    { id: 'a', type: 'image', position: { x: 0, y: 0 }, width: 100, height: 100 },
    { id: 'b', type: 'image', position: { x: 200, y: 0 }, width: 100, height: 100 },
    { id: 'c', type: 'image', position: { x: 500, y: 500 }, width: 100, height: 100 },
    { id: 'g', type: 'group', position: { x: 0, y: 0 }, width: 100, height: 100 },
  ];
  const viewport = { x: 0, y: 0, k: 1 };

  // A band over the first two nodes selects them and never a group.
  assert.deepEqual(
    bandSelection({ band: { left: -10, top: -10, right: 350, bottom: 150 }, viewport, nodes }),
    ['a', 'b'],
  );
  // A band far away selects nothing.
  assert.deepEqual(
    bandSelection({ band: { left: 400, top: 400, right: 450, bottom: 450 }, viewport, nodes }),
    [],
  );
  // The band is in screen pixels, so a scaled viewport shrinks its world reach.
  const zoomed = { x: 0, y: 0, k: 2 };
  assert.deepEqual(
    bandSelection({ band: { left: 0, top: 0, right: 150, bottom: 150 }, viewport: zoomed, nodes }),
    ['a'],
  );
});

test('a paste lands in the viewport centre and keeps the relative layout', async () => {
  const { planPaste } = await import('../miniapp/client/tools.mjs');

  const clip = {
    nodes: [
      { id: 'a', type: 'image', position: { x: 0, y: 0 }, width: 100, height: 100 },
      { id: 'b', type: 'image', position: { x: 150, y: 0 }, width: 100, height: 100 },
    ],
  };
  const viewport = { x: 0, y: 0, k: 1 };
  const planned = planPaste({
    clip,
    viewport,
    viewportSize: { width: 800, height: 600 },
    idFor: () => 'new_id',
  });

  assert.equal(planned.length, 2);
  // The first node is centred, the second keeps its 150px offset.
  assert.deepEqual(planned[0].position, { x: 350, y: 250 });
  assert.deepEqual(planned[1].position, { x: 500, y: 250 });
  // Pasted nodes get fresh ids.
  assert.deepEqual(planned.map((n) => n.id), ['new_id', 'new_id']);

  // Zooming in shrinks the world reach of the viewport centre.
  const zoomed = planPaste({
    clip,
    viewport: { x: 0, y: 0, k: 2 },
    viewportSize: { width: 800, height: 600 },
    idFor: () => 'id',
  });
  assert.deepEqual(zoomed[0].position, { x: 150, y: 100 });

  // An empty clipboard pastes nothing.
  assert.deepEqual(planPaste({ clip: { nodes: [] }, viewport, viewportSize: { width: 800, height: 600 } }), []);
});

test('an event target from another JavaScript realm is still resolved', async () => {
  const { resolveEventTarget } = await import('../miniapp/client/tools.mjs');

  // The desktop host renders the MiniApp page inside a webview, which is a
  // different realm: `target instanceof Element` is false there, so a realm
  // sensitive check would make every delegated lookup fail.
  const crossRealmElement = { nodeType: 1, closest: () => null };
  assert.equal(resolveEventTarget({ target: crossRealmElement }), crossRealmElement);

  // A real element in this realm resolves too.
  const localElement = { nodeType: 1, closest: () => null };
  assert.equal(resolveEventTarget({ target: localElement }), localElement);

  // Anything that is not an element resolves to null.
  assert.equal(resolveEventTarget({ target: { nodeType: 3 } }), null);
  assert.equal(resolveEventTarget({ target: null }), null);
  assert.equal(resolveEventTarget({}), null);
});

test('a node drag converts screen pixels into world units', async () => {
  const { dragPositions } = await import('../miniapp/client/tools.mjs');

  const origins = [{ id: 'a', x: 100, y: 200 }, { id: 'b', x: 400, y: 200 }];

  // At 1x a 100px screen move is a 100px world move.
  assert.deepEqual(dragPositions(origins, 100, 50, 1), [
    { id: 'a', x: 200, y: 250 },
    { id: 'b', x: 500, y: 250 },
  ]);

  // Zoomed in, the same screen move covers fewer world units.
  assert.deepEqual(dragPositions(origins, 100, 50, 2), [
    { id: 'a', x: 150, y: 225 },
    { id: 'b', x: 450, y: 225 },
  ]);

  // A zero scale must not divide by zero.
  assert.deepEqual(dragPositions(origins, 100, 50, 0)[0], { id: 'a', x: 200, y: 250 });
});

test('a control inside the viewport keeps its own press', async () => {
  const { isControlTarget } = await import('../miniapp/client/tools.mjs');

  // A press that lands on a control must not be cancelled: a cancelled
  // pointerdown suppresses the click, and the control would be dead.
  const fake = (tag, className = '') => ({
    closest(selector) {
      const list = selector.split(',').map((item) => item.trim());
      if (tag && list.includes(tag)) return { tag, className };
      if (className && list.includes(`.${className}`)) return { tag, className };
      return null;
    },
  });

  assert.equal(isControlTarget(fake('button')), true, 'a button is a control');
  assert.equal(isControlTarget(fake('select')), true);
  assert.equal(isControlTarget(fake('input')), true);
  assert.equal(isControlTarget(fake('textarea')), true);
  assert.equal(isControlTarget(fake('div', 'nxc-composer')), true);
  // The minimap is not inside a node, so nothing else stops its press.
  assert.equal(isControlTarget(fake('canvas', 'nxc-minimap')), true);

  // The canvas itself is not a control: a press there pans the board.
  assert.equal(isControlTarget(fake('div', 'nxc-world')), false);
  assert.equal(isControlTarget(null), false);
  assert.equal(isControlTarget({}), false);
});

test('the viewport does not cancel the press of a control', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // The viewport cancels every pointerdown, and a cancelled pointerdown never
  // produces the click a control listens for. The guard has to come first.
  const handler =
    /dom\.viewport\.addEventListener\(\s*'pointerdown',[\s\S]*?\n {4}\}\);/.exec(source)?.[0] ?? '';
  assert.ok(handler, 'the viewport must have a pointerdown handler');
  assert.ok(handler.includes('isControlTarget('), 'the handler must ask whether the press is on a control');
  assert.ok(
    handler.indexOf('isControlTarget(') < handler.indexOf('preventDefault()'),
    'the control check has to run before the press is cancelled',
  );
});

test('unknown routes and bad payloads are rejected', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const missing = await getJson(h.base, '/api/nope');
  assert.equal(missing.status, 404);

  const bad = await fetch(`${h.base}/api/canvases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);
});

test('the client bundle never calls or reads a name that does not exist', () => {
  // Regression guard. A node drag shipped broken because `startNodeDrag`
  // called `selected()`, a helper that was never written: every drag threw a
  // ReferenceError before it could move a pixel, and the whole unit suite
  // still passed because that line only runs inside a browser event handler.
  // The pure-function tests cannot see it; this scan can.
  //
  // Two kinds: a call target (`helper(...)`) and a table (`LABEL[key]`). The
  // capability list broke on the second one for months.
  const problems = scanFiles([
    new URL('../miniapp/client/app.js', import.meta.url),
    new URL('../miniapp/client/tools.mjs', import.meta.url),
    new URL('../miniapp/client/mention.mjs', import.meta.url),
    new URL('../miniapp/client/forms.mjs', import.meta.url),
    new URL('../miniapp/client/actions.mjs', import.meta.url),
  ]);
  assert.deepEqual(
    problems.map((p) => `${p.file}:${p.line} ${p.name} [${p.kind}]`),
    [],
  );
});

test('the undefined-call scanner fails on an undefined helper', async () => {
  // Negative control. A guard that cannot fail is not a guard: the scan
  // above would happily pass a bundle full of typos if the scanner itself
  // were broken.
  const dir = await mkdtemp(join(tmpdir(), 'nxc-scan-'));
  try {
    const file = join(dir, 'probe.mjs');
    await writeFile(file, 'function a() {\n  return helperThatDoesNotExist(1);\n}\n', 'utf8');
    const problems = scanFiles([file]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, 'helperThatDoesNotExist');
  } finally {
    await removeDir(dir);
  }
});

test('the undefined-table scanner fails on a table that was never defined', async () => {
  // Negative control for the second rule. The capability list read
  // `RUN_MODE_LABEL[mode]` for months while the table was never defined:
  // the panel refused to render and the docs still claimed it worked.
  //
  // A missing call target breaks the line it is on. A missing table breaks
  // every line that reads it, and nothing in the code looks wrong — which
  // is why the call rule alone could never have caught it.
  const dir = await mkdtemp(join(tmpdir(), 'nxc-index-'));
  try {
    const file = join(dir, 'probe.js');
    await writeFile(file, 'const label = RUN_MODE_LABEL[mode];\n', 'utf8');
    const problems = scanFiles([file]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, 'RUN_MODE_LABEL');
    assert.equal(problems[0].kind, 'index');
    // A table that does exist must stay quiet.
    const ok = join(dir, 'fine.js');
    await writeFile(ok, 'const RUN_MODE_LABEL = { image: "图片" };\nconst label = RUN_MODE_LABEL[mode];\n', 'utf8');
    assert.deepEqual(scanFiles([ok]), []);
  } finally {
    await removeDir(dir);
  }
});

test('the scanner sees the code inside a template expression', async () => {
  // Negative control. The code inside `${ ... }` runs, so a helper called
  // only there is exactly as broken as one called anywhere else. The first
  // version of the scanner dropped the whole expression and reported
  // nothing at all.
  const dir = await mkdtemp(join(tmpdir(), 'nxc-tpl-'));
  try {
    const file = join(dir, 'probe.js');
    await writeFile(file, 'const s = `速度 ${formatSpeed(speed)}`;\n', 'utf8');
    const problems = scanFiles([file]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, 'formatSpeed');
    // The CSS in a template is text, not a call.
    const css = join(dir, 'css.js');
    await writeFile(css, 'el.style.transform = `translate(${x}px) scale(${k})`;\n', 'utf8');
    assert.deepEqual(scanFiles([css]), []);
  } finally {
    await removeDir(dir);
  }
});

test('the scanner reports the line the problem is really on', async () => {
  // Negative control. The first version collapsed a multi-line template
  // literal into `''`, which moved every line number after it. A guard that
  // points at the wrong line is a guard nobody trusts — and it is exactly
  // the guard you need when it fires.
  const dir = await mkdtemp(join(tmpdir(), 'nxc-line-'));
  try {
    const file = join(dir, 'probe.js');
    await writeFile(file, 'const a = `line one\nline two`;\nconst b = missingHelper();\n', 'utf8');
    const problems = scanFiles([file]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, 'missingHelper');
    // The template literal above spans two lines; the helper is on the
    // third one, not the second.
    assert.equal(problems[0].line, 3);
  } finally {
    await removeDir(dir);
  }
});

test('a regex literal does not stop the scanner', async () => {
  // Negative control. `media-tools.mjs` writes `/'/g` to escape a quote for
  // ffmpeg. The scanner used to read that quote as the start of a string,
  // swallowed the rest of the file and reported nothing. A guard that
  // silently stops guarding is worse than no guard: it says "no problems".
  const dir = await mkdtemp(join(tmpdir(), 'nxc-regex-'));
  try {
    const file = join(dir, 'probe.js');
    await writeFile(file, "const escaped = name.replace(/'/g, \"'\\\\''\");\nconst later = laterHelper();\n", 'utf8');
    const problems = scanFiles([file]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, 'laterHelper');
    assert.equal(problems[0].line, 2);
  } finally {
    await removeDir(dir);
  }
});

test('the node modules never call a helper that does not exist', () => {
  // The client bundle is only half of the app. The Agent runner, the
  // connector runner and the MCP server are where a broken helper name
  // takes down a whole run, and a pure-function test suite cannot see a
  // name that was never written.
  const dir = fileURLToPath(new URL('../miniapp/node/', import.meta.url));
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(dir, name));
  assert.ok(files.length >= 10, `node 模块太少：${files.length}`);
  const problems = scanFiles(files);
  assert.deepEqual(
    problems.map((p) => `${p.file}:${p.line} ${p.name}`),
    [],
  );
});

test('a declaration never reads itself while it is being declared', async () => {
  // A card stopped rendering and three nodes on the board turned into red
  // error cards: `const state = inputSlotState(state.canvas, node, kind);`
  // The declaration shadows the app state inside its own initializer, so the
  // browser throws a temporal dead zone error. The unit suite stayed green,
  // because only a browser renders the card.
  const { scanFiles: scanSelfReference } = await import('./scan-self-reference.mjs');
  const problems = scanSelfReference([
    new URL('../miniapp/client/app.js', import.meta.url),
    new URL('../miniapp/client/tools.mjs', import.meta.url),
    new URL('../miniapp/client/mention.mjs', import.meta.url),
    new URL('../miniapp/node/mcp.mjs', import.meta.url),
  ]);
  assert.deepEqual(
    problems.map((p) => `${p.file}:${p.line} ${p.name}`),
    [],
  );
});

test('the self-reference scanner fails on a declaration that reads itself', async () => {
  // Negative control. A guard that cannot fail is not a guard.
  const { scanFiles: scanSelfReference } = await import('./scan-self-reference.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'nxc-selfref-'));
  try {
    const file = join(dir, 'probe.js');
    await writeFile(file, 'const state = read(state.canvas, node, kind);\n', 'utf8');
    const problems = scanSelfReference([file]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].name, 'state');
    // A recursive arrow function is not a bug: the read happens when it is
    // called, not while it is being declared.
    const ok = join(dir, 'fine.js');
    await writeFile(ok, 'const visit = (id) => (id ? visit(id) : 0);\n', 'utf8');
    assert.deepEqual(scanSelfReference([ok]), []);
  } finally {
    await removeDir(dir);
  }
});

test('a video node carries the video models, not the text models', () => {
  // Regression guard. The model drop-down used to be filled from the Agent
  // catalog for every node type, so a video node offered MiniMax-M3 and the
  // per-model limits of H3-Max / Hailuo could never apply.
  const video = palette().modes.video;
  assert.ok(Array.isArray(video.models) && video.models.length >= 3);
  assert.deepEqual(
    video.models.map((model) => model.id),
    ['MiniMax-H3', 'MiniMax-H3-Max', 'MiniMax-Hailuo-2.3'],
  );
  // The text modes have no model list of their own: they run on the Agent.
  assert.equal(palette().modes.text.models, undefined);
});

test('the parameter limits follow the video model a node selected', () => {
  const h3 = resolveLimits('video', 'MiniMax-H3');
  assert.deepEqual(h3.resolutions, ['768P', '2K']);
  assert.deepEqual(h3.durations, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  // The ratio belongs to the H3 family only.
  assert.deepEqual(h3.ratios, ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']);
  // H3 is the only one that takes reference collections.
  assert.equal(h3.maxImages, 9);
  assert.equal(h3.maxVideos, 3);
  assert.equal(h3.maxAudios, 3);

  const max = resolveLimits('video', 'MiniMax-H3-Max');
  assert.deepEqual(max.resolutions, ['480P', '768P']);
  // One picture, and it is the first frame.
  assert.equal(max.maxImages, 1);
  assert.equal(max.maxVideos, 0);
  assert.equal(max.maxAudios, 0);
  // H3-Max is in the H3 family, so it takes a ratio — a text-to-video run
  // needs a concrete shape. It has no reference collection, though.
  assert.deepEqual(max.ratios, ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']);
  assert.deepEqual(max.paths, ['keyframe', 'firstLast', 'lastFrame']);

  const hailuo = resolveLimits('video', 'MiniMax-Hailuo-2.3');
  assert.deepEqual(hailuo.resolutions, ['768P', '1080P']);
  assert.deepEqual(hailuo.durations, [6, 10]);
  assert.equal(hailuo.supportsLastFrame, false);
  // Hailuo is not in the H3 family, so it takes no ratio at all.
  assert.deepEqual(hailuo.ratios, []);

  // An unknown model falls back to the first video model.
  const fallback = resolveLimits('video', null);
  assert.deepEqual(fallback.resolutions, ['768P', '2K']);
});

test('a video model that couples resolution to duration is enforced', () => {
  // The connector pairs 1080P with 6 seconds only; 768P takes 6 or 10. The
  // capability table has to say so, and the server has to snap the pair.
  const hailuo = resolveLimits('video', 'MiniMax-Hailuo-2.3');
  assert.deepEqual(hailuo.resolutionByDuration, { 6: ['768P', '1080P'], 10: ['768P'] });
  assert.deepEqual(resolutionsForDuration(hailuo.model, 10), ['768P']);
  assert.deepEqual(resolutionsForDuration(hailuo.model, 6), ['768P', '1080P']);

  // A model without the coupling keeps its full list.
  const h3 = resolveLimits('video', 'MiniMax-H3');
  assert.equal(h3.resolutionByDuration, undefined);
  assert.deepEqual(resolutionsForDuration(h3.model, 7), ['768P', '2K']);
});

test('every tool states what it needs and what it produces', () => {
  // A tool that is not wired yet still has to say why, so the panel can
  // explain the gap instead of showing a bare placeholder.
  const tools = palette().tools;
  assert.ok(tools.length >= 12);
  for (const tool of tools) {
    assert.ok(tool.key && tool.label && tool.desc, `tool ${tool.key} is missing identity`);
    assert.ok(['image', 'video', 'audio', 'music', 'text'].includes(tool.kind), `tool ${tool.key} has no kind`);
    assert.ok(tool.produces?.node, `${tool.key} does not say what it produces`);
    assert.ok(Array.isArray(tool.requires) && tool.requires.length > 0, `${tool.key} does not say what it needs`);
    if (tool.status === 'pending') {
      assert.ok(tool.pendingReason, `${tool.key} does not say why it is not wired yet`);
    } else {
      // A tool that claims to be ready has to say how it runs.
      assert.ok(['local', 'agent', 'ffmpeg', 'understand'].includes(tool.run), `${tool.key} has no run mode`);
    }
  }
});

test('the local ffmpeg tools the panel offers are all wired', () => {
  // These run on the local ffmpeg, so they are ready here too — the runtime
  // owns the whole path.
  const tools = palette().tools;
  for (const key of [
    'frame', 'frameGrid', 'trim', 'cropVideo', 'autoSegment', 'splitAv', 'merge',
    'eraseSubtitle', 'removeWatermark', 'removeBg',
    'cutout', 'enhance', 'resize', 'idPhoto',
  ]) {
    const tool = tools.find((item) => item.key === key);
    assert.ok(tool, `the tool ${key} is missing from the panel`);
    assert.equal(tool.status, 'ready', `${key} is still marked as not wired`);
    assert.equal(tool.run, 'ffmpeg', `${key} does not run on the local ffmpeg`);
  }
});

test('the tools that were taken out stay taken out', () => {
  // Four image tools were removed on purpose: a tool on a result node is a
  // shortcut for that one picture, and these four were not (see
  // RETIRED_TOOLS). The reason is written down so they are not put back by
  // someone reading the reference implementation's list.
  const tools = palette().tools;
  for (const key of ['collage', 'poster', 'deWatermark', 'recolor']) {
    assert.equal(
      tools.find((item) => item.key === key),
      undefined,
      `${key} 又回来了，它是被有意下线的`,
    );
    assert.equal(findMediaTool(key), null, `${key} 的实现还在运行时的工具表里`);
  }
  assert.ok(RETIRED_TOOLS.collage, 'the reason for taking collage out is not written down');
  assert.ok(RETIRED_TOOLS.poster, 'the reason for taking poster out is not written down');
  assert.ok(RETIRED_TOOLS.deWatermark, 'the reason for taking deWatermark out is not written down');
  assert.ok(RETIRED_TOOLS.recolor, 'the reason for taking recolor out is not written down');
});

test('a tool that asks for several values runs once per value', () => {
  // 多角度 takes several angles. One run cannot answer two angles with one
  // picture, so the tool runs once per angle and each run names its own.
  const tool = palette().tools.find((item) => item.key === 'multiAngle');
  assert.ok(tool, 'the panel does not offer multiAngle');
  assert.equal(tool.params.find((param) => param.type === 'multi')?.key, 'angles');

  const steps = fanOutParams(tool, { angles: ['正面', '侧面'] });
  assert.equal(steps.length, 2, 'two angles should mean two runs');
  assert.deepEqual(steps.map((step) => step.label), ['正面', '侧面']);
  // Each run gets a parameter set of its own: the others keep their value.
  assert.deepEqual(steps[0].params.angles, ['正面']);
  assert.deepEqual(steps[1].params.angles, ['侧面']);

  // And each prompt names only its own angle.
  const prompts = steps.map((step) => toolPrompt(tool, step.params));
  assert.match(prompts[0], /角度：正面/);
  assert.doesNotMatch(prompts[0], /侧面/);
  assert.match(prompts[1], /角度：侧面/);
  assert.doesNotMatch(prompts[1], /正面/);

  // A tool without a multi parameter runs once, with everything it was given.
  const single = fanOutParams({ params: [{ key: 'style', type: 'select' }] }, { style: '霓虹夜色' });
  assert.equal(single.length, 1);
  assert.equal(single[0].params.style, '霓虹夜色');
  assert.equal(single[0].label, '');

  // Nothing chosen means nothing to run: the tool says so instead of running
  // an empty round.
  assert.deepEqual(fanOutParams(tool, { angles: [] }), []);
});

test('the crop box follows the pointer', () => {
  // 剪裁 is a drag on the picture. The box has to move with the pointer:
  // dragging the body moves it and keeps its size, dragging the handle grows
  // it from its corner. Without this the tool could only ever hand back the
  // whole picture.
  const full = { x: 0, y: 0, w: 1, h: 1 };

  // The handle: the corner stays, the size follows the pointer.
  const grown = cropRectAfterDrag(full, -0.25, -0.4, 'resize');
  assert.equal(grown.x, 0);
  assert.equal(grown.y, 0);
  assert.ok(Math.abs(grown.w - 0.75) < 1e-9, `the width did not follow: ${grown.w}`);
  assert.ok(Math.abs(grown.h - 0.6) < 1e-9, `the height did not follow: ${grown.h}`);

  // The body: the size stays, the place follows the pointer.
  const moved = cropRectAfterDrag({ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, 0.1, 0.05, 'move');
  assert.ok(Math.abs(moved.x - 0.3) < 1e-9, `the box did not move: ${moved.x}`);
  assert.ok(Math.abs(moved.y - 0.25) < 1e-9, `the box did not move: ${moved.y}`);
  assert.equal(moved.w, 0.3);
  assert.equal(moved.h, 0.3);

  // And the box never leaves the picture.
  const out = cropRectAfterDrag(full, 0.5, 0.5, 'move');
  assert.equal(out.x, 0);
  assert.equal(out.y, 0);
  const tooBig = cropRectAfterDrag({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 0.5, 0.5, 'resize');
  assert.ok(tooBig.w <= 1 - tooBig.x + 1e-9, 'the box grew past the picture');
  assert.ok(tooBig.h <= 1 - tooBig.y + 1e-9, 'the box grew past the picture');
  // A box cannot be shrunk away entirely.
  const tiny = cropRectAfterDrag(full, -2, -2, 'resize');
  assert.ok(tiny.w >= 0.02 && tiny.h >= 0.02, 'the box vanished');
});

test('a batch of produced cards never covers each other', async () => {
  // Two result cards that are sixty pixels apart cover each other, and the
  // pictures a tool produced are then hidden under their neighbours. The
  // distance between them is the card's own size.
  const { planBatchPlacement, NODE_GAP, TILE_CARD } = await import('../miniapp/client/tools.mjs');

  const plan = planBatchPlacement({
    count: 9,
    originX: 100,
    originY: 50,
    cardWidth: TILE_CARD.width,
    cardHeight: TILE_CARD.height,
  });
  assert.equal(plan.columns, 3);
  assert.equal(plan.rows, 3);
  assert.equal(plan.cells.length, 9);

  for (let a = 0; a < plan.cells.length; a += 1) {
    for (let b = a + 1; b < plan.cells.length; b += 1) {
      const one = plan.cells[a];
      const two = plan.cells[b];
      const apart = one.x + TILE_CARD.width <= two.x || two.x + TILE_CARD.width <= one.x
        || one.y + TILE_CARD.height <= two.y || two.y + TILE_CARD.height <= one.y;
      assert.ok(apart, `第 ${a + 1} 张和第 ${b + 1} 张压在一起了`);
    }
  }

  // A gap that is smaller than the card would let the cards touch.
  assert.ok(NODE_GAP > 0, 'the gap between two cards is not a number');
  const tight = planBatchPlacement({ count: 4, cardWidth: 320, cardHeight: 420, gap: 10 });
  assert.equal(tight.cells[1].x - tight.cells[0].x, 330);
});

test('a batch of cards stands by the real size of the cards', async () => {
  // The height of a card is measured from the page: the preview box follows
  // the media's own ratio and the tool bar wraps. A row is as tall as its
  // tallest card, so the rows never sit on each other.
  const { planBatchPlacement, NODE_GAP } = await import('../miniapp/client/tools.mjs');

  const plan = planBatchPlacement({
    count: 4,
    sizes: [
      { width: 240, height: 419 },
      { width: 240, height: 419 },
      { width: 240, height: 419 },
      { width: 240, height: 419 },
    ],
    perRow: 2,
  });
  assert.equal(plan.cells[2].y - plan.cells[0].y, 419 + NODE_GAP, 'the second row starts too early');
  assert.equal(plan.cells[1].x - plan.cells[0].x, 240 + NODE_GAP, 'the second column starts too early');

  // A short card in a tall row does not make the row short.
  const mixed = planBatchPlacement({
    count: 4,
    sizes: [
      { width: 240, height: 500 },
      { width: 240, height: 300 },
      { width: 240, height: 300 },
      { width: 240, height: 300 },
    ],
    perRow: 2,
  });
  assert.equal(mixed.cells[0].y, mixed.cells[1].y, 'two cards of one row must stand side by side');
  // The row is as tall as its tallest card, so the next row starts after it.
  assert.equal(mixed.cells[2].y - mixed.cells[0].y, 500 + NODE_GAP, 'the second row starts too early');
});

test('a card that lands on another one pushes it aside', async () => {
  // The cards never cover each other. The card that was just placed stays
  // where it is; the one in the way steps aside.
  const { pushAside, NODE_GAP } = await import('../miniapp/client/tools.mjs');

  const doc = {
    nodes: [
      { id: 'a', position: { x: 0, y: 0 }, width: 320, height: 420 },
      { id: 'b', position: { x: 400, y: 0 }, width: 320, height: 420 },
      { id: 'c', position: { x: 400, y: 0 }, width: 320, height: 420 },
    ],
    connections: [],
  };
  const apart = pushAside(doc, ['c']);
  const b = apart.nodes.find((node) => node.id === 'b');
  const c = apart.nodes.find((node) => node.id === 'c');
  assert.equal(c.position.x, 400, 'the new card must stay where it was put');
  assert.ok(
    b.position.x >= c.position.x + c.width + NODE_GAP,
    `the card in the way must step aside: ${b.position.x} vs ${c.position.x}`,
  );
  // Nothing that was placed may be moved by the rule.
  const a = apart.nodes.find((node) => node.id === 'a');
  assert.equal(a.position.x, 0);
});

test('the result of a branch does not cover the branch next to it', async () => {
  // 多角度 makes two branches of one node, side by side. The result of the
  // first one lands where the second one stands, so the second one has to
  // step aside — otherwise the result hides the branch under it.
  const { materializeResults } = await import('../miniapp/client/actions.mjs');
  const canvas = {
    nodes: [
      { id: 'src', type: 'result', title: '源', position: { x: 0, y: 0 }, width: 320, height: 420, metadata: {} },
      { id: 'a1', type: 'image', title: '左前 45°', position: { x: 400, y: 40 }, width: 320, height: 420, metadata: {} },
      { id: 'a2', type: 'image', title: '右前 45°', position: { x: 800, y: 40 }, width: 320, height: 420, metadata: {} },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'src', toNodeId: 'a1', kind: 'image' },
      { id: 'c2', fromNodeId: 'src', toNodeId: 'a2', kind: 'image' },
    ],
  };
  let seq = 0;
  const placed = materializeResults(canvas, canvas.nodes[1], { id: 't1', media: [{ kind: 'image', url: 'u' }] }, {
    sizes: { result: { width: 320, height: 420 } },
    idFor: (prefix) => `${prefix}_${++seq}`,
  });
  const result = placed.results[0];
  const second = placed.canvas.nodes.find((node) => node.id === 'a2');
  assert.ok(
    result.position.x + result.width <= second.position.x,
    `the result covers the branch next to it: ${result.position.x} and ${second.position.x}`,
  );
  // The branch the result belongs to did not move.
  const first = placed.canvas.nodes.find((node) => node.id === 'a1');
  assert.equal(first.position.x, 400);

  // A batch of results lands on a card as well, and the card in the way
  // steps aside.
  const batchDoc = {
    nodes: [
      { id: 'src', type: 'image', title: '图', position: { x: 0, y: 0 }, width: 320, height: 420, metadata: {} },
      { id: 'other', type: 'result', title: '别的', position: { x: 420, y: 40 }, width: 320, height: 420, metadata: {} },
    ],
    connections: [],
  };
  const batch = materializeResults(batchDoc, batchDoc.nodes[0], {
    id: 't2',
    media: [{ kind: 'image', url: 'a' }, { kind: 'image', url: 'b' }],
  }, {
    sizes: { result: { width: 320, height: 420 } },
    idFor: (prefix) => `${prefix}_${++seq}`,
  });
  const other = batch.canvas.nodes.find((node) => node.id === 'other');
  const firstResult = batch.results[0];
  assert.ok(
    firstResult.position.x + firstResult.width <= other.position.x,
    `the result covers the card in the way: ${firstResult.position.x} and ${other.position.x}`,
  );
});

test('a tool that asks the model makes a node that can generate', async () => {
  // 多角度 and 打光 run the Agent on a child node. The child has to be a
  // generating node: the runtime refuses to generate from a result node, and
  // the tools only ever sit on a result node, so a result child would never
  // run at all.
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  const runner = source.match(/async function runAgentTool[\s\S]*?\n  }\n/);
  assert.ok(runner, 'the page has no runAgentTool');
  assert.match(
    runner[0],
    /createNode\(kindOf\(node\)/,
    'the child of a model-backed tool is not a generating node',
  );
  assert.doesNotMatch(runner[0], /createNode\(node\.type/, 'the child copies the source node type');
});

test('a canvas that was never stamped can still be saved', async (t) => {
  // The version of a document is what stops two pages from overwriting each
  // other. A document that was never stamped (hand-edited, imported, restored
  // from a backup) has no version: reading it must not mint one, because a
  // fresh stamp on every read would make every write look like somebody else
  // had changed it, and the canvas could never be saved again.
  const h = await createHarness();
  t.after(() => h.cleanup());

  // Such a document, written straight to the store.
  const id = 'cv_neverstamped';
  const dir = join(h.dataDir, 'canvases');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${id}.json`),
    JSON.stringify({ id, title: '没盖过时间戳的画布', nodes: [], connections: [] }),
    'utf8',
  );

  // Read it twice: the version must not move on its own.
  const first = await getJson(h.base, `/api/canvases/${id}`);
  assert.equal(first.status, 200);
  const second = await getJson(h.base, `/api/canvases/${id}`);
  assert.equal(second.status, 200);
  assert.equal(
    first.body.canvas.updatedAt ?? '',
    second.body.canvas.updatedAt ?? '',
    'the version moved on its own',
  );

  // And a write based on the version it just read goes through.
  const saved = await getJson(h.base, `/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...first.body.canvas, title: '盖上了' }),
  });
  assert.equal(saved.status, 200, `保存被拒了：${saved.body?.message ?? ''}`);
  assert.ok(saved.body.canvas.updatedAt, 'the saved canvas has no version');
});

test('a tool leaves a result node behind', async () => {
  // Only a result node carries the tool bar, so the picture a tool produced
  // can be worked on again. Every tool builds its result the same way, in one
  // place, so the chain does not stop after one step.
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  const helper = source.match(/function createToolResult[\s\S]*?\n  }\n/);
  assert.ok(helper, 'the page has no single place that builds a tool result');
  assert.match(helper[0], /createNode\('result'/, 'a tool result is not a result node');
  // The tools that run on this machine and the ones that draw in the browser
  // both go through it.
  assert.match(source, /createToolResult\(node, \{/, 'the local tools do not use it');
  assert.ok(
    (source.match(/createToolResult\(node, \{/g) ?? []).length >= 3,
    'not every tool builds its result the same way',
  );
});

test('a picture the page drew is published as a real file', async (t) => {
  // The tools that work in the browser hand their bytes over. The result has
  // to be a file on this machine: a data URL would live inside the canvas and
  // could not be saved, listed or handed to the provider.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const published = await getJson(h.base, '/api/media/publish?name=%E5%88%87%E5%88%86%201.png', {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: bytes,
  });
  assert.equal(published.status, 200);
  assert.match(published.body.url, /^\/assets\//);
  assert.equal(published.body.kind, 'image');
  assert.equal(published.body.mimeType, 'image/png');
  assert.equal(published.body.bytes, bytes.length);

  // The file is served back, byte for byte.
  const served = await fetch(`${h.base}${published.body.url}`);
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes);

  // And it is in the library, so the user can find it and save it.
  const list = await getJson(h.base, '/api/library');
  assert.equal(list.status, 200);
  const asset = list.body.assets.find((item) => item.url === published.body.url);
  assert.ok(asset, 'the published picture is not in the library');
  assert.equal(asset.kind, 'image');

  // An empty body is refused: there is no picture to publish.
  const empty = await getJson(h.base, '/api/media/publish?name=x.png', {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.alloc(0),
  });
  assert.equal(empty.status, 400);

  // And so is anything that is not a picture.
  const refused = await getJson(h.base, '/api/media/publish?name=x.exe', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from('x'),
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /只能发布图片/);
});

test('the page and the runtime agree on every media tool', () => {
  // The page renders the tool parameters and the runtime executes them. If the
  // two lists drift, the page sends a parameter the runtime ignores and the
  // tool quietly does the wrong thing, so they are compared field by field.
  const pageTools = palette().tools.filter((tool) => tool.run === 'ffmpeg');
  assert.ok(pageTools.length >= 14, 'the panel offers 14 local media tools');
  for (const tool of pageTools) {
    const spec = findMediaTool(tool.key);
    assert.ok(spec, `the page offers ${tool.key} but the runtime has no implementation`);
    assert.equal(tool.kind, TOOL_ACCEPTS[tool.key], `${tool.key} is offered on the wrong node kind`);
    assert.equal(tool.produces.node, TOOL_PRODUCES[tool.key][0], `${tool.key} advertises the wrong output`);
    const pageParams = tool.params ?? [];
    const runtimeParams = spec.params ?? [];
    assert.deepEqual(
      pageParams.map((param) => param.key),
      runtimeParams.map((param) => param.key),
      `${tool.key} has different parameters on the page and in the runtime`,
    );
    for (const runtimeParam of runtimeParams) {
      const pageParam = pageParams.find((item) => item.key === runtimeParam.key);
      assert.deepEqual(pageParam.options ?? null, runtimeParam.options ?? null, `${tool.key}.${runtimeParam.key} offers different options`);
      assert.equal(pageParam.default, runtimeParam.default, `${tool.key}.${runtimeParam.key} has a different default`);
      assert.equal(pageParam.min, runtimeParam.min, `${tool.key}.${runtimeParam.key} has a different minimum`);
      assert.equal(pageParam.max, runtimeParam.max, `${tool.key}.${runtimeParam.key} has a different maximum`);
      assert.equal(pageParam.label, runtimeParam.label, `${tool.key}.${runtimeParam.key} has a different label`);
    }
  }
  // Every runtime tool is offered on the page; a tool the runtime has but the
  // page does not would be unreachable.
  for (const key of Object.keys(TOOL_ACCEPTS)) {
    assert.ok(pageTools.some((tool) => tool.key === key), `the runtime has ${key} but the panel does not`);
  }
});

test('the understanding tools read the provider directly', () => {
  // The provider reads the asset itself, so these are a connector call and
  // not an Agent turn.
  const tools = palette().tools;
  for (const key of ['deconstruct', 'viral']) {
    const tool = tools.find((item) => item.key === key);
    assert.ok(tool, `the tool ${key} is missing from the panel`);
    assert.equal(tool.status, 'ready', `${key} is still marked as not wired`);
    assert.equal(tool.run, 'understand', `${key} does not use the provider`);
    assert.equal(tool.produces.node, 'text', `${key} does not produce a text node`);
  }
});

test('the palette offers the three roles and what each upstream can feed', () => {
  const surface = palette();
  // The three roles: what goes in, what makes it, what it produced.
  assert.ok(surface.nodeTypes.includes('input'));
  assert.ok(surface.nodeTypes.includes('result'));
  assert.equal(surface.nodeRoles.input, 'input');
  assert.equal(surface.nodeRoles.result, 'result');
  assert.equal(surface.nodeRoles.image, 'generate');
  assert.ok(surface.sizes.input.width > 0);
  assert.ok(surface.sizes.result.height > 0);

  // What each upstream offers, so the picker cannot offer a dead end.
  assert.deepEqual(surface.upstreamAccepts.text, ['text', 'image', 'video', 'audio', 'music']);
  assert.deepEqual(surface.upstreamAccepts.image, ['image', 'video']);
  assert.deepEqual(surface.upstreamAccepts.video, ['video']);
  assert.deepEqual(surface.upstreamAccepts.audio, ['video']);
  // Every accepted type is a mode the page can actually generate.
  for (const accepts of Object.values(surface.upstreamAccepts)) {
    for (const mode of accepts) {
      assert.ok(surface.modes[mode], `${mode} is accepted but is not a generation mode`);
    }
  }
});

test('an uploaded file is stored and served back', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const bytes = Buffer.from('not really a png, but the store does not care');
  const uploaded = await getJson(h.base, '/api/uploads?name=cat.png', {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: bytes,
  });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.kind, 'image');
  assert.match(uploaded.body.url, /^\/uploads\//);

  const served = await fetch(`${h.base}${uploaded.body.url}`);
  assert.equal(served.status, 200);
  assert.equal(await served.text(), bytes.toString('utf8'));

  // A file type the canvas does not take is refused with a reason.
  const refused = await getJson(h.base, '/api/uploads?name=notes.exe', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from('x'),
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.message, /不支持的文件类型/);
});

test('the canvas keeps what a result node holds', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '结果测试' }),
  });
  const id = created.body.canvas.id;
  const node = {
    id: 'n_result',
    type: 'result',
    title: '图片 · 结果',
    position: { x: 10, y: 10 },
    width: 320,
    height: 420,
    metadata: {
      kind: 'video',
      sourceNodeId: 'n_gen',
      sourceTaskId: 'run_1',
      output: { status: 'success', media: [{ url: 'https://cdn.example.com/a.mp4', kind: 'video' }] },
    },
  };
  const saved = await getJson(h.base, `/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...created.body.canvas, nodes: [node] }),
  });
  assert.equal(saved.status, 200);
  const loaded = (await getJson(h.base, `/api/canvases/${id}`)).body.canvas;
  const result = loaded.nodes[0];
  assert.equal(result.type, 'result');
  assert.equal(result.metadata.kind, 'video');
  assert.equal(result.metadata.sourceNodeId, 'n_gen');
  assert.equal(result.metadata.sourceTaskId, 'run_1');
  assert.equal(result.metadata.output.media[0].kind, 'video');
});

test('the input ports follow the mode the node is in', async () => {
  const { inputKindsFor } = await import('../miniapp/client/tools.mjs');
  const { acceptsOf, modeForKinds, modesOf, slotsOf } = await import('../miniapp/client/forms.mjs');

  // The text input is always there; a media input only appears when the
  // model can actually use it. That is the model's business, not the port's.
  assert.deepEqual(inputKindsFor({ maxImages: 9, maxVideos: 0, maxAudios: 0 }), ['text', 'image']);
  assert.deepEqual(inputKindsFor({ maxImages: 9, maxVideos: 3, maxAudios: 3 }), ['text', 'image', 'video', 'audio']);
  assert.deepEqual(inputKindsFor({ maxImages: 0, maxVideos: 0, maxAudios: 0 }), ['text']);

  // The ports are the mode's inputs: a mode says what the node takes, and
  // picking it changes what the card waits for.
  const image = { type: 'image', metadata: {} };
  assert.deepEqual(acceptsOf(image), ['text']);
  assert.deepEqual(slotsOf(image).inputs, [{ kind: 'text', role: '', label: '' }]);
  // 图生图 takes the text — it is the card's text box — and a picture.
  assert.deepEqual(
    slotsOf({ type: 'image', metadata: { mode: 'image2image' } }).inputs,
    [{ kind: 'text', role: '', label: '' }, { kind: 'image', role: '', label: '' }],
  );
  // A node that comes from an old canvas lands in the mode that fits what is
  // connected to it, and the card keeps saying what it said.
  assert.equal(modeForKinds('image', []), 'text2image');
  assert.equal(modeForKinds('image', ['text']), 'text2image');
  assert.equal(modeForKinds('image', ['image']), 'image2image');
  assert.equal(modeForKinds('image', ['text', 'image']), 'image2image');
  // A picture on a video node lands on the first frame: it is the plain one.
  assert.equal(modeForKinds('video', ['text', 'image']), 'imagekey2video');
  // A clip lands on the reference set: that is the request that takes one.
  assert.equal(modeForKinds('video', ['video']), 'image2video');
  assert.equal(modeForKinds('text', ['image']), 'describe');
  assert.equal(modeForKinds('text', ['text']), 'generate');
  // The order the connections arrive in does not matter.
  assert.equal(modeForKinds('image', ['image', 'text']), 'image2image');

  // Every generating node has modes, and every mode says what it takes.
  for (const type of ['text', 'image', 'video', 'audio']) {
    const modes = modesOf({ type, metadata: {} });
    assert.ok(modes.length >= 2, `${type} needs more than one mode`);
    for (const mode of modes) {
      assert.ok(mode.label, `the mode ${mode.id} has no name`);
      assert.ok(mode.ports?.length, `the mode ${mode.id} takes nothing`);
    }
  }
});

test('the prompt node offers templates the page can pick', () => {
  const surface = palette();
  assert.ok(Array.isArray(surface.promptTemplates));
  assert.ok(surface.promptTemplates.length >= 4, 'the prompt node needs a few presets');
  // Every preset but the free-text one carries a shape to expand into.
  const presets = surface.promptTemplates.filter((item) => item.id !== 'custom');
  assert.ok(presets.length >= 4);
  for (const preset of presets) {
    assert.ok(preset.label && preset.text, `the preset ${preset.id} is empty`);
  }
  // The kinds an input card takes are named.
  assert.equal(surface.inputKindLabels.image, '图片');
  assert.equal(surface.inputKindLabels.text, '文本');
});

test('the runtime default model is left out of the Agent call', async (t) => {
  // The Host validates a model selection against the models it lists, and the
  // "runtime default" entry is not a selection at all: sending it as one is
  // refused with INVALID_ARGUMENTS, which is what the text mode ran into.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_text', mode: 'text', prompt: '写一段文案', modelKey: 'default' }),
  });
  assert.equal(started.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const call = h.agent.calls.find((item) => item.kind === 'run');
  assert.ok(call, 'the agent was not called');
  assert.equal(call.payload.model, undefined, 'the runtime default was sent as a model selection');
});

test('a connection keeps what it carries, so the line can sit on its port', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '连线测试' }),
  });
  const id = created.body.canvas.id;
  const nodes = [
    { id: 'n_from', type: 'result', title: '图', position: { x: 0, y: 0 }, width: 320, height: 420, metadata: { resultKind: 'image', output: { status: 'success', media: [{ url: 'https://cdn.example.com/a.png', kind: 'image' }] } } },
    { id: 'n_to', type: 'image', title: '图', position: { x: 500, y: 0 }, width: 320, height: 420, metadata: { output: { status: 'idle' } } },
  ];
  const saved = await getJson(h.base, `/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...created.body.canvas,
      nodes,
      connections: [{ id: 'c_1', fromNodeId: 'n_from', toNodeId: 'n_to', kind: 'image' }],
    }),
  });
  assert.equal(saved.status, 200);
  const loaded = (await getJson(h.base, `/api/canvases/${id}`)).body.canvas;
  assert.equal(loaded.connections[0].kind, 'image', 'the connection lost what it carries');
});

test('a stale page cannot overwrite a canvas that moved on', async (t) => {
  // Two pages can have the same canvas open. The one that is behind must not
  // silently drop the other's work.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '并发' }),
  });
  const canvas = created.body.canvas;

  // The other page saves first.
  const newer = await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...canvas, title: '新的标题' }),
  });
  assert.equal(newer.status, 200);

  // The page that is behind tries to save its old copy.
  const stale = await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...canvas, title: '旧标题' }),
  });
  assert.equal(stale.status, 409);
  assert.match(stale.body.message, /另一个页面/);

  // The newer title survived.
  const loaded = (await getJson(h.base, `/api/canvases/${canvas.id}`)).body.canvas;
  assert.equal(loaded.title, '新的标题');
});

test('the connector tool list matches the real matrix inventory', () => {  // Every tool the capability panel shows must be a real connector tool; a
  // guessed name makes the panel lie about what the Mini App can drive.
  const tools = palette().connectorTools.map((tool) => tool.tool);
  for (const name of [
    'connector__matrix__generate_image',
    'connector__matrix__submit_video_generation',
    'connector__matrix__query_video_generation',
    'connector__matrix__synthesize_speech',
    'connector__matrix__batch_text_to_music',
    'connector__matrix__get_voice_list',
    'connector__matrix__describe_images',
  ]) {
    assert.ok(tools.includes(name), `missing ${name}`);
  }
  assert.ok(tools.length >= 13, 'the inventory probe found more tools than the panel lists');
});

test('the voice catalogue is read from the connector, not hard-coded', async (t) => {
  // The canvas used to offer a made-up list of voices. The Node service must
  // read the real catalogue through the Host connector.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const payload = (await getJson(h.base, '/api/voices')).body;
  assert.equal(payload.source, 'connector');
  assert.equal(payload.voices.length, 2);
  assert.equal(payload.voices[0].value, 'male-qn-qingse');
  assert.equal(payload.voices[0].label, '青涩青年音色');
});

test('a missing connector leaves the voice list empty instead of failing', async (t) => {
  const h = await createHarness({ hostConnector: null });
  t.after(() => h.cleanup());

  const payload = (await getJson(h.base, '/api/voices')).body;
  assert.equal(payload.source, 'no-connector');
  assert.deepEqual(payload.voices, []);
  assert.ok(payload.error);
});

test('the host connector value decoder unwraps the provider envelope', () => {
  // The provider answers with one text block holding a JSON string; the
  // decoder removes that exact shape once and never touches provider fields.
  const payload = { code: 0, message: 'ok', available_voices: [{ voice_id: 'a', voice_name: 'A' }] };
  const wrapped = [{ type: 'text', text: JSON.stringify(payload) }];
  assert.deepEqual(decodeHostConnectorValue(wrapped), payload);

  // A value that is not that shape passes through untouched.
  assert.deepEqual(decodeHostConnectorValue({ code: 0 }), { code: 0 });
  assert.deepEqual(decodeHostConnectorValue([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), [
    { type: 'text', text: 'a' },
    { type: 'text', text: 'b' },
  ]);
});

test('the audio emotion list uses the enum the connector accepts', () => {
  const emotions = palette().modes.audio.emotions;
  const values = emotions.map((item) => item.value);
  for (const expected of ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral']) {
    assert.ok(values.includes(expected), `missing emotion ${expected}`);
  }
  // The page shows Chinese labels, but the value must stay the English enum.
  assert.equal(emotions.find((item) => item.value === 'happy').label, '开心');
  // No invented voice list may ship in the capability table.
  assert.equal(palette().modes.audio.voices, undefined);
});

test('an image node generates through the connector, not through an Agent turn', async (t) => {
  // The Node service owns the provider call: no Agent turn, no key, and the
  // asset URL is resolved from the drive node id.
  const connector = createMockHostConnector();
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const created = await fetch(`${h.base}/api/canvases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '直连测试' }),
  });
  const { canvas } = await created.json();
  const node = {
    id: 'n_direct',
    type: 'image',
    title: '图',
    position: { x: 0, y: 0 },
    width: 320,
    height: 420,
    metadata: { segments: [{ type: 'text', text: '一只猫' }], prompt: '一只猫', mentions: [], ratio: '16:9', resolution: '1K' },
  };
  await fetch(`${h.base}/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...canvas, nodes: [node] }),
  });

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_direct', mode: 'image', prompt: '一只猫', params: { ratio: '16:9', resolution: '1K' } }),
  });
  assert.equal(started.status, 202);
  const { run } = await started.json();
  assert.equal(run.runner, 'connector');

  // The run finishes without an Agent turn.
  const finished = await waitFor(h.base, run.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(finished.status, 'done');
  // The asset could not be downloaded, but the run still succeeds and keeps
  // the provider link: a dead download must not fail a finished generation.
  assert.equal(finished.media[0].url, `${ASSET_HOST}/node-1`);
  assert.equal(finished.media[0].kind, 'image');
  // The drive node id is kept so a short-lived URL can be refreshed.
  assert.equal(finished.media[0].nodeId, 'node-1');

  // The connector really was called with the connector's own field names.
  const imageCall = connector.calls.find((call) => call.toolRef.endsWith('generate-image'));
  assert.ok(imageCall, 'generate_image was not called');
  assert.equal(imageCall.args.requests[0].prompt, '一只猫');
  assert.equal(imageCall.args.requests[0].aspect_ratio, '16:9');
  assert.equal(imageCall.args.requests[0].resolution, '1K');
});

test('an upstream asset travels with the connection, not only with a mention', async (t) => {
  // The connection is the data channel. A mention in the prompt says which
  // part of it the prompt talks about; the reference implementation still
  // sends the connected asset when the prompt does not mention it.
  const connector = createMockHostConnector();
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_upstream',
      mode: 'image',
      prompt: '照着这个画一只猫',
      references: [
        {
          id: 'n_0',
          title: '上游图',
          kind: 'image',
          text: '',
          media: [{ url: 'https://cdn.example.com/up.png', kind: 'image' }],
        },
      ],
    }),
  });
  assert.equal(started.status, 202);
  const imageCall = await waitForCall(connector.calls, (call) => call.toolRef.endsWith('generate-image'));
  assert.ok(imageCall, 'generate_image was not called');
  assert.deepEqual(
    imageCall.args.requests[0].input_urls,
    ['https://cdn.example.com/up.png'],
    'the connected image did not travel with the run',
  );
});

test('two picture runs take the machine one after another', async (t) => {
  // The Host gives every connector call a window of its own. Two calls that
  // share the machine are the two that run over that window, so the second
  // picture waits for the first to finish instead of racing it.
  const connector = createMockHostConnector(undefined, { callDelayMs: 120 });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const first = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_first', mode: 'image', prompt: '第一张' }),
  });
  assert.equal(first.status, 202);
  const firstRun = (await first.json()).run;
  // The second run starts while the first one is on the machine, so the two
  // really do want the same window.
  await waitForCall(connector.calls, (call) => call.toolRef.endsWith('generate-image'));
  const second = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_second', mode: 'image', prompt: '第二张' }),
  });
  assert.equal(second.status, 202);
  const secondRun = (await second.json()).run;

  const doneFirst = await waitFor(h.base, firstRun.id, (item) => item.status === 'done' || item.status === 'error');
  const doneSecond = await waitFor(h.base, secondRun.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(doneFirst.status, 'done');
  assert.equal(doneSecond.status, 'done');

  // Two picture calls never share the machine.
  const image = connector.state.concurrentByTool.generate_image;
  assert.ok(image, 'generate_image was never called');
  assert.equal(image.max, 1, 'two picture calls ran at the same time');

  // And the run that waited says so: the time the user sees is told apart
  // from the time the provider answered.
  assert.ok(
    doneSecond.log.some((line) => line.includes('排队')),
    `the waiting run did not say it waited: ${JSON.stringify(doneSecond.log)}`,
  );
});

test('a reference file that is gone does not take the run down', async (t) => {
  // The provider cannot fetch a file this machine has lost either, so the
  // material is left out and the run says so. One gone file must not kill the
  // whole run — the chain of a canvas can hold an old file for ever.
  const connector = createMockHostConnector();
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_gone',
      mode: 'image',
      prompt: '一只猫',
      references: [
        { id: 'n_old', title: '老图', kind: 'image', text: '', media: [{ url: '/assets/m_gone.png', kind: 'image' }] },
        { id: 'n_new', title: '新图', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/new.png', kind: 'image' }] },
      ],
    }),
  });
  assert.equal(started.status, 202);
  const { run } = await started.json();
  const done = await waitFor(h.base, run.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(done.status, 'done', `the run died on a file that is gone: ${done.error}`);
  // The run says what it left out.
  assert.ok(
    done.log.some((line) => line.includes('已经不在了')),
    `the run did not say what it left out: ${JSON.stringify(done.log)}`,
  );
  // And the request carries only the material that could be read.
  const imageCall = connector.calls.find((call) => call.toolRef.endsWith('generate-image'));
  assert.ok(imageCall, 'generate_image was not called');
  assert.deepEqual(imageCall.args.requests[0].input_urls, ['https://cdn.example.com/new.png']);
});

test('the cleanup does not take the files when there is no canvas', async (t) => {
  // Without a canvas there is nothing that says which file belongs to whom,
  // and the cleanup would take every picture on this machine. A canvas that
  // is gone for a moment must not cost the user their files.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const published = await fetch(`${h.base}/api/media/publish?name=keep.png`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  assert.equal(published.status, 200);
  const name = (await published.json()).name;

  const cleaned = await getJson(h.base, '/api/library/gc', { method: 'POST' });
  assert.equal(cleaned.status, 409, 'the cleanup ran without a canvas to check against');
  assert.match(cleaned.body.message, /画布/);

  // The file is still there.
  const library = await getJson(h.base, '/api/library');
  const assets = library.body.assets ?? library.body ?? [];
  assert.ok(
    assets.some((item) => item.name === name),
    'the file was taken while there was no canvas to say it was in use',
  );
});

test('a stale tool reference is listed again and tried once more', async (t) => {
  // The tool reference belongs to the Host, not to us: it goes stale when the
  // service restarts, which happens on every publish. The Host's own rule is
  // to list the tools again and try once — without that, a run right after a
  // publish dies on a reference that is already old.
  const connector = createMockHostConnector(undefined, { staleRefOnce: true });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_stale', mode: 'image', prompt: '一只猫' }),
  });
  assert.equal(started.status, 202);
  const { run } = await started.json();
  const done = await waitFor(h.base, run.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(done.status, 'done', `the run died on a stale reference: ${done.error}`);
  // The tools were listed again after the stale reference.
  assert.ok(connector.state.listCalls >= 2, 'the tool list was not read again');
});

test('a card holding a video shows no tools, a picture result shows its own', async () => {
  // A finished clip is a deliverable, not a working material: a dozen buttons
  // under it are noise. The video tools stay in the runtime, so the Agent can
  // still call them.
  const { cardChrome, cardTools } = await import('../miniapp/client/forms.mjs');
  const tools = [
    { key: 'cutout', kind: 'image' },
    { key: 'gridSplit', kind: 'image' },
    { key: 'videoSplit', kind: 'video' },
    { key: 'frameExtract', kind: 'video' },
  ];
  const picture = { type: 'result', metadata: { kind: 'image', output: { media: [] } } };
  const video = { type: 'result', metadata: { kind: 'video', output: { media: [] } } };
  const generating = { type: 'image', metadata: { output: { media: [] } } };

  // A picture result offers the picture tools, and only those.
  assert.deepEqual(cardTools(picture, tools).map((tool) => tool.key), ['cutout', 'gridSplit']);
  // A video result offers none.
  assert.deepEqual(cardTools(video, tools), []);
  // A generating card has nothing to transform yet.
  assert.deepEqual(cardTools(generating, tools), []);

  // The footer is the toolbar: a card with no tools has no footer either, so
  // no empty strip is left under the material.
  assert.equal(cardChrome(picture, tools).hasFooter, true);
  assert.equal(cardChrome(video, tools).hasFooter, false);
  assert.equal(cardChrome(generating, tools).hasFooter, false);
  // The two answers come from the same rule, so they cannot disagree.
  assert.deepEqual(cardChrome(video, tools).tools, cardTools(video, tools));
});

test('a call that waited for the machine says how long it waited when it fails', async (t) => {
  // The Host stops a call that runs over its window, and the message it
  // raises says nothing about the step. The runtime adds the step: which
  // call, how long it ran, and how long it stood behind another call.
  const connector = createMockHostConnector(undefined, {
    callDelayMs: 60,
    timeoutCall: { tool: 'generate_image', nth: 2 },
  });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const first = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_ok', mode: 'image', prompt: '第一张' }),
  });
  const firstRun = (await first.json()).run;
  await waitForCall(connector.calls, (call) => call.toolRef.endsWith('generate-image'));
  const second = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_cut', mode: 'image', prompt: '第二张' }),
  });
  const secondRun = (await second.json()).run;

  const doneFirst = await waitFor(h.base, firstRun.id, (item) => item.status === 'done' || item.status === 'error');
  const failed = await waitFor(h.base, secondRun.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(doneFirst.status, 'done');
  assert.equal(failed.status, 'error');
  assert.match(failed.error, /generate_image/, 'the error does not say which call failed');
  assert.match(failed.error, /前面排队/, 'the error does not say how long the call waited');
  assert.match(failed.error, /耗时/, 'the error does not say how long the call itself ran');
  // A call that the Host stopped leaves nothing behind: the outcome is
  // unknown, and the message says so instead of inviting a retry.
  assert.match(failed.error, /结果未知/);

  // The call that failed does not stop the ones behind it.
  const third = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_after', mode: 'image', prompt: '第三张' }),
  });
  const thirdRun = (await third.json()).run;
  const doneThird = await waitFor(h.base, thirdRun.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(doneThird.status, 'done', 'a failed call blocked the one behind it');
});

test('a finished video that cannot be fetched says so instead of finishing empty', async (t) => {
  // The task is done, but the answer carries no link and the video has no
  // drive asset. Saying "完成" with nothing behind it is a lie the user would
  // believe, so the run says the file is missing.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded-without-link' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_nolink',
      mode: 'video',
      prompt: '一只猫在跑',
      modelKey: 'MiniMax-H3',
      params: { ratio: '16:9', resolution: '768P', duration: 6 },
    }),
  });
  assert.equal(started.status, 202);
  const { run } = await started.json();
  const polled = await waitFor(h.base, run.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(polled.status, 'error', 'a run that produced no file called itself done');
  assert.match(polled.error, /没有取回文件/);
});

test('a video node submits first and is polled afterwards', async (t) => {
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_video',
      mode: 'video',
      prompt: '一只猫在跑',
      modelKey: 'MiniMax-H3',
      params: { ratio: '16:9', resolution: '768P', duration: 6 },
    }),
  });
  const { run } = await started.json();
  assert.equal(run.runner, 'connector');

  // The submit is asynchronous, so the provider task id shows up on the
  // record once the provider accepted it.
  const submitted = await waitFor(h.base, run.id, (item) => Boolean(item.providerTaskId));
  assert.equal(submitted.providerTaskId, 'task-9');
  assert.equal(submitted.providerModel, 'MiniMax-H3');

  const submitCall = connector.calls.find((call) => call.toolRef.endsWith('submit-video-generation'));
  assert.ok(submitCall, 'submit_video_generation was not called');
  assert.equal(submitCall.args.model, 'MiniMax-H3');
  assert.equal(submitCall.args.duration, 6);
  assert.equal(submitCall.args.resolution, '768P');

  // The provider is asked about the state, and the finished video is resolved
  // into a displayable URL.
  const polled = await waitFor(h.base, run.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(polled.status, 'done');
  // A video has no drive asset: the file comes with the task's own answer.
  assert.equal(polled.media[0].url, 'https://cdn.example.com/video-1.mp4');
  assert.equal(polled.media[0].kind, 'video');
});

test('a picture becomes a video in three different ways, and the provider is asked for the right one', async (t) => {
  // The three requests are different requests, not one request with different
  // parameters: the first frame, the first and the last frame, and a set of
  // references. The mode says which one, and the body follows it.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const references = [
    { id: 'n_first', title: '首帧', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/first.png', kind: 'image' }] },
    { id: 'n_last', title: '尾帧', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/last.png', kind: 'image' }] },
  ];
  const frames = [
    { id: 'n_first', kind: 'image', role: 'first' },
    { id: 'n_last', kind: 'image', role: 'last' },
  ];

  let run = 0;
  const submitWith = async (path) => {
    run += 1;
    // The call of this run, not the one of an earlier run: a call that waits
    // for the machine is recorded later than the one before it.
    const before = connector.calls.length;
    const started = await fetch(`${h.base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId: `n_video_${run}`,
        mode: 'video',
        prompt: '一只猫在跑',
        modelKey: 'MiniMax-H3',
        params: { ratio: '16:9', resolution: '768P', duration: 6 },
        path,
        frames,
        references,
      }),
    });
    assert.equal(started.status, 202);
    await waitForCall(connector.calls, (call, index) => index >= before && call.toolRef.endsWith('submit-video-generation'));
    const calls = connector.calls.filter((call) => call.toolRef.endsWith('submit-video-generation'));
    return calls[calls.length - 1].args;
  };

  // The first frame: the picture is the frame, and the frame decides the shape.
  const keyframe = await submitWith('keyframe');
  assert.deepEqual(keyframe.input_image, { url: 'https://cdn.example.com/first.png' });
  assert.equal(keyframe.reference_type, 'first_frame');
  assert.equal(keyframe.ratio, 'adaptive');
  assert.equal(keyframe.last_frame_image, undefined);
  assert.equal(keyframe.reference_images, undefined);

  // The first and the last frame: two pictures, one at each end.
  const firstLast = await submitWith('firstLast');
  assert.deepEqual(firstLast.input_image, { url: 'https://cdn.example.com/first.png' });
  assert.deepEqual(firstLast.last_frame_image, { url: 'https://cdn.example.com/last.png' });
  assert.equal(firstLast.reference_type, 'last_frame');
  assert.equal(firstLast.ratio, 'adaptive');
  assert.equal(firstLast.reference_images, undefined);

  // The reference set: the pictures are references, and the ratio decides the
  // shape.
  const collection = await submitWith('collection');
  assert.deepEqual(collection.reference_images, [
    { url: 'https://cdn.example.com/first.png' },
    { url: 'https://cdn.example.com/last.png' },
  ]);
  assert.equal(collection.input_image, undefined);
  assert.equal(collection.ratio, '16:9');
});

test('the alignment line tells the model which picture is the first frame', async (t) => {
  // MiniMax's H3 guide says the alignment line is the first line of the final
  // prompt. The runtime writes it, because the runtime is the one that knows
  // which picture the request carries and how long the clip is.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const references = [
    { id: 'n_first', title: '首帧', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/first.png', kind: 'image' }] },
    { id: 'n_last', title: '尾帧', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/last.png', kind: 'image' }] },
  ];
  const frames = [
    { id: 'n_first', kind: 'image', role: 'first' },
    { id: 'n_last', kind: 'image', role: 'last' },
  ];

  const submitWith = async (path, prompt, duration) => {
    // The call of this run, not the one of an earlier run: a call that waits
    // for the machine is recorded later than the one before it.
    const before = connector.calls.length;
    const started = await getJson(h.base, '/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId: `n_video_${path}`,
        mode: 'video',
        prompt,
        modelKey: 'MiniMax-H3',
        params: { ratio: '16:9', resolution: '768P', duration },
        path,
        frames,
        references,
      }),
    });
    assert.equal(started.status, 202);
    await waitForCall(connector.calls, (call, index) => index >= before && call.toolRef.endsWith('submit-video-generation'));
    const calls = connector.calls.filter((call) => call.toolRef.endsWith('submit-video-generation'));
    return calls[calls.length - 1].args;
  };

  // The first frame: the line says the picture is the opening of the clip.
  const keyframe = await submitWith('keyframe', '一只猫在跑', 6);
  assert.ok(
    keyframe.prompt.startsWith('For the target video, at 0.00 seconds into the target video, @图片1 (from [Shot 1]) is fully referenced.'),
    `首帧的对齐说明不对：${keyframe.prompt}`,
  );
  assert.ok(keyframe.prompt.includes('一只猫在跑'), '对齐说明后面还得有正文');

  // Both ends: the line says which picture is the opening and which is the
  // ending, and the ending is the length of the clip.
  const firstLast = await submitWith('firstLast', '一只猫在跑 [Shot 2] At 00:03.000, 它跳上窗台', 6);
  assert.ok(
    firstLast.prompt.startsWith('How the reference pictures align with the target video — @图片1 (from Shot 1) aligns with the 0.00-second mark of the target video; @图片2 (from Shot 2) aligns with the 6.00-second mark of the target video.'),
    `首尾帧的对齐说明不对：${firstLast.prompt}`,
  );

  // The last frame alone: that picture is the ending, and it is the only
  // picture the request carries, so it is the first one in the numbering.
  const lastFrame = await submitWith('lastFrame', '一只猫在跑', 8);
  assert.ok(
    lastFrame.prompt.startsWith('How the reference pictures align with the target video — @图片1 (from [Shot 1]) aligns with the 8.00-second mark of the target video.'),
    `末帧的对齐说明不对：${lastFrame.prompt}`,
  );

  // A text-to-video run has no picture to align, so it has no line.
  const plain = await submitWith('text2video', '一只猫在跑', 6);
  assert.ok(!plain.prompt.includes('the target video'), `文生视频不该有对齐说明：${plain.prompt}`);
});

test('a frame request refuses a picture it will not send', async (t) => {
  // The provider takes the first frame (and the last one) in a frame request,
  // and it cannot take a reference set at the same time. A picture named in
  // the prompt but not plugged into a frame port would never reach the
  // model, so the run is refused instead of sending a prompt that points at
  // something the model cannot see.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_video_refused',
      mode: 'video',
      prompt: '照着 @图片1 写',
      modelKey: 'MiniMax-H3',
      segments: [
        { type: 'text', text: '照着 ' },
        { type: 'mention', kind: 'image', nodeId: 'n_other' },
        { type: 'text', text: ' 写' },
      ],
      params: { duration: 6 },
      path: 'keyframe',
      frames: [{ id: 'n_first', kind: 'image', role: 'first' }],
      references: [
        { id: 'n_first', title: '首帧', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/first.png', kind: 'image' }] },
        { id: 'n_other', title: '商品图', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/other.png', kind: 'image' }] },
      ],
    }),
  });
  assert.equal(started.status, 400);
  assert.match(started.body.message, /商品图/);
  assert.match(started.body.message, /首帧模式/);
});

test('the number in the prompt is the place the picture has in the request', async (t) => {
  // The prompt names the pictures and the request sends them. If the two
  // counted differently, "@图片1" would point at another picture and the
  // model would follow the wrong one.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_video_collection',
      mode: 'video',
      prompt: '@图片2 的风格，@图片1 的人物',
      modelKey: 'MiniMax-H3',
      segments: [
        { type: 'mention', kind: 'image', nodeId: 'n_b' },
        { type: 'text', text: ' 的风格，' },
        { type: 'mention', kind: 'image', nodeId: 'n_a' },
        { type: 'text', text: ' 的人物' },
      ],
      params: { ratio: '16:9', resolution: '768P', duration: 6 },
      path: 'collection',
      references: [
        { id: 'n_a', title: '甲', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/a.png', kind: 'image' }] },
        { id: 'n_b', title: '乙', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/b.png', kind: 'image' }] },
      ],
    }),
  });
  assert.equal(started.status, 202);
  await waitForCall(connector.calls, (call) => call.toolRef.endsWith('submit-video-generation'));
  const calls = connector.calls.filter((call) => call.toolRef.endsWith('submit-video-generation'));
  const request = calls[calls.length - 1].args;
  // The picture named first is the first one in the request, and the prompt
  // says so.
  assert.deepEqual(request.reference_images, [
    { url: 'https://cdn.example.com/b.png' },
    { url: 'https://cdn.example.com/a.png' },
  ]);
  assert.equal(request.prompt, '@图片1 的风格，@图片2 的人物');
});

test('a reference video carries its length to the provider', async (t) => {
  // The provider asks how long a reference video is. The runtime reads it off
  // the file, so the request says how long the clip is.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_video',
      mode: 'video',
      prompt: '接着这个视频',
      modelKey: 'MiniMax-H3',
      params: { ratio: '16:9', resolution: '768P', duration: 6 },
      path: 'collection',
      references: [
        {
          id: 'n_clip',
          title: '上一段',
          kind: 'video',
          text: '',
          media: [{ url: 'https://cdn.example.com/clip.mp4', kind: 'video', durationSeconds: 7 }],
        },
      ],
    }),
  });
  assert.equal(started.status, 202);
  await waitForCall(connector.calls, (call) => call.toolRef.endsWith('submit-video-generation'));
  const calls = connector.calls.filter((call) => call.toolRef.endsWith('submit-video-generation'));
  assert.deepEqual(calls[calls.length - 1].args.reference_videos, [
    { url: 'https://cdn.example.com/clip.mp4', duration_seconds: 7 },
  ]);
});

test('图生视频·首尾帧 has two picture ports, and the lines say which is which', async () => {
  const { assignPorts } = await import('../miniapp/client/tools.mjs');
  const { planPort } = await import('../miniapp/client/actions.mjs');
  const node = { id: 'n_v', type: 'video', metadata: { mode: 'imagefl2video' } };
  const canvas = {
    nodes: [
      node,
      { id: 'n_a', type: 'image', metadata: { kind: 'image' } },
      { id: 'n_b', type: 'image', metadata: { kind: 'image' } },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'n_a', toNodeId: 'n_v', kind: 'image' },
      { id: 'c2', fromNodeId: 'n_b', toNodeId: 'n_v', kind: 'image' },
    ],
  };
  // One picture is the first frame and the other is the last.
  const assigned = assignPorts(canvas, node);
  assert.equal(assigned.get('image:first').fromNodeId, 'n_a');
  assert.equal(assigned.get('image:last').fromNodeId, 'n_b');
  // Both ports are taken, so a third picture has nowhere to land.
  assert.equal(planPort(canvas, node, 'image').ok, false);
});

test('the ratio follows the request, not the model', async () => {
  const { ratioOptionsFor } = await import('../miniapp/client/forms.mjs');
  const { resolveLimits } = await import('../miniapp/node/capabilities.mjs');
  const h3 = resolveLimits('video', 'MiniMax-H3');
  // The two keyframe requests follow the frame: there is nothing to choose.
  assert.deepEqual(ratioOptionsFor({ type: 'video', metadata: { mode: 'imagekey2video' } }, h3), []);
  assert.deepEqual(ratioOptionsFor({ type: 'video', metadata: { mode: 'imagefl2video' } }, h3), []);
  // A reference set may follow the frame instead of a shape.
  assert.ok(ratioOptionsFor({ type: 'video', metadata: { mode: 'image2video' } }, h3).includes('adaptive'));
  // A text-to-video run needs a concrete shape.
  const text = ratioOptionsFor({ type: 'video', metadata: { mode: 'text2video' } }, h3);
  assert.ok(text.includes('16:9'));
  assert.ok(!text.includes('adaptive'));
});

test('an old canvas lands on a mode the model can run', async (t) => {
  // A canvas saved when 图生视频 meant one thing must not leave a card on a
  // request the model refuses. The node moves to the mode that fits what is
  // plugged into it.
  const h = await createHarness();
  t.after(() => h.cleanup());
  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '老画布' }),
  });
  const canvas = created.body.canvas;
  await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...canvas,
      nodes: [
        { id: 'n_pic', type: 'input', title: '图', position: { x: 0, y: 0 }, width: 320, height: 200, metadata: { kind: 'image' } },
        { id: 'n_h3', type: 'video', title: 'H3', position: { x: 400, y: 0 }, width: 340, height: 380, metadata: { mode: 'image2video', model: 'MiniMax-H3' } },
        { id: 'n_max', type: 'video', title: 'H3-Max', position: { x: 800, y: 0 }, width: 340, height: 380, metadata: { mode: 'image2video', model: 'MiniMax-H3-Max' } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'n_pic', toNodeId: 'n_h3', kind: 'image' },
        { id: 'c2', fromNodeId: 'n_pic', toNodeId: 'n_max', kind: 'image' },
      ],
    }),
  });
  const after = await getJson(h.base, `/api/canvases/${canvas.id}`);
  // H3 keeps the reference set: it is the only model that has one.
  assert.equal(after.body.canvas.nodes[1].metadata.mode, 'image2video');
  // H3-Max has no reference set, so it lands on the first frame.
  assert.equal(after.body.canvas.nodes[2].metadata.mode, 'imagekey2video');
});

test('the video node has no sound switches: the mode says what the request carries', async () => {
  // The two switches were dead. The video run goes straight to the
  // connector, and the prompt block that would have carried them belongs to
  // the Agent turn — so the request never saw them. A switch the request
  // ignores is a switch the user cannot trust.
  const app = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  assert.doesNotMatch(app, /同步配音/);
  assert.doesNotMatch(app, /允许背景音/);
  assert.doesNotMatch(app, /generateAudio/);
  assert.doesNotMatch(app, /allowNonDialogueAudio/);
  // The third switch was dead the same way: its landing spot was "take the
  // last frame of the upstream video", which this app never did.
  assert.doesNotMatch(app, /continueFromPrevious/);
  const store = await readFile(
    fileURLToPath(new URL('../miniapp/node/store.mjs', import.meta.url)),
    'utf8',
  );
  assert.doesNotMatch(store, /generateAudio/);
  assert.doesNotMatch(store, /allowNonDialogueAudio/);
  assert.doesNotMatch(store, /continueFromPrevious/);
});

test('the audio reference goes with the reference set', async (t) => {
  // The provider takes ONE set: pictures, videos and audios sit in it
  // together. The audio is not a request of its own any more, so it goes
  // whenever it is there — and the picture goes with it.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const submitWith = async (path, nodeId) => {
    // The call of this run, not the one of an earlier run: a call that waits
    // for the machine is recorded later than the one before it.
    const before = connector.calls.length;
    const started = await fetch(`${h.base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        mode: 'video',
        prompt: '一只猫在跑',
        modelKey: 'MiniMax-H3',
        params: { ratio: '16:9', resolution: '768P', duration: 6 },
        path,
        references: [
          { id: 'n_pic', title: '图', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/p.png', kind: 'image' }] },
          { id: 'n_music', title: '音乐', kind: 'audio', text: '', media: [{ url: 'https://cdn.example.com/m.mp3', kind: 'audio' }] },
        ],
      }),
    });
    assert.equal(started.status, 202);
    await waitForCall(connector.calls, (call, index) => index >= before && call.toolRef.endsWith('submit-video-generation'));
    const calls = connector.calls.filter((call) => call.toolRef.endsWith('submit-video-generation'));
    return calls[calls.length - 1].args;
  };

  const withBoth = await submitWith('collection', 'n_v1');
  assert.equal(withBoth.reference_images.length, 1);
  assert.deepEqual(withBoth.reference_audios, [{ url: 'https://cdn.example.com/m.mp3' }]);
});

test('an audio reference never comes alone', async (t) => {
  // The provider's own rule: an audio reference needs a picture or a video.
  // The run is refused here instead of being sent and coming back with a
  // provider error.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_audio_only',
      mode: 'video',
      prompt: '一段配乐',
      modelKey: 'MiniMax-H3',
      path: 'collection',
      references: [
        { id: 'n_music', title: '音乐', kind: 'audio', text: '', media: [{ url: 'https://cdn.example.com/m.mp3', kind: 'audio' }] },
      ],
    }),
  });
  assert.equal(started.status, 400);
  const refused = await started.json();
  assert.match(refused.message, /音频参考要配一张图或一条视频/);
  assert.equal(
    connector.calls.some((call) => call.toolRef.endsWith('submit-video-generation')),
    false,
    'the run must not be sent',
  );
});

test('a reference set with nothing in it is refused', async (t) => {
  // The provider's own rule: a set of references needs at least one item. A
  // word is not a reference, so the run is refused here instead of being sent
  // and coming back with a provider error.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_empty_set',
      mode: 'video',
      prompt: '一只猫在跑',
      modelKey: 'MiniMax-H3',
      path: 'collection',
      references: [
        { id: 'n_text', title: '文字', kind: 'text', text: '一只猫在跑', media: [] },
      ],
    }),
  });
  assert.equal(started.status, 400);
  const refused = await started.json();
  assert.match(refused.message, /至少要一样参考素材/);
  assert.equal(
    connector.calls.some((call) => call.toolRef.endsWith('submit-video-generation')),
    false,
    'the run must not be sent',
  );
});

test('the reference collections hold twelve items in all', async (t) => {
  // Nine pictures, three videos and one audio are twelve items — and the
  // provider takes twelve in all, so the thirteenth is refused.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const images = Array.from({ length: 9 }, (_, i) => ({ url: `https://cdn.example.com/p${i}.png`, kind: 'image' }));
  const videos = Array.from({ length: 3 }, (_, i) => ({ url: `https://cdn.example.com/v${i}.mp4`, kind: 'video' }));
  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_too_many',
      mode: 'video',
      prompt: '太长的一组参考',
      modelKey: 'MiniMax-H3',
      path: 'collection',
      references: [
        { id: 'n_pics', title: '图', kind: 'image', text: '', media: images },
        { id: 'n_vids', title: '视频', kind: 'video', text: '', media: videos },
        { id: 'n_music', title: '音乐', kind: 'audio', text: '', media: [{ url: 'https://cdn.example.com/m.mp3', kind: 'audio' }] },
      ],
    }),
  });
  assert.equal(started.status, 400);
  const refused = await started.json();
  assert.match(refused.message, /参考素材总共最多 12 个/);
});

test('the first and last frame request needs both frames', async (t) => {
  // A request that names an ending frame it does not have is one the
  // provider refuses: with only the first frame, it is a first-frame request.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_one_frame',
      mode: 'video',
      prompt: '一只猫在跑',
      modelKey: 'MiniMax-H3',
      params: { resolution: '768P', duration: 6 },
      path: 'firstLast',
      frames: [{ id: 'n_first', kind: 'image', role: 'first', url: 'https://cdn.example.com/first.png' }],
      references: [
        { id: 'n_first', title: '首帧', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/first.png', kind: 'image' }] },
      ],
    }),
  });
  assert.equal(started.status, 202);
  await waitForCall(connector.calls, (call) => call.toolRef.endsWith('submit-video-generation'));
  const calls = connector.calls.filter((call) => call.toolRef.endsWith('submit-video-generation'));
  const args = calls[calls.length - 1].args;
  assert.equal(args.reference_type, 'first_frame');
  assert.equal(args.last_frame_image, undefined);
});

test('the last frame request sends the picture as the ending, not as the first frame', async (t) => {
  // L2VA: one picture, and it is the last frame of the clip. The request says
  // so with reference_type, and it carries no ending frame of its own.
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_last_frame',
      mode: 'video',
      prompt: '一只猫在跑',
      modelKey: 'MiniMax-H3',
      params: { resolution: '768P', duration: 6 },
      path: 'lastFrame',
      frames: [{ id: 'n_end', kind: 'image', role: 'last', url: 'https://cdn.example.com/end.png' }],
      references: [
        { id: 'n_end', title: '末帧', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/end.png', kind: 'image' }] },
      ],
    }),
  });
  assert.equal(started.status, 202);
  await waitForCall(connector.calls, (call) => call.toolRef.endsWith('submit-video-generation'));
  const calls = connector.calls.filter((call) => call.toolRef.endsWith('submit-video-generation'));
  const args = calls[calls.length - 1].args;
  assert.deepEqual(args.input_image, { url: 'https://cdn.example.com/end.png' });
  assert.equal(args.reference_type, 'last_frame');
  // The ending frame is the picture itself, so there is no second one.
  assert.equal(args.last_frame_image, undefined);
});

test('a prompt node the Agent makes carries the template it was given', async () => {
  // The shape of the enhanced prompt is a template, and the H3 ones are the
  // provider's own. A node the Agent makes has to be able to name one,
  // otherwise it expands the sentence into whatever the Agent felt like
  // writing — and the whole point of the template is lost.
  const { applyAction, promptTemplateFor } = await import('../miniapp/client/actions.mjs');
  const { PROMPT_TEMPLATES } = await import('../miniapp/node/capabilities.mjs');
  const templates = PROMPT_TEMPLATES;

  // A prompt node without a name takes the first template, so it is useful
  // before anything is typed.
  const first = promptTemplateFor({ mode: 'prompt', templates });
  assert.equal(first.templateId, templates[0].id);
  assert.equal(first.templateText, templates[0].text);

  // A named template brings its own text.
  const named = promptTemplateFor({ mode: 'prompt', templateId: 'h3-i2va', templates });
  assert.equal(named.templateId, 'h3-i2va');
  assert.equal(named.templateText, templates.find((item) => item.id === 'h3-i2va').text);

  // A template of its own wins over the text of the named one.
  const own = promptTemplateFor({
    mode: 'prompt',
    templateId: 'h3-i2va',
    templateText: '只写三段',
    templates,
  });
  assert.equal(own.templateText, '只写三段');

  // A node that is not a prompt node carries no template.
  const other = promptTemplateFor({ mode: 'generate', templates });
  assert.equal(other.templateId, 'custom');
  assert.equal(other.templateText, '');

  // The Agent adds a prompt node with a template: the node carries it.
  const added = applyAction(
    { nodes: [], connections: [] },
    { type: 'add_node', args: { type: 'text', mode: 'prompt', templateId: 'h3-fl2va' } },
    { promptTemplates: templates },
  );
  assert.equal(added.error, undefined);
  assert.equal(added.node.metadata.templateId, 'h3-fl2va');
  assert.equal(
    added.node.metadata.templateText,
    templates.find((item) => item.id === 'h3-fl2va').text,
  );

  // And it can change the template of a node that is already there: the text
  // of the template follows the name.
  const changed = applyAction(
    { nodes: [added.node], connections: [] },
    { type: 'update_node', args: { id: added.node.id, templateId: 'h3-l2va' } },
    { promptTemplates: templates },
  );
  assert.equal(changed.error, undefined);
  assert.equal(changed.canvas.nodes[0].metadata.templateId, 'h3-l2va');
  assert.equal(
    changed.canvas.nodes[0].metadata.templateText,
    templates.find((item) => item.id === 'h3-l2va').text,
  );
});

test('an audio line keeps the node in the reference mode', async () => {
  // The reference set is one mode and it takes a sound as well as a picture,
  // so an audio line does not move the node anywhere: it lands on the audio
  // port of the mode that is already there.
  const { applyAction } = await import('../miniapp/client/actions.mjs');
  const canvas = {
    nodes: [
      { id: 'n_pic', type: 'input', title: '图', metadata: { kind: 'image' } },
      { id: 'n_music', type: 'input', title: '音乐', metadata: { kind: 'audio' } },
      { id: 'n_vid', type: 'video', title: '视频', metadata: { mode: 'image2video', model: 'MiniMax-H3' } },
    ],
    connections: [{ id: 'c1', fromNodeId: 'n_pic', toNodeId: 'n_vid', kind: 'image' }],
  };
  const withAudio = applyAction(canvas, { type: 'connect', args: { from: 'n_music', to: 'n_vid' } });
  assert.equal(withAudio.error, undefined);
  // The node stays in the reference mode, and the picture line stays too: the
  // set takes them both.
  assert.equal(withAudio.canvas.nodes[2].metadata.mode, 'image2video');
  assert.equal(withAudio.canvas.connections.length, 2);
});

test('a provider error is reported instead of an empty result', async (t) => {  const connector = createMockHostConnector(undefined, { failImage: true });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_fail', mode: 'image', prompt: '一只猫' }),
  });
  const { run } = await started.json();
  const failed = await waitFor(h.base, run.id, (item) => item.status === 'error' || item.status === 'done');
  assert.equal(failed.status, 'error');
  // A provider error is mapped to a readable message, not swallowed.
  assert.match(failed.error, /402|额度/);
  assert.deepEqual(failed.media, []);
});

test('a submitted video survives a runtime restart', async (t) => {
  // A video can take half an hour. If the runtime stops while it waits, the
  // canvas must keep waiting for the result it already paid for.
  const dataDir = await mkdtemp(join(tmpdir(), 'nxc-pending-'));
  t.after(() => removeDir(dataDir));

  const first = await createHarness({ dataDir, hostConnector: createMockHostConnector() });
  const started = await getJson(first.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_video',
      mode: 'video',
      prompt: '一只猫在跑',
      modelKey: 'MiniMax-H3',
      params: { duration: 6 },
    }),
  });
  assert.equal(started.status, 202);
  const submitted = await waitFor(first.base, started.body.run.id, (item) => Boolean(item.providerTaskId));
  assert.equal(submitted.providerTaskId, 'task-9');
  // The pending book is written after the task is submitted. A runtime that
  // stops before that write would lose the task, so the test waits for it.
  const pendingFile = join(dataDir, 'pending-runs.json');
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = JSON.parse(await readFile(pendingFile, 'utf8'));
      if (list.some((item) => item.id === started.body.run.id)) break;
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await first.cleanup();

  // The runtime comes back with the same data directory.
  const second = await createHarness({ dataDir, hostConnector: createMockHostConnector() });
  t.after(() => second.cleanup());
  const active = await getJson(second.base, '/api/tasks');
  assert.equal(active.status, 200);
  assert.equal(active.body.tasks.length, 1);
  assert.equal(active.body.tasks[0].nodeId, 'n_video');

  // And the restored run is polled to the end.
  const restored = await getJson(second.base, `/api/runs/${active.body.tasks[0].id}`);
  assert.equal(restored.body.run.providerTaskId, 'task-9');
  assert.equal(restored.body.run.runner, 'connector');
});

// ---------------------------------------------------------------- cancelling

async function startTextRun(base, nodeId, prompt = '画一张海报') {
  const started = await getJson(base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId, mode: 'text', prompt }),
  });
  assert.equal(started.status, 202);
  return started.body.run;
}

async function waitFor(base, runId, predicate, tries = 160) {
  let run = null;
  for (let i = 0; i < tries; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(base, `/api/runs/${runId}`)).body.run;
    if (predicate(run)) return run;
  }
  return run;
}

// Wait for a connector call to happen. A run is asynchronous, so a test that
// wants to see what the provider was asked cannot simply look right away.
// The predicate also gets the place of the call, so a test can wait for the
// call of its own run and not for the one of an earlier run.
async function waitForCall(calls, predicate, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    const found = calls.find((call, index) => predicate(call, index));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

test('a run can be stopped on its own, and the other runs keep going', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const first = await startTextRun(h.base, 'n_1');
  const second = await startTextRun(h.base, 'n_2');
  await waitFor(h.base, first.id, (run) => Boolean(run.pendingPermission));
  await waitFor(h.base, second.id, (run) => Boolean(run.pendingPermission));

  const cancelled = await getJson(h.base, `/api/runs/${first.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.run.status, 'aborted');
  assert.equal(cancelled.body.run.pendingPermission, null);

  // The stopped run does not come back on its own.
  await new Promise((resolve) => setTimeout(resolve, 80));
  const after = await getJson(h.base, `/api/runs/${first.id}`);
  assert.equal(after.body.run.status, 'aborted');
  assert.equal(after.body.run.error, '');

  // The other run is untouched: it still waits and still finishes.
  const other = await getJson(h.base, `/api/runs/${second.id}`);
  assert.ok(other.body.run.pendingPermission, 'the other run must keep its approval card');
  await getJson(h.base, `/api/runs/${second.id}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'deny' }),
  });
  const finished = await waitFor(h.base, second.id, (run) => run.status !== 'running' && run.status !== 'waiting-question');
  assert.equal(finished.status, 'done');
});

test('a stopped run frees its node for the next one', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const first = await startTextRun(h.base, 'n_1');
  await waitFor(h.base, first.id, (run) => Boolean(run.pendingPermission));
  const cancelled = await getJson(h.base, `/api/runs/${first.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.body.run.status, 'aborted');

  // The busy guard is per node, so a stopped run must not lock the node.
  const again = await startTextRun(h.base, 'n_1');
  assert.notEqual(again.id, first.id);
});

test('cancelling a run that does not exist is a 404', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const missing = await getJson(h.base, '/api/runs/r_nope/cancel', { method: 'POST' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'REQUEST_NOT_FOUND');
});

test('cancelling a run that already finished changes nothing', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const run = await startTextRun(h.base, 'n_1');
  await waitFor(h.base, run.id, (item) => Boolean(item.pendingPermission));
  await getJson(h.base, `/api/runs/${run.id}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'deny' }),
  });
  const finished = await waitFor(h.base, run.id, (item) => item.status === 'done');
  assert.equal(finished.status, 'done');

  const cancelled = await getJson(h.base, `/api/runs/${run.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.run.status, 'done');
});

test('a stopped video stops the runtime from waiting for the result', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_video', mode: 'video', prompt: '一只猫在跑', modelKey: 'MiniMax-H3' }),
  });
  assert.equal(started.status, 202);
  const runId = started.body.run.id;
  const submitted = await waitFor(h.base, runId, (run) => Boolean(run.providerTaskId));
  assert.equal(submitted.providerTaskId, 'task-9');

  const cancelled = await getJson(h.base, `/api/runs/${runId}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.run.status, 'aborted');

  // The runtime must not keep a cancelled video in its pending book.
  const pending = JSON.parse(await readFile(join(h.dataDir, 'pending-runs.json'), 'utf8'));
  assert.equal(pending.filter((item) => item.id === runId).length, 0);

  // And the run stays cancelled instead of turning back into a running one.
  await new Promise((resolve) => setTimeout(resolve, 60));
  const after = await getJson(h.base, `/api/runs/${runId}`);
  assert.equal(after.body.run.status, 'aborted');
});

test('the runtime reports the session as soon as the turn starts', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // The page opens the conversation of a run in the Host chat, and it can
  // only do that if the runtime tells it which session the run belongs to.
  const run = await startTextRun(h.base, 'n_1');
  const running = await waitFor(h.base, run.id, (item) => Boolean(item.sessionId));
  assert.equal(running.sessionId, 'sess_1');
  assert.equal(running.status, 'running');
});

test('the served page names its landmarks and announces its progress', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const page = await (await fetch(`${h.base}/canvas`)).text();
  // A reader has to be able to name the page, so the brand is a heading.
  assert.match(page, /<h1[^>]*class="nxc-brand"/);
  // The progress panel is a status area, not a decorative box.
  assert.match(page, /id="task-panel"[^>]*role="status"/);
});

test('the client gives the controls a name and says what is selected', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // The prompt editor needs a name of its own: a placeholder is a hint.
  assert.match(source, /editor\.setAttribute\('aria-label'/);
  // A node is a group with a name.
  assert.match(source, /wrap\.setAttribute\('role', 'group'\)/);
  assert.match(source, /nodeAccessibleName/);
  // The selection is said in words, so it is not carried by a border colour
  // alone.
  assert.match(source, /'已选'/);
  // A status message is announced, and a failure is announced firmly.
  assert.match(source, /'alert' : 'status'/);
});

test('a local reference is uploaded the way the provider expects', async (t) => {
  // The provider cannot read this machine's disk. Its upload command takes
  // the file's name and media type and answers with a signed form; the bytes
  // are posted to that form, and the temporary URL is what the provider can
  // fetch.
  const received = [];
  const uploadServer = createHttpServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ url: req.url, body: Buffer.concat(chunks) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => uploadServer.listen(0, '127.0.0.1', resolve));
  const uploadHost = `http://127.0.0.1:${uploadServer.address().port}/upload`;
  // The upload client keeps the connection alive, so the socket has to be
  // closed as well or the server never stops listening.
  t.after(() => new Promise((resolve) => {
    uploadServer.closeAllConnections?.();
    uploadServer.close(resolve);
  }));

  const h = await createHarness({
    hostConnector: createMockHostConnector(undefined, { uploadHost }),
  });
  t.after(() => h.cleanup());

  const assetsDir = join(h.dataDir, 'assets');
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, 'sample.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]));

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_1',
      mode: 'image',
      prompt: '一只猫',
      references: [
        {
          id: 'n_0',
          title: '上游',
          kind: 'image',
          role: 'result',
          text: '',
          media: [{ url: '/assets/sample.png', kind: 'image' }],
        },
      ],
    }),
  });
  assert.equal(started.status, 202);

  // The bytes were posted to the signed form, with the file and the fields.
  assert.equal(received.length, 1, 'the file must be posted to the signed form');
  const body = received[0].body.toString('latin1');
  assert.match(body, /name="key"/);
  assert.match(body, /name="policy"/);
  assert.match(body, /name="file"; filename="sample\.png"/);
  assert.match(body, /Content-Type: image\/png/);

  // And the provider was given the temporary URL, not the local path.
  const imageCall = h.hostConnector.calls.find((c) => c.toolRef.endsWith('generate-image'));
  assert.ok(imageCall, 'the image tool must have been called');
  assert.deepEqual(imageCall.args.requests[0].input_urls, ['https://cdn.example.com/temp/sample.png']);
});

test('the toolbar wraps instead of running out of a narrow window', async () => {
  const css = await readFile(
    fileURLToPath(new URL('../miniapp/client/styles.css', import.meta.url)),
    'utf8',
  );
  // The page itself does not scroll, so a toolbar that is wider than the
  // window would cut its last controls off. The toolbar holds more controls
  // than fit into the narrowest window the surface allows.
  const body = /body \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(body, /overflow:\s*hidden/, 'the page does not scroll');
  const toolbar = /\.nxc-toolbar \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(toolbar, /flex-wrap:\s*wrap/, 'the toolbar must wrap');
  const group = /\.nxc-toolbar__group \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(group, /flex-wrap:\s*wrap/, 'the toolbar groups must wrap as well');
});

test('the palette ships the limits every model was resolved with', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const palette = await getJson(h.base, '/api/palette');
  assert.equal(palette.status, 200);
  const byModel = palette.body.modesByModel;
  // The page renders the parameter row from this, so the rule that a model
  // only offers a resolution for some durations is written down once.
  const hailuo = byModel?.video?.['MiniMax-Hailuo-2.3'];
  assert.ok(hailuo, 'every model needs its resolved limits');
  assert.deepEqual(hailuo.resolutions, ['768P', '1080P']);
  assert.deepEqual(hailuo.durations, [6, 10]);
  assert.deepEqual(hailuo.resolutionByDuration, { 6: ['768P', '1080P'], 10: ['768P'] });
  assert.equal(byModel.video['MiniMax-H3'].supportsReferences, true);
  assert.equal(byModel.video['MiniMax-H3-Max'].supportsReferences, false);
  assert.deepEqual(byModel.image['matrix-image'].ratios, ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9']);
});

test('the capability list only claims the connector tools the app drives', async () => {
  const { CONNECTOR_TOOLS } = await import('../miniapp/node/capabilities.mjs');

  // The tools a feature of this app really runs through.
  const driven = [
    'generate_image',
    'submit_video_generation',
    'query_video_generation',
    'synthesize_speech',
    'get_voice_list',
    'batch_text_to_music',
    'upload_temp_url',
    'get_asset_url',
    'describe_images',
    'videos_understand',
  ];
  for (const tool of CONNECTOR_TOOLS) {
    const suffix = tool.tool.split('__').pop();
    assert.equal(
      tool.drives === true,
      driven.includes(suffix),
      `${suffix} 的「本 app 用不用」标错了`,
    );
  }

  // And each tool marked as driven has a call site in the runtime, not only a
  // name in the table.
  const files = ['connector-runner.mjs', 'provider-upload.mjs', 'media-store.mjs', 'server.mjs'];
  const sources = await Promise.all(files.map((file) => readFile(
    fileURLToPath(new URL(`../miniapp/node/${file}`, import.meta.url)),
    'utf8',
  )));
  const code = sources.join('\n');
  for (const suffix of driven) {
    assert.ok(code.includes(suffix), `${suffix} 标成在用，却没有调用点`);
  }
});

test('the capability list says which connector tools the Host granted', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const palette = await getJson(h.base, '/api/palette');
  const tools = palette.body.connectorTools ?? [];
  const byName = Object.fromEntries(tools.map((tool) => [tool.tool, tool.granted]));
  // The mock grants these three and not the rest.
  assert.equal(byName['connector__matrix__generate_image'], true);
  assert.equal(byName['connector__matrix__get_voice_list'], true);
  // The table knows the tool, but this install did not get it: the list must
  // not claim it is callable.
  assert.equal(byName['connector__matrix__search_images'], false);
  assert.equal(byName['connector__matrix__reverse_image_search'], false);
});

test('the history holds the document, not the camera', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // Panning the board is not a change to the document. If the view were in
  // the snapshot, every undo would move the camera, and a pan would push a
  // content change out of reach.
  const snapshot = /function snapshot\(\) \{([\s\S]*?)\n  \}/.exec(source)?.[1] ?? '';
  assert.ok(snapshot.includes('nodes:'), 'the snapshot holds the nodes');
  assert.ok(!snapshot.includes('viewport'), 'the snapshot must not hold the view');
  // The pan and the zoom save the document without entering the history.
  assert.match(source, /if \(moved\) markDirty\(\{ history: false \}\)/);
  assert.match(source, /applyViewport\(\);\s*markDirty\(\{ history: false \}\)/);
});

test('the parameters are snapped onto what the model offers', async () => {
  const { fitParamsToCaps } = await import('../miniapp/client/tools.mjs');

  // Hailuo pairs 1080P with six seconds only, so a longer run may not keep
  // the resolution it had.
  const hailuo = {
    ratios: ['16:9', '9:16'],
    resolutions: ['768P', '1080P'],
    durations: ['6', '10'],
    resolutionByDuration: { 6: ['768P', '1080P'], 10: ['768P'] },
  };
  const short = fitParamsToCaps({ ratio: '16:9', duration: '6', resolution: '1080P' }, hailuo);
  assert.equal(short.resolution, '1080P', 'six seconds may keep 1080P');
  const long = fitParamsToCaps({ ratio: '16:9', duration: '10', resolution: '1080P' }, hailuo);
  assert.equal(long.resolution, '768P', 'ten seconds may not');

  // A value the model does not offer at all falls back to the first one it
  // does, and a value it does offer is left alone.
  const kept = fitParamsToCaps({ ratio: '9:16', duration: '10', resolution: '768P' }, hailuo);
  assert.equal(kept.ratio, '9:16');
  assert.equal(kept.duration, '10');
  assert.equal(kept.resolution, '768P');
  const wrong = fitParamsToCaps({ ratio: '4:3', duration: '99', resolution: '4K' }, hailuo);
  assert.equal(wrong.ratio, '16:9');
  assert.equal(wrong.duration, '6');
  assert.equal(wrong.resolution, '768P');

  // A model without a coupling keeps everything it offers.
  const h3 = { ratios: ['16:9'], resolutions: ['768P', '2K'], durations: ['4', '15'] };
  const plain = fitParamsToCaps({ ratio: '16:9', duration: '15', resolution: '2K' }, h3);
  assert.equal(plain.resolution, '2K');
});

test('a model summary survives a model that has no durations', async () => {
  const { modelSummary } = await import('../miniapp/client/tools.mjs');

  // A video model carries durations and, for Hailuo, the coupling between a
  // resolution and the durations it may be used with.
  assert.equal(
    modelSummary({ resolutions: ['768P', '2K'], durations: [4, 5, 15] }),
    '768P/2K · 4-15s',
  );
  assert.equal(
    modelSummary({ resolutions: ['768P', '1080P'], resolutionByDuration: { 6: ['768P', '1080P'], 10: ['768P'] } }),
    '768P/1080P@6s  768P@10s',
  );
  // An image model has no durations at all: reading them used to throw, and
  // the throw took the whole capability panel down with it.
  assert.equal(modelSummary({ resolutions: ['1K', '2K', '4K'] }), '1K/2K/4K');
  assert.equal(modelSummary({ label: 'Matrix 语音合成' }), '—');
  assert.equal(modelSummary(null), '—');
});

test('the colours of the board can be read on every surface', async () => {
  // Each kind of data shares one hue, so a chain can be read by colour alone.
  // That only works if the hue stays readable on every surface it can sit on,
  // so the contrast is measured here instead of trusted to the eye.
  const css = await readFile(
    fileURLToPath(new URL('../miniapp/client/styles.css', import.meta.url)),
    'utf8',
  );

  const tokensOf = (selector) => {
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `样式里找不到 ${selector}`);
    const start = css.indexOf('{', at);
    const end = css.indexOf('}', start);
    const out = {};
    for (const hit of css.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
      out[hit[1]] = hit[2];
    }
    return out;
  };
  const luminance = (hex) => {
    const full = hex.replace('#', '');
    const wide = full.length === 3 ? full.split('').map((c) => c + c).join('') : full;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const s = parseInt(wide.slice(i, i + 2), 16) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  };

  const light = tokensOf(':root {');
  // The dark palette is written twice on purpose: once for the explicit
  // override and once for the system preference. The two copies have to say
  // the same thing, or the board changes colour when the system does.
  const explicit = tokensOf("[data-theme='dark']");
  const system = tokensOf('@media (prefers-color-scheme: dark)');
  for (const [name, value] of Object.entries(explicit)) {
    assert.equal(system[name], value, `暗色两处写法不一致：${name}`);
  }

  const kinds = ['text', 'image', 'video', 'audio', 'style'];
  const surfaces = ['bg', 'surface', 'surface-muted', 'bg-secondary'];
  const checkTheme = (label, tokens) => {
    for (const kind of kinds) {
      const fore = tokens[`nxc-kind-${kind}`];
      assert.ok(fore, `${label}缺了 ${kind} 的色`);
      for (const surface of surfaces) {
        const back = tokens[`mcode-${surface}`];
        const value = ratio(fore, back);
        assert.ok(
          value >= 4.5,
          `${label}的${kind}色在${surface}上只有 ${value.toFixed(2)}:1，读不清`,
        );
      }
    }
  };
  checkTheme('亮色', light);
  checkTheme('暗色', explicit);
});

test('a destructive action carries the danger colour before it is clicked', async () => {
  // The baseline: a destructive action uses the danger token. A button that
  // only turns red on hover asks the user to find out what it does first.
  const css = await readFile(
    fileURLToPath(new URL('../miniapp/client/styles.css', import.meta.url)),
    'utf8',
  );
  const app = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  assert.match(css, /\.nxc-btn--danger \{[^}]*color: var\(--mcode-danger\)/);
  assert.match(css, /\.nxc-menu__item--danger \{[^}]*color: var\(--mcode-danger\)/);
  // And the delete in the node menu is the destructive one.
  assert.match(app, /label: '删除节点', danger: true/);
});

test('every kind of data has a colour of its own', async () => {
  const css = await readFile(
    fileURLToPath(new URL('../miniapp/client/styles.css', import.meta.url)),
    'utf8',
  );
  const app = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // The content colour is what lets a chain be read by colour, so every kind
  // the app can carry needs one.
  for (const kind of ['text', 'image', 'video', 'audio', 'style']) {
    assert.match(css, new RegExp(`--nxc-kind-${kind}:`), `${kind} needs a colour`);
  }
  // The light and the dark palette both have to carry it.
  assert.equal((css.match(/--nxc-kind-image:/g) ?? []).length, 3, 'light, dark and system');
  // The node, its ports and the line are coloured by the same kind.
  assert.match(app, /wrap\.dataset\.kind = kindOf\(node\)/);
  assert.match(app, /portOut\.dataset\.kind = kindOf\(node\)/);
  // The line reads the kind live from the source, so it can never disagree
  // with the ports it joins — and an old line without a kind still lands on
  // the right port.
  assert.match(app, /const kind = kindOf\(from\) \|\| conn\.kind \|\| ''/);
  // The line ends on the port it was assigned to, so a mode that takes the
  // same kind twice still has one line per port.
  assert.match(app, /const d = bezier\(from, to, kind, port\)/);
  assert.match(app, /const port = portOfConnection\(state\.canvas, to, conn\)/);
  // A port is coloured by the kind that flows through it, not by the kind
  // of the card it sits on.
  assert.match(css, /\.nxc-node__port\[data-kind='text'\] \{ --port-kind: var\(--nxc-kind-text\)/);
  assert.match(css, /\.nxc-node__port\[data-kind='image'\] \{ --port-kind: var\(--nxc-kind-image\)/);
  // An output is filled and an input is hollow until it is plugged.
  assert.match(css, /\.nxc-node__port--out \{[^}]*background: var\(--port-kind\)/);
  assert.match(css, /\.nxc-node__port--in\.is-connected \{[^}]*background: var\(--port-kind\)/);
  // An input node that holds nothing yet is still the kind it was made for,
  // so its card, its port and its line are one colour. The rule itself lives
  // in the shared module, so it is checked by what it returns.
  const { kindOf } = await import('../miniapp/client/tools.mjs');
  assert.equal(kindOf({ type: 'input', metadata: { kind: 'image' } }), 'image');
  assert.equal(
    kindOf({ type: 'input', metadata: { kind: 'text', output: { media: [{ kind: 'video' }] } } }),
    'video',
  );
  assert.equal(kindOf({ type: 'result', metadata: { kind: 'audio' } }), 'audio');
  assert.equal(kindOf({ type: 'image', metadata: {} }), 'image');
  // A music run is an audio node in its music mode: the difference is the
  // model, not the data.
  assert.equal(kindOf({ type: 'audio', metadata: { mode: 'music' } }), 'audio');
  assert.equal(kindOf({ type: 'audio', metadata: { mode: 'speech' } }), 'audio');
  // The prompt mode is a text node that rewrites a sentence: it produces
  // text, not a kind of its own.
  assert.equal(kindOf({ type: 'text', metadata: { mode: 'prompt' } }), 'text');
  assert.equal(kindOf({ type: 'text', metadata: { mode: 'generate' } }), 'text');
});

test('every node declares the slots it takes and the one it hands on', async () => {
  const { slotsOf } = await import('../miniapp/client/tools.mjs');

  // The ComfyUI idea: a node says what may be plugged into it and what it
  // gives, so the card itself shows what may connect.
  //
  // An input card is a source: what it holds is what leaves it.
  assert.deepEqual(slotsOf({ type: 'input', metadata: { kind: 'image' } }, []), {
    inputs: [],
    outputs: [{ kind: 'image' }],
  });
  // A result card is fed by the generation, so it has an input as well.
  assert.deepEqual(slotsOf({ type: 'result', metadata: { kind: 'video' } }, []), {
    inputs: [{ kind: 'video', role: '', label: '' }],
    outputs: [{ kind: 'video' }],
  });
  // A group is a frame around other cards: it carries no data at all.
  assert.deepEqual(slotsOf({ type: 'group', metadata: {} }, []), {
    inputs: [],
    outputs: [],
  });
  // The prompt mode rewrites text into text, and takes text only.
  assert.deepEqual(slotsOf({ type: 'text', metadata: { mode: 'prompt' } }), {
    inputs: [{ kind: 'text', role: '', label: '' }],
    outputs: [{ kind: 'text' }],
  });
  // The same node in its plain mode takes a text.
  assert.deepEqual(slotsOf({ type: 'text', metadata: { mode: 'generate' } }), {
    inputs: [{ kind: 'text', role: '', label: '' }],
    outputs: [{ kind: 'text' }],
  });
  // A generating node takes what its mode takes, and gives what it makes.
  assert.deepEqual(slotsOf({ type: 'image', metadata: { mode: 'text2image' } }), {
    inputs: [{ kind: 'text', role: '', label: '' }],
    outputs: [{ kind: 'image' }],
  });
  // And the mode that waits for a picture waits for a picture, not for the
  // model: the ports follow the mode. The text is always there — it is the
  // card's text box — so 图生图 takes the text and the picture.
  assert.deepEqual(slotsOf({ type: 'image', metadata: { mode: 'image2image' } }), {
    inputs: [{ kind: 'text', role: '', label: '' }, { kind: 'image', role: '', label: '' }],
    outputs: [{ kind: 'image' }],
  });
  // An audio node hands on audio, in either of its modes.
  assert.deepEqual(slotsOf({ type: 'audio', metadata: { mode: 'music' } }), {
    inputs: [{ kind: 'text', role: '', label: '' }],
    outputs: [{ kind: 'audio' }],
  });

  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  const css = await readFile(
    fileURLToPath(new URL('../miniapp/client/styles.css', import.meta.url)),
    'utf8',
  );
  // The page feeds the rule with what the node knows about itself.
  assert.match(source, /return \{ inputs: stripInputs\(node, effectiveCaps\(node\)\), outputs: slots\.outputs \};/);
  // A node with a text box takes its text in the text box: the text has no
  // port of its own and no slot in the strip. One thing, one place.
  const { hasTextBox, portKinds, stripInputs } = await import('../miniapp/client/forms.mjs');
  assert.equal(hasTextBox({ type: 'image', metadata: {} }), true);
  assert.equal(hasTextBox({ type: 'input', metadata: { kind: 'text' } }), true);
  assert.equal(hasTextBox({ type: 'input', metadata: { kind: 'image' } }), false);
  assert.equal(hasTextBox({ type: 'result', metadata: { kind: 'text' } }), false);
  // A 文生图 node waits for a text, and the text goes into the box: no port.
  assert.deepEqual(portKinds({ type: 'image', metadata: { mode: 'text2image' } }), []);
  // The other kinds keep their ports.
  assert.deepEqual(portKinds({ type: 'image', metadata: { mode: 'image2image' } }), ['image']);
  // A text-to-video run carries no reference: the reference set is a request
  // of its own.
  assert.deepEqual(portKinds({ type: 'video', metadata: { mode: 'text2video' } }), []);
  // And the reference set takes the three kinds the provider takes in it: a
  // picture, a clip and a sound.
  assert.deepEqual(portKinds({ type: 'video', metadata: { mode: 'image2video' } }), ['image', 'video', 'audio']);
  // And the strip reads the same rule, so the card never says two different
  // things about the same input.
  assert.deepEqual(stripInputs({ type: 'image', metadata: { mode: 'image2image' } }), [{ kind: 'image', role: '', label: '' }]);
  assert.deepEqual(stripInputs({ type: 'image', metadata: { mode: 'text2image' } }), []);
  // A node with no text box keeps its text slot: the result card shows it.
  assert.deepEqual(stripInputs({ type: 'result', metadata: { kind: 'text' } }), [{ kind: 'text', role: '', label: '' }]);
  // 图生视频·首尾帧 takes two pictures, and the role is what tells the two
  // apart: one is the first frame and one is the last.
  assert.deepEqual(stripInputs({ type: 'video', metadata: { mode: 'imagefl2video' } }), [
    { kind: 'image', role: 'first', label: '首帧' },
    { kind: 'image', role: 'last', label: '尾帧' },
  ]);
  // The strip is drawn on the card, right under the header.
  assert.match(source, /wrap\.appendChild\(renderSlotStrip\(node, slots\)\)/);
  // An open slot says it is waiting in words, not only by a hollow ring.
  assert.match(source, /if \(open\) item\.appendChild\(el\('span', 'nxc-slot__wait', '待接入'\)\)/);
  assert.match(css, /\.nxc-slot\.is-open \.nxc-slot__dot \{[^}]*inset 0 0 0 1\.5px var\(--slot-kind\)/);
  // The slot, the port, the node and the line share one colour per kind.
  assert.match(css, /\.nxc-slot\[data-kind='image'\] \{ --slot-kind: var\(--nxc-kind-image\)/);
});

test('the hosted MCP server speaks the protocol the Host expects', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const init = await mcpCall(h.base, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.protocolVersion, '2025-03-26');
  assert.equal(init.body.result.serverInfo.name, 'ai-node-canvas');
  assert.ok(init.body.result.capabilities.tools, 'the server has to offer tools');

  const list = await mcpCall(h.base, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.body.result.tools.map((tool) => tool.name).sort(), [
    'canvas_add_node',
    'canvas_apply_template',
    'canvas_connect',
    'canvas_list',
    'canvas_list_templates',
    'canvas_read',
    'canvas_remove_node',
    'canvas_run',
    'canvas_update_node',
  ]);
  // The reading tools are read-only. The writing ones are not, and they say
  // so: they change the canvas the user is looking at.
  const byName = new Map(list.body.result.tools.map((tool) => [tool.name, tool]));
  assert.equal(byName.get('canvas_list').annotations.readOnlyHint, true);
  assert.equal(byName.get('canvas_read').annotations.readOnlyHint, true);
  assert.equal(byName.get('canvas_list_templates').annotations.readOnlyHint, true);
  for (const name of [
    'canvas_add_node',
    'canvas_connect',
    'canvas_update_node',
    'canvas_remove_node',
    'canvas_run',
  ]) {
    assert.equal(
      byName.get(name).annotations.readOnlyHint,
      false,
      `${name} must not claim to be read-only`,
    );
  }

  // An unknown method is refused, not silently ignored.
  const unknown = await mcpCall(h.base, { jsonrpc: '2.0', id: 3, method: 'nope' });
  assert.equal(unknown.body.error.code, -32601);
  // A tool that does not exist is an error answer, not a crash.
  const badTool = await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'canvas_delete', arguments: {} },
  });
  assert.equal(badTool.body.result.isError, true);

  // The transport is checked before anything is parsed.
  const wrongType = await fetch(`${h.base}/mcp/canvas`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', accept: 'application/json, text/event-stream' },
    body: '{}',
  });
  assert.equal(wrongType.status, 415);
  const wrongAccept = await fetch(`${h.base}/mcp/canvas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: '{}',
  });
  assert.equal(wrongAccept.status, 406);
  const wrongMethod = await fetch(`${h.base}/mcp/canvas`, { method: 'GET' });
  assert.equal(wrongMethod.status, 405);

  // The manifest and the server have to name the same path.
  const manifest = JSON.parse(
    await readFile(fileURLToPath(new URL('../miniapp/miniapp.json', import.meta.url)), 'utf8'),
  );
  assert.equal(manifest.mcpEndpoints[0].path, '/mcp/canvas');
  const servers = JSON.parse(
    await readFile(fileURLToPath(new URL('../servers.mcp.json', import.meta.url)), 'utf8'),
  );
  assert.equal(servers.mcpServers.canvas.type, 'streamable-http');
  const plugin = JSON.parse(
    await readFile(fileURLToPath(new URL('../.minimax-plugin/plugin.json', import.meta.url)), 'utf8'),
  );
  assert.ok(plugin.mcpServers.includes('servers.mcp.json'), 'the plugin has to reference the server file');
});

test('the MCP tools read the canvas the card shows', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'MCP 测试' }),
  });
  const canvas = created.body.canvas;
  const nodes = [
    { id: 'n_in', type: 'input', title: '输入', position: { x: 0, y: 0 }, width: 320, height: 420, metadata: { inputKind: 'image' } },
    { id: 'n_gen', type: 'image', title: '图', position: { x: 400, y: 0 }, width: 320, height: 420, metadata: { model: 'matrix-image', prompt: '一只猫' } },
    { id: 'n_out', type: 'result', title: '结果', position: { x: 800, y: 0 }, width: 320, height: 420, metadata: { resultKind: 'image' } },
  ];
  const connections = [
    // An old line, made before the kind travelled with it.
    { id: 'c1', fromNodeId: 'n_in', toNodeId: 'n_gen', kind: '' },
    { id: 'c2', fromNodeId: 'n_gen', toNodeId: 'n_out', kind: 'image' },
  ];
  await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...canvas, nodes, connections }),
  });
  const before = await getJson(h.base, `/api/canvases/${canvas.id}`);

  const listed = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'canvas_list', arguments: {} },
  }));
  assert.equal(listed.canvases.length, 1);
  assert.equal(listed.canvases[0].id, canvas.id);
  assert.equal(listed.canvases[0].nodeCount, 3);

  const doc = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'canvas_read', arguments: { id: canvas.id } },
  }));
  assert.equal(doc.nodeCount, 3);
  assert.equal(doc.connectionCount, 2);

  // The slots are the ones the card shows, with the same three states. The text
  // is not among them: it goes into the card's text box. A port with a role
  // says which one it is, so the Agent can tell two picture ports apart.
  const gen = doc.nodes.find((node) => node.id === 'n_gen');
  // The picture is connected, so the node sits in the mode that takes a
  // picture — and that mode takes the text as well, in its text box.
  assert.deepEqual(gen.slots.inputs, [{ kind: 'image', role: '', label: '', state: 'filled' }]);
  assert.deepEqual(gen.slots.outputs, [{ kind: 'image', state: 'out' }]);
  // The input card is a source, the result card is fed and hands on.
  const source = doc.nodes.find((node) => node.id === 'n_in');
  assert.deepEqual(source.slots.inputs, []);
  assert.deepEqual(source.slots.outputs, [{ kind: 'image', state: 'out' }]);
  const result = doc.nodes.find((node) => node.id === 'n_out');
  assert.deepEqual(result.slots.inputs, [{ kind: 'image', role: '', label: '', state: 'filled' }]);
  // And a node says what it holds and what went wrong, so the Agent can pass
  // the result on and can say why a run failed.
  assert.equal(gen.error, '');
  assert.deepEqual(gen.media, []);
  assert.equal(typeof gen.templateId, 'string');
  assert.equal(gen.text, '');
  assert.deepEqual(doc.connections, [
    // The kind of an old line is read from the source it comes from, the
    // same way the line is drawn on the board.
    { from: 'n_in', to: 'n_gen', kind: 'image' },
    { from: 'n_gen', to: 'n_out', kind: 'image' },
  ]);
  // The parameters are the ones the card shows: a node that was never
  // touched keeps an empty value, and the drop-down shows the first one the
  // model offers. A reader has to see that value, not the empty one.
  assert.deepEqual(gen.params, { ratio: '1:1', resolution: '1K', duration: '', count: 1 });

  // Reading does not write: the page is the only writer, and a tool that
  // wrote here would leave the open page holding a stale copy.
  const after = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(after.body.canvas.updatedAt, before.body.canvas.updatedAt);
});

test('one run can ask for several assets at once', async (t) => {
  const connector = createMockHostConnector();
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_batch',
      mode: 'image',
      prompt: '一只猫',
      count: 3,
      params: { ratio: '1:1', resolution: '1K' },
    }),
  });
  assert.equal(started.status, 202);
  const { run } = await started.json();
  assert.equal(run.count, 3);
  const finished = await waitFor(h.base, run.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(finished.status, 'done');
  // Three assets came back, each with an id of its own.
  assert.equal(finished.media.length, 3);
  assert.equal(new Set(finished.media.map((item) => item.nodeId)).size, 3);
  // And they came from three calls of one asset each, because the Host stops
  // a connector call that takes too long and a batch of assets takes longer
  // than one of them.
  const imageCalls = connector.calls.filter((call) => call.toolRef.endsWith('generate-image'));
  assert.equal(imageCalls.length, 3);
  assert.equal(imageCalls[0].args.requests.length, 1);
});

test('a mode that cannot be batched asks for one asset, and any count is clamped', async (t) => {
  const connector = createMockHostConnector(undefined, { videoState: 'succeeded' });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  // A video is one task per clip, so the count does not apply to it.
  const video = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_video',
      mode: 'video',
      prompt: '一只猫在跑',
      count: 4,
      modelKey: 'MiniMax-H3',
      params: { ratio: '16:9', resolution: '768P', duration: 6 },
    }),
  });
  const { run: videoRun } = await video.json();
  assert.equal(videoRun.count, 1);
  const submits = connector.calls.filter((call) => call.toolRef.endsWith('submit-video-generation'));
  assert.equal(submits.length, 1);
  // The task is stopped again: a video that is never polled would keep the
  // runtime's timer alive, and the test process would not end.
  await fetch(`${h.base}/api/runs/${videoRun.id}/cancel`, { method: 'POST' });
  // The runtime writes its pending book when a task is stopped, so the data
  // directory is left alone for a moment before it is removed.
  await new Promise((resolve) => setTimeout(resolve, 200));

  // A count from anywhere is clamped, so a request cannot ask for an
  // unbounded run.
  const tooMany = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_many', mode: 'image', prompt: '一只猫', count: 999 }),
  });
  assert.equal((await tooMany.json()).run.count, 8);
  const none = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_none', mode: 'image', prompt: '一只猫', count: 0 }),
  });
  assert.equal((await none.json()).run.count, 1);
  const nonsense = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_nonsense', mode: 'image', prompt: '一只猫', count: 'many' }),
  });
  assert.equal((await nonsense.json()).run.count, 1);
});

test('a batch of voice clips is a few calls, one clip each', async (t) => {
  const connector = createMockHostConnector();
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_voice',
      mode: 'audio',
      prompt: '这是一段口播',
      count: 2,
      params: { voice: 'male-qn-qingse' },
    }),
  });
  const { run } = await started.json();
  const finished = await waitFor(h.base, run.id, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(finished.status, 'done');
  assert.equal(finished.media.length, 2);
  // The voice tool takes one clip per call.
  const voiceCalls = connector.calls.filter((call) => call.toolRef.endsWith('synthesize-speech'));
  assert.equal(voiceCalls.length, 2);
});

test('a batch that loses one asset still shows the ones that came out', async (t) => {
  const connector = createMockHostConnector(undefined, { failImageCall: 2 });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const started = await fetch(`${h.base}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_partial',
      mode: 'image',
      prompt: '一只猫',
      count: 2,
      params: { ratio: '1:1', resolution: '1K' },
    }),
  });
  const { run } = await started.json();
  const finished = await waitFor(h.base, run.id, (item) => item.status === 'done' || item.status === 'error');
  // The asset that came out is worth showing, so the run is not a failure.
  assert.equal(finished.status, 'done');
  assert.equal(finished.media.length, 1);
  // And the run says what did not come out.
  assert.match(finished.log.join('\n'), /第 2 个没有生成出来/);
});

test('the count of a node survives a save and a load', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // The store rebuilds a node from the fields it knows, so a field it does
  // not know is dropped on the way in. The count has to be one of them.
  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '数量测试' }),
  });
  const canvas = created.body.canvas;
  const node = {
    id: 'n_count',
    type: 'image',
    title: '图',
    position: { x: 0, y: 0 },
    width: 320,
    height: 420,
    metadata: { count: 4, prompt: '一只猫' },
  };
  await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...canvas, nodes: [node] }),
  });
  const loaded = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(loaded.body.canvas.nodes[0].metadata.count, 4);
  // And a count that is out of range is clamped on the way in. The write
  // carries the version the last save gave, or the store refuses it as a
  // stale one.
  const current = await getJson(h.base, `/api/canvases/${canvas.id}`);
  await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...current.body.canvas,
      nodes: [{ ...node, metadata: { ...node.metadata, count: 99 } }],
    }),
  });
  const clamped = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(clamped.body.canvas.nodes[0].metadata.count, 8);
});

test('the count of a batch is decided in one place', async () => {
  const { batchCount, BATCH_MODES, BATCH_MAX } = await import('../miniapp/client/tools.mjs');

  // A mode whose provider call takes a list of requests can be batched.
  assert.deepEqual(BATCH_MODES, ['image', 'audio', 'music']);
  assert.equal(batchCount('image', 4), 4);
  // A video is one task per clip and a text is one Agent turn.
  assert.equal(batchCount('video', 4), 1);
  assert.equal(batchCount('text', 4), 1);
  // The number is clamped, so a request from anywhere is bounded.
  assert.equal(batchCount('image', 999), BATCH_MAX);
  assert.equal(batchCount('image', 0), 1);
  assert.equal(batchCount('image', 'many'), 1);
  assert.equal(batchCount('image', undefined), 1);

  // The page sends that number with the run, and the number comes from the
  // node the user set it on. It is decided in the shared run spec, so the page
  // and the runtime ask the same rule.
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  const rules = await readFile(
    fileURLToPath(new URL('../miniapp/client/actions.mjs', import.meta.url)),
    'utf8',
  );
  assert.match(source, /count: spec\.count,/);
  assert.match(rules, /count: batchCount\(node\.type, node\.metadata\?\.count\),/);
  // And the count sits next to the button that starts the run.
  assert.match(source, /paramSelect\('数量'/);
  // And a batch that lost an asset says so on the card.
  assert.match(source, /已完成 \$\{made\}\/\$\{asked\}/);
});

test('the kinds that travel are the four the whole app knows', async () => {
  const { DATA_KINDS, NODE_FORMS, CREATABLE_TYPES } = await import('../miniapp/client/forms.mjs');

  assert.deepEqual(DATA_KINDS, ['text', 'image', 'video', 'audio']);
  // A style preset and an expanded prompt are text: neither is a kind of its
  // own, so neither may put a kind of its own on a line.
  assert.ok(!Object.values(NODE_FORMS).some((form) => form.kind === 'style' || form.kind === 'prompt'));
  assert.ok(!CREATABLE_TYPES.includes('style'));
  // Every form that carries something carries a kind the board knows.
  for (const [type, form] of Object.entries(NODE_FORMS)) {
    if (!form.kind) continue;
    assert.ok(DATA_KINDS.includes(form.kind), `${type} carries ${form.kind}, which is not a kind`);
  }
});

test('a text source fills the text slot of the node downstream', async () => {
  const { inputSlotState, kindOf } = await import('../miniapp/client/tools.mjs');

  // The prompt node produces text. It used to claim a kind of its own, so the
  // text slot of the node downstream read as open and the line could not be
  // pulled from it.
  const promptNode = { id: 'n_p', type: 'prompt', metadata: { output: { text: '扩写后的提示词' } } };
  const imageNode = { id: 'n_i', type: 'image', metadata: {} };
  const canvas = {
    nodes: [promptNode, imageNode],
    connections: [{ fromNodeId: 'n_p', toNodeId: 'n_i', kind: 'text' }],
  };
  assert.equal(kindOf(promptNode), 'text');
  assert.equal(inputSlotState(canvas, imageNode, 'text'), 'filled');
});

test('a text mention never becomes the word undefined', async () => {
  const { tokenize, compilePrompt, buildMentionMap } = await import('../miniapp/node/prompt.mjs');

  // Text is not a numbered reference. It used to be forced into the image
  // bucket, so the token no longer matched and the prompt carried the word
  // "undefined" instead of the text.
  const references = [{ id: 'n_t', title: '文案', kind: 'text', role: 'result', text: '一段文案', media: [] }];
  const map = buildMentionMap(references);
  const out = compilePrompt(
    tokenize([{ type: 'text', text: '照这个改：' }, { type: 'mention', kind: 'text', nodeId: 'n_t' }]),
    map,
    'image',
    'minimax',
  );
  assert.ok(!out.promptForApi.includes('undefined'), 'the prompt must not carry the word undefined');
  assert.ok(out.promptForApi.includes('一段文案'), 'the text goes into the prompt as it is');
});

test('the page and the runtime agree on the cancel route', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // The path the page builds, taken from the page itself rather than from a
  // copy, so a change on either side has to be made on both.
  const template = /`([^`]*\/api\/runs\/[^`]*?\/cancel)`/.exec(source);
  assert.ok(template, 'the page must build a cancel route');

  const run = await startTextRun(h.base, 'n_1');
  await waitFor(h.base, run.id, (item) => Boolean(item.pendingPermission));
  const path = template[1].replace(/\$\{[^}]*\}/g, run.id);
  const cancelled = await getJson(h.base, path, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.run.status, 'aborted');
});

test('a turn that pauses on a question waits for the answer', async (t) => {
  const h = await createHarness({ agentOptions: { questionnaire: true } });
  t.after(() => h.cleanup());

  const run = await startTextRun(h.base, 'n_1');
  const waiting = await waitFor(h.base, run.id, (item) => Boolean(item.pendingQuestion));
  // A turn that pauses is not a finished run: the Host reports the turn as
  // finished with the question still pending, and the page has to show it.
  assert.equal(waiting.status, 'waiting-question');
  assert.ok(waiting.pendingQuestion.request.steps.length, 'the real request is shown');
  assert.equal(waiting.pendingQuestion.request.steps[0].options.length, 2);

  const answered = await getJson(h.base, `/api/runs/${run.id}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: waiting.pendingQuestion.requestId,
      sessionId: waiting.pendingQuestion.sessionId,
      answers: [{ stepId: 'step_1', selectedOptionIds: ['a'], selectedOther: false, otherText: '' }],
    }),
  });
  assert.equal(answered.status, 200);
  assert.equal(answered.body.run.status, 'done');
  assert.equal(answered.body.run.text, '已回答');
  assert.equal(answered.body.run.pendingQuestion, null);
});

test('an answer can be stopped on its own', async (t) => {
  const h = await createHarness({ agentOptions: { questionnaire: true, hangOnAnswer: true } });
  t.after(() => h.cleanup());

  const run = await startTextRun(h.base, 'n_1');
  const waiting = await waitFor(h.base, run.id, (item) => Boolean(item.pendingQuestion));
  assert.equal(waiting.status, 'waiting-question');

  // The answer keeps running until it is cancelled.
  const answer = getJson(h.base, `/api/runs/${run.id}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: waiting.pendingQuestion.requestId,
      sessionId: waiting.pendingQuestion.sessionId,
      answers: [{ stepId: 'step_1', selectedOptionIds: ['a'], selectedOther: false, otherText: '' }],
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 40));

  const cancelled = await getJson(h.base, `/api/runs/${run.id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.run.status, 'aborted');

  const settled = await answer;
  assert.equal(settled.status, 200);
  assert.equal(settled.body.run.status, 'aborted');
});

test('the turn is told what it may do and what to do when it is refused', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  await startTextRun(h.base, 'n_1', '画一张海报');
  const runCall = h.agent.calls.find((call) => call.kind === 'run');
  const text = runCall.payload.text;
  // The scope travels with the request: the Host chat does not copy the
  // node, the parameters or the upstream material into the turn by itself.
  assert.match(text, /本次只做下面这一件事/);
  assert.match(text, /不需要做的事不要做/);
  assert.match(text, /权限被拒绝/);
  // And the user's own request is still there.
  assert.match(text, /画一张海报/);
});

// ---------------------------------------------------------------- actions

test('an action changes the document the way the card shows it', () => {
  const canvas = { id: 'cv_1', nodes: [], connections: [] };
  const added = applyAction(
    canvas,
    { type: 'add_node', args: { type: 'audio', mode: 'music', title: '曲子' } },
    { sizes: { audio: { width: 320, height: 250, title: '音频' } }, idFor: (prefix) => `${prefix}_x` },
  );
  assert.equal(added.error, undefined);
  assert.equal(added.canvas.nodes.length, 1);
  const node = added.canvas.nodes[0];
  // The kind comes from the node table: a music run is an audio node.
  assert.equal(node.metadata.kind, 'audio');
  // And the mode is remembered: that is what makes it a music run.
  assert.equal(node.metadata.mode, 'music');
  assert.equal(node.title, '曲子');
  assert.equal(node.width, 320);
  // The document that was handed in is not changed.
  assert.equal(canvas.nodes.length, 0);
});

test('a line carries what the upstream makes, and never closes a loop', () => {
  const canvas = {
    nodes: [
      { id: 'n1', type: 'audio', title: '曲子', metadata: { mode: 'music' } },
      { id: 'n2', type: 'video', title: '片', metadata: {} },
      { id: 'n3', type: 'image', title: '图', metadata: {} },
    ],
    connections: [],
  };
  // A video node takes an audio line: the music is the sound track.
  const linked = applyAction(canvas, { type: 'connect', args: { from: 'n1', to: 'n2' } });
  assert.equal(linked.error, undefined);
  assert.equal(linked.canvas.connections.length, 1);
  assert.equal(linked.canvas.connections[0].kind, 'audio');
  // The same line twice is not a second line.
  const again = applyAction(linked.canvas, { type: 'connect', args: { from: 'n1', to: 'n2' } });
  assert.equal(again.canvas.connections.length, 1);
  // A line that closes a loop is refused.
  const loop = applyAction(linked.canvas, { type: 'connect', args: { from: 'n2', to: 'n1' } });
  assert.match(loop.error, /环/);
  assert.equal(loop.canvas.connections.length, 1);
  // A line of a kind the target has no port for is refused too, and the reason
  // says what the node does not take. The line is not drawn on a port that is
  // not there.
  const wrong = applyAction(linked.canvas, { type: 'connect', args: { from: 'n1', to: 'n3' } });
  assert.match(wrong.error, /不接音频/);
  assert.equal(wrong.canvas.connections.length, 1);
});

test('the chain says what a node has, and the source says what a line carries', async () => {
  const { planIncoming, linesDroppedByMode, lineKind, upstreamKinds } = await import('../miniapp/client/actions.mjs');

  // The chain is the flow: material handed to a node is handed further down.
  // The card reads the same chain for its slots, so the mode has to be chosen
  // from the chain too — otherwise the strip says "filled" for a kind the card
  // has no port for.
  const canvas = {
    nodes: [
      { id: 'n_word', type: 'input', title: '字', metadata: { kind: 'text' } },
      { id: 'n_a', type: 'image', title: '甲', metadata: {} },
      { id: 'n_b', type: 'image', title: '乙', metadata: {} },
      { id: 'n_pic', type: 'input', title: '图', metadata: { kind: 'image' } },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'n_word', toNodeId: 'n_a', kind: 'text' },
      { id: 'c2', fromNodeId: 'n_a', toNodeId: 'n_b', kind: 'image' },
    ],
  };
  const target = canvas.nodes[2];
  // The chain above 乙 holds a text (the word) and an image (甲).
  assert.deepEqual(upstreamKinds(canvas, target).sort(), ['image', 'text']);
  // So a picture coming in moves it to the mode that takes both.
  const plan = planIncoming(canvas, target, 'image');
  assert.equal(plan.error, '');
  assert.equal(plan.modeId, 'image2image');

  // A line carries what its source holds now, not what it carried when it was
  // drawn: the source may have been filled with something else since.
  const stale = {
    nodes: [
      { id: 'n_src', type: 'input', title: '图', metadata: { kind: 'image' } },
      { id: 'n_to', type: 'image', title: '图', metadata: { mode: 'image2image' } },
    ],
    connections: [{ id: 'c_old', fromNodeId: 'n_src', toNodeId: 'n_to', kind: 'text' }],
  };
  assert.equal(lineKind(stale, stale.connections[0]), 'image');
  // So 图生图 keeps the line: it takes a picture, and the line is a picture.
  assert.equal(linesDroppedByMode(stale, stale.nodes[1], 'image2image').length, 0);
  // And 文生图 drops it: it takes no picture at all.
  assert.equal(linesDroppedByMode(stale, stale.nodes[1], 'text2image').length, 1);
});

test('a line that the mode does not take moves the node to a mode that does', async () => {
  const { planIncoming, linesDroppedByMode, lineKind } = await import('../miniapp/client/actions.mjs');

  // An image node starts in 文生图, so it waits for a text.
  const canvas = {
    nodes: [
      { id: 'n_in', type: 'input', title: '图', metadata: { kind: 'image' } },
      { id: 'n_img', type: 'image', title: '图', metadata: {} },
      { id: 'n_txt', type: 'input', title: '字', metadata: { kind: 'text' } },
    ],
    connections: [],
  };
  const node = canvas.nodes[1];

  // A picture comes in: the node moves to the mode that takes it.
  const plan = planIncoming(canvas, node, 'image');
  assert.equal(plan.error, '');
  assert.equal(plan.modeId, 'image2image');
  assert.equal(plan.changed, true);

  // A kind the node already takes changes nothing.
  const same = planIncoming(canvas, { ...node, metadata: { mode: 'image2image' } }, 'text');
  assert.equal(same.modeId, 'image2image');
  assert.equal(same.changed, false);

  // A kind no mode takes is refused with a reason, not a broken line.
  const refused = planIncoming(canvas, node, 'audio');
  assert.match(refused.error, /不接音频/);
  assert.equal(refused.changed, false);

  // A result node takes the kind it shows: the generation handed it an image,
  // so a line of an image has somewhere to land.
  const withResult = {
    nodes: [
      { id: 'n_pic2', type: 'input', title: '图', metadata: { kind: 'image' } },
      { id: 'n_res', type: 'result', title: '结果', metadata: { kind: 'image' } },
    ],
    connections: [],
  };
  const intoResult = applyAction(withResult, { type: 'connect', args: { from: 'n_pic2', to: 'n_res' } });
  assert.equal(intoResult.error, undefined);
  assert.equal(intoResult.canvas.connections.length, 1);
  assert.equal(intoResult.canvas.connections[0].kind, 'image');
  // A line of another kind still has nowhere to land there.
  const withSound = {
    nodes: [
      ...withResult.nodes,
      { id: 'n_snd', type: 'input', title: '声', metadata: { kind: 'audio' } },
    ],
    connections: [],
  };
  const wrongIntoResult = applyAction(withSound, { type: 'connect', args: { from: 'n_snd', to: 'n_res' } });
  assert.match(wrongIntoResult.error, /不接音频/);
  assert.equal(wrongIntoResult.canvas.connections.length, 0);

  // The action applies the same rule: the node is in the new mode, and the
  // line carries the kind of its source.
  const linked = applyAction(canvas, { type: 'connect', args: { from: 'n_in', to: 'n_img' } });
  assert.equal(linked.error, undefined);
  assert.equal(linked.canvas.connections.length, 1);
  assert.equal(linked.canvas.connections[0].kind, 'image');
  assert.equal(linked.canvas.nodes[1].metadata.mode, 'image2image');

  // A text line on top of it moves the node to the mode that takes both.
  const withText = applyAction(linked.canvas, { type: 'connect', args: { from: 'n_txt', to: 'n_img' } });
  assert.equal(withText.error, undefined);
  assert.equal(withText.canvas.nodes[1].metadata.mode, 'image2image');
  assert.equal(withText.canvas.connections.length, 2);

  // The line carries what its source holds, read live.
  assert.equal(lineKind(withText.canvas, withText.canvas.connections[0]), 'image');

  // A mode that does not take a line takes it with it: the line goes, and the
  // caller is told which ones. 图生图 takes the picture and the text — the
  // text is the card's text box — so nothing is dropped.
  const dropped = linesDroppedByMode(withText.canvas, withText.canvas.nodes[1], 'image2image');
  assert.equal(dropped.length, 0);
  // And 文生图 takes no picture at all, so the picture line goes with it.
  const droppedByText = linesDroppedByMode(withText.canvas, withText.canvas.nodes[1], 'text2image');
  assert.equal(droppedByText.length, 1);
  assert.equal(droppedByText[0].kind, 'image');

  // And the action that changes the mode does the same thing.
  const changed = applyAction(withText.canvas, {
    type: 'update_node',
    args: { id: 'n_img', mode: 'image2image' },
  });
  assert.equal(changed.error, undefined);
  assert.equal(changed.canvas.nodes[1].metadata.mode, 'image2image');
  assert.equal(changed.canvas.connections.length, 2);
  assert.deepEqual(changed.info.dropped.length, 0);

  // And a mode that cannot take a line takes it with it: the picture line goes
  // with the picture, and the caller is told which ones.
  const toText = applyAction(withText.canvas, {
    type: 'update_node',
    args: { id: 'n_img', mode: 'text2image' },
  });
  assert.equal(toText.error, undefined);
  assert.equal(toText.canvas.nodes[1].metadata.mode, 'text2image');
  assert.equal(toText.canvas.connections.length, 1);
  assert.equal(toText.info.dropped.length, 1);
  assert.equal(toText.canvas.connections[0].kind, 'text');
});

test('the modes and the ports follow the model the node selected', async () => {
  const { modesFor, portKindsFor, referenceKinds } = await import('../miniapp/client/forms.mjs');
  const { resolveLimits } = await import('../miniapp/node/capabilities.mjs');

  // MiniMax-H3 takes reference collections and the first+last frame, so every
  // mode is on the table.
  const h3 = resolveLimits('video', 'MiniMax-H3');
  const video = { type: 'video', metadata: { mode: 'imagekey2video' } };
  assert.deepEqual(
    modesFor(video, h3).map((mode) => mode.id),
    ['text2video', 'imagekey2video', 'imagefl2video', 'imageend2video', 'image2video'],
  );
  // The ports are the kinds the mode takes and the model allows: the
  // reference set takes a picture, a clip and a sound.
  const ref = { type: 'video', metadata: { mode: 'image2video' } };
  assert.deepEqual(portKindsFor(ref, h3), ['image', 'video', 'audio']);

  // MiniMax-H3-Max has no reference collection, so the mode that runs on a
  // set of references is off the table.
  const max = resolveLimits('video', 'MiniMax-H3-Max');
  // A kind the model cannot take has no port either: the reference set has an
  // audio port and a video port, and H3-Max takes neither.
  assert.deepEqual(portKindsFor(ref, max), ['image']);
  assert.deepEqual(
    modesFor(video, max).map((mode) => mode.id),
    ['text2video', 'imagekey2video', 'imagefl2video', 'imageend2video'],
  );
  assert.deepEqual(portKindsFor(video, max), ['image']);
  // The model that can take a clip still offers the reference set, and the set
  // is the same one for every kind of reference.
  assert.deepEqual(
    modesFor(ref, h3).map((mode) => mode.id),
    ['text2video', 'imagekey2video', 'imagefl2video', 'imageend2video', 'image2video'],
  );
  assert.deepEqual(portKindsFor(ref, h3), ['image', 'video', 'audio']);

  // Hailuo has the first frame and nothing else.
  const hailuo = resolveLimits('video', 'MiniMax-Hailuo-2.3');
  assert.deepEqual(
    modesFor(video, hailuo).map((mode) => mode.id),
    ['text2video', 'imagekey2video'],
  );

  // The kinds a model can take are the ones its limits allow.
  assert.deepEqual(referenceKinds(h3), ['image', 'video', 'audio']);
  assert.deepEqual(referenceKinds(max), ['image']);
  assert.deepEqual(referenceKinds(hailuo), ['image']);

  // And the strip reads the same rule: a kind the model cannot take is not an
  // input of the node either.
  const { stripInputs } = await import('../miniapp/client/forms.mjs');
  assert.deepEqual(stripInputs(ref, h3), [
    { kind: 'image', role: '', label: '' },
    { kind: 'video', role: '', label: '' },
    { kind: 'audio', role: '', label: '' },
  ]);
  // The first frame mode has one picture port, and it says which end it is.
  assert.deepEqual(stripInputs(video, max), [
    { kind: 'image', role: 'first', label: '首帧' },
  ]);
  // A kind the model cannot take is not an input of the node either: the
  // reference set has a clip port and a sound port, and H3-Max takes neither.
  assert.deepEqual(stripInputs(ref, max), [
    { kind: 'image', role: '', label: '' },
  ]);
});

test('the reference set takes a picture, a clip and a sound', async () => {
  // The provider takes ONE set of references, and the set may hold pictures,
  // videos and audios together. The card says the same thing: the ports of
  // the reference mode are the three kinds.
  const { modeRecordOf, portKindsFor } = await import('../miniapp/client/forms.mjs');
  const { resolveLimits } = await import('../miniapp/node/capabilities.mjs');
  const h3 = resolveLimits('video', 'MiniMax-H3');
  const ref = { type: 'video', metadata: { mode: 'image2video' } };
  const record = modeRecordOf(ref);
  assert.equal(record.id, 'image2video');
  assert.deepEqual(record.ports.map((port) => port.kind), ['text', 'image', 'video', 'audio']);
  assert.deepEqual(portKindsFor(ref, h3), ['image', 'video', 'audio']);
});

test('the modes that split the reference set land on the one that carries them all', async () => {
  // A canvas from before the merge names a mode that split the set by the
  // kind of its first reference. It keeps its card and lands on the mode that
  // carries them all — and gains the kinds it was missing.
  const { currentModeId, modeOf, portKindsFor } = await import('../miniapp/client/forms.mjs');
  const { resolveLimits } = await import('../miniapp/node/capabilities.mjs');
  const h3 = resolveLimits('video', 'MiniMax-H3');
  for (const old of ['image2videoaudio', 'video2video', 'video2videoaudio']) {
    assert.equal(currentModeId(old), 'image2video');
    const node = { type: 'video', metadata: { mode: old } };
    assert.equal(modeOf(node), 'image2video');
    assert.deepEqual(portKindsFor(node, h3), ['image', 'video', 'audio']);
  }
});

test('the tool tells the Agent the modes the table has', async () => {
  // The MCP schema lists the modes the Agent may set. The list comes from the
  // mode table, so a mode that is added or taken away is in the tool the
  // moment it is — there is no second copy to forget.
  const { MCP_TOOLS } = await import('../miniapp/node/mcp.mjs');
  const { modesOf } = await import('../miniapp/client/forms.mjs');
  const tool = MCP_TOOLS.find((item) => item.name === 'canvas_update_node');
  const schema = tool.inputSchema.properties.mode;
  for (const id of modesOf({ type: 'video' }).map((mode) => mode.id)) {
    assert.ok(schema.enum.includes(id), `the tool does not offer ${id}`);
  }
  // And the modes that are gone are not offered any more.
  assert.ok(!schema.enum.includes('video2video'));
  assert.ok(!schema.enum.includes('image2videoaudio'));
  assert.ok(!schema.enum.includes('video2videoaudio'));
});

test('the mode list of the card follows the model too', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  const rules = await readFile(
    fileURLToPath(new URL('../miniapp/client/actions.mjs', import.meta.url)),
    'utf8',
  );
  // The card offers the modes the model can run, and the ports the model can
  // take: a card must never offer something the run would refuse.
  assert.match(source, /const modes = modesFor\(node, caps\);/);
  assert.match(source, /const ports = portList\(node, caps\);/);
  // And switching the model goes through the shared rule, so the Agent and
  // the runtime land on the same mode.
  assert.match(source, /const result = applyModel\(state\.canvas, node, next, actionContext\(\)\);/);
  assert.match(rules, /export function applyModel\(canvas, node, modelKey, context = \{\}\)/);
});

test('switching the model leaves the node on a mode the model can run', async () => {
  const { applyAction, applyModel } = await import('../miniapp/client/actions.mjs');
  const { resolveLimits } = await import('../miniapp/node/capabilities.mjs');
  const capsFor = (node) => resolveLimits('video', node.metadata?.model);

  const canvas = {
    nodes: [
      {
        id: 'n_v',
        type: 'video',
        title: '片',
        metadata: { output: { media: [{ kind: 'video', url: 'u' }] } },
      },
      { id: 'n_t', type: 'video', title: '参考', metadata: { mode: 'image2video', model: 'MiniMax-H3' } },
    ],
    connections: [{ id: 'c1', fromNodeId: 'n_v', toNodeId: 'n_t', kind: 'video' }],
  };
  const node = canvas.nodes[1];

  // MiniMax-H3 can take a clip as a reference: the mode stays where it is.
  const same = applyModel(canvas, node, 'MiniMax-H3', { capsFor });
  assert.equal(same.node.metadata.mode, 'image2video');
  assert.equal(same.dropped.length, 0);

  // MiniMax-H3-Max cannot: the node moves to a mode it can run, and the video
  // line goes with it — it has nowhere to land any more.
  const other = applyModel(canvas, node, 'MiniMax-H3-Max', { capsFor });
  assert.equal(other.node.metadata.mode, 'text2video');
  assert.equal(other.dropped.length, 1);
  assert.equal(other.dropped[0].kind, 'video');

  // And the action the Agent sends does the same thing, so the canvas is the
  // same whoever asked for the change.
  const applied = applyAction(
    canvas,
    { type: 'update_node', args: { id: 'n_t', model: 'MiniMax-H3-Max' } },
    { capsFor },
  );
  assert.equal(applied.error, undefined);
  assert.equal(applied.canvas.nodes[1].metadata.mode, 'text2video');
  assert.equal(applied.canvas.connections.length, 0);
  assert.equal(applied.info.dropped.length, 1);
});

test('a floating panel stays inside the window', async () => {
  // The capability list is longer than the window. It used to be placed with
  // `Math.min(anchor.bottom + 6, window.innerHeight - height - 8)`, and for a
  // panel that tall that goes negative: the panel opened with its title
  // above the top of the screen, so the user could not tell what it was.
  const { placeOverlay } = await import('../miniapp/client/tools.mjs');
  const viewport = { width: 1200, height: 800 };

  const tall = placeOverlay({ left: 100, top: 60 }, { width: 300, height: 1400 }, viewport);
  assert.ok(tall.top >= 8, `面板不能跑到屏幕上方：${tall.top}`);

  // A panel that fits goes where it was asked to go.
  const fits = placeOverlay({ left: 100, top: 60 }, { width: 300, height: 200 }, viewport);
  assert.equal(fits.top, 60);
  assert.equal(fits.left, 100);

  // A panel anchored to the right edge is pushed back inside.
  const right = placeOverlay({ left: 1150, top: 60 }, { width: 300, height: 200 }, viewport);
  assert.ok(right.left + 300 <= viewport.width, `面板不能跑到屏幕右边：${right.left}`);

  // A panel anchored below the bottom edge is pushed up.
  const below = placeOverlay({ left: 100, top: 780 }, { width: 300, height: 200 }, viewport);
  assert.ok(below.top + 200 <= viewport.height, `面板不能跑到屏幕下方：${below.top}`);
});

test('the placement rule is written once', async () => {
  // The rule was copied into five places in the page, and one of the copies
  // had no lower bound. Now it lives in one function, and the page calls it.
  const app = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.ok(app.includes('placeOverlay('), '页面必须走共享的定位规则');
  assert.ok(!app.includes('window.innerHeight - rect.height'), '旧的定位算式还在页面里');
  assert.ok(!app.includes('window.innerWidth - rect.width'), '旧的定位算式还在页面里');
});

test('a node can be changed, and removed with its lines', () => {
  const canvas = {
    nodes: [
      { id: 'n1', type: 'image', title: '图', metadata: { prompt: '旧的' } },
      { id: 'n2', type: 'result', title: '结果', metadata: {} },
    ],
    connections: [{ id: 'c1', fromNodeId: 'n1', toNodeId: 'n2', kind: 'image' }],
  };
  const changed = applyAction(canvas, { type: 'update_node', args: { id: 'n1', prompt: '一只猫' } });
  assert.equal(changed.error, undefined);
  assert.equal(changed.canvas.nodes[0].metadata.prompt, '一只猫');
  // The prompt is one text segment, so the card shows it as one.
  assert.deepEqual(changed.canvas.nodes[0].metadata.segments, [{ type: 'text', text: '一只猫' }]);
  // A node that is not there cannot be changed.
  const missing = applyAction(canvas, { type: 'update_node', args: { id: 'n_x', prompt: 'x' } });
  assert.match(missing.error, /没有这个节点/);

  const removed = applyAction(changed.canvas, { type: 'remove_node', args: { id: 'n1' } });
  assert.equal(removed.canvas.nodes.length, 1);
  assert.equal(removed.canvas.connections.length, 0);
  // Removing a node that is already gone is not an error: the same action twice
  // is not a second removal.
  const gone = applyAction(removed.canvas, { type: 'remove_node', args: { id: 'n1' } });
  assert.equal(gone.error, undefined);
});

test('a text line that lands on a node hands its text over', async () => {
  const { inheritedTextFor, textOfSource } = await import('../miniapp/client/actions.mjs');

  // A text input hands over what was typed into it.
  const input = { id: 'n_in', type: 'input', title: '输入', metadata: { kind: 'text', prompt: '一只猫' } };
  assert.equal(textOfSource(input), '一只猫');
  // A text result hands over what it produced.
  const result = { id: 'n_res', type: 'result', title: '结果', metadata: { kind: 'text', output: { text: '扩写好的提示词' } } };
  assert.equal(textOfSource(result), '扩写好的提示词');

  const target = { id: 'n_to', type: 'image', title: '图', metadata: { prompt: '画一只猫' } };
  const canvas = {
    nodes: [input, target],
    connections: [{ id: 'c1', fromNodeId: 'n_in', toNodeId: 'n_to', kind: 'text' }],
  };
  const inherited = inheritedTextFor(canvas, target);
  assert.equal(inherited.text, '一只猫');
  assert.equal(inherited.title, '输入');
  assert.equal(inherited.id, 'n_in');

  // An image upstream hands over nothing: the text it carries is a note about
  // the batch, not a prompt.
  const image = { id: 'n_img', type: 'image', title: '图', metadata: { output: { text: '2 张里有 1 张失败' } } };
  const withImage = {
    nodes: [image, target],
    connections: [{ id: 'c1', fromNodeId: 'n_img', toNodeId: 'n_to', kind: 'image' }],
  };
  assert.equal(inheritedTextFor(withImage, target), null);

  // A text node that has not run yet hands over nothing either.
  const empty = { id: 'n_t', type: 'text', title: '文本', metadata: { mode: 'generate', output: { text: '' } } };
  assert.equal(
    inheritedTextFor({ nodes: [empty, target], connections: [{ id: 'c', fromNodeId: 'n_t', toNodeId: 'n_to', kind: 'text' }] }, target),
    null,
  );

  // The newest text line wins: that is the one the user just drew.
  const two = {
    nodes: [input, result, target],
    connections: [
      { id: 'c1', fromNodeId: 'n_in', toNodeId: 'n_to', kind: 'text' },
      { id: 'c2', fromNodeId: 'n_res', toNodeId: 'n_to', kind: 'text' },
    ],
  };
  assert.equal(inheritedTextFor(two, target).text, '扩写好的提示词');

  // And no line at all means the box is the user's own.
  assert.equal(inheritedTextFor({ nodes: [target], connections: [] }, target), null);

  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // The text box is where a text line lands: the line ends on it, not on a
  // port on the edge of the card.
  assert.match(source, /wrap\.dataset\.textBox = '1';/);
  assert.match(source, /box\.dataset\.textBox = '1';/);
  assert.match(source, /side === 'in' && kind === 'text' && hasTextBox\(node\)/);
  assert.match(source, /\[data-node-id="\$\{node\.id\}"\] \[data-text-box\]/);
  // The inherited text is shown read-only, and the own prompt is not thrown
  // away: the note says so.
  assert.match(source, /renderInheritedPrompt\(node, inherited\)/);
  assert.match(source, /你自己写的提示词还留着/);
  // The page asks the shared rule and does not answer the question again.
  assert.doesNotMatch(source, /function inheritedTextFor/);
  assert.match(source, /inheritedTextFor\(state\.canvas, node\)/);
  // And the run is built by the same shared rule, so the card and the run say
  // the same thing.
  assert.match(source, /const spec = runSpecFor\(state\.canvas, node/);
  assert.doesNotMatch(source, /function buildEnhancePrompt/);
});

test('the Agent sees the label the prompt gives each material', async (t) => {
  // The prompt says "@图片1" and the request sends the picture list. Whoever
  // writes the prompt has to be able to name the same picture, so the material
  // block carries the label — and the user's own line says it the same way,
  // because one prompt cannot carry two vocabularies.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_text',
      mode: 'text',
      modelKey: JSON.stringify({ providerId: 'minimax', modelId: 'minimax-M3' }),
      prompt: '照着 @图片1 写一条提示词',
      segments: [
        { type: 'text', text: '照着 ' },
        { type: 'mention', kind: 'image', nodeId: 'n_0' },
        { type: 'text', text: ' 写一条提示词' },
      ],
      mentions: [{ nodeId: 'n_0', kind: 'image' }],
      references: [
        {
          id: 'n_0',
          title: '上游图',
          kind: 'image',
          text: '',
          media: [{ url: 'https://cdn.example.com/p.png', kind: 'image' }],
        },
      ],
    }),
  });
  assert.equal(started.status, 202);
  const runId = started.body.run.id;
  let run = null;
  for (let i = 0; i < 40 && !run?.pendingPermission; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
  }
  const runCall = h.agent.calls.find((c) => c.kind === 'run');
  assert.ok(runCall, 'the Agent was not asked to write the prompt');
  // The material block names the picture by the number the request gives it.
  assert.match(runCall.payload.text, /【参考素材 @图片1 · 上游图（image）】/);
  // And the user's own line says the same thing, not the title.
  assert.match(runCall.payload.text, /照着 @图片1 写一条提示词/);
  assert.doesNotMatch(runCall.payload.text, /照着 @上游图/);
});

test('a material the prompt names reaches the node that generates from it', async () => {
  // The H3 flow: a prompt node names a picture, and the video node that runs
  // the prompt has to receive it. The user should not have to draw that line
  // a second time.
  const { syncMentions } = await import('../miniapp/client/actions.mjs');

  const canvas = {
    nodes: [
      {
        id: 'n_pic',
        type: 'result',
        title: '商品图',
        position: { x: 0, y: 0 },
        metadata: { kind: 'image', output: { media: [{ kind: 'image', url: 'https://cdn.example.com/p.png' }] } },
      },
      {
        id: 'n_text',
        type: 'text',
        title: '文本',
        position: { x: 400, y: 0 },
        metadata: {
          mode: 'prompt',
          segments: [{ type: 'text', text: '照着 ' }, { type: 'mention', kind: 'image', nodeId: 'n_pic' }],
        },
      },
      {
        id: 'n_video',
        type: 'video',
        title: '视频',
        position: { x: 800, y: 0 },
        metadata: { mode: 'imagekey2video', model: 'MiniMax-H3' },
      },
    ],
    connections: [{ id: 'c1', fromNodeId: 'n_text', toNodeId: 'n_video', kind: 'text' }],
  };

  const synced = syncMentions(canvas, 'n_text');
  // The material is held by an input node, so the flow does not depend on
  // where the picture came from, and the chain never runs it again.
  assert.equal(synced.added.length, 1);
  const holder = synced.added[0];
  assert.equal(holder.type, 'input');
  assert.equal(holder.metadata.kind, 'image');
  assert.equal(holder.metadata.materialFrom, 'n_pic');
  assert.deepEqual(holder.metadata.output.media, [{ kind: 'image', url: 'https://cdn.example.com/p.png' }]);
  // And it is wired to the video node, on the first frame port.
  assert.equal(synced.connected.length, 1);
  assert.equal(synced.connected[0].from, holder.id);
  assert.equal(synced.connected[0].to, 'n_video');
  assert.equal(synced.connected[0].role, 'first');
  // The prompt node has no picture port, so it keeps naming the picture it
  // named: the Agent still looks at it.
  const text = synced.canvas.nodes.find((node) => node.id === 'n_text');
  assert.equal(text.metadata.segments[1].nodeId, 'n_pic');
});

test('the prompt names the picture the request carries', async () => {
  // The number in the prompt is the place the picture has in the request, so
  // the prompt has to name the picture that is actually sent — the one that
  // is plugged into the node.
  const { syncMentions } = await import('../miniapp/client/actions.mjs');

  const canvas = {
    nodes: [
      {
        id: 'n_pic',
        type: 'result',
        title: '商品图',
        position: { x: 0, y: 0 },
        metadata: { kind: 'image', output: { media: [{ kind: 'image', url: 'https://cdn.example.com/p.png' }] } },
      },
      {
        id: 'n_video',
        type: 'video',
        title: '视频',
        position: { x: 400, y: 0 },
        metadata: {
          mode: 'imagekey2video',
          model: 'MiniMax-H3',
          segments: [{ type: 'text', text: '照着 ' }, { type: 'mention', kind: 'image', nodeId: 'n_pic' }],
        },
      },
    ],
    connections: [],
  };

  const synced = syncMentions(canvas, 'n_video');
  assert.equal(synced.added.length, 1);
  const holder = synced.added[0];
  assert.equal(synced.connected.length, 1);
  assert.equal(synced.connected[0].to, 'n_video');
  // The mention now points at the holder, which is the picture the request
  // carries. The chip still says the same thing, because the holder is named
  // after the material.
  const video = synced.canvas.nodes.find((node) => node.id === 'n_video');
  assert.equal(video.metadata.segments[1].nodeId, holder.id);
  assert.equal(holder.title, '商品图');
});

test('the wiring happens once', async () => {
  // The rule runs after every change, so it has to be the same when it runs
  // again: a second holder for the same picture would fill the canvas.
  const { syncMentions } = await import('../miniapp/client/actions.mjs');

  const canvas = {
    nodes: [
      {
        id: 'n_pic',
        type: 'result',
        title: '商品图',
        position: { x: 0, y: 0 },
        metadata: { kind: 'image', output: { media: [{ kind: 'image', url: 'https://cdn.example.com/p.png' }] } },
      },
      {
        id: 'n_text',
        type: 'text',
        title: '文本',
        position: { x: 400, y: 0 },
        metadata: {
          mode: 'prompt',
          segments: [{ type: 'text', text: '照着 ' }, { type: 'mention', kind: 'image', nodeId: 'n_pic' }],
        },
      },
      {
        id: 'n_video',
        type: 'video',
        title: '视频',
        position: { x: 800, y: 0 },
        metadata: { mode: 'imagekey2video', model: 'MiniMax-H3' },
      },
    ],
    connections: [{ id: 'c1', fromNodeId: 'n_text', toNodeId: 'n_video', kind: 'text' }],
  };

  const first = syncMentions(canvas, 'n_text');
  assert.equal(first.added.length, 1);
  const second = syncMentions(first.canvas, 'n_text');
  assert.equal(second.added.length, 0, '同一张图不该被再拿一个');
  assert.equal(second.connected.length, 0, '线已经接上了');
  assert.equal(second.canvas.nodes.length, first.canvas.nodes.length);
});

test('a material the prompt names is a reference of the node that names it', async () => {
  // The picture may sit anywhere on the canvas. The prompt names it, so the
  // run has to take it with it — otherwise the Agent is asked about a
  // picture it never saw.
  const { runSpecFor } = await import('../miniapp/client/actions.mjs');

  const canvas = {
    nodes: [
      {
        id: 'n_pic',
        type: 'result',
        title: '商品图',
        position: { x: 0, y: 0 },
        metadata: { kind: 'image', output: { media: [{ kind: 'image', url: 'https://cdn.example.com/p.png' }] } },
      },
      {
        id: 'n_text',
        type: 'text',
        title: '文本',
        position: { x: 400, y: 0 },
        metadata: {
          mode: 'prompt',
          segments: [{ type: 'text', text: '照着 ' }, { type: 'mention', kind: 'image', nodeId: 'n_pic' }],
        },
      },
    ],
    connections: [],
  };

  const spec = runSpecFor(canvas, canvas.nodes[1]);
  assert.equal(spec.references.length, 1);
  assert.equal(spec.references[0].id, 'n_pic');
  assert.deepEqual(spec.references[0].media, [{ kind: 'image', url: 'https://cdn.example.com/p.png' }]);
});

test('the mention menu offers the whole canvas', async () => {
  // A prompt may be about a picture that sits somewhere else, so the menu
  // lists every material on the board and not only the ones above the node.
  const { mentionCandidates } = await import('../miniapp/client/tools.mjs');

  const canvas = {
    nodes: [
      {
        id: 'n_pic',
        type: 'result',
        title: '商品图',
        metadata: { kind: 'image', output: { media: [{ kind: 'image', url: 'https://cdn.example.com/p.png' }] } },
      },
      {
        id: 'n_text',
        type: 'text',
        title: '文本',
        metadata: { mode: 'prompt', output: { media: [{ kind: 'text', url: 'https://cdn.example.com/t.txt' }] } },
      },
      {
        id: 'n_other',
        type: 'result',
        title: '别处',
        metadata: { kind: 'image', output: { media: [{ kind: 'image', url: 'https://cdn.example.com/o.png' }] } },
      },
    ],
    connections: [{ id: 'c1', fromNodeId: 'n_pic', toNodeId: 'n_text', kind: 'image' }],
  };

  const candidates = mentionCandidates(canvas, canvas.nodes[1]);
  // Both pictures are in the list, even the one that is not above the node.
  assert.deepEqual(candidates.map((item) => item.id), ['n_pic', 'n_other']);
  // The one above the node comes first: that is the one a prompt is usually
  // about.
  assert.equal(candidates[0].upstream, true);
  assert.equal(candidates[1].upstream, false);
  // The node itself is not a candidate.
  assert.ok(!candidates.some((item) => item.id === 'n_text'));

  // And the wiring rule is asked for when a material is named and when a
  // line is drawn, so the picture reaches the node that generates from it.
  // The call has to be in the right place: a call somewhere else on the page
  // is not a call that fires.
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  const near = (header, call) => {
    const at = source.indexOf(header);
    if (at < 0) return false;
    return source.slice(at, at + 2500).includes(call);
  };
  assert.ok(near('function insertMention(', 'applyMentions(node.id);'), '提到素材时要问接线规则');
  assert.ok(near('function connect(', 'applyMentions(fromId);'), '连线时要问接线规则');
  assert.ok(near('function renderParams(', 'applyMentions(node.id);'), '切模式时要问接线规则');
});

test('the holder of a material survives the save', async (t) => {
  // The holder is found again by the node the material came from, so the
  // same picture is not held twice after a reload.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '素材测试' }),
  });
  const id = created.body.canvas.id;
  const saved = await getJson(h.base, `/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      title: '素材测试',
      nodes: [
        {
          id: 'n_holder',
          type: 'input',
          title: '商品图',
          position: { x: 10, y: 20 },
          metadata: {
            kind: 'image',
            materialFrom: 'n_pic',
            output: { media: [{ kind: 'image', url: 'https://cdn.example.com/p.png' }] },
          },
        },
      ],
      connections: [],
    }),
  });
  assert.equal(saved.status, 200);
  const loaded = await getJson(h.base, `/api/canvases/${id}`);
  const holder = loaded.body.canvas.nodes.find((node) => node.id === 'n_holder');
  assert.equal(holder.metadata.materialFrom, 'n_pic');
  assert.equal(holder.metadata.kind, 'image');
  assert.equal(holder.metadata.output.media.length, 1);
  assert.equal(holder.metadata.output.media[0].url, 'https://cdn.example.com/p.png');
  assert.equal(holder.metadata.output.media[0].kind, 'image');
});

test('a prompt that names a picture the request does not carry is refused', async (t) => {
  // The number in the prompt is the place the picture has in the request. A
  // prompt that says "照着 @图片2 写" while the request carries one picture
  // would quietly produce something else, so the run is refused with the
  // reason instead.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_video_mismatch',
      mode: 'video',
      prompt: '照着 @图片2 的构图写',
      modelKey: 'MiniMax-H3',
      params: { ratio: '16:9', resolution: '768P', duration: 6 },
      path: 'collection',
      references: [
        { id: 'n_a', title: '甲', kind: 'image', text: '', media: [{ url: 'https://cdn.example.com/a.png', kind: 'image' }] },
      ],
    }),
  });
  assert.equal(started.status, 400);
  assert.match(started.body.message, /@图片2/);
  assert.match(started.body.message, /只带了 1 张图片/);
});

test('the library holds what this machine produced and picked', async (t) => {
  // The library is the folder: everything the runtime produced and everything
  // the user picked from their machine. The panel shows it, so an asset that
  // is on no canvas can still be brought back into a flow.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const uploaded = await fetch(`${h.base}/api/uploads?name=%E5%95%86%E5%93%81%E5%9B%BE.png&kind=image`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  assert.equal(uploaded.status, 200);
  const saved = await uploaded.json();
  assert.match(saved.url, /^\/uploads\//);

  const list = await getJson(h.base, '/api/library');
  assert.equal(list.status, 200);
  assert.equal(list.body.assets.length, 1);
  assert.equal(list.body.assets[0].kind, 'image');
  assert.equal(list.body.assets[0].url, saved.url);
  assert.equal(list.body.assets[0].inUse, false);

  // And the file can be handed over: the runtime says it is an attachment,
  // so the browser saves it even when the link is opened on its own.
  const file = await fetch(`${h.base}${saved.url}?download=${encodeURIComponent('商品图.jpg')}`);
  assert.equal(file.status, 200);
  const disposition = file.headers.get('content-disposition') ?? '';
  assert.match(disposition, /attachment/);
  assert.match(disposition, /filename\*=UTF-8/);
});

test('an asset a canvas uses cannot be deleted', async (t) => {
  // Deleting the file would leave a broken card behind, so the library says
  // so instead of doing it.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const uploaded = await fetch(`${h.base}/api/uploads?name=pic.png&kind=image`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  const saved = await uploaded.json();

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '用着素材的画布' }),
  });
  const id = created.body.canvas.id;
  const savedCanvas = await getJson(h.base, `/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      title: '用着素材的画布',
      nodes: [
        {
          id: 'n_input',
          type: 'input',
          title: '商品图',
          position: { x: 0, y: 0 },
          metadata: {
            kind: 'image',
            output: { status: 'success', media: [{ kind: 'image', url: saved.url }] },
          },
        },
      ],
      connections: [],
    }),
  });
  assert.equal(savedCanvas.status, 200);

  // The library knows who uses it.
  const list = await getJson(h.base, '/api/library');
  const asset = list.body.assets[0];
  assert.equal(asset.inUse, true);
  assert.equal(asset.title, '商品图');
  assert.equal(asset.canvasId, id);

  // And the file stays.
  const removed = await getJson(h.base, `/api/library/${encodeURIComponent(asset.name)}`, { method: 'DELETE' });
  assert.equal(removed.status, 409);
  assert.match(removed.body.message, /还在用|用着/);
  const again = await getJson(h.base, '/api/library');
  assert.equal(again.body.assets.length, 1);
});

test('the cleanup takes away what no canvas uses', async (t) => {
  // The folder grows with every run. The cleanup is what keeps it from
  // growing for ever.
  const h = await createHarness();
  t.after(() => h.cleanup());

  const upload = async (name) => {
    const response = await fetch(`${h.base}/api/uploads?name=${name}&kind=image`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    return response.json();
  };
  const kept = await upload('kept.png');
  await upload('gone.png');

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '留一个' }),
  });
  const id = created.body.canvas.id;
  await getJson(h.base, `/api/canvases/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      title: '留一个',
      nodes: [
        {
          id: 'n_input',
          type: 'input',
          title: '留下的',
          position: { x: 0, y: 0 },
          metadata: {
            kind: 'image',
            output: { status: 'success', media: [{ kind: 'image', url: kept.url }] },
          },
        },
      ],
      connections: [],
    }),
  });

  const cleaned = await getJson(h.base, '/api/library/gc', { method: 'POST' });
  assert.equal(cleaned.status, 200);
  assert.equal(cleaned.body.removed.length, 1);
  const list = await getJson(h.base, '/api/library');
  assert.equal(list.body.assets.length, 1);
  assert.equal(list.body.assets[0].url, kept.url);
});

test('a file can be put where the user can find it', async (t) => {
  // The runtime keeps the file in its own folder, which is not somewhere a
  // person looks for a picture. Saving copies it out, under the name the
  // node carries.
  const { createMediaStore } = await import('../miniapp/node/media-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'nxc-save-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createMediaStore({ dataDir: dir });
  const uploaded = await store.saveUpload('商品图.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image');
  // The material is a day old: a copy of it would look a day old too.
  const yesterday = new Date(Date.now() - 86_400_000);
  await utimes(join(dir, 'uploads', uploaded.name), yesterday, yesterday);

  const target = join(dir, 'out');
  await mkdir(target, { recursive: true });
  const out = await store.saveToDownloads(uploaded.name, '商品图.jpg', target);
  assert.ok(out?.ok, '文件没有存出去');
  assert.equal(out.path, join(target, '商品图.jpg'));
  assert.ok((await readFile(out.path)).length > 0);
  // The copy says it is a fresh save: a copied file keeps the time of the
  // original, which would make a save look old.
  const info = await stat(out.path);
  assert.ok(Date.now() - info.mtimeMs < 60_000, '刚存出来的文件不该是旧时间');

  // A file that is already there is kept: the copy gets a number.
  const again = await store.saveToDownloads(uploaded.name, '商品图.jpg', target);
  assert.notEqual(again.path, out.path);
  assert.match(again.path, /商品图 \(1\)\.jpg/);
});

test('a save name cannot walk out of the folder it lands in', async (t) => {
  // The name of a saved file comes from outside. A name like `..` points at
  // the parent of the Downloads folder, so it would put a file next to it
  // instead of inside it. The name is judged, not tidied up: `.` and `..`
  // are not names at all.
  const { createMediaStore, plainName, resolveInside } = await import('../miniapp/node/media-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'nxc-escape-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createMediaStore({ dataDir: dir });
  const uploaded = await store.saveUpload('商品图.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image');

  const target = join(dir, 'out');
  await mkdir(target, { recursive: true });

  for (const name of ['..', '.', '../逃出去.png', 'sub/../../逃出去.png']) {
    const saved = await store.saveToDownloads(uploaded.name, name, target);
    assert.equal(saved.ok, false, `这个名字不该被接受：${name}`);
    assert.equal(saved.reason, 'bad_name', `拒绝的理由说错了：${name}`);
  }
  // Nothing landed next to the folder either: a file written outside would
  // show up here as an extra entry.
  const beside = await readdir(dir);
  assert.deepEqual(beside.sort(), ['assets', 'out', 'uploads', 'work'], '有文件被写到了文件夹外面');

  // The rule itself: a path inside a folder, or nothing.
  assert.equal(resolveInside(target, 'ok.png'), join(target, 'ok.png'));
  assert.equal(resolveInside(target, '..'), null);
  assert.equal(resolveInside(target, '.'), null);
  assert.equal(resolveInside(target, '../out.png'), null);
  assert.equal(resolveInside(target, 'a/../../out.png'), null);
  // What lands on disk is one plain name: no separator, no dot segment.
  assert.equal(plainName('商品图.jpg'), '商品图.jpg');
  assert.equal(plainName(''), null);
  assert.equal(plainName('..'), null);
  assert.equal(plainName('.'), null);
  assert.equal(plainName('a/b:c.jpg'), 'abc.jpg');
});

test('a material id cannot walk out of the asset folder', async (t) => {
  // The id of a material comes from the route, so it is judged the same way
  // a save name is: `..` is not a material, and it must not read the folder
  // above the assets.
  const { createMediaStore } = await import('../miniapp/node/media-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'nxc-id-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createMediaStore({ dataDir: dir });
  const uploaded = await store.saveUpload('商品图.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image');

  const target = join(dir, 'out');
  await mkdir(target, { recursive: true });
  const saved = await store.saveToDownloads('..', '逃出去.png', target);
  assert.equal(saved.ok, false);
  assert.equal(saved.reason, 'not_found');
  const again = await store.saveToDownloads(uploaded.name, 'ok.png', target);
  assert.equal(again.ok, true, '正常的素材还是应该存得出去');
});

test('a download never reaches this machine or the network it sits in', async () => {
  // A provider link is an address this runtime would fetch, so the address
  // is judged before the request goes out: the loopback, the private ranges
  // and the link-local range are this machine, and a link to them is
  // refused.
  const { isPrivateAddress, isPublicUrl } = await import('../miniapp/node/media-store.mjs');

  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('127.13.2.9'), true);
  assert.equal(isPrivateAddress('10.0.0.1'), true);
  assert.equal(isPrivateAddress('172.16.0.1'), true);
  assert.equal(isPrivateAddress('172.31.255.255'), true);
  assert.equal(isPrivateAddress('192.168.1.1'), true);
  assert.equal(isPrivateAddress('169.254.1.1'), true);
  assert.equal(isPrivateAddress('0.0.0.0'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('fe80::1'), true);
  assert.equal(isPrivateAddress('fd00::1'), true);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  // A public address is not refused.
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('172.32.0.1'), false);
  assert.equal(isPrivateAddress('2606:4700::1111'), false);

  assert.equal(isPublicUrl('http://127.0.0.1:9/file.png'), false);
  assert.equal(isPublicUrl('http://localhost/file.png'), true, '一个名字要等查了才知道');
  assert.equal(isPublicUrl('https://cdn.example.com/file.png'), true);
  assert.equal(isPublicUrl('file:///etc/passwd'), false);
  assert.equal(isPublicUrl('not a url'), false);
});

test('a redirect into the loopback is refused', async (t) => {
  // The redirect is followed by hand, so every hop is judged: a public
  // address that redirects into this machine is still this machine.
  const { createMediaStore, isAllowedHop } = await import('../miniapp/node/media-store.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'nxc-redirect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createMediaStore({ dataDir: dir });

  // A hop is allowed when its address is public and every address its name
  // points at is public too.
  assert.equal(isAllowedHop('https://cdn.example.com/a.png', ['93.184.216.34']), true);
  assert.equal(isAllowedHop('https://cdn.example.com/a.png', ['93.184.216.34', '127.0.0.1']), false);
  assert.equal(isAllowedHop('http://127.0.0.1:9/a.png', []), false);
  assert.equal(isAllowedHop('http://192.168.0.10/a.png', []), false);

  // And a link to this machine is refused before a socket is opened.
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  await assert.rejects(
    () => store.materialize({ url: `http://127.0.0.1:${port}/start.png` }),
    /拒绝/,
    '指向本机的请求不该被放行',
  );
});

test('a material can be handed to the user, and the library can be opened', async () => {
  // The file is on this machine already, but only the page can hand it to
  // the browser. The library is where the files are, so it needs a way in.
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // The way out of the app: the runtime copies the file into the Downloads
  // folder under the name the node carries, and says where it landed.
  assert.match(source, /\/api\/library\/\$\{encodeURIComponent\(file\)\}\/save/);
  assert.match(source, /已保存到 \$\{result\.path\}/);
  assert.match(source, /renderMediaActions\(node, item\)/);
  assert.match(source, /label: '保存到本地'/);
  // The runtime says it in the headers as well, so the file is saved even
  // when the link is opened on its own.
  const server = await readFile(
    fileURLToPath(new URL('../miniapp/node/server.mjs', import.meta.url)),
    'utf8',
  );
  assert.match(server, /content-disposition/);
  assert.match(server, /downloadNameOf\(req\)/);
  assert.match(server, /saveToDownloads/);
  // The library panel.
  assert.match(source, /openLibraryPanel/);
  assert.match(source, /api\('\/api\/library'\)/);
  assert.match(source, /api\('\/api\/library\/gc', \{ method: 'POST' \}\)/);
  assert.match(source, /insertFromLibrary/);
  const html = await readFile(
    fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url)),
    'utf8',
  );
  assert.match(html, /id="btn-library"/);
});

test('a picture can be read before the Agent writes about it', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // The 图生文 mode reads the picture with the provider: the text model never
  // sees a picture, so it would only get an url.
  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_d',
      mode: 'text',
      nodeMode: 'describe',
      prompt: '',
      references: [{
        id: 'n_pic',
        title: '图',
        kind: 'image',
        role: 'result',
        text: '',
        media: [{ kind: 'image', url: 'https://cdn.example.com/p.png' }],
      }],
    }),
  });
  assert.equal(started.status, 202);
  const runId = started.body.run.id;
  let run = null;
  for (let i = 0; i < 60 && !run?.pendingPermission; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
  }
  assert.ok(run.pendingPermission, 'run 应该先请求授权');
  // The provider was asked about the picture...
  const asked = h.hostConnector.calls.find((call) => call.toolRef.endsWith('describe-images'));
  assert.ok(asked, 'provider 没有被问这张图');
  assert.equal(asked.args.image_info[0].url, 'https://cdn.example.com/p.png');
  // ...and the Agent got what it said.
  const turn = h.agent.calls.find((call) => call.kind === 'run');
  assert.match(turn.payload.text, /图片内容：https:\/\/cdn\.example\.com\/p\.png/);
  assert.match(turn.payload.text, /写出这张图的详细描述/);

  // Without a picture the mode says what it needs.
  const noPicture = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_d2',
      mode: 'text',
      nodeMode: 'describe',
      prompt: '',
      references: [],
    }),
  });
  assert.equal(noPicture.status, 400);
  assert.match(noPicture.body.message, /需要一张图/);
});

test('a video can be turned back into a prompt', async (t) => {
  const { modesOf, modeForKinds, portKinds, materialToRead } = await import('../miniapp/client/forms.mjs');
  const { runSpecFor } = await import('../miniapp/client/actions.mjs');

  // The text node has one more mode: it takes a video.
  assert.deepEqual(
    modesOf({ type: 'text', metadata: {} }).map((mode) => mode.id),
    ['generate', 'prompt', 'describe', 'video2text'],
  );
  assert.equal(modeForKinds('text', ['video']), 'video2text');
  // The port it draws is the video: the text box is where the text goes.
  assert.deepEqual(portKinds({ type: 'text', metadata: { mode: 'video2text' } }), ['video']);
  // The mode table says the runtime has to read the video before the Agent
  // writes, so the runtime does not answer that question on its own.
  assert.equal(materialToRead('video2text'), 'video');
  assert.equal(materialToRead('generate'), '');

  // The run carries the mode, so the runtime knows what it is running.
  const canvas = {
    nodes: [
      {
        id: 'n_v',
        type: 'video',
        title: '视频',
        metadata: { output: { media: [{ kind: 'video', url: 'https://cdn.example.com/v.mp4' }] } },
      },
      { id: 'n_t', type: 'text', title: '文本', metadata: { mode: 'video2text' } },
    ],
    connections: [{ id: 'c1', fromNodeId: 'n_v', toNodeId: 'n_t', kind: 'video' }],
  };
  const spec = runSpecFor(canvas, canvas.nodes[1]);
  assert.equal(spec.nodeMode, 'video2text');
  assert.equal(spec.mode, 'text');
  assert.equal(spec.references.find((item) => item.id === 'n_v').kind, 'video');

  // And the runtime reads the video with the provider before the Agent writes.
  const h = await createHarness();
  t.after(() => h.cleanup());
  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_t',
      mode: 'text',
      nodeMode: 'video2text',
      prompt: '',
      references: [{
        id: 'n_v',
        title: '视频',
        kind: 'video',
        role: 'result',
        text: '',
        media: [{ kind: 'video', url: 'https://cdn.example.com/v.mp4' }],
      }],
    }),
  });
  assert.equal(started.status, 202);
  const runId = started.body.run.id;
  // The Agent turn asks for permission before it answers, so the run is only
  // finished once the permission is answered.
  let run = null;
  for (let i = 0; i < 60 && !run?.pendingPermission; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
  }
  assert.ok(run.pendingPermission, 'run 应该先请求授权');
  // The provider was asked about the video, and the answer went to the Agent.
  const asked = h.hostConnector.calls.find((call) => call.toolRef.endsWith('videos-understand'));
  assert.ok(asked, 'provider 没有被问这条视频');
  assert.equal(asked.args.video_info[0].url, 'https://cdn.example.com/v.mp4');
  const turn = h.agent.calls.find((call) => call.kind === 'run');
  assert.match(turn.payload.text, /视频内容：https:\/\/cdn\.example\.com\/v\.mp4/);
  assert.match(turn.payload.text, /反推出能生成它的提示词/);

  const denied = await getJson(h.base, `/api/runs/${runId}/permission`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'deny' }),
  });
  assert.equal(denied.status, 200);
  run = await waitFor(h.base, runId, (item) => item.status === 'done' || item.status === 'error');
  assert.equal(run.status, 'done');
});

test('a video mode says what is missing when it cannot read the video', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // No video at all: the node needs one.
  const none = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: 'n_t', mode: 'text', nodeMode: 'video2text', prompt: '' }),
  });
  assert.equal(none.status, 400);
  assert.match(none.body.message, /需要一条视频/);

  // A video that has nothing in it yet: that is a different problem, and the
  // message has to say so.
  const empty = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_t',
      mode: 'text',
      nodeMode: 'video2text',
      prompt: '',
      references: [{ id: 'n_v', title: '视频', kind: 'video', role: 'result', text: '', media: [] }],
    }),
  });
  assert.equal(empty.status, 400);
  assert.match(empty.body.message, /还没有内容/);
});

test('a run takes the chain above it with it', () => {
  const canvas = {
    nodes: [
      { id: 'n_in', type: 'input', title: '素材', metadata: { kind: 'text', prompt: '一只猫', output: { text: '' } } },
      { id: 'n_music', type: 'audio', title: '曲子', metadata: { mode: 'music', output: { media: [{ kind: 'audio', url: 'u' }] } } },
      { id: 'n_img', type: 'image', title: '图', metadata: { prompt: '画一只猫', segments: [], mentions: [] } },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'n_in', toNodeId: 'n_img', kind: 'text' },
      { id: 'c2', fromNodeId: 'n_music', toNodeId: 'n_img', kind: 'audio' },
    ],
  };
  const spec = runSpecFor(canvas, canvas.nodes[2]);
  assert.equal(spec.error, undefined);
  assert.equal(spec.mode, 'image');
  // The text that landed on the node's text box is the prompt now: the card
  // shows that text, so the run sends that text. The node's own prompt stays
  // in the node — it comes back when the line is gone — but it is not sent.
  assert.equal(spec.prompt, '一只猫');
  assert.equal(canvas.nodes[2].metadata.prompt, '画一只猫');
  assert.deepEqual(spec.segments, []);
  assert.deepEqual(spec.mentions, []);
  // The source that handed the text over is not a reference any more: its text
  // is the prompt, and a text source carries no material to lose.
  assert.equal(spec.references.length, 1);
  // The kind is what the data is: a music run hands on audio.
  assert.equal(spec.references.find((item) => item.id === 'n_music').kind, 'audio');
  assert.equal(spec.references.find((item) => item.id === 'n_music').media.length, 1);

  // Without the text line the node sends its own prompt, and the upstream
  // input is a reference whose text is the prompt material.
  const noText = {
    nodes: canvas.nodes,
    connections: [{ id: 'c2', fromNodeId: 'n_music', toNodeId: 'n_img', kind: 'audio' }],
  };
  const ownSpec = runSpecFor(noText, noText.nodes[2]);
  assert.equal(ownSpec.prompt, '画一只猫');
  assert.equal(ownSpec.references.length, 1);

  // The text of an input node is the prompt material, and the card says which
  // kind the node holds — not what the card is called.
  const textInput = { id: 'n_txt', type: 'input', title: '输入', metadata: { kind: 'text', prompt: '一只猫' } };
  const imageNode = { id: 'n_pic', type: 'image', title: '图', metadata: { prompt: '画一只猫', segments: [], mentions: [] } };
  const withText = {
    nodes: [textInput, imageNode],
    connections: [{ id: 'c1', fromNodeId: 'n_txt', toNodeId: 'n_pic', kind: 'text' }],
  };
  const textSpec = runSpecFor(withText, imageNode);
  assert.equal(textSpec.prompt, '一只猫');
  assert.equal(textSpec.references.length, 0);

  // The node's own segments are not sent either: the box shows the upstream
  // text, so the run sends that text and nothing else.
  const word = { id: 'n_word', type: 'input', title: '输入', metadata: { kind: 'text', prompt: '一只猫' } };
  const withSegments = {
    nodes: [
      word,
      {
        id: 'n_s',
        type: 'image',
        title: '图',
        metadata: {
          prompt: '画一只猫',
          segments: [{ type: 'text', text: '画一只猫' }],
          mentions: [{ kind: 'image', nodeId: 'n_x' }],
        },
      },
    ],
    connections: [{ id: 'c1', fromNodeId: 'n_word', toNodeId: 'n_s', kind: 'text' }],
  };
  const segmentSpec = runSpecFor(withSegments, withSegments.nodes[1]);
  assert.equal(segmentSpec.prompt, '一只猫');
  assert.deepEqual(segmentSpec.segments, []);
  assert.deepEqual(segmentSpec.mentions, []);

  // And it is not the name of the card: an input node that holds a picture
  // hands on a picture, even though the card is called 输入.
  const pictureInput = {
    id: 'n_pic_in',
    type: 'input',
    title: '输入',
    metadata: { kind: 'image', output: { media: [{ kind: 'image', url: 'u' }] } },
  };
  const pictureNode = { id: 'n_pic', type: 'image', title: '图', metadata: { prompt: '画一只猫', segments: [], mentions: [] } };
  const pictureSpec = runSpecFor({
    nodes: [pictureInput, pictureNode],
    connections: [{ id: 'c1', fromNodeId: 'n_pic_in', toNodeId: 'n_pic', kind: 'image' }],
  }, pictureNode);
  assert.equal(pictureSpec.references.find((item) => item.id === 'n_pic_in').kind, 'image');

  // A music run runs the music model, and the prompt mode runs the text model
  // with the expanded prompt.
  const music = runSpecFor(canvas, canvas.nodes[1]);
  assert.equal(music.mode, 'music');
  const promptNode = { id: 'n_p', type: 'text', metadata: { mode: 'prompt', prompt: '一只猫', segments: [] } };
  const promptSpec = runSpecFor({ nodes: [promptNode], connections: [] }, promptNode);
  assert.equal(promptSpec.mode, 'text');
  assert.match(promptSpec.prompt, /提示词工程师/);
  assert.deepEqual(promptSpec.segments, []);
});

test('the result of a run becomes a node of its own', () => {
  const canvas = {
    nodes: [{ id: 'n1', type: 'image', title: '图', position: { x: 0, y: 0 }, width: 320, height: 420, metadata: {} }],
    connections: [],
  };
  // Every node gets its own id, so a second result would be told apart from
  // the first one.
  let seq = 0;
  const ctx = { sizes: { result: { width: 320, height: 420 } }, idFor: (prefix) => `${prefix}_${++seq}` };
  const placed = materializeResults(canvas, canvas.nodes[0], { id: 't1', media: [{ kind: 'image', url: 'u' }] }, ctx);
  assert.equal(placed.canvas.nodes.length, 2);
  assert.equal(placed.canvas.nodes[1].type, 'result');
  assert.equal(placed.canvas.nodes[1].metadata.sourceTaskId, 't1');
  assert.equal(placed.canvas.connections.length, 1);
  // The same task twice is not a second result: the result that is already
  // there is the one that stays.
  const again = materializeResults(placed.canvas, canvas.nodes[0], { id: 't1', media: [{ kind: 'image', url: 'u' }] }, ctx);
  assert.equal(again.canvas.nodes.length, 2);
  assert.equal(again.results[0].id, placed.results[0].id);
  // A batch is one result per asset, in one row.
  const batch = materializeResults(canvas, canvas.nodes[0], {
    id: 't2',
    media: [{ kind: 'image', url: 'a' }, { kind: 'image', url: 'b' }],
  }, ctx);
  assert.equal(batch.canvas.nodes.length, 3);
  // The distance between two results is the card's own size plus the gap, so
  // the second card cannot cover the first one.
  const step = ctx.sizes.result.width + NODE_GAP;
  assert.equal(batch.canvas.nodes[1].position.x + step, batch.canvas.nodes[2].position.x);
  assert.equal(batch.canvas.nodes[1].position.y, batch.canvas.nodes[2].position.y);
  // The first result starts next to the node it came from, not on top of it.
  assert.ok(batch.canvas.nodes[1].position.x >= canvas.nodes[0].position.x + canvas.nodes[0].width);
});

test('a change from the Agent waits for the page that holds the canvas', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '动作队列' }),
  });
  const canvas = created.body.canvas;

  // The page takes the canvas before it reads it.
  const claimed = await getJson(h.base, '/api/actions/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ canvasId: canvas.id }),
  });
  assert.equal(claimed.status, 200);

  // The Agent asks for a node.
  const asked = mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'canvas_add_node',
      arguments: { id: canvas.id, type: 'image', title: 'Agent 加的' },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  // The canvas is not written behind the page's back.
  const during = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(during.body.canvas.nodes.length, 0);

  // The page picks the action up.
  const list = await getJson(h.base, `/api/actions?canvas=${canvas.id}`);
  assert.equal(list.body.actions.length, 1);
  const action = list.body.actions[0];
  assert.equal(action.type, 'add_node');
  assert.equal(action.args.title, 'Agent 加的');

  // The page applies it with the same rule and answers.
  const applied = applyAction(during.body.canvas, action, {
    sizes: { image: { width: 320, height: 420, title: '图片' } },
  });
  assert.equal(applied.error, undefined);
  await getJson(h.base, '/api/actions/ack', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: action.id, ok: true, info: applied.info }),
  });

  const answer = toolResult(await asked);
  assert.equal(answer.appliedBy, '画布页面');
  assert.equal(answer.title, 'Agent 加的');
  // The page is still the only writer: the runtime did not touch the canvas.
  const after = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(after.body.canvas.nodes.length, 0);
});

test('with nobody looking, the runtime writes the canvas itself', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());
  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '没人看着' }),
  });
  const canvas = created.body.canvas;

  const answer = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'canvas_add_node',
      arguments: { id: canvas.id, type: 'image', title: '运行时加的' },
    },
  }));
  assert.equal(answer.appliedBy, '运行时');
  const after = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(after.body.canvas.nodes.length, 1);
  assert.equal(after.body.canvas.nodes[0].title, '运行时加的');
});

test('the writing tools change the canvas the user sees', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '写工具' }),
  });
  const canvas = created.body.canvas;

  const added = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'canvas_add_node',
      arguments: { id: canvas.id, type: 'image', title: '第一张', prompt: '一只猫' },
    },
  }));
  assert.ok(added.id);

  const second = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'canvas_add_node',
      arguments: { id: canvas.id, type: 'text', title: '文案' },
    },
  }));
  assert.ok(second.id);

  const linked = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'canvas_connect', arguments: { id: canvas.id, from: added.id, to: second.id } },
  }));
  // The line carries what the upstream makes.
  assert.equal(linked.kind, 'image');

  await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'canvas_update_node',
      arguments: { id: canvas.id, nodeId: added.id, prompt: '一只戴帽子的猫' },
    },
  });
  const changed = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(changed.body.canvas.nodes[0].metadata.prompt, '一只戴帽子的猫');
  assert.equal(changed.body.canvas.connections.length, 1);

  await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'canvas_remove_node', arguments: { id: canvas.id, nodeId: added.id } },
  });
  const removed = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(removed.body.canvas.nodes.length, 1);
  // The line to the removed node went with it.
  assert.equal(removed.body.canvas.connections.length, 0);

  // A change that cannot be made is refused, not reported as done.
  const refused = await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'canvas_connect',
      arguments: { id: canvas.id, from: 'n_missing', to: second.id },
    },
  });
  assert.equal(refused.body.result.isError, true);
});

test('the Agent can give a prompt node the H3 template', async (t) => {
  // The shape of an H3 prompt is the provider's own, and it is long: the
  // segments, the shot notation and the sound layers. Hand-writing it loses
  // them, so the Agent asks for the template by name and the node carries it.
  const h = await createHarness();
  t.after(() => h.cleanup());
  const { PROMPT_TEMPLATES } = await import('../miniapp/node/capabilities.mjs');
  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '模板' }),
  });
  const canvas = created.body.canvas;

  const added = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'canvas_add_node',
      arguments: { id: canvas.id, type: 'text', mode: 'prompt', templateId: 'h3-i2va' },
    },
  }));
  assert.ok(added.id);

  // The node that landed on the canvas carries that template's text.
  const doc = await getJson(h.base, `/api/canvases/${canvas.id}`);
  const node = doc.body.canvas.nodes[0];
  assert.equal(node.metadata.templateId, 'h3-i2va');
  assert.equal(
    node.metadata.templateText,
    PROMPT_TEMPLATES.find((item) => item.id === 'h3-i2va').text,
  );

  // And the template can be changed on a node that is already there.
  await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'canvas_update_node',
      arguments: { id: canvas.id, nodeId: added.id, templateId: 'h3-l2va' },
    },
  });
  const changed = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(changed.body.canvas.nodes[0].metadata.templateId, 'h3-l2va');
  assert.equal(
    changed.body.canvas.nodes[0].metadata.templateText,
    PROMPT_TEMPLATES.find((item) => item.id === 'h3-l2va').text,
  );
});

test('a template is a skeleton, and putting it on the canvas does not run it', async () => {
  // A template is the steps of a chain: the nodes, the lines between them
  // and the prompts they carry — and nothing of what a run leaves behind.
  const { applyTemplate, templateFromCanvas } = await import('../miniapp/client/actions.mjs');
  const { BUILTIN_TEMPLATES } = await import('../miniapp/node/templates.mjs');

  // The built-in template that reads a picture back and draws it again.
  const template = BUILTIN_TEMPLATES.find((item) => item.id === 'image-mimic');
  assert.ok(template, 'the image-mimic template is missing');

  const applied = applyTemplate({ nodes: [], connections: [] }, template, { idFor: (p) => `${p}_${Math.random().toString(36).slice(2, 8)}` });  assert.equal(applied.error, undefined);
  // Three nodes: the picture that goes in, the prompt that reads it back, and
  // the picture that is drawn again — and two lines.
  assert.equal(applied.canvas.nodes.length, 3);
  assert.equal(applied.canvas.connections.length, 2);
  assert.deepEqual(applied.canvas.nodes.map((node) => node.type), ['input', 'text', 'image']);
  // The lines point at the nodes the template made, in the order it made
  // them: the picture feeds the prompt, the prompt feeds the picture.
  assert.equal(applied.canvas.connections[0].fromNodeId, applied.canvas.nodes[0].id);
  assert.equal(applied.canvas.connections[0].toNodeId, applied.canvas.nodes[1].id);
  assert.equal(applied.canvas.connections[1].fromNodeId, applied.canvas.nodes[1].id);
  assert.equal(applied.canvas.connections[1].toNodeId, applied.canvas.nodes[2].id);
  // The nodes carry the template's own settings.
  assert.equal(applied.canvas.nodes[2].metadata.ratio, '1:1');
  assert.equal(applied.canvas.nodes[2].metadata.mode, 'text2image');
  // And nothing is run: a template puts the steps on the canvas, the user
  // decides when the first node may spend anything.
  assert.equal(applied.canvas.nodes.every((node) => node.metadata.output?.status === 'idle'), true);

  // The skeleton of a canvas: the steps, without the results and without
  // the material somebody picked.
  const skeleton = templateFromCanvas(
    {
      nodes: [
        { id: 'n_t', type: 'text', title: '文案', metadata: { prompt: '一只猫' } },
        { id: 'n_i', type: 'input', title: '原图', metadata: { kind: 'image' } },
        { id: 'n_g', type: 'image', title: '主图', metadata: { prompt: '白底', mode: 'text2image', ratio: '1:1' } },
        { id: 'n_r', type: 'result', title: '主图 · 结果', metadata: { kind: 'image' } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'n_t', toNodeId: 'n_g', kind: 'text' },
        { id: 'c2', fromNodeId: 'n_i', toNodeId: 'n_g', kind: 'image' },
        { id: 'c3', fromNodeId: 'n_g', toNodeId: 'n_r', kind: 'image' },
      ],
    },
    { id: 'own-1', title: '我的模板' },
  );
  // The result is not a step: what is left is the text node, the empty
  // input that holds the material, the picture node, and the lines between
  // them. The input node stays — it is where the material goes in — but the
  // material itself is left behind.
  assert.equal(skeleton.actions.filter((action) => action.type === 'add_node').length, 3);
  assert.equal(skeleton.actions.filter((action) => action.type === 'connect').length, 2);
  assert.equal(skeleton.actions[0].args.title, '文案');
  assert.equal(skeleton.actions[1].args.type, 'input');
  assert.equal(skeleton.actions[1].args.kind, 'image');
  assert.equal(skeleton.actions[2].args.title, '主图');
  // The lines are written by the order of the steps, so the skeleton can be
  // applied without knowing the ids.
  assert.deepEqual(skeleton.actions[3].args, { from: '@1', to: '@3' });
  assert.deepEqual(skeleton.actions[4].args, { from: '@2', to: '@3' });
  // And the skeleton can be put on a canvas: it is a template like any.
  const back = applyTemplate({ nodes: [], connections: [] }, skeleton, { idFor: (p) => `${p}_${Math.random().toString(36).slice(2, 8)}` });
  assert.equal(back.error, undefined);
  assert.equal(back.canvas.nodes.length, 3);
  assert.equal(back.canvas.connections.length, 2);
  // The input node comes out empty: the person who puts the template on their
  // board puts their own file in it.
  const input = back.canvas.nodes.find((node) => node.type === 'input');
  assert.ok(input, 'the input node did not come back');
  assert.deepEqual(input.metadata.output?.media ?? [], []);
});

test('the Agent can list the templates and put one on the canvas', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());
  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '模板' }),
  });
  const canvas = created.body.canvas;

  // The Agent can see what there is.
  const listed = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'canvas_list_templates', arguments: {} },
  }));
  assert.ok(listed.templates.length >= 5, 'the built-in templates are not listed');
  assert.ok(listed.templates.some((item) => item.id === 'image-mimic'));

  // And it can put one on the canvas.
  const applied = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'canvas_apply_template', arguments: { id: canvas.id, template: 'h3-t2va' } },
  }));
  assert.ok(applied.id, 'the template was not applied');
  const doc = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(doc.body.canvas.nodes.length, 2);
  assert.equal(doc.body.canvas.connections.length, 1);
  // And nothing is run: a template puts the steps there, the Agent runs
  // them when it wants to spend something.
  assert.equal(doc.body.canvas.nodes.every((node) => node.metadata.output?.status === 'idle'), true);

  // A template that is not there is refused, not silently ignored.
  const missing = await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'canvas_apply_template', arguments: { id: canvas.id, template: 'nope' } },
  });
  assert.equal(missing.body.result.isError, true);
});

test('a canvas can be kept as a template of its own', async (t) => {
  // The steps of a canvas can be kept, so the next one starts from a
  // chain instead of from nothing.
  const h = await createHarness();
  t.after(() => h.cleanup());
  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '我的链' }),
  });
  const canvas = created.body.canvas;
  await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...canvas,
      nodes: [
        { id: 'n_t', type: 'text', title: '文案', position: { x: 0, y: 0 }, width: 320, height: 300, metadata: { prompt: '一只猫' } },
        { id: 'n_g', type: 'image', title: '主图', position: { x: 400, y: 0 }, width: 320, height: 420, metadata: { prompt: '白底', mode: 'text2image' } },
        { id: 'n_r', type: 'result', title: '主图 · 结果', position: { x: 800, y: 0 }, width: 320, height: 420, metadata: { kind: 'image' } },
      ],
      connections: [{ id: 'c1', fromNodeId: 'n_t', toNodeId: 'n_g', kind: 'text' }],
    }),
  });

  const saved = await getJson(h.base, '/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'own-test', title: '我的链 的模板', canvasId: canvas.id }),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.template.steps, 3);

  // It is there afterwards, and the Agent can see it too.
  const listed = await getJson(h.base, '/api/templates');
  const own = listed.body.templates.find((item) => item.id === 'own-test');
  assert.ok(own, 'the template of the user was not kept');
  assert.equal(own.own, true);
  assert.equal(own.title, '我的链 的模板');
});

test('a template travels in a file, and lands the same way on another machine', async () => {
  const { applyTemplate, readTemplateFile, templateFile, templateFromCanvas } = await import('../miniapp/client/actions.mjs');

  // The file says what it is, and carries the steps and nothing else.
  const skeleton = templateFromCanvas(
    {
      nodes: [
        { id: 'n_t', type: 'text', title: '文案', metadata: { prompt: '一只猫' } },
        { id: 'n_g', type: 'image', title: '主图', metadata: { prompt: '白底', mode: 'text2image', ratio: '1:1' } },
        { id: 'n_r', type: 'result', title: '主图 · 结果', metadata: { kind: 'image' } },
      ],
      connections: [{ id: 'c1', fromNodeId: 'n_t', toNodeId: 'n_g', kind: 'text' }],
    },
    { id: 'own-1', title: '我的模板' },
  );
  const file = templateFile({ id: skeleton.id, title: skeleton.title, actions: skeleton.actions });
  assert.equal(file.kind, 'ai-node-canvas-template');
  assert.equal(file.steps, 3);
  // Only the steps are in the file: a result is not a step.
  assert.deepEqual([...new Set(file.actions.map((action) => action.type))].sort(), ['add_node', 'connect']);

  // Another machine reads it with the one rule that reads a template.
  const read = readTemplateFile(JSON.stringify(file));
  assert.equal(read.ok, true);
  assert.equal(read.template.title, '我的模板');
  assert.equal(read.template.actions.length, 3);

  // And it lands on the canvas exactly as the skeleton would.
  const ids = () => {
    let n = 0;
    return (prefix) => `${prefix}_${(n += 1)}`;
  };
  const here = applyTemplate({ nodes: [], connections: [] }, skeleton, { idFor: ids() });
  const there = applyTemplate({ nodes: [], connections: [] }, read.template, { idFor: ids() });
  assert.equal(here.error, undefined);
  assert.equal(there.error, undefined);
  assert.equal(there.canvas.nodes.length, here.canvas.nodes.length);
  assert.equal(there.canvas.connections.length, here.canvas.connections.length);
  assert.deepEqual(there.canvas.nodes.map((node) => node.type), here.canvas.nodes.map((node) => node.type));
  assert.equal(there.canvas.nodes[1].metadata.ratio, '1:1');
  assert.equal(there.canvas.nodes[1].metadata.mode, 'text2image');
});

test('a file that is not a template is refused, and says why', async () => {
  const { readTemplateFile } = await import('../miniapp/client/actions.mjs');
  // Not JSON at all.
  const broken = readTemplateFile('这不是 JSON');
  assert.equal(broken.ok, false);
  assert.match(broken.error, /JSON/);
  // JSON, but something else entirely.
  const other = readTemplateFile(JSON.stringify({ kind: 'something-else', actions: [{ type: 'add_node', args: {} }] }));
  assert.equal(other.ok, false);
  assert.match(other.error, /模板/);
  // A template with no steps in it.
  const empty = readTemplateFile(JSON.stringify({ kind: 'ai-node-canvas-template', actions: [] }));
  assert.equal(empty.ok, false);
  assert.match(empty.error, /步骤/);
  // A step that is neither a node nor a line.
  const odd = readTemplateFile(JSON.stringify({ kind: 'ai-node-canvas-template', actions: [{ type: 'drop_everything', args: {} }] }));
  assert.equal(odd.ok, false);
  assert.match(odd.error, /连线/);
  // A file from a newer canvas than this one.
  const future = readTemplateFile(JSON.stringify({ kind: 'ai-node-canvas-template', version: 99, actions: [{ type: 'add_node', args: { type: 'image' } }] }));
  assert.equal(future.ok, false);
  assert.match(future.error, /版本/);
});

test('a template that came from another machine is kept on this one', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());
  const { templateFile } = await import('../miniapp/client/actions.mjs');

  const file = templateFile({
    id: 'from-another-machine',
    title: '别处的链',
    description: '另一台机器上做的',
    actions: [
      { type: 'add_node', args: { type: 'text', title: '文案', prompt: '一只猫' } },
      { type: 'add_node', args: { type: 'image', title: '主图', mode: 'text2image', ratio: '1:1' } },
      { type: 'connect', args: { from: '@1', to: '@2' } },
    ],
  });

  // The steps come with the file, so they are kept as they are.
  const saved = await getJson(h.base, '/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'own-imported-1',
      title: file.title,
      description: file.description,
      actions: file.actions,
    }),
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.template.steps, 3);

  // It is in the list, with its steps — so it can be put on the canvas again.
  const listed = await getJson(h.base, '/api/templates');
  const own = listed.body.templates.find((item) => item.id === 'own-imported-1');
  assert.ok(own, 'the imported template was not kept');
  assert.equal(own.own, true);
  assert.equal(own.title, '别处的链');
  assert.equal(own.actions.length, 3);
  assert.equal(own.actions[2].args.from, '@1');
});

test('the toolbar has one template button, and it opens the one menu', async () => {
  // Two ways in and two ways out, and they all live in one menu: the toolbar
  // carries a single button, so nothing about a template is spread over the
  // page.
  const html = await readFile(fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url)), 'utf8');
  assert.match(html, /id="btn-templates"[^>]*>模板</);
  assert.doesNotMatch(html, /id="btn-export"/);
  assert.doesNotMatch(html, /id="btn-import"/);
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.match(source, /function saveTemplateToLocal\(\)/);
  assert.match(source, /function openTemplatePanel\(/);
  assert.match(source, /function openTemplateInNewCanvas\(/);
  // The file reaches the page through a control that is in the page.
  assert.match(source, /const input = el\('input'\);\s*\n\s*input\.type = 'file'/);
});

test('the template menu has two ways in and two ways out', async () => {
  // **In**: 我的模板 (the ones the user kept) and 打开本地模板 (a file on this
  // machine). **Out**: 保存为我的模板 and 保存到本地. Nothing else: a folder to
  // look in, a button that keeps a file, and a second way to pick a file were
  // three ways to say the same thing.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  const panel = source.match(/async function openTemplatePanel\([\s\S]*?\n  }\n/)?.[0] ?? '';
  assert.ok(panel, 'the template menu is gone');
  assert.match(panel, /renderTemplateGroups/);
  assert.match(panel, /el\('span', null, '打开本地模板'\)/);
  assert.match(panel, /el\('span', null, '保存为我的模板'\)/);
  assert.match(panel, /el\('span', null, '保存到本地'\)/);
  // And the ways that were too many are gone.
  assert.doesNotMatch(panel, /本机文件夹里的模板/);
  assert.doesNotMatch(panel, /在这个文件夹里找/);
  assert.doesNotMatch(source, /nxc-panel__keep/);
  assert.doesNotMatch(source, /listDownloadsFiles/);
  assert.doesNotMatch(source, /api\/templates\/files/);
  assert.match(source, /function templateGroups\(templates\)/);
});

test('a template that is opened gets a canvas of its own', async () => {
  // The canvas that is open now is a piece of work in progress. A chain that
  // is picked in the import panel is a new piece of work, and it gets a
  // canvas of its own — the current one is left alone.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.match(source, /async function openTemplateInNewCanvas\(template\) \{[\s\S]*?createCanvas\(/);
  assert.match(source, /createCanvas\(`\$\{template\.title \|\| '新画布'\}`, \{ askName: false \}\)/);
  // The name of the canvas is the name of the template: there is nothing to
  // ask, because the template already carries one.
  assert.match(source, /if \(askName\) startRename\(/);
  // An empty canvas is used as it is: there is nothing on it to lose, and a
  // second empty canvas would only be clutter. A canvas that is not open yet
  // is not a canvas at all — it would have nowhere to be written.
  assert.match(source, /const empty = Boolean\(state\.canvas\?\.id\) && !\(state\.canvas\?\.nodes\?\.length\);/);
});

test('the canvas saves itself, so the toolbar has no save button', async () => {
  // The canvas is a workbench, not something that is written by hand: a
  // change is written down by itself a moment later, and the state beside
  // the canvas name says whether it happened. A button that does it by hand
  // would only be a second way to do what the page already does.
  const html = await readFile(fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url)), 'utf8');
  assert.doesNotMatch(html, /id="btn-save"/);
  // The state is next to the canvas it talks about.
  assert.match(html, /id="save-state"/);
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  // A change schedules the writing of the canvas.
  assert.match(source, /const AUTOSAVE_MS = \d+;/);
  assert.match(source, /function markDirty\(/);
  assert.match(source, /window\.setTimeout\(\(\) => \{\s*\n\s*void saveCanvas\(\);/);
  // And a window that goes away takes the draft with it, so a change made
  // between the timer and the close is not lost.
  assert.match(source, /window\.addEventListener\('pagehide', \(\) => \{[^}]*saveDraft\(\);/);
  assert.match(source, /document\.addEventListener\('visibilitychange', \(\) => \{[^}]*saveDraft\(\);/);
});

test('the panel of the templates holds templates only', async () => {
  // The whole canvas is not a thing that travels: what a run left behind is
  // in the library, and the steps travel as a template. So the panel does not
  // offer a copy of the canvas any more.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /导出画布/);
  assert.doesNotMatch(source, /导入画布/);
  assert.doesNotMatch(source, /function exportCanvasFile\(/);
  assert.doesNotMatch(source, /function importCanvasFile\(/);
  // What it does hold: the chains of the user, the ready-made ones, and the
  // way to make one of the canvas.
  assert.match(source, /把当前画布存成模板|保存为我的模板/);
  assert.match(source, /我的模板/);
  // The ready-made ones are told apart by the group they carry.
  assert.match(source, /function templateGroups\(templates\)/);
});

test('the ready-made templates cover the ways a chain starts', async () => {
  // The templates that ship with the MiniApp are the ways a chain can start:
  // from words, from material, or from the H3 shapes — and the two that read
  // a clip back and imitate it.
  const { BUILTIN_TEMPLATES } = await import('../miniapp/node/templates.mjs');
  const byId = new Map(BUILTIN_TEMPLATES.map((item) => [item.id, item]));
  // The H3 shapes, one for each way the request can carry a picture.
  for (const [id, mode] of [
    ['h3-t2va', 'text2video'],
    ['h3-i2va', 'imagekey2video'],
    ['h3-fl2va', 'imagefl2video'],
    ['h3-l2va', 'imageend2video'],
    ['h3-reference', 'image2video'],
  ]) {
    const template = byId.get(id);
    assert.ok(template, `the ${id} template is missing`);
    const video = template.actions.find((action) => action.type === 'add_node' && action.args.type === 'video');
    assert.ok(video, `the ${id} template has no video node`);
    assert.equal(video.args.mode, mode);
    assert.equal(video.args.model, 'MiniMax-H3');
    // The structure of H3 is written by a prompt node that carries the
    // template of that shape — the runtime adds the line that names the
    // picture.
    const prompt = template.actions.find((action) => action.type === 'add_node' && action.args.type === 'text');
    assert.ok(prompt, `the ${id} template has no prompt node`);
    assert.equal(prompt.args.mode, 'prompt');
    assert.equal(prompt.args.templateId, id);
  }
  // The full reference is the one shape that takes everything H3 can read, so
  // the template leaves a slot for a picture, a clip and a sound. What is
  // empty is simply not in the request.
  const reference = byId.get('h3-reference');
  const slots = reference.actions
    .filter((action) => action.type === 'add_node' && action.args.type === 'input')
    .map((action) => action.args.kind);
  assert.deepEqual(slots, ['image', 'video', 'audio']);
  // And every one of them is wired to the reference node.
  const wires = reference.actions.filter((action) => action.type === 'connect');
  assert.equal(wires.length, 4);
  // The two that imitate: the picture and the clip are read back into a
  // prompt, and the prompt is what is generated from.
  for (const [id, mode, read] of [
    ['image-mimic', 'text2image', 'describe'],
    ['video-mimic', 'text2video', 'video2text'],
  ]) {
    const template = byId.get(id);
    assert.ok(template, `the ${id} template is missing`);
    const reverse = template.actions.find((action) => action.type === 'add_node' && action.args.mode === read);
    assert.ok(reverse, `the ${id} template does not read the material back`);
    const out = template.actions.find((action) => action.type === 'add_node' && action.args.mode === mode);
    assert.ok(out, `the ${id} template does not generate anything`);
  }
  // The picture is read back and drawn again: the picture feeds the prompt,
  // and the prompt feeds the picture that is drawn.
  const picture = byId.get('image-mimic');
  const pictureLines = picture.actions.filter((action) => action.type === 'connect');
  assert.equal(pictureLines.length, 2);
  assert.equal(pictureLines[1].args.to, '@3');
  // The clip is read back, and what was read back is written into the shape
  // H3 expects before the clip is made again.
  const clip = byId.get('video-mimic');
  const clipLines = clip.actions.filter((action) => action.type === 'connect');
  assert.equal(clipLines.length, 3);
  assert.equal(clipLines[2].args.to, '@4');
  // Every template is a group of its own, so the panel can tell them apart.
  for (const template of BUILTIN_TEMPLATES) {
    assert.ok(template.group, `the ${template.id} template has no group`);
  }
  // The ready-made ones are the ones the user kept and tuned: two that
  // imitate a piece of material and the five shapes H3 can be asked for.
  assert.equal(BUILTIN_TEMPLATES.length, 7);
  assert.deepEqual(
    BUILTIN_TEMPLATES.map((item) => item.id),
    ['image-mimic', 'video-mimic', 'h3-t2va', 'h3-i2va', 'h3-fl2va', 'h3-l2va', 'h3-reference'],
  );
});

test('a change that quietly does nothing is refused instead', async () => {
  // A mode the node does not have is not set on it — and it is said, because a
  // change that quietly did nothing is a change the caller believes it made.
  const { applyAction } = await import('../miniapp/client/actions.mjs');
  const canvas = {
    nodes: [{ id: 'n_img', type: 'image', title: '图', position: { x: 0, y: 0 }, metadata: {} }],
    connections: [],
  };
  const wrong = applyAction(canvas, { type: 'update_node', args: { id: 'n_img', mode: 'music' } }, {});
  assert.ok(wrong.error, '一个节点没有的模式被悄悄忽略了');
  assert.match(wrong.error, /music/);
  // And the node keeps the mode it had.
  assert.equal(wrong.canvas.nodes[0].metadata.mode, undefined);
  // A mode the node does have is set.
  const right = applyAction(canvas, { type: 'update_node', args: { id: 'n_img', mode: 'image2image' } }, {});
  assert.equal(right.error, undefined);
  assert.equal(right.canvas.nodes[0].metadata.mode, 'image2image');
});

test('the tool enforces the schema the Agent read', async () => {
  // The schema is what the Agent reads, so it has to be what the tool
  // enforces: a missing argument, a value outside an enumeration and an
  // argument that is not in the schema are all refused.
  const { checkArgs } = await import('../miniapp/node/mcp.mjs');
  const schema = {
    type: 'object',
    properties: { type: { type: 'string', enum: ['text', 'image'] } },
    required: ['type'],
    additionalProperties: false,
  };
  assert.deepEqual(checkArgs(schema, { type: 'text' }), []);
  assert.ok(checkArgs(schema, {}).some((problem) => problem.includes('type')), '少参数没有被拒');
  assert.ok(checkArgs(schema, { type: 'music' }).some((problem) => problem.includes('music')), '越界的值没有被拒');
  assert.ok(checkArgs(schema, { type: 'text', nope: 1 }).some((problem) => problem.includes('nope')), '不认识的参数没有被拒');
});

test('a template cannot take anything away', async () => {
  // A template is the skeleton of a chain: it makes nodes and draws the lines
  // between them. A step that removes something is not a step of a chain, and
  // a template that could would tidy up the canvas it was dropped on.
  const { applyTemplate } = await import('../miniapp/client/actions.mjs');
  const canvas = {
    nodes: [{ id: 'n_keep', type: 'text', title: '留着', position: { x: 0, y: 0 }, metadata: {} }],
    connections: [],
  };
  const bad = applyTemplate(canvas, {
    id: 't',
    title: '坏的',
    actions: [
      { type: 'add_node', args: { type: 'text', title: '新' } },
      { type: 'remove_node', args: { id: 'n_keep' } },
    ],
  }, { idFor: () => 'n_new' });
  assert.ok(bad.error, '模板能删节点');
  assert.match(bad.error, /remove_node/);
  // And the whole template is refused: the node it made is not on the canvas
  // either.
  assert.equal(bad.canvas.nodes.length, 1);
  // A line that does not point at the template's own nodes is refused too.
  const stray = applyTemplate(canvas, {
    id: 't2',
    title: '乱指',
    actions: [{ type: 'connect', args: { from: 'n_keep', to: '@1' } }],
  }, { idFor: () => 'n_new' });
  assert.ok(stray.error, '模板的线可以指向别人的节点');
});

test('a named port is a slot of its own', async () => {
  // The first frame and the last frame are two slots, not one slot twice: a
  // line that asks for the first frame cannot land on it when it is taken.
  const { planPort } = await import('../miniapp/client/actions.mjs');
  const node = { id: 'n_v', type: 'video', title: '片', metadata: { mode: 'imagefl2video' } };
  const picture = (id) => ({
    id,
    type: 'input',
    title: '图',
    position: { x: 0, y: 0 },
    metadata: { kind: 'image', output: { media: [{ kind: 'image', url: `/uploads/${id}.png` }] } },
  });
  const one = { nodes: [node, picture('n_a')], connections: [{ id: 'c1', fromNodeId: 'n_a', toNodeId: 'n_v', kind: 'image' }] };
  // The line that is there took the first frame, so a second line cannot ask
  // for the first frame as well.
  const first = planPort(one, node, 'image', 'first');
  assert.equal(first.ok, false, '首帧口已经接上了，还能再接一条');
  assert.match(first.reason, /已经接上/);
  // The last frame is a slot of its own, and it is free.
  const last = planPort(one, node, 'image', 'last');
  assert.equal(last.ok, true);
  assert.equal(last.role, 'last');
  // Both picture ports are taken: a third line has nowhere to land.
  const both = {
    nodes: [node, picture('n_a'), picture('n_b')],
    connections: [
      { id: 'c1', fromNodeId: 'n_a', toNodeId: 'n_v', kind: 'image' },
      { id: 'c2', fromNodeId: 'n_b', toNodeId: 'n_v', kind: 'image' },
    ],
  };
  const again = planPort(both, node, 'image', 'first');
  assert.equal(again.ok, false, '两个口都占满了，还能再接一条');
  assert.match(again.reason, /已经接上/);
});

test('a run the page did not answer is not on its way, and a busy node says why', async () => {
  // A run is not repeated: it costs money, and the runtime never sends it
  // twice. So a run the page did not answer is not "queued" — it may never
  // have started, and the one who asked is told that instead of being told
  // it is on its way.
  const queue = await readFile(fileURLToPath(new URL('../miniapp/node/action-queue.mjs', import.meta.url)), 'utf8');
  assert.match(queue, /const isRun = action\?\.type === 'run';/);
  assert.match(queue, /没有确认开始/);
  // And a node that is busy says so, instead of being marked as failed: it
  // is not an error, it is another run that is on it.
  const app = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.match(app, /node\.metadata\.output\.notice = String\(error\?\.message \?\? error\);/);
  assert.match(app, /node\.metadata\.output\?\.notice \|\| node\.metadata\.output\?\.error/);
});

test('the ready-made templates are files, so one can be read and changed', async () => {
  const { BUILTIN_TEMPLATES } = await import('../miniapp/node/templates.mjs');
  const source = await readFile(fileURLToPath(new URL('../miniapp/node/templates.mjs', import.meta.url)), 'utf8');
  assert.match(source, /readdirSync/);
  assert.match(source, /'\.\.', 'templates'/);
  // And every file in the folder is a template that says what it is.
  const dir = fileURLToPath(new URL('../miniapp/templates/', import.meta.url));
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  assert.equal(names.length, 7, 'the folder of the ready-made templates does not hold seven files');
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(dir, name), 'utf8'));
    assert.ok(parsed.id, `${name} has no id`);
    assert.ok(parsed.title, `${name} has no title`);
    assert.ok(parsed.group, `${name} has no group`);
    assert.ok(parsed.description, `${name} has no description`);
    assert.ok(Array.isArray(parsed.actions) && parsed.actions.length, `${name} has no steps`);
  }
  // And the templates that are read are the ones in the folder.
  assert.equal(BUILTIN_TEMPLATES.length, names.length);
});

test('the group of a template reaches the panel', async (t) => {
  // The panel tells the ready-made templates apart by the group they carry,
  // so the group has to come with them.
  const h = await createHarness();
  t.after(() => h.cleanup());
  const listed = await getJson(h.base, '/api/templates');
  assert.equal(listed.status, 200);
  const groups = new Set(listed.body.templates.map((item) => item.group).filter(Boolean));
  assert.ok(groups.size >= 2, `the templates carry ${groups.size} groups`);
  for (const label of ['从素材出发', 'H3']) {
    assert.ok(groups.has(label), `the group ${label} did not reach the panel`);
  }
});

test('the page says what deleting a canvas takes away, and how to keep it', async () => {
  // Deleting the canvas takes the steps with it. The page says so, and it
  // names the two ways of keeping the work: a template and a local copy of a
  // result.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  const warning = source.match(/`([^`]*确定删除画布[^`]*)`/)?.[1] ?? '';
  assert.match(warning, /确定删除画布/);
  assert.match(warning, /存成模板/);
  assert.match(warning, /资产库/);
});

test('a template of the user can be taken away again', async (t) => {
  // A template the user kept is theirs: they can take it away. The
  // ready-made ones are not — they belong to the package.
  const h = await createHarness();
  t.after(() => h.cleanup());
  const saved = await getJson(h.base, '/api/templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'own-to-delete',
      title: '要删掉的模板',
      actions: [{ type: 'add_node', args: { type: 'image', title: '主图', mode: 'text2image' } }],
    }),
  });
  assert.equal(saved.status, 200);

  const listed = await getJson(h.base, '/api/templates');
  assert.ok(listed.body.templates.some((item) => item.id === 'own-to-delete'));

  const removed = await getJson(h.base, '/api/templates/own-to-delete', { method: 'DELETE' });
  assert.equal(removed.status, 200);
  const after = await getJson(h.base, '/api/templates');
  assert.equal(after.body.templates.some((item) => item.id === 'own-to-delete'), false);

  // A name that walks out of the template folder is refused — and the file it
  // points at is still there.
  const { removeTemplate } = await import('../miniapp/node/templates.mjs');
  const outside = join(h.dataDir, 'canvas.json');
  await writeFile(outside, '{}', 'utf8');
  assert.equal(await removeTemplate(h.dataDir, '../canvas'), false);
  assert.equal(await readFile(outside, 'utf8'), '{}');
  const escape = await getJson(h.base, '/api/templates/..%2F..%2Fcanvas', { method: 'DELETE' });
  assert.equal(escape.status, 404);

  // And the page asks in itself before it takes one away.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.match(source, /确定删掉模板/);
  assert.match(source, /method: 'DELETE'/);
});

test('a shared file is written by the runtime, not by the browser', async () => {
  // A download the browser starts inside the host never arrives under the name
  // it was given: the file stays a temporary name in the Downloads folder. So
  // the runtime writes the file and says where it went.
  const { createMediaStore } = await import('../miniapp/node/media-store.mjs');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const target = await mkdtemp(join(tmpdir(), 'nxc-downloads-'));
  const store = createMediaStore({ dataDir: await mkdtemp(join(tmpdir(), 'nxc-assets-')) });

  const saved = await store.writeToFolder('耳机.模板.json', '{"kind":"ai-node-canvas-template"}', target);
  assert.equal(saved.ok, true);
  assert.equal(saved.name, '耳机.模板.json');
  assert.equal(saved.path.startsWith(target), true);

  // The file is there, under the name it was given.
  const written = await readFile(saved.path, 'utf8');
  assert.match(written, /ai-node-canvas-template/);

  // A name that walks out of the folder is refused, not tidied up.
  const escape = await store.writeToFolder('../逃出去.json', '{}', target);
  assert.equal(escape.ok, false);
  assert.equal(escape.reason, 'bad_name');
});

test('a template file is read by the one rule that reads a template', async () => {
  // A local template is opened by the user, one file at a time: the file is
  // read by the same rule that reads a template that came from elsewhere, so
  // a file that is something else is refused instead of being poured onto
  // the canvas.
  const { readTemplateFile, templateFile } = await import('../miniapp/client/actions.mjs');
  const document = templateFile({
    id: 'from-another-machine',
    title: '别处的链',
    actions: [
      { type: 'add_node', args: { type: 'image', title: '主图', mode: 'text2image' } },
      { type: 'connect', args: { from: '@1', to: '@1' } },
    ],
  });
  const read = readTemplateFile(JSON.stringify(document));
  assert.equal(read.ok, true);
  assert.equal(read.template.title, '别处的链');
  assert.equal(read.template.actions.length, 2);

  // A file that is something else entirely.
  const other = readTemplateFile(JSON.stringify({ hello: 'world' }));
  assert.equal(other.ok, false);
  // And a file that says it is something else, even if it carries steps.
  const wrongKind = readTemplateFile(JSON.stringify({
    kind: 'something-else',
    actions: [{ type: 'add_node', args: { type: 'image' } }],
  }));
  assert.equal(wrongKind.ok, false);
});

test('the templates of this machine are found, and a file that is not one is not offered', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { templateFile } = await import('../miniapp/client/actions.mjs');

  // A folder of our own: the test does not put anything in the user's own
  // folder, and it does not move the home directory of the machine either.
  const folder = await mkdtemp(join(tmpdir(), 'nxc-places-'));

  // A template somebody sent to this machine.
  const document = templateFile({
    id: 'from-another-machine',
    title: '别处的链',
    actions: [
      { type: 'add_node', args: { type: 'image', title: '主图', mode: 'text2image' } },
      { type: 'connect', args: { from: '@1', to: '@1' } },
    ],
  });
  await writeFile(join(folder, '别处的链.模板.json'), JSON.stringify(document), 'utf8');
  // And a file that is something else entirely.
  await writeFile(join(folder, '随便.json'), JSON.stringify({ hello: 'world' }), 'utf8');

  // The file the page shares is written by the runtime, under the name it
  // was given and in the folder it was pointed at.
  const exported = await getJson(h.base, '/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: join(folder, '我的链.模板.json'), document }),
  });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.ok, true);
  assert.equal(exported.body.name, '我的链.模板.json');
  assert.equal(exported.body.path.startsWith(folder), true);
  const onDisk = JSON.parse(await readFile(exported.body.path, 'utf8'));
  assert.equal(onDisk.kind, 'ai-node-canvas-template');
  assert.equal(onDisk.actions.length, 2);

  // A folder that is not there is refused, not guessed at.
  const bad = await getJson(h.base, '/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: join(folder, '没有这个文件夹', '链.模板.json'), document }),
  });
  assert.equal(bad.status, 400);
  // And a path that is not a full path is refused too.
  const relative = await getJson(h.base, '/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '链.模板.json', document }),
  });
  assert.equal(relative.status, 400);
  // And a file with nothing in it is refused too.
  const empty = await getJson(h.base, '/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: join(folder, '空的.json') }),
  });
  assert.equal(empty.status, 400);
});

test('the page asks in itself: a native dialog never reaches the screen', async () => {
  // A native prompt() or confirm() is a separate OS window. Inside the
  // MiniApp host it never shows, so the button that used it looked as if it
  // did nothing — 新建 and 删除 were both mute.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /window\.(prompt|confirm|alert)\(/);
  // The name is typed into the page instead, and the question is drawn there.
  const html = await readFile(fileURLToPath(new URL('../miniapp/client/index.html', import.meta.url)), 'utf8');
  assert.match(html, /id="canvas-rename"/);
  assert.match(html, /id="confirm-dialog"/);
  // And the new canvas gets a name of its own without anyone being asked.
  assert.match(source, /function nextCanvasTitle\(\)/);
  assert.match(source, /startRename\(state\.canvas\.title \|\| title\)/);
});

test('the Agent can ask for a run, and the result lands on the canvas', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '跑一次' }),
  });
  const canvas = created.body.canvas;
  await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...canvas,
      nodes: [
        {
          id: 'n_img',
          type: 'image',
          title: '一张图',
          position: { x: 0, y: 0 },
          width: 320,
          height: 420,
          metadata: { prompt: '一只猫' },
        },
      ],
      connections: [],
    }),
  });

  const answer = toolResult(await mcpCall(h.base, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'canvas_run', arguments: { id: canvas.id, nodeId: 'n_img' } },
  }));
  assert.equal(answer.status, 'started');
  assert.ok(answer.runId);

  // The result becomes a node of its own, without anybody touching the page.
  let canvasNow = null;
  for (let i = 0; i < 80; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    canvasNow = (await getJson(h.base, `/api/canvases/${canvas.id}`)).body.canvas;
    if (canvasNow.nodes.length > 1) break;
  }
  assert.equal(canvasNow.nodes.length, 2);
  assert.equal(canvasNow.nodes[1].type, 'result');
  assert.equal(canvasNow.connections.length, 1);
});

test('a page that goes quiet keeps the canvas its own', async () => {
  // A page in a background tab has its timers throttled by the browser, so it
  // may not answer for a while. The canvas is still its own: the runtime must
  // not write it, or the page would hold a copy that is suddenly old and its
  // next save would be refused.
  const saved = [];
  const canvas = { id: 'cv_1', title: '安静的页面', nodes: [], connections: [] };
  const store = {
    get: async () => canvas,
    save: async (doc) => { saved.push(doc); return { ...doc, updatedAt: 'now' }; },
    list: async () => [canvas],
  };
  const runner = {
    modelCatalog: async () => ({ items: [], defaultKey: null }),
    startRun: async () => ({ id: 'run_1' }),
    get: () => null,
  };
  const queue = createActionQueue({ store, runner, ackTimeoutMs: 150 });
  await queue.claim('cv_1');
  const result = await queue.deliver('cv_1', { type: 'add_node', args: { type: 'image', title: '排队的改动' } });
  assert.equal(result.appliedBy, 'page');
  assert.equal(result.ok, true);
  assert.equal(result.info.queued, true);
  // The runtime did not write the canvas behind the page's back.
  assert.equal(saved.length, 0);
  // The change is still in the queue: the page applies it when it wakes up.
  const pending = queue.pending('cv_1');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].type, 'add_node');

  // Without a page, the very same change is written by the runtime.
  const alone = createActionQueue({ store, runner, ackTimeoutMs: 150 });
  const written = await alone.deliver('cv_1', { type: 'add_node', args: { type: 'image', title: '运行时写的' } });
  assert.equal(written.appliedBy, 'runtime');
  assert.equal(written.ok, true);
  assert.equal(saved.length, 1);
});

test('a claim outlives the throttling of a tab the user does not look at', () => {
  // A browser throttles the timers of a hidden tab down to once a minute. The
  // claim is refreshed by that heartbeat, so it has to live longer than the
  // throttle — otherwise the runtime writes a canvas the page still holds.
  assert.ok(
    OWNER_TTL_MS >= 60_000,
    'the claim has to outlive the one-minute throttling of a hidden tab',
  );
});
test('the menu offers the kinds of node, and a mode is a choice on the card', async () => {
  const { NODE_KINDS, modesOf, modeOf, runModeOf } = await import('../miniapp/client/forms.mjs');

  // Eight kinds and the frame around them: an input of each kind and a
  // generating node of each kind.
  assert.equal(NODE_KINDS.length, 9);
  assert.deepEqual(
    NODE_KINDS.filter((entry) => entry.role === 'input').map((entry) => entry.kind),
    ['text', 'image', 'video', 'audio'],
  );
  assert.deepEqual(
    NODE_KINDS.filter((entry) => entry.role === 'generate').map((entry) => entry.kind),
    ['text', 'image', 'video', 'audio'],
  );
  // A mode is a choice on the card, and every generating node has one.
  assert.deepEqual(modesOf({ type: 'text', metadata: {} }).map((mode) => mode.id), ['generate', 'prompt', 'describe', 'video2text']);
  assert.deepEqual(modesOf({ type: 'audio', metadata: {} }).map((mode) => mode.id), ['speech', 'music']);
  assert.deepEqual(modesOf({ type: 'image', metadata: {} }).map((mode) => mode.id), ['text2image', 'image2image']);
  assert.deepEqual(modesOf({ type: 'video', metadata: {} }).map((mode) => mode.id), ['text2video', 'imagekey2video', 'imagefl2video', 'imageend2video', 'image2video']);
  // The mode a node is in, and the way it runs.
  assert.equal(modeOf({ type: 'text', metadata: { mode: 'prompt' } }), 'prompt');
  assert.equal(modeOf({ type: 'text', metadata: {} }), 'generate');
  assert.equal(modeOf({ type: 'audio', metadata: { mode: 'music' } }), 'music');
  assert.equal(modeOf({ type: 'image', metadata: { mode: 'image2image' } }), 'image2image');
  assert.equal(runModeOf({ type: 'audio', metadata: { mode: 'music' } }), 'music');
  assert.equal(runModeOf({ type: 'audio', metadata: { mode: 'speech' } }), 'audio');
  assert.equal(runModeOf({ type: 'text', metadata: { mode: 'prompt' } }), 'text');
  // The way it runs is still the path the provider takes: a mode does not
  // change it, except for the audio node in its music mode.
  assert.equal(runModeOf({ type: 'image', metadata: { mode: 'image2image' } }), 'image');

  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  const rules = await readFile(
    fileURLToPath(new URL('../miniapp/client/actions.mjs', import.meta.url)),
    'utf8',
  );
  // The menu is built from that table, and it does not carry the raw type key
  // any more: the card never shows that either.
  assert.match(source, /const KIND_ORDER = NODE_KINDS;/);
  assert.doesNotMatch(source, /新建\$\{KIND_LABEL\[kind\]\}节点/);
  // And the ports follow the mode and the model. A node with a text box takes
  // its text in the box, so the text has no port of its own; and a kind the
  // model cannot take has no port either, because the run would refuse it.
  assert.match(source, /const ports = portList\(node, caps\);/);
  // The modes follow the model as well: only MiniMax-H3 can continue a video.
  assert.match(source, /const modes = modesFor\(node, caps\);/);
  // Which line may land on which node is one rule, and it lives in the shared
  // action layer: the page asks it, and does not answer the question again on
  // its own. A line of a kind the mode does not take moves the node to the mode
  // that takes it, and a kind no mode takes is refused with a reason.
  assert.match(rules, /export function planIncoming\(canvas, node, kind\)/);
  // A mode takes a kind when it declares a port for it.
  assert.match(rules, /const takes = \(mode\) => \(mode\.ports \?\? \[\]\)\.some\(\(port\) => port\.kind === kind\);/);
  assert.match(rules, /这个节点现在不接\$\{kindLabel\(kind\)\}/);
  assert.match(rules, /export function linesDroppedByMode\(canvas, node, modeId\)/);
  // The page has no second copy of the rule.
  assert.doesNotMatch(source, /modes\.find\(\(mode\) => wanted\.every/);
  assert.match(source, /const plan = planIncoming\(state\.canvas, target, kind\);/);
  // Picking a mode takes the lines the new mode does not take with it. The
  // page sends the same action the Agent sends, so the rule lives in the
  // shared action layer.
  assert.match(rules, /dropped = linesDroppedByMode\(doc, next, args\.mode\);/);
  assert.match(source, /type: 'update_node', args: \{ id: node\.id, mode: value \}/);
  // And every line on the page is drawn through one door: the one that asks
  // the shared rule first. A second place that pushes a connection would be a
  // line that skipped the rule.
  const pushes = source.match(/state\.canvas\.connections\.push/g) ?? [];
  assert.equal(pushes.length, 1);
  assert.match(
    source,
    /state\.canvas\.connections\.push\(\{ id: uid\('c'\), fromNodeId: fromId, toNodeId: toId, kind, role \}\);/,
  );
  // A batch draws its lines quietly and redraws the board once, instead of
  // rebuilding it for every piece.
  assert.match(source, /connect\(node\.id, child\.id, kindOf\(node\), \{ quiet: true \}\);/);
});

test('a ratio says which way the frame lies', async () => {
  const { ratioLabel } = await import('../miniapp/client/forms.mjs');
  // A wide frame, a tall one, and the square in between.
  assert.equal(ratioLabel('16:9'), '16:9 横屏');
  assert.equal(ratioLabel('21:9'), '21:9 横屏');
  assert.equal(ratioLabel('9:16'), '9:16 竖屏');
  assert.equal(ratioLabel('3:4'), '3:4 竖屏');
  assert.equal(ratioLabel('1:1'), '1:1 方形');
  // The video's own ratio is not a frame at all.
  assert.equal(ratioLabel('adaptive'), '自适应');
  // Something that is not a ratio keeps its own name.
  assert.equal(ratioLabel('whatever'), 'whatever');
  assert.equal(ratioLabel(''), '');

  // And the menu uses it: the label grows, the value stays the ratio the
  // provider takes.
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  assert.match(source, /label: ratioLabel\(ratio\),/);
});

test('the modes that were two are one, and an old canvas lands on the one that is left', async (t) => {
  const { currentModeId, modeOf, modesOf } = await import('../miniapp/client/forms.mjs');

  // 图生图 and 图文生图 were one request to the provider all along: a prompt
  // plus reference images. The text is the card's text box now, so it has no
  // port of its own — the two modes only ever drew the same card.
  assert.deepEqual(
    modesOf({ type: 'image', metadata: {} }).map((mode) => mode.id),
    ['text2image', 'image2image'],
  );
  // The video node had the same pair, for the same reason.
  assert.deepEqual(
    modesOf({ type: 'video', metadata: {} }).map((mode) => mode.id),
    ['text2video', 'imagekey2video', 'imagefl2video', 'imageend2video', 'image2video'],
  );
  // A canvas that still names the old mode keeps its card and lands on the
  // mode that is left.
  assert.equal(currentModeId('textimage2image'), 'image2image');
  assert.equal(currentModeId('textimage2video'), 'image2video');
  // The first+last frame mode was renamed, and the old name still means it.
  assert.equal(currentModeId('imagelast2video'), 'imagefl2video');
  assert.equal(modeOf({ type: 'image', metadata: { mode: 'textimage2image' } }), 'image2image');
  assert.equal(modeOf({ type: 'video', metadata: { mode: 'textimage2video' } }), 'image2video');

  // And the stored canvas heals: the old name does not come back.
  const h = await createHarness();
  t.after(() => h.cleanup());
  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '合并前的画布' }),
  });
  const canvas = created.body.canvas;
  await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...canvas,
      nodes: [
        {
          id: 'n_old',
          type: 'image',
          title: '图',
          position: { x: 0, y: 0 },
          width: 320,
          height: 420,
          metadata: { mode: 'textimage2image', prompt: '一只猫' },
        },
        {
          id: 'n_old_video',
          type: 'video',
          title: '片',
          position: { x: 400, y: 0 },
          width: 340,
          height: 380,
          metadata: { mode: 'textimage2video' },
        },
      ],
      connections: [],
    }),
  });
  const after = await getJson(h.base, `/api/canvases/${canvas.id}`);
  assert.equal(after.body.canvas.nodes[0].metadata.mode, 'image2image');
  assert.equal(after.body.canvas.nodes[1].metadata.mode, 'image2video');
});

test('a prompt or music node of the old canvas keeps its card as a mode', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  const created = await getJson(h.base, '/api/canvases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '老画布' }),
  });
  const canvas = created.body.canvas;
  await getJson(h.base, `/api/canvases/${canvas.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...canvas,
      nodes: [
        {
          id: 'n_p',
          type: 'prompt',
          title: '提示词',
          position: { x: 0, y: 0 },
          width: 340,
          height: 340,
          metadata: { prompt: '一只猫' },
        },
        {
          id: 'n_m',
          type: 'music',
          title: '音乐',
          position: { x: 400, y: 0 },
          width: 320,
          height: 250,
          metadata: { prompt: '轻快的' },
        },
      ],
      connections: [],
    }),
  });

  const after = await getJson(h.base, `/api/canvases/${canvas.id}`);
  const nodes = after.body.canvas.nodes;
  // The prompt node is a text node in its prompt mode...
  assert.equal(nodes[0].type, 'text');
  assert.equal(nodes[0].metadata.mode, 'prompt');
  assert.equal(nodes[0].metadata.kind, 'text');
  // ...and the music node is an audio node in its music mode.
  assert.equal(nodes[1].type, 'audio');
  assert.equal(nodes[1].metadata.mode, 'music');
  assert.equal(nodes[1].metadata.kind, 'audio');
});

test('the writing tools offer the same forms the menu does', async () => {
  const { MCP_TOOLS } = await import('../miniapp/node/mcp.mjs');
  const { CREATABLE_TYPES } = await import('../miniapp/client/forms.mjs');
  const add = MCP_TOOLS.find((tool) => tool.name === 'canvas_add_node');
  assert.deepEqual(
    [...add.inputSchema.properties.type.enum].sort(),
    [...CREATABLE_TYPES].sort(),
  );
  // The modes are reachable from the Agent as well: every mode of every
  // generating node.
  const { NODE_MODES } = await import('../miniapp/client/forms.mjs');
  const everyMode = Object.values(NODE_MODES).flat().map((mode) => mode.id);
  const update = MCP_TOOLS.find((tool) => tool.name === 'canvas_update_node');
  assert.deepEqual(
    [...update.inputSchema.properties.mode.enum].sort(),
    [...everyMode].sort(),
  );
});
test('the prompt node offers the H3 shapes', async () => {
  // The enhanced prompt is what the video model reads, so the prompt node
  // offers one shape per H3 generation mode: the four base tasks and the
  // reference tasks.
  const surface = palette();
  const ids = surface.promptTemplates.map((item) => item.id);
  for (const id of ['h3-t2va', 'h3-i2va', 'h3-fl2va', 'h3-l2va', 'h3-reference']) {
    assert.ok(ids.includes(id), `提示词增强没有 ${id} 这个形状`);
  }
  // The Base format is three fields, and each one says what belongs in it.
  const base = surface.promptTemplates.find((item) => item.id === 'h3-t2va');
  for (const field of ['integrated_multimodal_description', 'overall_soundscape', 'non_diegetic_music']) {
    assert.ok(base.text.includes(field), `三段式少了 ${field}`);
  }
  // The alignment line is the runtime's job: it is the one that knows which
  // picture the request carries and how long the clip is. A template that
  // wrote it as well would put a second copy in the prompt.
  const t2va = base.text;
  const i2va = surface.promptTemplates.find((item) => item.id === 'h3-i2va');
  const fl2va = surface.promptTemplates.find((item) => item.id === 'h3-fl2va');
  const l2va = surface.promptTemplates.find((item) => item.id === 'h3-l2va');
  assert.ok(!t2va.includes('aligns with'), '文生视频没有参考帧，不该有对齐说明');
  for (const shape of [i2va, fl2va, l2va]) {
    assert.ok(!shape.text.includes('is fully referenced'), '对齐说明由运行时补，模板不该自己写');
    assert.ok(!shape.text.includes('aligns with'), '对齐说明由运行时补，模板不该自己写');
    assert.ok(shape.text.includes('由运行时补上'), '模板该说明对齐说明是运行时写的');
  }
  // The label the template names a picture with is the label the prompt
  // gives it, so one prompt never mixes two spellings. The prompt compiler is
  // where that label comes from.
  const { compilePrompt, buildMentionMap, referenceSlots } = await import('../miniapp/node/prompt.mjs');
  const references = [
    { id: 'n_pic', kind: 'image', title: '上游', media: [{ url: 'https://cdn.example.com/p.png', kind: 'image' }] },
  ];
  const slots = referenceSlots({
    path: 'keyframe',
    frames: [{ id: 'n_pic', kind: 'image', role: 'first', url: 'https://cdn.example.com/p.png' }],
    segments: [],
    references,
  });
  const compiled = compilePrompt(
    '[[cw:image:n_pic]] 保持构图',
    buildMentionMap(references),
    'video',
    'minimax',
    slots,
  );
  assert.equal(compiled.promptForApi, '@图片1 保持构图');
  assert.ok(i2va.text.includes(compiled.promptForApi.slice(0, 4)), '模板里的标签和提示词里的标签不是同一个');
  // The Full-Reference format is six sections, in this order.
  const ref = surface.promptTemplates.find((item) => item.id === 'h3-reference');
  // The assets are named the way this app names them, so one prompt has one
  // vocabulary for the material it points at.
  assert.ok(ref.text.includes('@图片N'), '全参考格式要用本 app 的素材编号');
  assert.ok(!ref.text.includes('<Picture N>'), '全参考格式不该混进第二套素材编号');
  const sections = [
    'subject_definitions',
    'summary',
    'retention_analysis',
    'detailed_description',
    'overall_soundscape',
    'non_diegetic_music',
  ];
  let at = -1;
  for (const section of sections) {
    const found = ref.text.indexOf(section);
    assert.ok(found > at, `六段式里 ${section} 不在顺序上`);
    at = found;
  }
  // The relation markers are fixed values in the output format, so the
  // template has to name them.
  for (const marker of ['fully_preserved', 'attribute_transfer', 'weak_reference', 'fully_copy']) {
    assert.ok(ref.text.includes(marker), `六段式少了 ${marker}`);
  }
  // The task-type prefixes are the guide's own fixed list.
  for (const prefix of ['[reference generation]', '[video continuation]', '[audio reuse]']) {
    assert.ok(ref.text.includes(prefix), `六段式少了任务类型 ${prefix}`);
  }
});

test('the kind of a node is fixed when the node is created', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // The input card does not offer a switch for what it holds: the kind is
  // fixed when the node is created, and the header already says what it is.
  assert.doesNotMatch(source, /renderInputParams/);
  assert.doesNotMatch(source, /'类型'/);
  // An input node does not generate anything, so it must not say it does.
  assert.match(source, /roleOf\(node\) === 'input'\)[\s\S]{0,160}?这里放你要送进去的素材/);
  // A node that holds material has no text box: the text that goes with it
  // belongs to a text input above it, or to the prompt of the node it feeds.
  // (The call has two closing brackets: appendChild(renderUpload(node)).)
  assert.doesNotMatch(source, /renderUpload\(node\)\);\n\s*body\.appendChild\(createComposer\(node\)\)/);

  // And an action cannot change the kind afterwards either: the material that
  // was already put in belongs to the kind it was put in for.
  const canvas = {
    nodes: [{ id: 'n1', type: 'input', title: '输入', metadata: { kind: 'text', output: { text: '一只猫' } } }],
    connections: [],
  };
  const changed = applyAction(canvas, { type: 'update_node', args: { id: 'n1', kind: 'image' } });
  assert.equal(changed.error, undefined);
  assert.equal(changed.canvas.nodes[0].metadata.kind, 'text');
  assert.equal(changed.canvas.nodes[0].metadata.output.text, '一只猫');
});
test('an input node only takes the files of its own kind', async (t) => {
  const h = await createHarness();
  t.after(() => h.cleanup());

  // A picture node takes a picture.
  const picture = await getJson(h.base, '/api/uploads?name=cat.png&kind=image', {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: 'png-bytes',
  });
  assert.equal(picture.status, 200);
  assert.equal(picture.body.kind, 'image');

  // And it does not take a video: the node holds one kind of material.
  const video = await getJson(h.base, '/api/uploads?name=cat.mp4&kind=image', {
    method: 'POST',
    headers: { 'content-type': 'video/mp4' },
    body: 'mp4-bytes',
  });
  assert.equal(video.status, 400);
  assert.match(video.body.message, /装的是图片/);

  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // A text node holds text, so it has nothing to pick: the upload belongs to
  // the nodes that hold material.
  assert.match(source, /if \(kind === 'text'\) \{[\s\S]{0,600}?\} else \{[\s\S]{0,600}?renderUpload\(node\)/);
  assert.doesNotMatch(source, /picker\.accept = kind === 'image' \? 'image\/\*' : kind === 'video' \? 'video\/\*' : kind === 'audio' \? 'audio\/\*' : 'image\/\*,video\/\*,audio\/\*'/);
});
test('the focus never scrolls the canvas, and the mode switch keeps it in the node', async () => {
  const source = await readFile(
    fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)),
    'utf8',
  );
  // The board is a transformed layer: the browser would scroll to the layout
  // box of the focused control, which is a place the board is not. So every
  // focus move says so.
  assert.doesNotMatch(source, /\.focus\(\);/);
  assert.match(source, /focusTarget\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /open\.button\.focus\(\{ preventScroll: true \}\)/);
  // And the mode switch puts the focus back on the node it belongs to, so the
  // next Tab does not wander to another node.
  assert.match(source, /field\.dataset\.field = 'mode';/);
  assert.match(source, /focusModeControl\(node\);/);
});

test('the package tells the Agent how to use the canvas', async () => {
  // A Skill is how a plugin tells the Agent what it can do and when to reach
  // for what. It is named in the manifest and read from the package, so a
  // rename that leaves the manifest pointing at nothing has to fail here.
  const { readFile, stat } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(await readFile(join(root, '.minimax-plugin', 'plugin.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.skills) && manifest.skills.length, 'the package declares no skill');
  for (const relative of manifest.skills) {
    const file = join(root, ...relative.split('/'));
    const info = await stat(file);
    assert.ok(info.isFile(), `${relative} is not a file`);
    const text = await readFile(file, 'utf8');
    // The frontmatter is what the Agent reads first: without a name and a
    // description the skill is never matched against a request.
    assert.match(text, /^---\r?\n/, `${relative} has no frontmatter`);
    assert.match(text, /^name:\s*\S+/m, `${relative} has no name`);
    assert.match(text, /^description:\s*\S+/m, `${relative} has no description`);
    // A description that carries a colon has to be quoted: an unquoted
    // scalar with ": " in it is not a string, and the Host reads the
    // frontmatter as YAML — the whole package is refused when it is not.
    const lines = text.split(/\r?\n/);
    const end = lines.indexOf('---', 1);
    const frontmatter = lines.slice(1, end);
    for (const line of frontmatter) {
      const value = line.match(/^description:\s*(.*)$/)?.[1]?.trim() ?? '';
      if (!value) continue;
      const quoted = /^["'].*["']$/.test(value);
      assert.ok(
        quoted || !value.includes(': '),
        `${relative}: the description has a colon in it and is not quoted`,
      );
    }
  }
});

test('a file box is not typing, a text field is', async () => {
  // The rule that decides when the canvas may be drawn: a redraw that happens
  // while the user is typing takes the text being typed with it. A file box
  // is not typing — the user chose a file there and nothing is being written
  // — and counting it as typing stranded a redraw once: a run that had
  // finished kept turning for ever.
  const { isTypingTarget, redrawBlocker } = await import('../miniapp/client/forms.mjs');
  const input = (type) => ({ tagName: 'INPUT', getAttribute: (name) => (name === 'type' ? type : null) });
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget({ tagName: 'DIV' }), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget(input('text')), true);
  assert.equal(isTypingTarget(input('file')), false);
  assert.equal(isTypingTarget(input('checkbox')), false);
  assert.equal(isTypingTarget(input('radio')), false);
  // And what holds a redraw off: the hands, not the page.
  assert.equal(redrawBlocker(), '');
  assert.equal(redrawBlocker({ typing: true }), 'typing');
  assert.equal(redrawBlocker({ pointerHeld: true }), 'pointer');
  assert.equal(redrawBlocker({ typing: true, pointerHeld: true }), 'typing');
});

test('a request carries a deadline, and a lost run is told apart from a slow one', async () => {
  // A request that never comes back would stop the loop that asked for it,
  // and the card would turn for ever on a run that is long gone. The call is
  // given a signal, so the work it started can be let go.
  const { runIsGone, withDeadline } = await import('../miniapp/client/run-watch.mjs');
  let signal = null;
  const started = Date.now();
  await assert.rejects(() => withDeadline((abortSignal) => {
    signal = abortSignal;
    return new Promise((_, reject) => {
      abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }, 60));
  assert.ok(signal, 'the call was not given a signal');
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - started < 3000, 'the deadline did not pass');
  // A run the runtime does not know is gone. A request that timed out is
  // another matter: the run may still be going.
  assert.equal(runIsGone({ status: 404 }), true);
  assert.equal(runIsGone({ status: 500 }), false);
  assert.equal(runIsGone({ name: 'AbortError' }), false);
  assert.equal(runIsGone(null), false);
  // A call that answers in time is handed back as it is.
  assert.equal(await withDeadline(async () => 'answered', 1000), 'answered');
});

test('the page asks for a run with a deadline, and asks each run on its own', async () => {
  // The card of a run that is over must not keep turning: the request that
  // asks for the run carries a deadline, and one run that does not answer
  // must not keep the others from being seen.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.match(source, /const POLL_TIMEOUT_MS = \d+;/);
  assert.match(source, /await apiWithDeadline\(`\/api\/runs\/\$\{taskId\}`, POLL_TIMEOUT_MS\)/);
  assert.match(source, /if \(state\.polling\.has\(taskId\)\) continue;/);
  // And the run that is gone is said out loud instead of turning for ever.
  assert.match(source, /if \(!runIsGone\(error\)\) return;/);
  assert.match(source, /error: '这次运行已经不在了/);
});

test('a redraw that was held off is not lost, and a button under the pointer is not replaced', async () => {
  // The redraw waits for the user to stop typing — but the focus may leave
  // any field, not only the one in a card, so the wait has to end there too.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.match(source, /document\.addEventListener\('focusout', \(\) => \{\s*\n\s*flushRender\(\);/);
  // And the poll is the heartbeat that puts a held-off redraw back on the
  // screen, and that keeps the progress panel true.
  assert.match(source, /renderTaskPanel\(\);\s*\n\s*flushRender\(\);/);
  // A click that is in flight: the button under the pointer stays where it
  // is, so the click reaches it.
  assert.match(source, /state\.pointerAt = Date\.now\(\);/);
  assert.match(source, /state\.pendingPanel = true;/);
});

test('every module the page imports is served, and the fingerprint covers it', async () => {
  // A module the page imports but the server does not serve is a page that
  // never starts: the import fails, and the canvas stays blank with nothing
  // said on the screen. The files the page is made of are one list, and the
  // fingerprint is that same list — so a new file is registered in one place.
  const { CLIENT_FILES, FINGERPRINT_FILES } = await import('../miniapp/node/server.mjs');
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  const imported = [...source.matchAll(/from '\.\/([A-Za-z0-9_.-]+\.mjs)'/g)].map((match) => match[1]);
  assert.ok(imported.length >= 4, 'the imports of the page were not found');
  for (const name of imported) {
    assert.ok(CLIENT_FILES.has(`/${name}`), `${name} is imported by the page but not served`);
  }
  // And the fingerprint is the same list, so a page that was left open reloads
  // itself when the client code changes.
  assert.deepEqual(FINGERPRINT_FILES, [...CLIENT_FILES.values()].map((entry) => entry.file));
});

test('a wait holds on to the run it is about', async () => {
  // The page forgets which run belongs to a node as soon as that run is over
  // — the node is free to run again — so a waiter that looked the run up again
  // would never see it finish, and the chain that waits for an upstream node
  // would stand still until its own timeout.
  const { waitForTheRun } = await import('../miniapp/client/run-watch.mjs');
  const tasks = new Map([['r_1', { id: 'r_1', status: 'running' }]]);
  const readTask = (id) => tasks.get(id);
  let ticks = 0;
  const schedule = (fn) => {
    ticks += 1;
    if (ticks >= 3) tasks.set('r_1', { id: 'r_1', status: 'done' });
    fn();
  };
  const task = await waitForTheRun({ taskId: 'r_1', readTask, schedule, intervalMs: 0 });
  assert.equal(task.status, 'done');
  // A wait with no run at all ends at once: nothing is going to happen.
  const none = await waitForTheRun({ taskId: null, readTask, schedule: () => {}, intervalMs: 0 });
  assert.equal(none, null);
  // And a run that never ends ends the wait by the timeout, not for ever.
  let clock = 0;
  const timedOut = await waitForTheRun({
    taskId: 'r_2',
    readTask,
    schedule: (fn) => fn(),
    intervalMs: 0,
    now: () => { clock += 3_000_000; return clock; },
    timeoutMs: 2_700_000,
  });
  assert.equal(timedOut, null);
});

test('a busy node is not a failed one', async () => {
  // The runtime refuses a second run on a node that is already running. That
  // is not a failure: the run that is on the node is the one to wait for, and
  // marking the node as failed would be a lie.
  const { isBusyRefusal } = await import('../miniapp/client/run-watch.mjs');
  assert.equal(isBusyRefusal({ code: 'BUSY', message: '这个节点正在生成中，请等它跑完' }), true);
  assert.equal(isBusyRefusal({ code: 'INVALID_ARGUMENTS' }), false);
  assert.equal(isBusyRefusal({ status: 500 }), false);
  assert.equal(isBusyRefusal(null), false);
});

test('the page waits for the run it was given, and a busy node keeps its card', async () => {
  // The rule is one rule: the page holds the run it waits for, and a node that
  // is busy is not marked as failed.
  const source = await readFile(fileURLToPath(new URL('../miniapp/client/app.js', import.meta.url)), 'utf8');
  assert.match(source, /const taskId = state\.nodeTasks\.get\(nodeId\);\s*\n\s*return waitForTheRun\(\{/);
  assert.match(source, /if \(isBusyRefusal\(error\)\) \{/);
});

test('a clip the provider cannot read in time is made smaller first', async () => {
  // The provider reads a clip frame by frame, and the Host stops a connector
  // call after thirty seconds. A phone recording is sixty frames a second at
  // 1080×1920 — six hundred frames to look at — so it is made smaller before
  // it is asked about. The rules are plain functions, so they are tested
  // without a clip.
  const {
    UNDERSTANDING_LIMITS,
    compressionArgs,
    isUnderstandTimeout,
    understandingPlan,
  } = await import('../miniapp/node/understand-media.mjs');

  // A small clip is left alone: making it smaller would gain nothing.
  const small = understandingPlan({ bytes: 400 * 1024, duration: 6, width: 1280, height: 720, fps: 24 });
  assert.equal(small.compress, false);
  assert.deepEqual(small.reasons, []);
  assert.deepEqual(small.tiers, []);

  // A phone clip is not: its size, its frame and its frame rate all say so.
  const big = understandingPlan({ bytes: 8 * 1024 * 1024, duration: 10, width: 1080, height: 1920, fps: 60 });
  assert.equal(big.compress, true);
  assert.equal(big.reasons.length, 3);
  assert.match(big.reasons.join(' '), /8\.0MB/);
  assert.match(big.reasons.join(' '), /1080×1920/);
  assert.match(big.reasons.join(' '), /60fps/);
  assert.equal(big.tiers.length, 2);
  // And a clip that is too long is cut down to what the provider reads.
  const long = understandingPlan({ bytes: 1024, duration: 40, width: 640, height: 480, fps: 24 });
  assert.equal(long.compress, true);
  assert.match(long.reasons.join(' '), /40\.0s/);

  // The command keeps the shape of the frame and takes the frames down.
  const args = compressionArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    tier: big.tiers[0],
    width: 1080,
    height: 1920,
    fps: 60,
    duration: 10,
    hasAudio: true,
  });
  const filter = args[args.indexOf('-vf') + 1];
  assert.ok(String(filter).includes('scale=w=1280:h=1280:force_original_aspect_ratio=decrease'), filter);
  assert.ok(String(filter).includes('fps=24'), filter);
  assert.ok(args.includes('aac'));
  assert.equal(args.at(-1), 'out.mp4');
  // The sound is kept, because the provider does hear it.
  assert.equal(args.includes('-an'), false);
  // A clip without a sound is not given one.
  const silent = compressionArgs({
    input: 'a.mp4', output: 'b.mp4', tier: big.tiers[0],
    width: 640, height: 480, fps: 30, duration: 4, hasAudio: false,
  });
  assert.ok(silent.includes('-an'));
  // A clip that is already small is not scaled up.
  const little = compressionArgs({
    input: 'a.mp4', output: 'b.mp4', tier: big.tiers[0],
    width: 640, height: 480, fps: 24, duration: 4, hasAudio: true,
  });
  assert.equal(little.some((item) => String(item).startsWith('scale=')), false);
  assert.equal(little.some((item) => String(item).startsWith('fps=')), false);
  // A clip whose shape could not be measured is made smaller anyway: a clip
  // that cannot be measured is a clip that cannot be read in time.
  const unknown = compressionArgs({
    input: 'a.mp4', output: 'b.mp4', tier: big.tiers[0],
    duration: 4, hasAudio: true,
  });
  const unknownFilter = String(unknown[unknown.indexOf('-vf') + 1]);
  assert.ok(unknownFilter.includes('scale=w=1280:h=1280'), unknownFilter);
  assert.ok(unknownFilter.includes('fps=24'), unknownFilter);

  // Only a call that ran out of time is worth another try: a clip the
  // provider refused would be refused the same way.
  assert.equal(isUnderstandTimeout({ code: 'CONNECTOR_OUTCOME_UNKNOWN' }), true);
  assert.equal(isUnderstandTimeout({ code: 'CONNECTOR_TIMEOUT' }), true);
  assert.equal(isUnderstandTimeout({ code: 'CONNECTOR_PROVIDER_ERROR' }), false);
  assert.equal(isUnderstandTimeout({ code: 'INVALID_ARGUMENTS' }), false);
  assert.equal(isUnderstandTimeout(null), false);
  // And the limits are the ones the rules say they are.
  assert.equal(UNDERSTANDING_LIMITS.maxFps, 24);
  assert.equal(UNDERSTANDING_LIMITS.maxSide, 1280);
});

test('the card that is empty is named, not "this picture"', async (t) => {
  // Three cards on the board, and one of them has nothing in it: "this
  // picture" says nothing about which one. The card that is empty is named.
  const connector = createMockHostConnector();
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  const empty = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_empty',
      mode: 'text',
      nodeMode: 'describe',
      prompt: '',
      references: [{
        id: 'n_pic',
        title: '参考图',
        kind: 'image',
        role: 'result',
        text: '',
        media: [],
      }],
    }),
  });
  assert.equal(empty.status, 400);
  assert.match(empty.body.message, /参考图/);
  assert.match(empty.body.message, /还没有内容/);
});

test('a big clip is read in a smaller shape, and a timeout is tried again', async (t) => {
  // The provider reads a clip frame by frame, and the Host stops a connector
  // call after thirty seconds. A clip that is too big for that is asked about
  // in a smaller shape, and a call that ran out of time is asked again with
  // the next size — not left as a silent failure.
  const uploadServer = createHttpServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((resolve) => uploadServer.listen(0, '127.0.0.1', resolve));
  const uploadPort = uploadServer.address().port;
  t.after(() => new Promise((resolve) => uploadServer.close(resolve)));

  const connector = createMockHostConnector(undefined, {
    // The first ask about the clip runs out of time.
    timeoutCall: { tool: 'videos_understand', nth: 1 },
    uploadHost: `http://127.0.0.1:${uploadPort}/upload`,
  });
  const h = await createHarness({ hostConnector: connector });
  t.after(() => h.cleanup());

  // A clip like a phone recording: 1080×1920 at sixty frames a second.
  await mkdir(join(h.dataDir, 'uploads'), { recursive: true });
  const clip = join(h.dataDir, 'uploads', 'big.mp4');
  const made = await makeTestClip(clip);
  if (!made) {
    t.skip('本机没有 ffmpeg，这条合同要在一台装了 ffmpeg 的机器上验');
    return;
  }

  const started = await getJson(h.base, '/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nodeId: 'n_clip',
      mode: 'text',
      nodeMode: 'video2text',
      prompt: '',
      references: [{
        id: 'n_v',
        title: '参考视频',
        kind: 'video',
        role: 'result',
        text: '',
        media: [{ kind: 'video', url: '/uploads/big.mp4' }],
      }],
    }),
  });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const runId = started.body.run.id;
  let run = null;
  for (let i = 0; i < 600 && run?.status !== 'done' && run?.status !== 'error'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    run = (await getJson(h.base, `/api/runs/${runId}`)).body.run;
    // The Agent asks before it writes, and the answer comes from the page.
    if (run?.pendingPermission) {
      await getJson(h.base, `/api/runs/${runId}/permission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: run.pendingPermission.requestId,
          sessionId: run.pendingPermission.sessionId,
          decision: 'allowOnce',
        }),
      });
    }
  }

  // The clip was asked about twice: the first ask ran out of time, and the
  // second one was about a shape the provider could read.
  const asked = connector.calls.filter((call) => call.toolRef.endsWith('videos-understand'));
  assert.equal(asked.length, 2);
  assert.match(asked[1].args.video_info[0].url, /^https:\/\//);
  // And a smaller copy of the clip was made and uploaded for that ask.
  const uploads = connector.calls.filter((call) => call.toolRef.endsWith('upload-temp-url'));
  assert.ok(uploads.length >= 2, '没有把压小的视频传给 provider');
  assert.ok(
    uploads.some((call) => call.args?.filename && call.args.filename !== 'big.mp4'),
    '没有压小一份视频',
  );
  // The run ends well: the second ask came back with an answer.
  assert.equal(run.status, 'done', JSON.stringify(run).slice(0, 800));
});

/**
 * A short clip like a phone recording, for the test that needs one.
 *
 * It is made by the local ffmpeg: the test that needs a clip is about what
 * the runtime does with a big one, and a clip that is not big would not say
 * anything. A machine without ffmpeg skips that test instead of failing it.
 */
async function makeTestClip(path) {
  return new Promise((resolve) => {
    const child = spawn(
      'ffmpeg',
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=60:duration=2',
        '-pix_fmt', 'yuv420p',
        path,
      ],
      { shell: false, windowsHide: true },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

test('a clip on this machine can be measured', async (t) => {
  // ffprobe writes every tag of every stream, and a clip with a long tag
  // list is more text than the answer is allowed to be: the answer was cut
  // off in the middle and could not be read at all — so the runtime knew
  // nothing about the clip it was asked to read, and the clip was sent to
  // the provider exactly as it was.
  const { createFfmpeg } = await import('../miniapp/node/ffmpeg.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'nxc-probe-'));
  t.after(() => removeDir(dir));
  const clip = join(dir, 'clip.mp4');
  const made = await makeTestClip(clip);
  if (!made) {
    t.skip('本机没有 ffmpeg，这条合同要在一台装了 ffmpeg 的机器上验');
    return;
  }
  const info = await createFfmpeg({}).probe(clip);
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.equal(info.fps, 60);
  assert.ok(info.duration > 1.5 && info.duration < 2.5, `时长读成了 ${info.duration}`);
  // And only the fields that are needed are asked for: the whole of every
  // stream and every tag is what made the answer too long to read.
  const source = await readFile(fileURLToPath(new URL('../miniapp/node/ffmpeg.mjs', import.meta.url)), 'utf8');
  assert.match(source, /-show_entries/);
  assert.equal(source.includes("'-show_streams'"), false, 'probe 又去问整个流了');
});
