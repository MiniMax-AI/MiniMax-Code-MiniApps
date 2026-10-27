import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpeechInput } from '../miniapp/client/speech-input.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(options = {}) {
  const states = [], texts = [], partials = [], calls = [], contexts = [], streams = [];
  const timers = new Map();
  let nextTimer = 0, gumCalls = 0;
  const makeStream = () => {
    const listeners = new Set();
    const track = {
      readyState: 'live', stops: 0,
      stop() { this.stops++; this.readyState = 'ended'; },
      addEventListener(type, listener) { if (type === 'ended') listeners.add(listener); },
      removeEventListener(type, listener) { if (type === 'ended') listeners.delete(listener); },
      end() { this.readyState = 'ended'; for (const listener of [...listeners]) listener(); },
    };
    const stream = { track, getTracks: () => [track], getAudioTracks: () => [track] };
    streams.push(stream);
    return stream;
  };
  const miniapp = {
    capabilities: { has: (name) => name === 'speech.transcribe' },
    speech: { transcribe: async (input, callbacks) => {
      calls.push(input);
      assert.equal(streams.at(-1).track.stops, 1, 'microphone closes before transcription');
      callbacks.onPartial('processing');
      return options.transcribe ? options.transcribe(input, callbacks) : { text: 'recognized' };
    } },
  };
  const makeContext = () => {
    const node = () => ({ disconnects: 0, connect() {}, disconnect() { this.disconnects++; } });
    const context = {
      sampleRate: options.rate ?? 48000, destination: {}, closes: 0,
      source: node(), processor: node(), mute: { ...node(), gain: { value: 1 } },
      resume: () => options.resume ? options.resume() : Promise.resolve(),
      close() { this.closes++; return Promise.resolve(); },
      createMediaStreamSource() { this.createdSource = true; return this.source; },
      createScriptProcessor() {
        if (options.setupFailure) throw new Error('processor failed');
        this.createdProcessor = true;
        return this.processor;
      },
      createGain() { this.createdMute = true; return this.mute; },
    };
    contexts.push(context);
    return context;
  };
  const input = createSpeechInput({
    getMiniApp: () => options.miniapp === undefined ? miniapp : options.miniapp,
    onState: (state) => states.push(state), onText: (text) => texts.push(text),
    onPartial: (text) => partials.push(text),
    dependencies: {
      getUserMedia: (constraints) => {
        gumCalls++;
        assert.equal(constraints.audio.channelCount, 1);
        return options.getUserMedia ? options.getUserMedia() : Promise.resolve(makeStream());
      },
      createAudioContext: makeContext,
      setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
  });
  const feed = (...channels) => {
    const arrays = channels.map((values) => Float32Array.from(values));
    contexts.at(-1).processor.onaudioprocess?.({ inputBuffer: {
      length: arrays[0].length, numberOfChannels: arrays.length,
      getChannelData: (index) => arrays[index],
    } });
  };
  const assertReleased = () => {
    for (const context of contexts) {
      assert.equal(context.closes, 1);
      if (context.createdSource) assert.equal(context.source.disconnects, 1);
      if (context.createdProcessor) {
        assert.equal(context.processor.disconnects, 1);
        assert.equal(context.processor.onaudioprocess, null);
      }
      if (context.createdMute) assert.equal(context.mute.disconnects, 1);
    }
    for (const stream of streams) assert.equal(stream.track.stops, 1);
    assert.equal(timers.size, 0);
  };
  return { input, miniapp, states, texts, partials, calls, contexts, streams, timers,
    makeStream, feed, assertReleased, gumCalls: () => gumCalls };
}

test('records actual 48 kHz stereo input, downmixes/resamples to 16 kHz s16, and delivers one final text', async () => {
  const f = fixture();
  assert.equal(f.input.isAvailable(), true);
  await f.input.start();
  f.feed(Array(480).fill(0.8), Array(480).fill(0.2));
  await f.input.stop();
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].audio instanceof Int16Array);
  assert.equal(f.calls[0].audio.length, 160);
  assert.ok(f.calls[0].audio.every((value) => value === 16384));
  assert.deepEqual(f.calls[0].format, { sampleRate: 16000, channelCount: 1, sampleFormat: 's16' });
  assert.deepEqual(f.states.map(({ state }) => state), ['requesting', 'recording', 'transcribing', 'idle']);
  assert.deepEqual(f.partials, ['processing']);
  assert.deepEqual(f.texts, ['recognized']);
  f.assertReleased();
});

test('uses the actual 44.1 kHz context rate rather than the requested rate', async () => {
  const f = fixture({ rate: 44100 });
  await f.input.start();
  f.feed(Array(441).fill(1));
  await f.input.stop();
  assert.equal(f.calls[0].audio.length, 160);
  assert.ok(f.calls[0].audio.every((value) => value === 32767));
  f.assertReleased();
});

