import { timelineDuration, type ProjectDoc, type TimelineState } from '../../editor/types';
import { resolveTimelineRenderPlan } from '../../editor/sequenceGraph';

// 在已认证的 MiniApp 页面中渲染，不额外启动需要宿主认证的 HTTP 服务。
export async function renderMiniAppStills(state: TimelineState, frames: number[], project?: ProjectDoc, timelineId?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('画面检查超过 45 秒，请保持应用窗口打开，稍后只检查一帧。')), 45_000);
  try {
    const response = await fetch('/api/product-resources/prepare', {
      signal: controller.signal, method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project ?? state),
    });
    if (!response.ok) throw new Error(await response.text());
    const [{ renderStillOnWeb }, { TimelineComposition }] = await Promise.all([
      import('@remotion/web-renderer'), import('../../editor/TimelineComposition'),
    ]);
    const durationInFrames = Math.max(1, project && timelineId
      ? resolveTimelineRenderPlan(project, timelineId).durationInFrames : timelineDuration(state));
    const props = { state, project, timelineId, transparent: false, browserRenderer: true };
    const images: Array<{ frame: number; base64: string }> = [];
    for (const requested of frames.slice(0, 8)) {
      const frame = Math.max(0, Math.min(durationInFrames - 1, Math.round(requested)));
      const rendering = renderStillOnWeb({
        signal: controller.signal,
        composition: { id: 'miniapp-still', component: TimelineComposition,
          durationInFrames, fps: state.fps, width: state.width, height: state.height, defaultProps: props },
        inputProps: props, frame, scale: Math.min(1, 640 / state.width),
      });
      // 宿主可能在 60 秒后结束工具请求，先释放本次草稿调用，避免一直显示忙碌。
      let onAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const result = await Promise.race([rendering, aborted]).finally(() => controller.signal.removeEventListener('abort', onAbort));
      const blob = await result.blob({ format: 'jpeg', quality: 0.72 });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]!);
        reader.onerror = () => reject(reader.error ?? new Error('无法读取预览图片'));
        reader.readAsDataURL(blob);
      });
      images.push({ frame, base64 });
    }
    return images;
  } finally { clearTimeout(timeout); }
}
