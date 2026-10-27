// The page records one utterance; the public Host API only transcribes its PCM.
const FORMAT = Object.freeze({ sampleRate: 16000, channelCount: 1, sampleFormat: 's16' });
const MAX_DURATION_MS = 60000;
const BUFFER_SIZE = 4096;
const HOST_ERRORS = new Set([
  'invalid_request', 'not_permitted', 'audio_too_large', 'busy',
  'runtime_unavailable', 'transcription_failed', 'result_unknown',
]);

function errorCode(error, phase) {
  const code = error?.code || error?.message;
  if (HOST_ERRORS.has(code)) return code;
  if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error?.name))
    return 'not_permitted';
  if (['NotFoundError', 'DevicesNotFoundError', 'NotReadableError', 'TrackStartError', 'OverconstrainedError'].includes(error?.name))
    return 'microphone_unavailable';
  return phase === 'transcribing' ? 'result_unknown' : 'capture_failed';
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try { track.stop(); } catch { /* Release the other tracks too. */ }
  }
}

function toPcm(chunks, length, sampleRate) {
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const ratio = sampleRate / FORMAT.sampleRate;
  const pcm = new Int16Array(Math.floor(length / ratio));
  for (let i = 0; i < pcm.length; i++) {
    const start = i * ratio;
    let sample;
    if (ratio >= 1) {
      // Average each source interval, including fractional edges, rather than
      // mislabelling 44.1/48 kHz samples as 16 kHz or just dropping samples.
      const end = Math.min(length, (i + 1) * ratio);
      let sum = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j++) {
        const weight = Math.min(end, j + 1) - Math.max(start, j);
        sum += (Number.isFinite(samples[j]) ? samples[j] : 0) * weight;
      }
      sample = sum / (end - start);
    } else {
      const left = Math.floor(start);
      const right = Math.min(length - 1, left + 1);
      const fraction = start - left;
      sample = samples[left] * (1 - fraction) + samples[right] * fraction;
    }
    sample = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
    pcm[i] = Math.round(sample < 0 ? sample * 32768 : sample * 32767);
  }
  return pcm;
}

/**
 * Owns one microphone recording and one final-text delivery at a time.
 * Expected failures resolve start/stop and are reported through onState.
 * `dependencies` only replaces browser/timer boundaries for focused Node tests.
 */
