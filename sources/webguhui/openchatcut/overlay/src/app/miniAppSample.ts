import { docFromTimeline, createProject, saveProjectThumb } from '../persist/projectStore';
import { uploadFile } from '../media/uploadTransport';
import type { MediaAsset, TimelineItem } from '../editor/types';

// 原创示例在本机生成，使用正常素材上传与工程保存流程；不覆盖旧示例。
const scenes = [
  { title: '把灵感，剪成作品', note: 'OPENVIDEO', color: '#df8f57', caption: '从一个想法开始，把素材变成故事。' },
  { title: '每一步，都能看见', note: 'EDIT · PREVIEW · REFINE', color: '#68b7aa', caption: '调整画面和字幕，预览后再应用修改。' },
  { title: '你的第一支短片', note: 'MADE BY YOU', color: '#a69cdb', caption: '现在试着改一句字幕，再导出你的作品。' },
];
function picture(index: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const c = canvas.getContext('2d'); if (!c) throw new Error('无法创建示例画面，请重试');
  const scene = scenes[index]; c.fillStyle = '#141619'; c.fillRect(0, 0, 1280, 720);
  const glow = c.createRadialGradient(1050, 200, 0, 1050, 200, 650); glow.addColorStop(0, scene.color); glow.addColorStop(1, '#141619');
  c.globalAlpha = 0.42; c.fillStyle = glow; c.fillRect(0, 0, 1280, 720); c.globalAlpha = 1;
  c.strokeStyle = scene.color; c.lineWidth = 2;
  for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(1040, 230, 90 + i * 38, 0, Math.PI * 2); c.stroke(); }
  c.fillStyle = scene.color; c.font = '500 22px sans-serif'; c.fillText(scene.note, 90, 110);
  c.fillStyle = '#faf8f3'; c.font = '600 68px sans-serif'; c.fillText(scene.title, 90, 340);
  c.fillStyle = '#a7abb3'; c.font = '24px sans-serif'; c.fillText('12 秒，完成一次从想法到成片的练习', 94, 400);
  for (let i = 0; i < 3; i++) { c.fillStyle = i === index ? scene.color : '#414449'; c.fillRect(94 + i * 112, 490, 92, 5); }
  c.fillStyle = '#a7abb3'; c.font = '18px sans-serif'; c.fillText(`0${index + 1} / 03`, 1100, 640);
  return canvas;
}
function soundtrack(): Blob {
  const rate = 22050, count = rate * 12; const bytes = new ArrayBuffer(44 + count * 2), v = new DataView(bytes);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + count * 2, true); text(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, count * 2, true);
  const notes = [261.63, 329.63, 392, 523.25, 220, 329.63, 440, 392];
  for (let i = 0; i < count; i++) { const t = i / rate, phase = t % 0.5, f = notes[Math.floor(t * 2) % notes.length]; const envelope = Math.min(1, phase * 80) * Math.exp(-phase * 5) * Math.min(1, t, 12 - t); const sample = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * 0.16 * envelope; v.setInt16(44 + i * 2, Math.round(sample * 32767), true); }
  return new Blob([bytes], { type: 'audio/wav' });
}
export async function miniAppSampleDoc() {
  await document.fonts.ready;
  const assets: MediaAsset[] = [], items: TimelineItem[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const canvas = picture(i); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('示例画面生成失败')), 'image/png'));
    const media = await uploadFile(new File([blob], `minimax-sample-${i + 1}.png`, { type: blob.type }));
    const id = `sample_image_${i}`; assets.push({ id, name: scenes[i].title, kind: 'image', ...media, width: 1280, height: 720, durationInFrames: 120 });
    items.push({ id: `sample_scene_${i}`, sourceAssetId: id, name: scenes[i].title, kind: 'image', track: 'V1', ...media, startFrame: i * 120, durationInFrames: 120, width: 1280, height: 720, fadeInFrames: i === 0 ? 0 : 10, fadeOutFrames: 10 });
  }
  const audio = await uploadFile(new File([soundtrack()], 'minimax-sample-music.wav', { type: 'audio/wav' }));
  assets.push({ id: 'sample_music', name: '原创示例配乐', kind: 'audio', ...audio, durationInFrames: 360 });
  items.push({ id: 'sample_music_clip', sourceAssetId: 'sample_music', name: '原创示例配乐', kind: 'audio', track: 'A1', ...audio, startFrame: 0, durationInFrames: 360, fadeInFrames: 15, fadeOutFrames: 30, volume: 0.7 });
  return docFromTimeline({ fps: 30, width: 1280, height: 720, items, assets, selectedId: null, captions: { enabled: true, template: 'plain', pacing: 'phrase', words: scenes.map((s, i) => ({ text: s.caption, start: i * 4000 + 300, end: (i + 1) * 4000 - 300 })) } });
}
export async function createMiniAppSample() {
  const doc = await miniAppSampleDoc(); const project = await createProject('从灵感到作品 · 入门示例', doc);
  // 封面保存失败不影响已经成功创建的工程。
  await saveProjectThumb(project.id, project.updatedAt + 2, picture(0).toDataURL('image/jpeg', 0.8)).catch(() => undefined);
  return project;
}
