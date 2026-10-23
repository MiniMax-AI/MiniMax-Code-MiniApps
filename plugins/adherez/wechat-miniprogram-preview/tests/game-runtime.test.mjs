import test from 'node:test';
import assert from 'node:assert/strict';
import { gameEnvironment } from './helpers/game-dom.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compileProject } from '../miniapp/node/compiler.mjs';

test('game boot waits for matching init, executes local CommonJS once, and mounts only the first canvas', (t) => {
  const env = gameEnvironment(t, { modules: {
    'game.js': `const value=require('./lib/value'); GameGlobal.started=(GameGlobal.started||0)+1;GameGlobal.answer=value;
      GameGlobal.screen=wx.createCanvas();GameGlobal.offscreen=wx.createCanvas();wx.onShow(()=>GameGlobal.shown=(GameGlobal.shown||0)+1);`,
    'lib/value.js': `module.exports=require('../data.json').value;`, 'data.json': 'module.exports={value:42};',
  } });
  assert.equal(env.messages.at(-1).type, 'ready');
  assert.equal(env.win.started, undefined);
  env.message({ type: 'init', instanceId: 'old', storage: {} });
  env.message({ type: 'init', storage: {} }, {});
  assert.equal(env.win.started, undefined);
  env.init(); env.init();
  assert.equal(env.win.started, 1);
  assert.equal(env.win.answer, 42);
  assert.equal(env.win.GameGlobal, env.win);
  assert.equal(env.win.screen.width, 390);
  assert.equal(env.win.screen.height, 844);
  assert.equal(env.win.screen.isConnected, true);
  assert.equal(env.win.offscreen.isConnected, false);
  assert.equal(env.win.shown, 1);
  assert.equal(env.messages.filter((m) => m.type === 'started').length, 1);
  assert.equal(env.status().status, 'rendered');
  assert.equal(env.win.Page, undefined);
});

test('game capsule stays at document level and matches portrait and landscape menu metrics', (t) => {
  const portrait = gameEnvironment(t); portrait.init();
  const capsule = portrait.win.document.getElementById('wx-capsule');
  assert.ok(capsule);
  assert.equal(capsule.parentElement, portrait.win.document.body);
  assert.equal(capsule.getAttribute('aria-hidden'), 'true');
  assert.deepEqual({ ...portrait.win.wx.getMenuButtonBoundingClientRect() }, {
    width: 88, height: 32, top: 44, bottom: 76, left: 292, right: 380,
  });
  assert.equal(portrait.win.document.documentElement.style.getPropertyValue('--wx-capsule-top'), '44px');

  const landscape = gameEnvironment(t, { orientation: 'landscape' }); landscape.init();
  assert.deepEqual({ ...landscape.win.wx.getMenuButtonBoundingClientRect() }, {
    width: 88, height: 32, top: 12, bottom: 44, left: 746, right: 834,
  });
  assert.equal(landscape.win.document.documentElement.style.getPropertyValue('--wx-capsule-top'), '12px');
  assert.equal(landscape.win.document.documentElement.style.getPropertyValue('--wx-capsule-right'), '10px');
  assert.equal(landscape.win.document.getElementById('wx-capsule').parentElement, landscape.win.document.body);

  for (const showStatusBar of [false, true]) {
    const se = gameEnvironment(t, { showStatusBar }); se.init({ device: '375x667' });
    const top = showStatusBar ? 30 : 10;
    assert.deepEqual({ ...se.win.wx.getMenuButtonBoundingClientRect() }, {
      width: 88, height: 32, top, bottom: top + 32, left: 277, right: 365,
    });
    const notched = gameEnvironment(t, { showStatusBar }); notched.init();
    assert.equal(notched.win.wx.getMenuButtonBoundingClientRect().top, 44);
  }
});