test('converts clipped/non-finite samples safely and supports lower sample rates', async () => {
  const f = fixture({ rate: 16000 });
  await f.input.start();
  f.feed([-2, -1, -0.5, 0, 0.5, 1, 2, NaN]);
  await f.input.stop();
  assert.deepEqual([...f.calls[0].audio], [-32768, -32768, -16384, 0, 16384, 32767, 32767, 0]);
  f.assertReleased();
  const low = fixture({ rate: 8000 });
  await low.input.start();
  low.feed([0, 0.5, 1, 0]);
  await low.input.stop();
  assert.equal(low.calls[0].audio.length, 8);
  low.assertReleased();
});

test('feature detection requires the synchronous capability and the real transcription method', async () => {
  for (const miniapp of [null, {}, { speech: { transcribe() {} } },
    { capabilities: { has: () => false }, speech: { transcribe() {} } },
    { capabilities: { has: () => true } }, { capabilities: { has: async () => true }, speech: { transcribe() {} } }]) {
    const f = fixture({ miniapp });
    assert.equal(f.input.isAvailable(), false);
    await f.input.start();
    assert.deepEqual(f.states, [{ state: 'error', errorCode: 'speech_unavailable' }]);
    assert.equal(f.gumCalls(), 0);
  }
});

test('capability support does not bypass the microphone permission grant', async () => {
  const f = fixture({ getUserMedia: () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) });
  assert.equal(f.input.isAvailable(), true);
  await f.input.start();
  assert.deepEqual(f.states.at(-1), { state: 'error', errorCode: 'not_permitted' });
  assert.equal(f.calls.length, 0);
  f.assertReleased();
});

test('missing/unreadable microphone and setup failures release every acquired resource', async () => {
  for (const name of ['NotFoundError', 'NotReadableError']) {
    const f = fixture({ getUserMedia: () => Promise.reject(Object.assign(new Error(name), { name })) });
    await f.input.start();
    assert.deepEqual(f.states.at(-1), { state: 'error', errorCode: 'microphone_unavailable' });
    f.assertReleased();
  }
  const f = fixture({ setupFailure: true });
  await f.input.start();
  assert.deepEqual(f.states.at(-1), { state: 'error', errorCode: 'capture_failed' });
  f.assertReleased();
});

test('cancel or stop during getUserMedia settles start and stops a late granted stream', async () => {
  for (const action of ['cancel', 'stop']) {
    const permission = deferred();
    const f = fixture({ getUserMedia: () => permission.promise });
    const starting = f.input.start();
    f.input[action]();
    await starting;
    permission.resolve(f.makeStream());
    await flush();
    assert.deepEqual(f.states.map(({ state }) => state), ['requesting', 'idle']);
    assert.equal(f.calls.length, 0);
    f.assertReleased();
  }
});

test('dispose during permission prompt drops callbacks, releases context and stops the late stream', async () => {
  const permission = deferred();
  const f = fixture({ getUserMedia: () => permission.promise });
  const starting = f.input.start();
  f.input.dispose();
  f.input.dispose();
  await starting;
  permission.resolve(f.makeStream());
  await flush();
  assert.deepEqual(f.states, [{ state: 'requesting' }]);
  assert.equal(f.input.isAvailable(), false);
  await f.input.start();
  assert.equal(f.gumCalls(), 1);
  f.assertReleased();
});

test('a failed audio context resume cannot leak a late microphone stream', async () => {
  const permission = deferred();
  const f = fixture({ getUserMedia: () => permission.promise, resume: () => Promise.reject(new Error('audio unavailable')) });
  await f.input.start();
  permission.resolve(f.makeStream());
  await flush();
  assert.deepEqual(f.states.at(-1), { state: 'error', errorCode: 'capture_failed' });
  f.assertReleased();
});

test('cancel during recording discards audio; an externally ended track reports microphone failure', async () => {
  const f = fixture();
  await f.input.start();
  f.feed([1, 1, 1]);
  f.input.cancel();
  await f.input.stop();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.states.at(-1), { state: 'idle' });
  f.assertReleased();
  const ended = fixture();
  await ended.input.start();
  ended.streams[0].track.end();
  assert.deepEqual(ended.states.at(-1), { state: 'error', errorCode: 'microphone_unavailable' });
  ended.assertReleased();
});

test('empty recordings report no_audio without calling ASR', async () => {
  const f = fixture();
  await f.input.start();
  await f.input.stop();
  assert.deepEqual(f.states.at(-1), { state: 'error', errorCode: 'no_audio' });
  assert.equal(f.calls.length, 0);
  f.assertReleased();
});

test('the 60 second timer stops recording and transcribes the audio actually received', async () => {
  const f = fixture({ rate: 16000 });
  await f.input.start();
  f.feed(Array(160).fill(0.2));
  const timer = [...f.timers.values()][0];
  assert.equal(timer.ms, 60000);
  timer.callback();
  await flush();
  assert.equal(f.calls[0].audio.length, 160);
  assert.deepEqual(f.texts, ['recognized']);
  f.assertReleased();
});

