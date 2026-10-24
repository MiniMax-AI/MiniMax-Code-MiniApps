// Direct connector generation for the AI Node Canvas MiniApp.
//
// The Node service owns the live reads and writes: it calls the Host
// connector itself instead of routing a provider call through an Agent turn.
// The Host owns the credentials, so no key is handled here, and the account
// behind the connector is the user's own — the call path does not change
// which pool is billed.
//
// The tool names come from the Host inventory, where a tool is named
// `<provider>_<tool>`; the provider prefix cannot be assumed, so the tools
// are matched on their suffix.
//
// Every parameter below is taken from the connector's own input schema; the
// field names are never guessed.
import { decodeHostConnectorValue } from './host-connector-value.mjs';
import { frameRequestShape } from './video-request.mjs';
import { batchCount } from '../client/tools.mjs';

const INVENTORY_TTL_MS = 60_000;
const VIDEO_POLL_INTERVAL_MS = 10_000;

// The tool reference belongs to the Host: it goes stale when the service
// restarts. The Host's own rule for that is to list the tools again.
const STALE_REF_CODES = new Set(['TOOL_REF_STALE', 'SERVICE_RESTARTED']);

const TOOL = {
  image: 'generate_image',
  videoSubmit: 'submit_video_generation',
  videoQuery: 'query_video_generation',
  audio: 'synthesize_speech',
  music: 'batch_text_to_music',
  assetUrl: 'get_asset_url',
};

// The provider takes media URLs, never local paths or data URIs.
function mediaUrl(item) {
  return item?.url ?? item?.link ?? item?.download_url ?? null;
}

// The note that goes with a batch: what did not come out of it.
function batchNote(warnings) {
  return (warnings ?? []).join('；');
}

/**
 * How long a call waited for the machine, in words.
 *
 * Under a second it is said in milliseconds: a tenth of a second rounded to
 * "0.1s" reads like a tenth of a second, and it is not.
 */