export function createSpeechInput({
  getMiniApp = () => globalThis.window?.mcode?.miniapp,
  onState = () => {},
  onText = () => {},
  onPartial = () => {},
  dependencies = {},
} = {}) {
  const getUserMedia = dependencies.getUserMedia ?? ((constraints) =>
    globalThis.navigator.mediaDevices.getUserMedia(constraints));
  const createAudioContext = dependencies.createAudioContext ?? (() => {
    const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    return new AudioContext({ sampleRate: FORMAT.sampleRate });
  });
  const schedule = dependencies.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const unschedule = dependencies.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  let state = 'idle';
  let generation = 0;
  let disposed = false;
  let capture = null;
  let stopping = null;

  function emit(callback, value) {
    try { callback(value); } catch { /* A view callback must not leak the microphone. */ }
  }
  function setState(next, code) {
    if (disposed) return;
    state = next;
    emit(onState, { state: next, ...(code ? { errorCode: code } : {}) });
  }
  function speech() {
    try {
      const miniapp = getMiniApp();
      return miniapp?.capabilities?.has?.('speech.transcribe') === true &&
        typeof miniapp?.speech?.transcribe === 'function' ? miniapp.speech : null;
    } catch { return null; }
  }
  function isAvailable() {
    return !disposed && !!speech() &&
      (!!dependencies.getUserMedia || typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function') &&
      (!!dependencies.createAudioContext || typeof (globalThis.AudioContext ?? globalThis.webkitAudioContext) === 'function');
  }
  const current = (token) => !disposed && generation === token;

  function release(recording) {
    if (!recording || recording.released) return Promise.resolve();
    recording.released = true;
    recording.cancelReady();
    if (recording.timer !== null) unschedule(recording.timer);
    recording.processor && (recording.processor.onaudioprocess = null);
    for (const stop of recording.trackListeners) stop();
    for (const node of [recording.source, recording.processor, recording.mute]) {
      try { node?.disconnect(); } catch { /* Continue releasing remaining resources. */ }
    }
    stopTracks(recording.stream);
    recording.chunks.length = 0;
    try { return Promise.resolve(recording.context.close()).catch(() => {}); }
    catch { return Promise.resolve(); }
  }

  function fail(token, code) {
    if (!current(token)) return;
    generation++;
    const recording = capture;
    capture = null;
    void release(recording);
    setState('error', code);
  }

  async function start() {
    if (disposed || ['requesting', 'recording', 'transcribing'].includes(state)) return;
    if (!isAvailable()) { setState('error', 'speech_unavailable'); return; }
    const token = ++generation;
    setState('requesting');
    // A callback may have synchronously cancelled or disposed the request.
    if (!current(token)) return;
    let recording;
    try {
      const context = createAudioContext();
      let cancelReady;
      const cancelled = new Promise((resolve) => { cancelReady = resolve; });
      recording = {
        context, stream: null, source: null, processor: null, mute: null,
        chunks: [], frames: 0, timer: null, released: false,
        trackListeners: [], cancelReady,
      };
      capture = recording;
      if (!Number.isFinite(context.sampleRate) || context.sampleRate <= 0)
        throw new Error('Invalid microphone sample rate');
      // Start/resume inside start's user gesture, before awaiting the permission prompt.
      const resumed = Promise.resolve(context.resume());
      let media;
      try {
        media = getUserMedia({ audio: {
          channelCount: 1, echoCancellation: true, autoGainControl: true, noiseSuppression: true,
        } });
      } catch (error) { media = Promise.reject(error); }
      const acquired = Promise.resolve(media).then((stream) => {
        if (!current(token) || capture !== recording || recording.released) {
          stopTracks(stream);
          return;
        }
        recording.stream = stream;
      });
      await Promise.race([Promise.all([resumed, acquired]), cancelled]);
      if (!current(token) || capture !== recording || recording.released) return;
      const tracks = recording.stream?.getAudioTracks?.() ?? recording.stream?.getTracks?.() ?? [];
      if (!tracks.length || tracks.every((track) => track.readyState === 'ended'))
        throw Object.assign(new Error('No active microphone'), { name: 'NotFoundError' });
      for (const track of tracks) {
        const ended = () => fail(token, 'microphone_unavailable');
        track.addEventListener?.('ended', ended);
        recording.trackListeners.push(() => track.removeEventListener?.('ended', ended));
      }
      recording.source = context.createMediaStreamSource(recording.stream);
      // ScriptProcessor is the same zero-build capture boundary used by the Host's
      // public copyable helper. No worklet/runtime package or encoded audio is needed.
      recording.processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1);
      recording.mute = context.createGain();
      recording.mute.gain.value = 0;
      recording.processor.onaudioprocess = (event) => {
        if (!current(token) || capture !== recording || recording.released) return;
        try {
          const input = event.inputBuffer;
          const remaining = Math.max(0, Math.floor(context.sampleRate * MAX_DURATION_MS / 1000) - recording.frames);
          const length = Math.min(input.length, remaining);
          if (length > 0) {
            const mono = new Float32Array(length);
            const channels = input.numberOfChannels;
            for (let channel = 0; channel < channels; channel++) {
              const values = input.getChannelData(channel);
              for (let i = 0; i < length; i++) mono[i] += (Number.isFinite(values[i]) ? values[i] : 0) / channels;
            }
            recording.chunks.push(mono);
            recording.frames += length;
          }
          if (!remaining || length === remaining) void stop();
        } catch { fail(token, 'capture_failed'); }
      };
      recording.source.connect(recording.processor);
      recording.processor.connect(recording.mute);
      recording.mute.connect(context.destination);
      recording.timer = schedule(() => { if (current(token)) void stop(); }, MAX_DURATION_MS);
      setState('recording');
    } catch (error) {
      if (current(token)) fail(token, errorCode(error, 'capture'));
      else void release(recording);
    }
  }

  function stop() {
    if (disposed) return Promise.resolve();
    if (stopping) return stopping;
    if (state === 'requesting') { cancel(); return Promise.resolve(); }
    if (state !== 'recording' || !capture) return Promise.resolve();
    const token = generation;
    const recording = capture;
    capture = null;
    let pcm;
    try { pcm = toPcm(recording.chunks, recording.frames, recording.context.sampleRate); }
    catch { void release(recording); fail(token, 'capture_failed'); return Promise.resolve(); }
    const released = release(recording);
    if (!pcm.length) { fail(token, 'no_audio'); return released; }
    setState('transcribing');
    if (!current(token)) return released;
    const pending = (async () => {
      try {
        await released;
        if (!current(token)) return;
        const api = speech();
        if (!api) { fail(token, 'speech_unavailable'); return; }
        const transcription = api.transcribe({ audio: pcm, format: { ...FORMAT } }, {
          onPartial: (text) => {
            if (current(token) && state === 'transcribing' && typeof text === 'string') emit(onPartial, text);
          },
        });
        // The bridge owns the dispatched audio; do not retain another recording
        // reference while waiting, particularly after cancel/dispose.
        pcm = null;
        const result = await transcription;
        if (!current(token)) return;
        if (!result || typeof result.text !== 'string') { fail(token, 'result_unknown'); return; }
        emit(onText, result.text);
        if (current(token)) setState('idle');
      } catch (error) {
        fail(token, errorCode(error, 'transcribing'));
      } finally {
        pcm = null;
        if (stopping === pending) stopping = null;
      }
    })();
    stopping = pending;
    return pending;
  }

  function cancel() {
    if (disposed) return;
    generation++;
    const recording = capture;
    capture = null;
    stopping = null;
    void release(recording);
    setState('idle');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    const recording = capture;
    capture = null;
    stopping = null;
    void release(recording);
  }

  return { isAvailable, start, stop, cancel, dispose };
}
