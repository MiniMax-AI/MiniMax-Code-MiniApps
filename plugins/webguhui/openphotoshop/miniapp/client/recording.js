import { download } from './model.js';

let recorder = null;
let requesting = false;

export async function toggleRecording(status) {
  if (requesting) {
    status('正在等待屏幕共享选择，请在浏览器中选择或取消');
    return;
  }
  if (recorder) {
    if (recorder.state === 'recording') recorder.stop();
    status('正在结束录屏，请稍候');
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined')
    throw Error('当前浏览器不支持屏幕录制，请使用系统录屏工具');

  requesting = true;
  status('请选择要录制的修图工作台窗口或标签页');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 20 },
      audio: false,
    });
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const current = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    const chunks = [];
    let failed = false;
    const release = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (recorder === current) recorder = null;
    };
    current.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    current.onerror = () => {
      failed = true;
      release();
      status('录屏失败，已停止屏幕共享，请重试或使用系统录屏工具', true);
    };
    current.onstop = () => {
      release();
      if (failed) return;
      if (!chunks.length) {
        status('未收到录屏内容，请重试或使用系统录屏工具', true);
        return;
      }
      try {
        download(new Blob(chunks, { type: current.mimeType }), '修图操作录屏.webm');
        status('录屏已导出');
      } catch (error) {
        status(error.message || '录屏导出失败', true);
      }
    };
    const video = stream.getVideoTracks()[0];
    if (!video || video.readyState === 'ended') throw Error('屏幕共享已经结束，请重新选择');
    video.onended = () => {
      if (current.state === 'recording') current.stop();
    };
    recorder = current;
    current.start(1000);
    status('正在录屏 · 帮助菜单中再次点击“录制 / 停止录屏”结束');
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    recorder = null;
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      status('未开始录屏：屏幕共享已取消或未获授权');
      return;
    }
    throw error;
  } finally {
    requesting = false;
  }
}
