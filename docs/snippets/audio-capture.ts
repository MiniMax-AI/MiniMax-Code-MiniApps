/**
 * Copyable microphone capture for `window.mcode.miniapp.speech.transcribe`.
 * Produces exactly the PCM the Host transcribes: 16 kHz, mono, signed 16-bit little-endian.
 * No Host or runtime import; copy it into the Client bundle. Keep the .ts filename because
 * Electron dependency packaging filters out .d.ts assets. See docs/client.md for usage.
 * Copy it next to client-api.ts from examples/hello-miniapp/miniapp/client/, whose types it imports.
 */
import type { MiniAppSpeechAudioFormat } from './client-api.js';

export const SPEECH_AUDIO_FORMAT: MiniAppSpeechAudioFormat = {
  sampleRate: 16000,
  channelCount: 1,
  sampleFormat: 's16',
};

export interface SpeechCapture {
  /** Stops the microphone and returns everything recorded since `startSpeechCapture`. */
  stop(): Int16Array;
  /** Stops the microphone and discards the recording. */
  cancel(): void;
  /** 0..1 RMS level of the latest audio block, for a level meter. */
  readonly level: number;
}

const BUFFER_SIZE = 4096;

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * Opens the microphone (the Host grants it only when this Mini App declares
 * `deviceAccess: ["microphone"]` and the user left the switch on; otherwise `getUserMedia`
 * rejects with `NotAllowedError`) and accumulates 16 kHz mono PCM until `stop()`.
 */
export async function startSpeechCapture(
  options: { deviceId?: string } = {},
): Promise<SpeechCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
      ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    },
  });
  // The AudioContext resamples the microphone to the Host's rate; do not change it.
  const context = new AudioContext({ sampleRate: SPEECH_AUDIO_FORMAT.sampleRate });
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1);
  const chunks: Int16Array[] = [];
  let level = 0;
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(toInt16(input));
    let sum = 0;
    for (let i = 0; i < input.length; i += 1) sum += (input[i] ?? 0) ** 2;
    level = Math.min(1, Math.sqrt(sum / input.length) / 0.15);
  };
  source.connect(processor);
  processor.connect(context.destination);

  const teardown = () => {
    processor.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };

  return {
    get level() {
      return level;
    },
    stop() {
      teardown();
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const pcm = new Int16Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        pcm.set(chunk, offset);
        offset += chunk.length;
      }
      return pcm;
    },
    cancel() {
      teardown();
      chunks.length = 0;
    },
  };
}
