import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../miniapp/client/app.js', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('function syncMedia() {'), source.indexOf('function seekMediaWhilePaused()'));

for (const chained of [false, true]) {
  for (const waiting of ['seek', 'loading', 'seek-and-loading']) {
    test(`${chained ? 'Web Audio' : 'element gain'} resumes after ${waiting} without a persistent mute`, () => {
      const events = [];
      const chain = { vol: { value: 0.35 } };
      let time = waiting === 'loading' ? 2 : 0;
      const el = {
        paused: true, seeking: false, readyState: waiting === 'seek' ? 4 : 1,
        playbackRate: 1, volume: 1,
        get currentTime() { return time; },
        set currentTime(value) { time = value; this.seeking = true; events.push('seek'); },
        pause() { this.paused = true; events.push('pause'); },
        play() {
          assert.equal(this.seeking, false);
          assert.ok(this.readyState >= 2);
          assert.equal(this.volume, chained ? 1 : 0.35, 'restore volume before play');
          if (chained) assert.equal(chain.vol.value, 0.35);
          this.paused = false; events.push('play'); return Promise.resolve();
        },
      };
      const clip = { id: 'a', kind: 'audio', start: 0 };
      const context = vm.createContext({
        state: { time: 0, playing: true },
        runtime: { audio: null, clipGain: new Map(chained ? [['a', chain]] : []) },
        VIDEO_PREFETCH_SEC: 0.85, playRate: () => 1, mediaClips: () => [clip],
        getClipEl: () => el, clipRenders: () => true, mediaTimeAt: () => 2,
        activeAt: () => true, evalProps: () => ({ speed: 1 }),
        clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
        muteClipChain: (c) => { if (c) c.vol.value = 0; },
        driveClipChain: (c) => { c.vol.value = 0.35; },
        clipAudioGain: () => 0.35,
      });
      vm.runInContext(fn + '\nsyncMedia();', context);
      assert.equal(events.includes('play'), false);
      assert.equal(el.volume, 0);
      if (chained) assert.equal(chain.vol.value, 0);
      el.seeking = false;
      if (waiting !== 'seek') {
        vm.runInContext('syncMedia();', context);
        assert.equal(events.includes('play'), false, 'wait for decoded media too');
      }
      el.readyState = 4;
      vm.runInContext('syncMedia();', context);
      assert.equal(events.filter((e) => e === 'play').length, 1);
      assert.equal(el.volume, chained ? 1 : 0.35);
      vm.runInContext('syncMedia();', context);
      assert.equal(el.volume, chained ? 1 : 0.35, 'steady playback retains correct gain');
    });
  }
}
