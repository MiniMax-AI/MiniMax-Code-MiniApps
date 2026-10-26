// The media tool runner.
//
// A media tool is a local transformation: it takes a media file the canvas
// already has and produces a new one. The Node service owns the whole path —
// downloading the source, running ffmpeg, publishing the result — so the page
// never has to know about file paths or command lines.
import { createFfmpeg } from './ffmpeg.mjs';
import { createMediaStore } from './media-store.mjs';
import { findMediaTool, TOOL_ACCEPTS } from './media-tools.mjs';

const FALLBACK_EXT = {
  video: '.mp4',
  image: '.jpg',
  audio: '.m4a',
};

function extensionOf(path) {
  const match = /\.[a-z0-9]{2,5}$/i.exec(String(path ?? ''));
  return match ? match[0].toLowerCase() : '.bin';
}

export function createMediaRunner(context) {
  const ffmpeg = createFfmpeg(context);
  const store = createMediaStore(context);

  /** The capability state the page renders from. */
  async function status() {
    const ffmpegState = await ffmpeg.status();
    return { ...ffmpegState, canUpload: await store.hasUploadTool() };
  }

  /**
   * Make a media file readable by the provider.
   *
   * The provider's media gateway refuses a raw generation link ("could not be
   * used as a media source"), so the media is downloaded and uploaded first.
   * The temporary URL is what the provider can fetch.
   */
  async function prepareForProvider(media) {
    const local = await store.materialize(media, { fallbackExt: '.mp4' });
    const uploaded = await store.uploadTempUrl(local.path);
    if (!uploaded) {
      throw Object.assign(
        new Error('当前客户端没有提供素材上传能力，provider 读不到这段素材。'),
        { code: 'MEDIA_UPLOAD_UNAVAILABLE' },
      );
    }
    return uploaded.url;
  }

  /**
   * Run one media tool.
   *
   * `sources` is ordered: the node's own media first, then the media of the
   * nodes connected to it. A single-source tool reads `source`, and a
   * multi-source tool (拼图 / 合并视频) reads the whole list.
   */
  async function run({ tool, sources, params }) {
    const spec = findMediaTool(tool);
    if (!spec) {
      throw Object.assign(new Error(`未知工具：${tool}`), { code: 'INVALID_ARGUMENTS' });
    }
    const accepts = TOOL_ACCEPTS[tool] ?? null;

    const state = await ffmpeg.status();
    if (!state.available) {
      throw Object.assign(
        new Error('本机没有安装 ffmpeg，媒体处理工具暂时不可用。装好 ffmpeg 后重新发布即可。'),
        { code: 'FFMPEG_UNAVAILABLE' },
      );
    }

    const list = (Array.isArray(sources) ? sources : []).filter((item) => item?.url);
    if (!list.length) {
      throw Object.assign(new Error('这个节点还没有素材'), { code: 'INVALID_ARGUMENTS' });
    }

    const fallbackExt = FALLBACK_EXT[accepts] ?? '.mp4';
    const materialized = [];
    for (const item of list) {
      const local = await store.materialize(item, { fallbackExt });
      materialized.push(local);
    }

    try {
      const primary = materialized[0];
      if (accepts) {
        // A container can carry another extension, so the check is a soft one
        // and ffmpeg gets the final word.
        const videoExts = ['.mp4', '.mov', '.webm', '.mkv', '.avi'];
        const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'];
        const allowed = accepts === 'video' ? videoExts : imageExts;
        if (!allowed.includes(primary.ext)) {
          throw Object.assign(
            new Error(`这个工具需要${accepts === 'video' ? '视频' : '图片'}素材，当前素材是 ${primary.ext}`),
            { code: 'INVALID_ARGUMENTS' },
          );
        }
      }

      const artifacts = await spec.run({
        ffmpeg,
        store,
        params: params ?? {},
        source: primary.path,
        sources: materialized.map((item) => item.path),
        out: (ext) => store.out(ext),
      });

      const published = [];
      for (const artifact of artifacts ?? []) {
        const ext = extensionOf(artifact.path);
        const asset = await store.publishAs(artifact.path, ext);
        published.push({
          url: asset.url,
          kind: artifact.kind ?? asset.kind,
          mimeType: artifact.mimeType ?? asset.mimeType,
          bytes: asset.bytes,
        });
      }
      if (!published.length) {
        throw Object.assign(new Error('工具没有产出文件'), { code: 'MEDIA_TOOL_FAILED' });
      }
      return { tool, artifacts: published };
    } finally {
      // The copies this run downloaded are scratch: the published result is
      // what the canvas keeps, so the working folder does not grow without
      // bound. The store decides what may be thrown away — a source that is
      // already a published file belongs to the canvas, and it stays.
      for (const item of materialized) {
        await store.discard(item.path);
      }
    }
  }

  function dispose() {
    ffmpeg.dispose();
  }

  return { status, run, prepareForProvider, dispose, store };
}