test('scheduler pauses remaining timeout/interval and rAF work, clamps fps, and resumes without catch-up bursts', (t) => {
  const env = gameEnvironment(t, { modules: { 'game.js': `GameGlobal.canvas=wx.createCanvas();GameGlobal.calls=[];GameGlobal.frames=[];
    setTimeout(()=>calls.push('timeout'),100);setInterval(()=>calls.push('interval'),60);
    function draw(time){frames.push(time);requestAnimationFrame(draw)}requestAnimationFrame(draw);` } });
  env.init(); env.advance(30);
  env.message({ type: 'game-control', action: 'pause', requestId: 'pause' });
  env.advance(1000); env.animationFrame();
  assert.deepEqual([...env.win.calls], []);
  assert.equal(env.win.frames.length, 0);
  assert.equal(env.state().paused, true);
  env.message({ type: 'game-control', action: 'resume', requestId: 'resume' });
  env.advance(29); assert.equal(env.win.calls.length, 0);
  env.advance(1); assert.deepEqual([...env.win.calls], ['interval']);
  env.advance(40); assert.deepEqual([...env.win.calls], ['interval', 'timeout']);
  env.win.wx.setPreferredFramesPerSecond(30);
  for (let i = 0; i < 6; i++) env.animationFrame();
  assert.equal(env.win.frames.length, 3);
  env.win.wx.setPreferredFramesPerSecond(144);
  assert.equal(env.state().framesPerSecond, 60);
  assert.throws(() => env.win.wx.setPreferredFramesPerSecond(0), /positive fps/);
});

test('visibility and explicit user pause are independent, and show/hide listeners can be removed', (t) => {
  const env = gameEnvironment(t, { modules: { 'game.js': `wx.createCanvas();GameGlobal.lifecycle=[];const show=()=>lifecycle.push('show');
    wx.onShow(show);wx.onHide(()=>lifecycle.push('hide'));GameGlobal.off=()=>wx.offShow(show);` } });
  env.init();
  env.message({ type: 'visibility', visible: false });
  env.message({ type: 'game-control', action: 'pause' });
  env.message({ type: 'visibility', visible: true });
  assert.equal(env.state().paused, true);
  assert.deepEqual([...env.win.lifecycle], ['show', 'hide']);
  env.message({ type: 'game-control', action: 'resume' });
  assert.deepEqual([...env.win.lifecycle], ['show', 'hide', 'show']);
  env.win.off();
  env.message({ type: 'visibility', visible: false }); env.message({ type: 'visibility', visible: true });
  assert.deepEqual([...env.win.lifecycle], ['show', 'hide', 'show', 'hide']);
});

test('quiesce flush freezes all write APIs and user input while retaining valid synchronous storage semantics', async (t) => {
  const env = gameEnvironment(t, { modules: { 'game.js': `wx.createCanvas();GameGlobal.taps=0;wx.onTouchStart(()=>taps++);` } });
  env.init({ storage: { score: 7 } });
  assert.equal(env.win.wx.getStorageSync('score'), 7);
  env.win.eval('wx.setStorageSync("state",{n:1})');
  assert.deepEqual(env.messages.at(-1).data, { score: 7, state: { n: 1 } });
  const copy = env.win.wx.getStorageSync('state'); copy.n = 9;
  assert.equal(env.win.wx.getStorageSync('state').n, 1);
  env.message({ type: 'quiesce-storage', requestId: 'save' });
  assert.deepEqual(env.messages.at(-1).storage, { score: 7, state: { n: 1 } });
  for (const source of ['wx.setStorageSync("score",8)', 'wx.clearStorageSync()', 'wx.removeStorageSync("score")']) assert.throws(() => env.win.eval(source), /temporarily unavailable/);
  await assert.rejects(env.win.wx.setStorage({ key: 'score', data: 2 }), (err) => /temporarily unavailable/.test(err.errMsg));
  env.message({ type: 'resume-storage', requestId: 'wrong' }); assert.equal(env.state().paused, true);
  env.message({ type: 'resume-storage', requestId: 'save' }); assert.equal(env.state().paused, false);
  for (const source of ['wx.setStorageSync("score",NaN)', 'wx.setStorageSync("score",new Date())', 'wx.setStorageSync("__proto__",1)', 'wx.setStorageSync("score","x".repeat(1048576))']) assert.throws(() => env.win.eval(source), /storage:fail/);
  assert.equal(env.win.wx.getStorageSync('score'), 7);
  env.win.eval('GameGlobal.callbacks=[];wx.getStorage({key:"score",success:v=>callbacks.push(v.data),complete:v=>callbacks.push(v.errMsg)})');
  await env.flush();
  assert.deepEqual([...env.win.callbacks], [7, 'getStorage:ok']);
});