test('an audio block is bounded to 60 seconds even if the wall-clock timer is delayed', async () => {
  const f = fixture({ rate: 16000 });
  await f.input.start();
  f.feed(new Float32Array(16000 * 60 + 100));
  await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].audio.length, 16000 * 60);
  f.assertReleased();
});

test('repeated start and stop cannot duplicate capture, transcription or final text', async () => {
  const result = deferred();
  const f = fixture({ transcribe: () => result.promise });
  const first = f.input.start();
  await f.input.start();
  await first;
  await f.input.start();
  f.feed([1, 1, 1]);
  const one = f.input.stop();
  const two = f.input.stop();
  assert.equal(one, two);
  await flush();
  assert.equal(f.gumCalls(), 1);
  assert.equal(f.calls.length, 1);
  result.resolve({ text: 'only once' });
  await Promise.all([one, two]);
  assert.deepEqual(f.texts, ['only once']);
  f.assertReleased();
});

test('cancel/dispose during ASR ignore its late partial, final and failure results', async () => {
  for (const action of ['cancel', 'dispose']) {
    const result = deferred();
    let callbacks;
    const f = fixture({ transcribe: (_input, options) => { callbacks = options; return result.promise; } });
    await f.input.start();
    f.feed([1, 1, 1]);
    const stopping = f.input.stop();
    await flush();
    f.input[action]();
    const count = f.states.length;
    callbacks.onPartial('late partial');
    result.resolve({ text: 'late text' });
    await stopping;
    assert.deepEqual(f.texts, []);
    assert.deepEqual(f.partials, ['processing']);
    assert.equal(f.states.length, count);
    f.assertReleased();
  }
});

test('Host rejection codes and malformed results are surfaced without text or retry', async () => {
  for (const code of ['not_permitted', 'busy', 'runtime_unavailable', 'transcription_failed', 'result_unknown']) {
    const f = fixture({ transcribe: () => Promise.reject(new Error(code)) });
    await f.input.start();
    f.feed([1, 1, 1]);
    await f.input.stop();
    assert.deepEqual(f.states.at(-1), { state: 'error', errorCode: code });
    assert.deepEqual(f.texts, []);
    assert.equal(f.calls.length, 1);
    f.assertReleased();
  }
  const f = fixture({ transcribe: () => ({ text: 42 }) });
  await f.input.start();
  f.feed([1, 1, 1]);
  await f.input.stop();
  assert.deepEqual(f.states.at(-1), { state: 'error', errorCode: 'result_unknown' });
  f.assertReleased();
});

test('capability withdrawal after recording preserves the recording failure and never calls ASR', async () => {
  const f = fixture();
  await f.input.start();
  f.feed([1, 1, 1]);
  f.miniapp.capabilities.has = () => false;
  await f.input.stop();
  assert.deepEqual(f.states.at(-1), { state: 'error', errorCode: 'speech_unavailable' });
  assert.equal(f.calls.length, 0);
  f.assertReleased();
});

test('a cancelled ASR cannot settle or overwrite a newer recording and result', async () => {
  const old = deferred();
  let invocation = 0;
  const f = fixture({ transcribe: () => ++invocation === 1 ? old.promise : { text: 'new recording' } });
  await f.input.start();
  f.feed([1, 1, 1]);
  const oldStop = f.input.stop();
  await flush();
  f.input.cancel();
  await f.input.start();
  f.feed([0.5, 0.5, 0.5]);
  await f.input.stop();
  old.resolve({ text: 'old recording' });
  await oldStop;
  assert.deepEqual(f.texts, ['new recording']);
  assert.deepEqual(f.states.at(-1), { state: 'idle' });
  assert.equal(f.calls.length, 2);
  f.assertReleased();
});

test('a cancelled ASR rejection is ignored rather than replacing the idle state with an error', async () => {
  const old = deferred();
  const f = fixture({ transcribe: () => old.promise });
  await f.input.start();
  f.feed([1, 1, 1]);
  const stopping = f.input.stop();
  await flush();
  f.input.cancel();
  const count = f.states.length;
  old.reject(new Error('transcription_failed'));
  await stopping;
  assert.equal(f.states.length, count);
  assert.deepEqual(f.states.at(-1), { state: 'idle' });
  assert.deepEqual(f.texts, []);
  f.assertReleased();
});

test('synchronous getUserMedia failure and asynchronous resume failure are both consumed', async () => {
  const f = fixture({
    getUserMedia: () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); },
    resume: () => Promise.reject(new Error('resume failed')),
  });
  await f.input.start();
  await flush();
  assert.equal(f.states.at(-1).state, 'error');
  assert.equal(f.calls.length, 0);
  f.assertReleased();
});
