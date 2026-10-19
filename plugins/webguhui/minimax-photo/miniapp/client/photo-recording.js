// Records the editor's rendered canvas, never the desktop or other windows.
export function createCanvasRecording({ canvas, changed, failed }) {
  let recorder, stream, chunks = [], bytes = 0, timer, blob;
  let state = 'idle';
  const publish = () => changed(state);
  const release = () => {
    clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
  };
  function stop() {
    if (state !== 'recording') return;
    state = 'stopping';
    publish();
    recorder.stop();
  }
  return {
    get pending() { return state !== 'idle'; },
    get state() { return state; },
    start() {
      if (state !== 'idle') throw Error('Save the previous recording first');
      const source = canvas();
      if (!source?.captureStream || typeof MediaRecorder === 'undefined')
        throw Error('Canvas recording is unavailable');
      try {
        const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
          .find(type => MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw Error('WebM recording is unavailable');
        stream = source.captureStream(20);
        recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1200000 });
        chunks = []; bytes = 0;
        recorder.ondataavailable = ({ data }) => {
          if (data.size) { chunks.push(data); bytes += data.size; }
          // Keep a bounded recording in memory; the finished video stays available to save.
          if (bytes >= 256 * 1024 * 1024) stop();
        };
        recorder.onerror = event => failed(event.error || Error('Recording failed'));
        recorder.onstop = () => {
          release();
          blob = new Blob(chunks, { type: recorder.mimeType });
          chunks = [];
          state = blob.size ? 'ready' : 'idle';
          if (!blob.size) failed(Error('The recording is empty'));
          publish();
        };
        recorder.start(1000);
        state = 'recording'; publish();
        timer = setTimeout(stop, 60 * 60 * 1000);
      } catch (error) {
        release(); recorder = undefined; state = 'idle'; publish(); throw error;
      }
    },
    stop,
    download() {
      if (state !== 'ready') return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'MiniMax-Photo-process.webm';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      // Keep the blob so a cancelled save can be retried.
    },
    discard() {
      if (state !== 'ready') return;
      blob = undefined; recorder = undefined; state = 'idle'; publish();
    },
  };
}