test('landscape pointers report logical CSS coordinates independent of canvas backing DPR and preserve multitouch IDs', (t) => {
  const env = gameEnvironment(t, { orientation: 'landscape', modules: { 'game.js': `GameGlobal.canvas=wx.createCanvas();canvas.width*=3;canvas.height*=3;GameGlobal.touches=[];
    wx.onTouchStart(e=>touches.push(e));wx.onTouchEnd(e=>touches.push(e));` } });
  env.init(); const canvas = env.win.canvas;
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 422, height: 195 });
  const pointer = (type, identifier, x, y) => {
    const event = new env.win.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: identifier }); canvas.dispatchEvent(event);
  };
  pointer('pointerdown', 4, 221, 117.5);
  pointer('pointerdown', 8, 110, 120);
  pointer('pointerup', 4, 221, 117.5);
  assert.equal(env.win.wx.getWindowInfo().windowWidth, 844);
  assert.equal(env.win.wx.getWindowInfo().windowHeight, 390);
  assert.equal(canvas.width, 2532);
  assert.equal(env.win.touches[0].touches[0].clientX, 422);
  assert.equal(env.win.touches[0].touches[0].clientY, 195);
  assert.equal(env.win.touches[1].touches.length, 2);
  assert.deepEqual([...env.win.touches[2].touches].map((x) => x.identifier), [8]);
  assert.equal(env.win.touches[2].changedTouches[0].identifier, 4);
});

test('images resolve only local immutable image assets and do not fall back to network', (t) => {
  const png = 'data:image/png;base64,YQ==';
  const env = gameEnvironment(t, { assets: { 'images/a.png': png } }); env.init();
  const image = env.win.wx.createImage(); image.src = './images/a.png';
  assert.equal(image.src, png);
  let errors = 0; image.onerror = () => errors++;
  image.src = 'https://example.invalid/a.png'; env.advance(0);
  assert.equal(image.getAttribute('src'), null);
  assert.equal(errors, 1);
  assert.equal(env.status().status, 'limited');
});

test('WebGL uses the real provided context and disposal deletes resources, loses context and ignores callbacks', (t) => {
  const calls = [];
  const texture = {}, buffer = {};
  const gl = { createTexture: () => texture, deleteTexture: (v) => calls.push(['texture', v]), createBuffer: () => buffer, deleteBuffer: (v) => calls.push(['buffer', v]), getExtension: () => ({ loseContext: () => calls.push(['lost']) }) };
  const env = gameEnvironment(t, { beforeRuntime(win) { win.HTMLCanvasElement.prototype.getContext = () => gl; }, modules: { 'game.js': `GameGlobal.canvas=wx.createCanvas();GameGlobal.gl=canvas.getContext('webgl');gl.createTexture();gl.createBuffer();GameGlobal.callbacks=0;setInterval(()=>callbacks++,1);requestAnimationFrame(()=>callbacks++);canvas.addEventListener('click',()=>callbacks++);` } });
  env.init(); assert.equal(env.win.gl, gl);
  env.message({ type: 'dispose', requestId: 'dispose-one' });
  env.message({ type: 'dispose', requestId: 'dispose-two' });
  env.advance(200); env.animationFrame();
  env.win.canvas.dispatchEvent(new env.win.MouseEvent('click', { bubbles: true }));
  assert.equal(env.win.callbacks, 0);
  assert.equal(calls.filter((x) => x[0] === 'texture').length, 1);
  assert.equal(calls.filter((x) => x[0] === 'buffer').length, 1);
  assert.equal(calls.filter((x) => x[0] === 'lost').length, 1);
  assert.equal(env.messages.at(-1).type, 'game-disposed');
  assert.equal(env.messages.at(-1).requestId, 'dispose-two');
  assert.equal(env.win.document.querySelector('canvas'), null);
});

test('unsupported native capabilities fail visibly and canIUse never advertises them', async (t) => {
  const env = gameEnvironment(t); env.init();
  for (const name of ['createWorker', 'getOpenDataContext', 'getFileSystemManager']) {
    assert.equal(env.win.wx.canIUse(name), false);
    assert.throws(() => env.win.wx[name](), /not supported/);
  }
  await assert.rejects(env.win.wx.loadSubpackage({ name: 'level' }), (err) => /not supported/.test(err.errMsg));
  await assert.rejects(env.win.wx.cloud.callFunction({ name: 'cloud' }), (err) => /not supported/.test(err.errMsg));
  assert.throws(() => env.win.eval('new Worker("worker.js")'), /not supported/);
  assert.throws(() => env.win.eval('WebAssembly.compile(new Uint8Array())'), /not supported/);
  assert.equal(env.status().status, 'limited');
  assert.equal(env.win.wx.canIUse('createCanvas'), true);
});

