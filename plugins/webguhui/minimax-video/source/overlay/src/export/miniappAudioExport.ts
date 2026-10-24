import { timelineDuration } from '../editor/types';
import { resolveTimelineRenderPlan } from '../editor/sequenceGraph';
import { recordExport } from '../persist/exportHistoryStore';
import { writeBlobToDestination, exportDestinationFilename, exportHistoryDestinationId } from './exportDestination';
import type { VideoExportContext } from './videoExportOperation';
import { validateVideoExportSequenceGraph } from './videoExportOperation';

export async function exportMiniAppAudio(context: VideoExportContext, signal?: AbortSignal): Promise<void> {
  validateVideoExportSequenceGraph(context.options);
  signal?.throwIfAborted();
  const { state, project, timelineId, base } = context.options;
  const [{ renderMediaOnWeb }, { TimelineComposition }] = await Promise.all([
    import('@remotion/web-renderer'), import('../editor/TimelineComposition'),
  ]);
  const props = { state, project, timelineId, transparent: false, browserRenderer: true };
  context.setRenderEngine('browser');
  context.setEngineInfo({ id: 'browser-pcm-local-mp3', label: '本机混音与 MP3 编码', hardware: false, transport: 'browser' });
  context.setBusy('正在混音…');
  const result = await renderMediaOnWeb({
    composition: { id: 'openchatcut-audio', component: TimelineComposition,
      durationInFrames: Math.max(1, project && timelineId ? resolveTimelineRenderPlan(project, timelineId).durationInFrames : timelineDuration(state)),
      fps: state.fps, width: state.width, height: state.height, defaultProps: props },
    inputProps: props, container: 'wav', audioCodec: 'pcm-s16', videoCodec: null,
    signal, pageResponsiveness: 'medium',
    onProgress: snapshot => context.setProgress(current => current ? { ...current, phase: 'rendering',
      percent: Math.max(current.percent, Math.round(snapshot.progress * 85)), detail: '正在混合时间线音轨' } : current),
  });
  signal?.throwIfAborted();
  context.setBusy('正在编码 MP3…');
  const wav = await result.getBlob();
  const response = await fetch('/export/audio-mp3', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal });
  if (!response.ok) throw new Error(await response.text());
  const mp3 = await response.blob();
  signal?.throwIfAborted();
  const filename = `${base}.mp3`;
  context.setBusy('正在保存…');
  context.setProgress(current => current ? { ...current, phase: 'downloading', percent: 99, outputSize: mp3.size } : current);
  context.beginTargetCommit();
  try {
    await writeBlobToDestination(context.destination, filename, mp3, signal);
    context.markTargetCommitted();
  } catch (error) { context.endTargetCommit(); throw error; }
  const destinationId = exportHistoryDestinationId(context.destination);
  void recordExport({ name: exportDestinationFilename(context.destination, filename), format: 'audio', codec: 'mp3',
    sizeBytes: mp3.size, createdAt: Date.now(), ...(destinationId ? { destinationId } : {}) });
}