export function queueWaitText(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

/**
 * The wait that goes with a failed call.
 *
 * The Host gives every connector call a window of its own, so the time a call
 * spent standing behind another one is the difference between "the provider
 * was slow" and "it waited its turn". The wait is said apart from the call
 * itself, because only the call's own time is the provider's answer.
 */
export function queueNote(ms) {
  const value = Number(ms) || 0;
  // Below this the call did not really stand behind anything.
  if (value < 20) return '';
  return `，前面排队 ${queueWaitText(value)}`;
}

/**
 * The reference videos, with their lengths.
 *
 * The provider asks how long a reference video is. A video this machine
 * cannot read has no length to give, and a run that needs one says so
 * instead of sending a video the provider will refuse.
 */
function videoReferences(videos) {
  return (videos ?? []).map((item) => {
    const seconds = Math.round(Number(item?.durationSeconds ?? 0));
    if (!seconds) {
      throw Object.assign(new Error('读不出参考视频的时长：provider 需要知道这个视频有多长。'), {
        code: 'INVALID_ARGUMENTS',
      });
    }
    return { url: item.url, duration_seconds: seconds };
  });
}

export function createConnectorRunner(context, options = {}) {
  let inventory = null;
  let inventoryAt = 0;

  // A produced asset is kept under this runtime's own asset folder, so the
  // canvas does not depend on a provider link that expires.
  async function publishSafely(url, kind) {
    if (!options.publish || !url) return url;
    try {
      return (await options.publish(url, kind)) ?? url;
    } catch {
      // The asset is still usable through the provider link, so a failed
      // download must not fail the run.
      return url;
    }
  }

  function connector() {
    return context.hostConnector ?? null;
  }

  async function listTools(force = false) {
    const api = connector();
    if (!api) return [];
    const now = Date.now();
    if (!force && inventory && now - inventoryAt < INVENTORY_TTL_MS) return inventory;
    try {
      const result = await api.list();
      inventory = Array.isArray(result?.tools) ? result.tools : [];
      inventoryAt = now;
    } catch {
      inventory = [];
      inventoryAt = 0;
    }
    return inventory;
  }

  // The Host names its tools `<provider>_<tool>`, so match on the suffix.
  async function findTool(suffix, force = false) {
    const tools = await listTools(force);
    return (
      tools.find((item) => item?.name === suffix)
      ?? tools.find((item) => new RegExp(`(^|_)${suffix}$`).test(item?.name ?? ''))
      ?? null
    );
  }

  /**
   * One provider call at a time.
   *
   * The Host stops a connector request that takes too long (30 s by default),
   * and two calls that share the machine are the two that run over that
   * window. The window is per call, so a call that has the machine to itself
   * is the one that fits into it.
   *
   * That is why a batch of assets is made one after another, and why two
   * angles of the same picture do not run side by side: the second one waits
   * for the first, and both get a full window of their own.
   *
   * The calls that only read the provider — the task list, an asset link —
   * are not queued: they are quick, and a video waiting for its result must
   * not stand behind a slow picture.
   */
  const SLOW_CALLS = new Set([TOOL.image, TOOL.audio, TOOL.music, TOOL.videoSubmit]);
  let callChain = Promise.resolve();

  function inCallQueue(suffix, task) {
    if (!SLOW_CALLS.has(suffix)) return task();
    const run = callChain.then(task, task);
    // The chain only carries the order, never the failure: one call that fails
    // must not stop the ones behind it.
    callChain = run.then(() => {}, () => {});
    return run;
  }

  async function callTool(suffix, args, signal, timing = null) {
    const api = connector();
    if (!api) {
      throw Object.assign(new Error('当前客户端未授予连接器访问权限'), { code: 'CONNECTOR_UNAVAILABLE' });
    }
    let tool = await findTool(suffix);
    if (!tool) {
      throw Object.assign(new Error(`当前连接器没有提供 ${suffix} 工具`), { code: 'CONNECTOR_UNAVAILABLE' });
    }
    const queuedAt = Date.now();
    let callMs = 0;
    let waitedMs = 0;
    let result;
    const run = async (ref) => inCallQueue(suffix, async () => {
      waitedMs = Date.now() - queuedAt;
      const began = Date.now();
      try {
        return await api.call(ref, args, { signal: signal ?? context.signal });
      } finally {
        callMs = Date.now() - began;
      }
    });
    try {
      result = await run(tool.toolRef);
    } catch (error) {
      // The Host says the reference is stale: the service restarted, or the
      // inventory this call used is older than the service. The Host's own
      // rule is to list the tools again and try once — the tool reference
      // belongs to the Host and is not ours to keep.
      if (STALE_REF_CODES.has(error?.code)) {
        const fresh = await findTool(suffix, true);
        if (fresh?.toolRef) {
          tool = fresh;
          try {
            result = await run(fresh.toolRef);
            error = null;
          } catch (retryError) {
            error = retryError;
          }
        }
      }
      if (error) {
        // Which call failed, and how long it ran, is what the user needs: the
        // Host stops a connector request that takes too long, and the message
        // it raises says nothing about the step.
        //
        // The time shown is the call's own time. The time it spent waiting for
        // the machine is said separately, because that is the difference
        // between "the provider was slow" and "it stood behind another call".
        const note = error?.code === 'CONNECTOR_OUTCOME_UNKNOWN'
          ? '调用已经发出但没收到回执，结果未知（可能已经扣费）；宿主对连接器调用有超时上限，太慢的调用会被中止。'
          : error?.code === 'CONNECTOR_TIMEOUT'
            ? '这次调用超过了宿主的时限（默认 30 秒）被中止；结果未知，先核对业务状态再决定要不要重试。'
            : String(error?.message ?? error);
        throw Object.assign(
          new Error(`调用 ${suffix} 失败（耗时 ${(callMs / 1000).toFixed(1)}s${queueNote(waitedMs)}）：${note}`),
          { code: error?.code ?? 'CONNECTOR_ERROR' },
        );
      }
    }
    // The timing travels with the result: the caller says how long the run
    // waited, instead of only the caller that happened to time it.
    if (timing) {
      timing.waitedMs = (timing.waitedMs ?? 0) + waitedMs;
      timing.callMs = (timing.callMs ?? 0) + callMs;
    }
    return decodeHostConnectorValue(result.value);
  }

  // A short-lived display URL for a produced asset.
  async function assetUrl(nodeId) {
    if (!nodeId) return null;
    try {
      const value = await callTool(TOOL.assetUrl, { node_id: nodeId });
      return mediaUrl(value) ?? null;
    } catch {
      return null;
    }
  }

  // The upstream assets a node references. The order comes from the compiled
  // prompt, so the `@图片1` numbering in the prompt and the URLs sent to the
  // provider always line up.
  function referenceAssets(assets) {
    const list = (urls) => (urls ?? []).map((url) => ({ url })).filter((item) => item.url);
    // A reference video carries its length: the provider wants to know how
    // long it is, and the runtime read it off the file.
    const videos = (assets?.videos ?? [])
      .map((url) => ({ url, durationSeconds: Number(assets?.durations?.[url] ?? 0) }))
      .filter((item) => item.url);
    return {
      images: list(assets?.images),
      videos,
      audios: list(assets?.audios),
    };
  }

  async function collectMedia(items, kind) {
    const media = [];
    for (const item of items ?? []) {
      const nodeId = item?.node_id ?? item?.file_id ?? null;
      const url = (await assetUrl(nodeId)) ?? mediaUrl(item);
      if (!url) continue;
      const local = await publishSafely(url, kind);
      media.push({ url: local, kind, nodeId, providerUrl: url });
    }
    return media;
  }

  /**
   * Start a generation through the connector.
   *
   * Returns `{ state: 'done' }` for the synchronous modes and
   * `{ state: 'pending', providerTaskId }` for video, which the provider
   * finishes on its own schedule.
   */
  /**
   * Run one provider call per asset.
   *
   * The Host stops a connector call that takes too long (30 seconds by
   * default), so a batch of assets is a few calls of one asset each: every
   * call gets its own window. The calls run one after another on purpose —
   * the window is per call, and a call that has the machine to itself is the
   * one that fits into it. The call queue enforces the same rule for the calls
   * that come from somewhere else, so two runs of the same picture do not
   * share the machine either. What came back is kept even when one of the
   * calls fails, because a half-finished batch is still worth showing.
   */
  async function callPerAsset(tool, argsFor, kind, wanted, signal) {
    const media = [];
    const warnings = [];
    // The time the batch spent waiting for the machine, and the time the
    // calls themselves took. The two are told apart, because only one of
    // them is the provider's answer.
    const timing = { waitedMs: 0, callMs: 0 };
    for (let index = 0; index < wanted; index += 1) {
      try {
        media.push(...(await callOneAsset(tool, argsFor(index), kind, signal, timing)));
      } catch (error) {
        warnings.push(`第 ${index + 1} 个没有生成出来：${error?.message ?? error}`);
      }
    }
    if (!media.length && warnings.length) {
      throw Object.assign(new Error(warnings[0].replace(/^第 \d+ 个没有生成出来：/, '')), { code: 'CONNECTOR_ERROR' });
    }
    return { media, warnings, waitedMs: timing.waitedMs, callMs: timing.callMs };
  }

  /** One provider call for one asset. */
  async function callOneAsset(tool, args, kind, signal, timing) {
    const value = await callTool(tool, args, signal, timing);
    if (value?.code && value.code !== 0) {
      throw Object.assign(new Error(value.message || '生成失败'), { code: 'CONNECTOR_PROVIDER_ERROR' });
    }
    return collectMedia(value?.success_items ?? (value?.node_id ? [value] : []), kind);
  }

  async function submit({ mode, prompt, params, assets, modelId, signal, count = 1, path = '', frames = [] }) {
    const reference = referenceAssets(assets);
    const text = String(prompt ?? '').trim();
    // How many assets this call asks for. The mode decides whether a batch
    // is possible at all.
    const wanted = batchCount(mode, count);

    if (mode === 'image') {
      const request = { prompt: text };
      if (params?.ratio) request.aspect_ratio = params.ratio;
      if (params?.resolution) request.resolution = params.resolution;
      if (reference.images.length) request.input_urls = reference.images.map((item) => item.url);
      const { media, warnings, waitedMs, callMs } = await callPerAsset(
        TOOL.image,
        () => ({ requests: [{ ...request }] }),
        'image',
        wanted,
        signal,
      );
      return { state: 'done', media, text: batchNote(warnings), warnings, waitedMs, callMs };
    }

    if (mode === 'audio') {
      const request = { text };
      if (params?.voice) request.voice_id = params.voice;
      if (params?.emotion) request.emotion = params.emotion;
      const { media, warnings, waitedMs, callMs } = await callPerAsset(
        TOOL.audio,
        () => ({ ...request }),
        'audio',
        wanted,
        signal,
      );
      return { state: 'done', media, text: batchNote(warnings), warnings, waitedMs, callMs };
    }

    if (mode === 'music') {
      const { media, warnings, waitedMs, callMs } = await callPerAsset(
        TOOL.music,
        () => ({ requests: [{ prompt: text }] }),
        'audio',
        wanted,
        signal,
      );
      return { state: 'done', media, text: batchNote(warnings), warnings, waitedMs, callMs };
    }

    if (mode === 'video') {
      const model = modelId ?? 'MiniMax-H3';
      const request = { prompt: text, model };
      if (params?.duration) request.duration = Number(params.duration);
      if (params?.resolution) request.resolution = params.resolution;
      // Which request the provider is asked for. A picture becomes a video in
      // three different ways, and the provider has three different requests
      // for them — the mode says which one, not the model.
      if (path === 'keyframe' || path === 'firstLast' || path === 'lastFrame') {
        // The shape of the request, read by one rule: the connector builds
        // the body from it, and the prompt writes the alignment line that
        // goes with it. Two readers, one answer.
        const shape = frameRequestShape(path, frames);
        if (shape.kind !== 'none') {
          // The picture that anchors the clip: the first frame, or the last
          // one when the mode says the picture is the ending.
          const anchor = shape.kind === 'lastFrame' ? shape.last.url : shape.first.url;
          request.input_image = { url: anchor };
          // reference_type says which end the picture is: the first frame,
          // the last one, or a clip that ends on it.
          request.reference_type = shape.kind === 'keyframe' ? 'first_frame' : 'last_frame';
          // The frame decides the shape, so the provider ignores a ratio here.
          // Without a frame there is nothing to follow, and the run is a plain
          // text-to-video one that needs a shape of its own.
          request.ratio = 'adaptive';
        }
        if (shape.kind === 'firstLast') {
          request.last_frame_image = { url: shape.last.url };
        }
      } else if (path === 'collection' || path === 'collectionAudio') {
        if (reference.images.length) request.reference_images = reference.images;
        if (reference.videos.length) request.reference_videos = videoReferences(reference.videos);
        // The audio goes only when the mode asked for it: the mode says what
        // the request carries.
        if (path === 'collectionAudio' && reference.audios.length) {
          request.reference_audios = reference.audios;
        }
        // A reference set may follow the frame instead of a shape.
        request.ratio = params?.ratio || 'adaptive';
      } else if (params?.ratio) {
        // A text-to-video run needs a concrete shape.
        request.ratio = params.ratio;
      }
      const timing = { waitedMs: 0, callMs: 0 };
      const value = await callTool(TOOL.videoSubmit, request, signal, timing);
      if (value?.code && value.code !== 0) {
        throw Object.assign(new Error(value.message || '视频生成提交失败'), { code: 'CONNECTOR_PROVIDER_ERROR' });
      }
      const taskId = value?.task_id ?? value?.taskId ?? value?.id ?? null;
      if (!taskId) {
        throw Object.assign(new Error('视频任务没有返回 task_id'), { code: 'CONNECTOR_PROVIDER_ERROR' });
      }
      return {
        state: 'pending',
        providerTaskId: taskId,
        providerModel: model,
        text: value?.message ?? '',
        waitedMs: timing.waitedMs,
        callMs: timing.callMs,
      };
    }

    throw Object.assign(new Error(`连接器不支持 ${mode} 模式`), { code: 'INVALID_ARGUMENTS' });
  }

  /**
   * Check a submitted video task. The provider finishes on its own schedule
   * (H3 usually 15-30 minutes), so the page polls this instead of holding a
   * request open.
   */
  async function pollVideo({ providerTaskId, providerModel }) {
    const value = await callTool(TOOL.videoQuery, { task_id: providerTaskId, model: providerModel });
    if (value?.code && value.code !== 0) {
      throw Object.assign(new Error(value.message || '视频任务查询失败'), { code: 'CONNECTOR_PROVIDER_ERROR' });
    }
    const status = String(value?.status ?? value?.state ?? '').toLowerCase();
    if (status === 'succeeded' || status === 'success' || status === 'completed') {
      const nodeId = value?.file_id ?? value?.node_id ?? null;
      const url = (await assetUrl(nodeId)) ?? mediaUrl(value);
      const local = await publishSafely(url, 'video');
      // The download link is temporary, so the task id travels with it: the
      // task can be queried again for a fresh link.
      return {
        state: 'done',
        media: local
          ? [{ url: local, kind: 'video', nodeId, taskId: providerTaskId, model: providerModel, providerUrl: url }]
          : [],
        text: value?.message ?? '',
      };
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      throw Object.assign(
        new Error(value?.message || value?.failure_reason || `视频生成${status === 'failed' ? '失败' : '已取消'}`),
        { code: 'CONNECTOR_PROVIDER_ERROR' },
      );
    }
    return { state: 'pending', providerStatus: status || 'running', text: value?.message ?? '' };
  }

  /**
   * Ask the provider about a media file.
   *
   * The provider fetches the URL itself, so a provider asset link is read
   * directly. A file this MiniApp produced is served from the loopback
   * address, which the provider cannot reach.
   */
  async function understand({ kind = 'video', url, prompt }) {
    const target = kind === 'audio' ? 'audios_understand' : kind === 'image' ? 'describe_images' : 'videos_understand';
    const field = kind === 'audio' ? 'audio_info' : kind === 'image' ? 'image_info' : 'video_info';
    const value = await callTool(target, { [field]: [{ url, prompt: prompt || undefined }] });
    if (value?.code && value.code !== 0) {
      throw Object.assign(new Error(value.message || '媒体理解失败'), { code: 'CONNECTOR_PROVIDER_ERROR' });
    }
    const results = Array.isArray(value?.results) ? value.results : [];
    const first = results[0] ?? {};
    if (first.success === false) {
      throw Object.assign(new Error(first.error || '媒体理解失败'), { code: 'CONNECTOR_PROVIDER_ERROR' });
    }
    const description = String(first.description ?? '').trim();
    if (!description) {
      throw Object.assign(new Error('媒体理解没有返回内容'), { code: 'CONNECTOR_PROVIDER_ERROR' });
    }
    return { text: description };
  }

  return {
    available() {
      return Boolean(connector());
    },
    listTools,
    /**
     * The names of the tools the Host granted.
     *
     * The inventory is read in one go: asking the Host once per tool would
     * be a round trip per row of the capability list. `fresh` asks the Host
     * again — right after the runtime starts the inventory is not complete
     * yet, and a list read then would be wrong.
     */
    async grantedToolNames(fresh = false) {
      const tools = await listTools(fresh);
      return tools
        .map((item) => String(item?.name ?? ''))
        .filter((name) => name.length > 0);
    },
    submit,
    pollVideo,
    understand,
    videoPollIntervalMs: VIDEO_POLL_INTERVAL_MS,
  };
}