test('missing or escaping modules and startup throws are errors instead of started success', (t) => {
  for (const entry of ['require("../../secret")', 'require("node:fs")', 'throw new Error("game exploded")']) {
    const env = gameEnvironment(t, { modules: { 'game.js': entry } }); env.init();
    assert.equal(env.messages.some((m) => m.type === 'started'), false);
    assert.equal(env.messages.at(-1).type, 'startup-error');
    assert.equal(env.status().status, 'error');
  }
});

test('quiesce stops scheduling before onHide, includes its synchronous final storage, then rejects its async tail', async (t) => {
  const env = gameEnvironment(t, { modules: { 'game.js': `wx.createCanvas();GameGlobal.calls=[];
    setInterval(()=>calls.push('tick'),10);requestAnimationFrame(()=>calls.push('frame'));
    wx.onHide(()=>{calls.push('hide');wx.setStorageSync('final',42);Promise.resolve().then(()=>{
      try{wx.setStorageSync('tooLate',1)}catch(e){calls.push('blocked-async')}
    })});` } });
  env.init();
  env.message({ type: 'quiesce-storage', requestId: 'final-save' });
  const flushed = env.messages.findLast((message) => message.type === 'storage-flushed');
  assert.deepEqual(flushed.storage, { final: 42 });
  await env.flush(); env.advance(100); env.animationFrame();
  assert.deepEqual([...env.win.calls], ['hide', 'blocked-async']);
  assert.equal(env.win.wx.getStorageSync('tooLate'), '');
  env.message({ type: 'resume-storage', requestId: 'final-save' });
  env.advance(10); env.animationFrame();
  assert.ok(env.win.calls.includes('tick'));
  assert.ok(env.win.calls.includes('frame'));
});

test('startup failure cancels already-created resources and never lets old async work write or reschedule', async (t) => {
  const env = gameEnvironment(t, { modules: { 'game.js': `GameGlobal.canvas=wx.createCanvas();GameGlobal.calls=[];
    setInterval(()=>calls.push('interval'),1);setTimeout(()=>calls.push('timeout'),1);requestAnimationFrame(()=>calls.push('frame'));
    Promise.resolve().then(()=>{try{wx.setStorageSync('stale',1)}catch(e){calls.push('rejected-write')}
      try{setTimeout(()=>{},0)}catch(e){calls.push('rejected-timer')}});throw new Error('startup failed after allocations');` } });
  env.init(); await env.flush(); env.advance(100); env.animationFrame();
  assert.equal(env.status().status, 'error');
  assert.match(env.status().details.at(-1).message, /startup failed after allocations/);
  assert.deepEqual([...env.win.calls], ['rejected-write', 'rejected-timer']);
  assert.equal(env.win.document.querySelector('canvas'), null);
  assert.equal(env.messages.some((message) => message.type === 'started'), false);
  assert.throws(() => env.win.requestAnimationFrame(() => {}), /disposed|stopped/);
  env.message({ type: 'dispose', requestId: 'dispose-failed' });
  assert.equal(env.messages.at(-1).type, 'game-disposed');
});

test('Image properties and listeners defer completion during pause, honor removals, and never run after disposal', (t) => {
  const env = gameEnvironment(t); env.init();
  const image = env.win.wx.createImage(); const calls = [];
  const removed = () => calls.push('removed');
  image.onload = () => calls.push('property');
  image.addEventListener('load', () => calls.push('listener'), { once: true });
  image.addEventListener('load', removed);
  env.message({ type: 'game-control', action: 'pause' });
  image.dispatchEvent(new env.win.Event('load'));
  image.removeEventListener('load', removed);
  assert.deepEqual(calls, []);
  env.message({ type: 'game-control', action: 'resume' });
  assert.deepEqual(calls, ['property', 'listener']);
  image.dispatchEvent(new env.win.Event('load'));
  assert.deepEqual(calls, ['property', 'listener', 'property']);
  env.message({ type: 'game-control', action: 'pause' });
  image.dispatchEvent(new env.win.Event('load'));
  env.message({ type: 'dispose', requestId: 'dispose-image' });
  env.message({ type: 'game-control', action: 'resume' });
  image.dispatchEvent(new env.win.Event('load'));
  assert.deepEqual(calls, ['property', 'listener', 'property']);
  assert.throws(() => { image.src = 'data:image/png;base64,YQ=='; }, /disposed/);
});

test('game control and all responses bind the full lease identity without exposing the asset map', (t) => {
  const env = gameEnvironment(t); env.init();
  for (const key of ['serverEpoch', 'previewId', 'projectId', 'buildId', 'clientId', 'instanceId', 'leaseEpoch']) {
    env.message({ type: 'game-control', action: 'pause', requestId: 'invalid', [key]: key === 'leaseEpoch' ? 8 : 'foreign' });
    assert.equal(env.state().paused, false, key);
  }
  env.message({ type: 'game-control', action: 'pause', requestId: 'command-2' });
  assert.equal(env.state().paused, true);
  assert.equal(env.state().requestId, 'command-2');
  for (const message of env.messages) {
    for (const [key, value] of Object.entries(env.identity)) assert.equal(message[key], value, key);
    assert.equal(Object.hasOwn(message, 'assets'), false);
  }
});

test('audio reports actual playback rejection, pauses on lifecycle change and releases its source before disposed ack', async (t) => {
  let media;
  const env = gameEnvironment(t, { assets: { 'tone.wav': 'data:audio/wav;base64,YQ==' }, beforeRuntime(win) {
    win.Audio = function () {
      media = new win.EventTarget(); media.src = ''; media.paused = true; media.currentTime = 0; media.loads = 0;
      media.play = () => win.Promise.reject(new win.Error('gesture required'));
      media.pause = () => { media.paused = true; media.dispatchEvent(new win.Event('pause')); };
      media.removeAttribute = () => { media.src = ''; };
      media.load = () => { media.loads++; };
      return media;
    };
  } });
  env.init(); const audio = env.win.wx.createInnerAudioContext(); const calls = [];
  audio.onPlay(() => calls.push('played')); audio.onError((err) => calls.push(err.errMsg));
  audio.src = 'tone.wav'; audio.play(); await env.flush();
  assert.deepEqual(calls, ['audio:fail gesture required']);
  assert.equal(env.status().status, 'limited');
  media.play = () => { media.paused = false; media.dispatchEvent(new env.win.Event('play')); return env.win.Promise.resolve(); };
  audio.play(); await env.flush(); assert.equal(calls.at(-1), 'played');
  env.message({ type: 'game-control', action: 'pause' });
  assert.equal(media.paused, true);
  env.message({ type: 'dispose', requestId: 'dispose-audio' });
  assert.equal(media.src, ''); assert.equal(media.loads, 1);
  assert.equal(env.messages.at(-1).requestId, 'dispose-audio');
  assert.throws(() => { audio.src = 'tone.wav'; }, /destroyed/);
  assert.throws(() => audio.play(), /destroyed|disposed/);
  assert.throws(() => { audio.volume = 0.5; }, /destroyed|disposed/);
});

test('audio completion callbacks wait through pause and do not fake a new play on automatic resume', async (t) => {
  let media;
  const env = gameEnvironment(t, { beforeRuntime(win) {
    win.Audio = function () {
      media = new win.EventTarget(); media.paused = true; media.currentTime = 0; media.src = '';
      media.play = () => win.Promise.resolve(); media.pause = () => { media.paused = true; };
      media.removeAttribute = () => {}; media.load = () => {};
      return media;
    };
  } });
  env.init(); const audio = env.win.wx.createInnerAudioContext(); const calls = [];
  audio.onCanplay(() => calls.push('canplay')); audio.onPlay(() => calls.push('play'));
  env.message({ type: 'game-control', action: 'pause' });
  media.dispatchEvent(new env.win.Event('canplay'));
  media.dispatchEvent(new env.win.Event('play'));
  assert.deepEqual(calls, []);
  env.message({ type: 'game-control', action: 'resume' }); await env.flush();
  assert.deepEqual(calls, ['canplay']);
  assert.equal(media.paused, true);
});

test('canceled audio play rejection cannot outlive its generation, but a current playback failure stays observable', async (t) => {
  let rejectPlayback;
  const env = gameEnvironment(t, { beforeRuntime(win) {
    win.Audio = function () {
      const media = new win.EventTarget(); media.paused = true; media.currentTime = 0; media.src = '';
      media.play = () => new win.Promise((_resolve, reject) => { rejectPlayback = reject; });
      media.pause = () => { media.paused = true; }; media.removeAttribute = () => {}; media.load = () => {};
      return media;
    };
  } });
  env.init(); const audio = env.win.wx.createInnerAudioContext(); const errors = [];
  audio.onError((event) => errors.push(event.errMsg));
  audio.play();
  env.message({ type: 'game-control', action: 'pause' });
  rejectPlayback(new env.win.Error('The play() request was interrupted by a call to pause()'));
  await env.flush();
  env.message({ type: 'game-control', action: 'resume' });
  assert.deepEqual(errors, []);
  assert.equal(env.status().status, 'rendered');
  audio.play(); audio.pause();
  rejectPlayback(new env.win.Error('explicit pause canceled playback'));
  await env.flush();
  assert.deepEqual(errors, []);
  assert.equal(env.status().status, 'rendered');
  audio.play();
  rejectPlayback(new env.win.Error('NotSupportedError: cannot decode media'));
  await env.flush();
  assert.deepEqual(errors, ['audio:fail NotSupportedError: cannot decode media']);
  assert.equal(env.status().status, 'limited');
});

test('actual compiler output executes prebuilt npm, relative JSON and dynamic imports only from the module map', async (t) => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'game-runtime-modules-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  const files = {
    'game.json': '{"deviceOrientation":"portrait"}',
    'game.js': `const value=require('answer');const data=require('./data.json');GameGlobal.total=value+data.delta;
      GameGlobal.later=()=>import('./later').then(mod=>GameGlobal.loaded=mod.default);wx.createCanvas();`,
    'data.json': '{"delta":2}', 'later.js': 'export default 99;',
    'miniprogram_npm/answer/index.js': 'module.exports=40;',
  };
  for (const [name, source] of Object.entries(files)) { const target = path.join(project, name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, source); }
  const build = await compileProject(project, { projectKind: 'minigame' });
  assert.deepEqual(build.errors, []);
  const env = gameEnvironment(t, { modules: build.payload.modules }); env.init();
  assert.equal(env.win.total, 42);
  await env.win.later(); assert.equal(env.win.loaded, 99);
  env.message({ type: 'dispose' });
  await assert.rejects(env.win.later(), /disposed|stopped/);
});

test('global listeners, Image alias and object URLs are paused or released without losing the internal dispose protocol', (t) => {
  const revoked = [];
  let sequence = 0;
  const env = gameEnvironment(t, { beforeRuntime(win) {
    win.URL.createObjectURL = () => 'blob:preview/' + (++sequence);
    win.URL.revokeObjectURL = (value) => revoked.push(value);
  } });
  env.init(); let callbacks = 0;
  env.win.addEventListener('game-test', () => callbacks++);
  env.win.document.addEventListener('game-test', () => callbacks++);
  const image = new env.win.Image(4, 5); image.onload = () => callbacks++;
  const one = env.win.URL.createObjectURL(new env.win.Blob(['a'], { type: 'image/png' }));
  const two = env.win.URL.createObjectURL(new env.win.Blob(['b'], { type: 'image/png' }));
  env.win.URL.revokeObjectURL(one);
  assert.deepEqual(revoked, [one]);
  assert.equal(image.width, 4); assert.equal(image.height, 5);
  image.src = two;
  assert.equal(image.src, two);
  env.message({ type: 'game-control', action: 'pause' });
  env.win.dispatchEvent(new env.win.Event('game-test')); env.win.document.dispatchEvent(new env.win.Event('game-test'));
  image.dispatchEvent(new env.win.Event('load')); assert.equal(callbacks, 0);
  env.message({ type: 'game-control', action: 'resume' }); assert.equal(callbacks, 1);
  env.win.dispatchEvent(new env.win.Event('game-test')); assert.equal(callbacks, 2);
  env.message({ type: 'dispose', requestId: 'release-all' });
  env.win.dispatchEvent(new env.win.Event('game-test')); env.win.document.dispatchEvent(new env.win.Event('game-test')); image.dispatchEvent(new env.win.Event('load'));
  assert.equal(callbacks, 2);
  assert.deepEqual(revoked, [one, two]);
  assert.equal(env.messages.at(-1).requestId, 'release-all');
  assert.throws(() => new env.win.Image(), /disposed/);
  assert.throws(() => env.win.URL.createObjectURL(new env.win.Blob()), /disposed/);
  assert.throws(() => env.win.addEventListener('game-test', () => {}), /disposed/);
});
