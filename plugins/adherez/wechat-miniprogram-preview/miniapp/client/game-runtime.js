/* Independent browser-backed Mini Game runtime. No Page/WXML component engine. */
(function () {
  'use strict';
  const build = window.__WX_BUILD__ || {};
  const frame = window.__WX_PREVIEW_FRAME__ || {};
  const native = {
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    requestAnimationFrame: window.requestAnimationFrame?.bind(window), cancelAnimationFrame: window.cancelAnimationFrame?.bind(window),
    Image: window.Image, Audio: window.Audio, Worker: window.Worker,
    createObjectURL: window.URL.createObjectURL?.bind(window.URL), revokeObjectURL: window.URL.revokeObjectURL?.bind(window.URL),
    windowAdd: window.addEventListener.bind(window), windowRemove: window.removeEventListener.bind(window),
    documentAdd: document.addEventListener.bind(document), documentRemove: document.removeEventListener.bind(document),
  };
  const viewport = document.getElementById('wx-game-viewport') || document.body.appendChild(Object.assign(document.createElement('main'), { id: 'wx-game-viewport' }));
  const overlay = document.createElement('div');
  overlay.id = 'wx-game-overlay'; overlay.hidden = true; overlay.setAttribute('role', 'status');
  document.body.appendChild(overlay);
  let initialized = false;
  let disposed = false;
  let failed = false;
  let finalStorageWrite = false;
  let reportingError = false;
  let visible = true;
  let userPaused = false;
  let quiescing = false;
  let quiesceRequest = null;
  let paused = false;
  let fps = 60;
  let device = window.__WX_PREVIEW_DEVICES__.get(window.__WX_PREVIEW_DEVICES__.defaultId);
  let orientation = build.game?.deviceOrientation === 'landscape' ? 'landscape' : 'portrait';
  let mainCanvas = null;
  let storage = Object.create(null);
  let status = 'rendered';
  const details = [];
  const detailKeys = new Set();
  const events = new Map();
  const timers = new Map();
  const animationFrames = new Map();
  const canvases = new Set();
  const images = new Set();
  const audios = new Set();
  const graphics = new Set();
  const trackedGraphics = new WeakSet();
  const listeners = new Set();
  const pendingCompletions = new Map();
  const cleanupCallbacks = new Set();
  const completionTimers = new Set();
  const objectUrls = new Map();
  const touches = new Map();
  const modules = new Map();
  let nextTimer = 1;
  let nextAnimation = 1;
  let nativeAnimation = null;
  let lastFrame = -Infinity;
  let logs = [];
  let logTimer = null;

  function post(message) {
    const identity = {};
    for (const key of ['previewId', 'projectId', 'serverEpoch', 'buildId', 'clientId', 'instanceId', 'leaseEpoch']) identity[key] = frame[key];
    window.parent.postMessage({ ...message, ...identity, source: 'wx-sim' }, '*');
  }
  function diagnostic(level, code, message) {
    if (disposed) return;
    if (level === 'error' || status !== 'error' && level === 'limited') status = level;
    const key = code + ':' + message;
    if (!detailKeys.has(key) && details.length < 100) {
      detailKeys.add(key); details.push({ code: String(code).slice(0, 100), message: String(message).slice(0, 2000) });
    }
    post({ type: 'preview-status', status, details: details.slice() });
  }
  function error(err, code = 'game-runtime') {
    diagnostic('error', code, err?.message || String(err));
    if (!reportingError) {
      reportingError = true;
      try { emit('Error', err?.message || String(err)); } finally { reportingError = false; }
    }
  }
  function call(fn, self, args = []) {
    if (disposed || typeof fn !== 'function') return;
    try { return fn.apply(self, args); } catch (err) { error(err, 'game-callback'); }
  }
  function emit(name, value) { for (const fn of [...(events.get(name) || [])]) call(fn, null, [value]); }
  function on(name, callback) {
    active();
    if (typeof callback !== 'function') throw new TypeError('Event listener must be a function');
    let set = events.get(name); if (!set) events.set(name, set = new Set()); set.add(callback);
  }
  function off(name, callback) { if (callback) events.get(name)?.delete(callback); else events.delete(name); }
  function format(value) {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  function flushLogs() {
    if (logTimer !== null) native.clearTimeout(logTimer);
    logTimer = null;
    if (logs.length) post({ type: 'log', entries: logs.splice(0, 100) });
  }
  const consoles = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    consoles[level] = console[level].bind(console);
    console[level] = (...args) => {
      consoles[level](...args);
      if (disposed) return;
      logs.push({ level, source: 'runtime', message: args.map(format).join(' ').slice(0, 4000) });
      if (logs.length >= 100) flushLogs();
      else if (logTimer === null) logTimer = native.setTimeout(flushLogs, 100);
    };
  }
  function listen(target, name, callback, options) {
    const add = target === window ? native.windowAdd : native.documentAdd;
    const remove = target === window ? native.windowRemove : native.documentRemove;
    add(name, callback, options); cleanupCallbacks.add(() => remove(name, callback, options));
  }
  listen(window, 'error', (event) => error(event.error || event.message));
  listen(window, 'unhandledrejection', (event) => error(event.reason, 'game-unhandled-rejection'));
  function active() { if (disposed) throw new Error('game:fail preview disposed or stopped'); }

  function dimensions() {
    const landscape = orientation === 'landscape';
    return { width: landscape ? device.height : device.width, height: landscape ? device.width : device.height };
  }
  function menuRect() {
    const landscape = orientation === 'landscape';
    const { width } = dimensions();
    // DevTools game chrome has its own geometry, separate from program navigation.
    const capsuleWidth = 88, capsuleHeight = 32, right = 10;
    const top = landscape ? 12 : device.hasNotch ? 44 : 10 + (build.game?.showStatusBar ? device.statusBarHeight : 0);
    return {
      width: capsuleWidth, height: capsuleHeight, top,
      bottom: top + capsuleHeight,
      left: width - right - capsuleWidth,
      right: width - right,
    };
  }
  function systemInfo() {
    const { width, height } = dimensions();
    const landscape = orientation === 'landscape';
    const safe = landscape
      ? { left: device.statusBarHeight, right: width - device.statusBarHeight, top: 0, bottom: height - device.safeAreaBottom }
      : { left: 0, right: width, top: device.statusBarHeight, bottom: height - device.safeAreaBottom };
    return {
      brand: 'devtools', model: device.model, platform: device.platform, system: device.system,
      version: device.version, SDKVersion: device.sdkVersion, pixelRatio: device.pixelRatio,
      screenWidth: width, screenHeight: height, windowWidth: width, windowHeight: height, screenTop: 0,
      statusBarHeight: landscape ? 0 : device.statusBarHeight, language: 'zh_CN', theme: 'light', deviceOrientation: orientation,
      safeArea: { ...safe, width: safe.right - safe.left, height: safe.bottom - safe.top },
    };
  }
  function resize() {
    const { width, height } = dimensions();
    const menu = menuRect();
    document.documentElement.style.setProperty('--wx-game-width', width + 'px');
    document.documentElement.style.setProperty('--wx-game-height', height + 'px');
    document.documentElement.style.setProperty('--wx-capsule-width', menu.width + 'px');
    document.documentElement.style.setProperty('--wx-capsule-height', menu.height + 'px');
    document.documentElement.style.setProperty('--wx-capsule-top', menu.top + 'px');
    document.documentElement.style.setProperty('--wx-capsule-right', (width - menu.right) + 'px');
    viewport.style.width = width + 'px'; viewport.style.height = height + 'px';
    if (mainCanvas) { mainCanvas.style.width = width + 'px'; mainCanvas.style.height = height + 'px'; }
    emit('WindowResize', { windowWidth: width, windowHeight: height, deviceOrientation: orientation });
  }

  function scheduleTimer(record) {
    if (paused || disposed) return;
    record.due = performance.now() + record.remaining;
    record.nativeId = native.setTimeout(() => {
      record.nativeId = null;
      if (paused || disposed || !timers.has(record.id)) return;
      if (!record.repeat) timers.delete(record.id);
      call(record.callback, window, record.args);
      if (record.repeat && timers.has(record.id) && !disposed) { record.remaining = record.delay; scheduleTimer(record); }
    }, record.remaining);
  }
  function timer(callback, delay, repeat, args) {
    active();
    if (typeof callback !== 'function') throw new TypeError('String timers are not supported in Mini Game preview');
    if (timers.size >= 2048) throw new Error('game timers: limit exceeded');
    const milliseconds = Math.max(repeat ? 1 : 0, Math.min(2147483647, Number(delay) || 0));
    const record = { id: nextTimer++, callback, delay: milliseconds, remaining: milliseconds, repeat, args, nativeId: null };
    timers.set(record.id, record); scheduleTimer(record); return record.id;
  }
  function clearTimer(id) { const record = timers.get(id); if (record?.nativeId !== null) native.clearTimeout(record?.nativeId); timers.delete(id); }
  window.setTimeout = (fn, delay, ...args) => timer(fn, delay, false, args);
  window.setInterval = (fn, delay, ...args) => timer(fn, delay, true, args);
  window.clearTimeout = window.clearInterval = clearTimer;

  function cancelNativeFrame() {
    if (nativeAnimation === null) return;
    if (native.requestAnimationFrame) native.cancelAnimationFrame(nativeAnimation); else native.clearTimeout(nativeAnimation);
    nativeAnimation = null;
  }
  function pumpFrame(timestamp) {
    nativeAnimation = null;
    if (paused || disposed) return;
    if (timestamp - lastFrame >= 1000 / fps - 0.5) {
      lastFrame = timestamp;
      const work = [...animationFrames.entries()]; animationFrames.clear();
      for (const [, callback] of work) call(callback, window, [timestamp]);
    }
    queueFrame();
  }
  function queueFrame() {
    if (paused || disposed || !animationFrames.size || nativeAnimation !== null) return;
    nativeAnimation = native.requestAnimationFrame ? native.requestAnimationFrame(pumpFrame) : native.setTimeout(() => pumpFrame(performance.now()), 1000 / fps);
  }
  window.requestAnimationFrame = (callback) => {
    if (typeof callback !== 'function') throw new TypeError('requestAnimationFrame needs a function');
    active();
    if (animationFrames.size >= 2048) throw new Error('game animation callbacks: limit exceeded');
    const id = nextAnimation++; animationFrames.set(id, callback); queueFrame(); return id;
  };
  window.cancelAnimationFrame = (id) => { animationFrames.delete(id); if (!animationFrames.size) cancelNativeFrame(); };

  function state(requestId) {
    post({ type: 'game-state', ...(requestId ? { requestId } : {}), paused, reason: failed ? 'error' : disposed ? 'disposed' : quiescing ? 'quiescing' : !visible ? 'hidden' : userPaused ? 'user' : 'running', framesPerSecond: fps });
  }
  function updatePause(requestId) {
    const next = disposed || quiescing || userPaused || !visible;
    if (paused !== next) {
      paused = next;
      if (paused) {
        for (const record of timers.values()) {
          if (record.nativeId !== null) {
            native.clearTimeout(record.nativeId); record.nativeId = null;
            record.remaining = Math.max(0, record.due - performance.now());
          }
        }
        cancelNativeFrame(); touches.clear();
        for (const audio of audios) audio.suspend();
        emit('Hide', {});
      } else {
        lastFrame = -Infinity;
        for (const record of timers.values()) scheduleTimer(record);
        queueFrame(); emit('Show', { scene: 1001, query: {} });
        for (const [key, deliver] of [...pendingCompletions]) {
          if (paused || disposed) break;
          pendingCompletions.delete(key); deliver();
        }
      }
    }
    viewport.inert = paused;
    overlay.hidden = !paused;
    overlay.textContent = disposed ? '小游戏预览已停止' : quiescing ? '正在保存小游戏状态' : userPaused ? '小游戏已暂停' : '小游戏已隐藏';
    state(requestId);
  }

  function normalizedPath(source, base = '') {
    if (typeof source !== 'string' || !source || source.includes('\0') || /[\\]|^[a-z][a-z0-9+.-]*:|^\/\//i.test(source)) throw new Error('Invalid local game path');
    const parts = source.startsWith('/') ? [] : base.split('/').filter(Boolean);
    for (const part of source.replace(/^\//, '').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!parts.length) throw new Error('Game path escapes project'); parts.pop(); }
      else parts.push(part);
    }
    return parts.join('/');
  }
  function asset(source, kind) {
    if (typeof source !== 'string') throw new Error(kind + ':fail invalid asset path');
    if (source.startsWith('data:')) {
      if (new RegExp('^data:' + (kind === 'image' ? 'image/' : 'audio/'), 'i').test(source)) return source;
      throw new Error(kind + ':fail unsupported data URL');
    }
    if (source.startsWith('blob:') && objectUrls.has(source)) {
      if (objectUrls.get(source).startsWith(kind + '/')) return source;
      throw new Error(kind + ':fail object URL has incompatible media type');
    }
    const name = normalizedPath(source.split(/[?#]/)[0]);
    const url = Object.prototype.hasOwnProperty.call(frame.assets || {}, name) ? frame.assets[name] : null;
    if (typeof url !== 'string' || !new RegExp('^data:' + (kind === 'image' ? 'image/' : 'audio/'), 'i').test(url)) {
      throw new Error(kind + ':fail local asset unavailable: ' + name);
    }
    return url;
  }
  function loadModule(id) {
    active();
    if (modules.has(id)) return modules.get(id).exports;
    if (!Object.prototype.hasOwnProperty.call(build.modules || {}, id)) throw new Error('Game module not found: ' + id);
    const module = { exports: {} }; modules.set(id, module);
    const require = (request) => {
      active();
      if (typeof request !== 'string') throw new Error('Game module name must be a string');
      const owner = id.slice(0, Math.max(0, id.lastIndexOf('/')));
      const bases = request.startsWith('.') || request.startsWith('/') ? [normalizedPath(request, owner)]
        : [normalizedPath(request, owner), normalizedPath(request), normalizedPath('miniprogram_npm/' + request)];
      const target = bases.flatMap((base) => [base, base + '.js', base + '.ts', base + '.json', base + '/index.js']).find((name) => Object.prototype.hasOwnProperty.call(build.modules, name));
      if (!target) throw new Error('Game module not found: ' + request);
      return loadModule(target);
    };
    require.async = (request) => Promise.resolve().then(() => require(request));
    try { new Function('require', 'module', 'exports', String(build.modules[id]) + '\n//# sourceURL=minigame://' + id)(require, module, module.exports); }
    catch (err) { modules.delete(id); throw err; }
    return module.exports;
  }

  function trackTarget(target, deferred = false) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, callback, options) => {
      active();
      if (!callback) return;
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      if (typeof options === 'object' && options.signal?.aborted) return;
      if ([...listeners].some((record) => record.target === target && record.type === type && record.callback === callback && record.capture === capture)) return;
      const actualOptions = typeof options === 'object' ? { ...options, once: false } : options;
      const record = { target, type, callback, options: actualOptions, capture, remove, enabled: true, once: !!options?.once };
      if (options?.signal) {
        record.abort = () => removeRecord(record);
        options.signal.addEventListener('abort', record.abort, { once: true });
      }
      record.wrapped = (event) => completion(record, () => {
        if (!record.enabled) return;
        if (record.once) removeRecord(record);
        typeof callback === 'function' ? call(callback, target, [event]) : call(callback.handleEvent, callback, [event]);
      }, deferred);
      listeners.add(record); add(type, record.wrapped, actualOptions);
    };
    target.removeEventListener = (type, callback, options) => {
      const capture = typeof options === 'boolean' ? options : !!options?.capture;
      for (const record of listeners) if (record.target === target && record.type === type && record.callback === callback && record.capture === capture) removeRecord(record);
    };
  }
  function removeRecord(record) {
    record.enabled = false; record.remove(record.type, record.wrapped, record.options);
    if (record.abort) record.options.signal.removeEventListener('abort', record.abort);
    pendingCompletions.delete(record); listeners.delete(record);
  }
  function completion(key, deliver, defer) {
    if (disposed) return;
    if (!paused) { deliver(); return; }
    if (!defer) return;
    if (!pendingCompletions.has(key) && pendingCompletions.size >= 512) {
      diagnostic('limited', 'game-completions', 'Paused resource callback limit exceeded'); return;
    }
    pendingCompletions.set(key, deliver);
  }
  function graphicsContext(gl) {
    if (trackedGraphics.has(gl)) return gl;
    trackedGraphics.add(gl);
    const allocations = new Map();
    const kinds = ['Buffer', 'Framebuffer', 'Program', 'Renderbuffer', 'Shader', 'Texture', 'Query', 'Sampler', 'TransformFeedback', 'VertexArray'];
    for (const kind of kinds) {
      if (typeof gl['create' + kind] !== 'function' || typeof gl['delete' + kind] !== 'function') continue;
      const create = gl['create' + kind].bind(gl), destroy = gl['delete' + kind].bind(gl), values = new Set();
      allocations.set(kind, { values, destroy });
      gl['create' + kind] = (...args) => { if (disposed) return null; const resource = create(...args); if (resource) values.add(resource); return resource; };
      gl['delete' + kind] = (resource) => { values.delete(resource); return destroy(resource); };
    }
    const resource = { dispose() {
      for (const { values, destroy } of allocations.values()) { for (const value of values) destroy(value); values.clear(); }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } };
    graphics.add(resource); return gl;
  }
  function createCanvas(offscreen = false, options = {}) {
    if (disposed) throw new Error('createCanvas:fail preview disposed');
    const canvas = document.createElement('canvas');
    const size = dimensions();
    canvas.width = Math.max(1, Math.min(16384, Number(options.width) || size.width));
    canvas.height = Math.max(1, Math.min(16384, Number(options.height) || size.height));
    if (!offscreen && !mainCanvas) {
      mainCanvas = canvas; canvas.id = 'wx-game-canvas';
      canvas.style.width = size.width + 'px'; canvas.style.height = size.height + 'px'; viewport.appendChild(canvas);
    }
    const getContext = canvas.getContext.bind(canvas); const contexts = new Map();
    canvas.getContext = (name, attributes) => {
      if (disposed) return null;
      if (contexts.has(name)) return contexts.get(name);
      const context = getContext(name, attributes);
      if (!context) { diagnostic('limited', 'context:' + name, 'Browser graphics context is unavailable: ' + name); return null; }
      if (/^(webgl2?|experimental-webgl)$/.test(name)) graphicsContext(context);
      contexts.set(name, context); return context;
    };
    canvas.requestAnimationFrame = window.requestAnimationFrame;
    canvas.cancelAnimationFrame = window.cancelAnimationFrame;
    canvas.createImage = createImage;
    trackTarget(canvas); canvases.add(canvas); return canvas;
  }
  function createImage() {
    if (disposed) throw new Error('createImage:fail preview disposed');
    const image = new native.Image();
    const add = image.addEventListener.bind(image), remove = image.removeEventListener.bind(image);
    for (const name of ['load', 'error']) {
      let callback = null;
      const key = {};
      const listener = (event) => completion(key, () => call(callback, image, [event]), true);
      add(name, listener);
      Object.defineProperty(image, 'on' + name, { configurable: true, get: () => callback, set(value) {
        if (disposed && value !== null) active();
        callback = typeof value === 'function' ? value : null;
        if (!callback) pendingCompletions.delete(key);
      } });
      cleanupCallbacks.add(() => { pendingCompletions.delete(key); callback = null; remove(name, listener); });
    }
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src');
    Object.defineProperty(image, 'src', { configurable: true, get() { return descriptor.get.call(image); }, set(value) {
      if (disposed) throw new Error('image:fail preview disposed');
      try { descriptor.set.call(image, asset(value, 'image')); }
      catch (err) {
        diagnostic('limited', 'game-image', err.message); image.removeAttribute('src');
        const timer = native.setTimeout(() => { completionTimers.delete(timer); if (!disposed) image.dispatchEvent(new Event('error')); }, 0);
        completionTimers.add(timer);
      }
    } });
    images.add(image); trackTarget(image, true); return image;
  }

  function innerAudioContext() {
    if (disposed) throw new Error('createInnerAudioContext:fail preview disposed');
    const audio = new native.Audio();
    let destroyed = false;
    let autoplay = false;
    let audioGeneration = 0;
    const callbacks = new Map();
    const removers = [];
    const completionKeys = new Map();
    const ensureAudio = () => { if (disposed || destroyed) throw new Error('audio:fail context destroyed or preview disposed'); };
    const dispatch = (name, value) => {
      if (disposed || destroyed) return;
      for (const callback of callbacks.get(name) || []) {
        let keys = completionKeys.get(name); if (!keys) completionKeys.set(name, keys = new Map());
        let key = keys.get(callback); if (!key) keys.set(callback, key = {});
        completion(key, () => { if (!destroyed && callbacks.get(name)?.has(callback)) call(callback, null, [value]); }, true);
      }
    };
    const api = {};
    for (const [name, domEvent] of Object.entries({ Play: 'play', Pause: 'pause', Ended: 'ended', Canplay: 'canplay', TimeUpdate: 'timeupdate', Waiting: 'waiting', Seeking: 'seeking', Seeked: 'seeked' })) {
      const listener = () => {
        if (name === 'Play' && paused) { audio.pause(); return; }
        dispatch(name, {});
      };
      audio.addEventListener(domEvent, listener); removers.push(() => audio.removeEventListener(domEvent, listener));
    }
    const mediaError = () => dispatch('Error', { errMsg: 'audio:fail media decode or load failed', errCode: audio.error?.code || 0 });
    audio.addEventListener('error', mediaError); removers.push(() => audio.removeEventListener('error', mediaError));
    for (const name of ['Play', 'Pause', 'Stop', 'Ended', 'Canplay', 'TimeUpdate', 'Waiting', 'Seeking', 'Seeked', 'Error']) {
      api['on' + name] = (callback) => { ensureAudio(); if (typeof callback !== 'function') throw new TypeError('Audio listener must be a function'); let set = callbacks.get(name); if (!set) callbacks.set(name, set = new Set()); set.add(callback); };
      api['off' + name] = (callback) => { if (callback) callbacks.get(name)?.delete(callback); else callbacks.delete(name); };
    }
    Object.defineProperty(api, 'src', { get: () => audio.src, set(value) {
      ensureAudio();
      try {
        audio.src = asset(value, 'audio');
        if (autoplay && !paused) api.play();
      } catch (err) { audio.pause(); audio.removeAttribute('src'); diagnostic('limited', 'game-audio', err.message); dispatch('Error', { errMsg: err.message }); }
    } });
    for (const name of ['loop', 'volume', 'playbackRate']) Object.defineProperty(api, name, { get: () => audio[name], set: (value) => { ensureAudio(); audio[name] = value; } });
    Object.defineProperty(api, 'autoplay', { get: () => autoplay, set: (value) => { ensureAudio(); autoplay = !!value; if (autoplay && audio.src && !paused) api.play(); } });
    for (const name of ['duration', 'currentTime', 'paused']) Object.defineProperty(api, name, { get: () => audio[name] });
    api.play = () => {
      ensureAudio();
      if (paused) { dispatch('Error', { errMsg: 'audio:fail preview paused' }); return; }
      const generation = audioGeneration;
      try {
        Promise.resolve(audio.play()).then(() => { if (disposed || destroyed || paused || generation !== audioGeneration) audio.pause(); }, (err) => {
          if (disposed || destroyed || paused || generation !== audioGeneration) return;
          diagnostic('limited', 'audio-playback', err.message); dispatch('Error', { errMsg: 'audio:fail ' + err.message });
        });
      } catch (err) { diagnostic('limited', 'audio-playback', err.message); dispatch('Error', { errMsg: 'audio:fail ' + err.message }); }
    };
    api.pause = () => { ensureAudio(); audioGeneration++; audio.pause(); };
    api.stop = () => { ensureAudio(); audioGeneration++; audio.pause(); audio.currentTime = 0; dispatch('Stop', {}); };
    api.seek = (time) => { ensureAudio(); audio.currentTime = Math.max(0, Number(time) || 0); };
    const record = { suspend: () => { audioGeneration++; audio.pause(); }, dispose() {
      if (destroyed) return; destroyed = true; audioGeneration++; audio.pause(); audio.removeAttribute('src'); audio.load(); callbacks.clear();
      for (const keys of completionKeys.values()) for (const key of keys.values()) pendingCompletions.delete(key); completionKeys.clear();
      for (const remove of removers) remove(); audios.delete(record);
    } };
    api.destroy = record.dispose; audios.add(record); return api;
  }

  const MAX_STORAGE_BYTES = 1024 * 1024;
  const badKeys = new Set(['__proto__', 'prototype', 'constructor']);
  function storageKey(key) { const text = String(key); if (badKeys.has(text)) throw new Error('storage:fail unsafe key'); return text; }
  function encodeStorage(value) {
    const ancestors = new Set(); let nodes = 0;
    const invalid = () => { throw new Error('storage:fail only bounded JSON data without unsafe keys is supported'); };
    function visit(item, depth) {
      if (++nodes > 100000 || depth > 64) invalid();
      if (item === null || ['string', 'boolean'].includes(typeof item)) return;
      if (typeof item === 'number') { if (!Number.isFinite(item)) invalid(); return; }
      if (!item || typeof item !== 'object' || ancestors.has(item)) invalid();
      const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
      if (Object.getOwnPropertySymbols(item).length || (array && item.length > 100000)) invalid();
      const descriptors = Object.getOwnPropertyDescriptors(item), keys = Object.keys(descriptors);
      if (array && keys.length !== item.length + 1) invalid();
      ancestors.add(item);
      for (const key of keys) {
        if (array && key === 'length') continue;
        storageKey(key); const descriptor = descriptors[key];
        if (!descriptor.enumerable || !('value' in descriptor) || array && !/^(0|[1-9]\d*)$/.test(key)) invalid();
        visit(descriptor.value, depth + 1);
      }
      ancestors.delete(item);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    visit(value, 0); const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).length > MAX_STORAGE_BYTES) throw new Error('storage:fail quota exceeded (1 MiB per project)');
    return encoded;
  }
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  function writable() { if (disposed || (quiescing && !finalStorageWrite)) throw new Error('storage:fail temporarily unavailable during preview transition'); }
  function writeStorage(next) { writable(); storage = JSON.parse(encodeStorage(next)); post({ type: 'storage', data: storage }); }
  function asynchronous(name, run) {
    return (options = {}) => {
      const callbackStyle = ['success', 'fail', 'complete'].some((key) => typeof options[key] === 'function');
      const promise = Promise.resolve().then(() => run(options)).then((value) => {
        const result = { errMsg: name + ':ok', ...value }; call(options.success, null, [result]); call(options.complete, null, [result]); return result;
      }, (err) => {
        const result = { errMsg: name + ':fail ' + (err?.message || String(err)) }; call(options.fail, null, [result]); call(options.complete, null, [result]);
        if (!callbackStyle) throw result; return result;
      });
      if (callbackStyle) { promise.catch(() => {}); return; } return promise;
    };
  }
  const unsupportedNames = new Set();
  function unsupported(name, sync = false) {
    unsupportedNames.add(name);
    const fail = () => { const message = name + ':fail not supported in local Mini Game preview'; diagnostic('limited', 'api:' + name, message); throw new Error(message); };
    return sync ? fail : asynchronous(name, fail);
  }
  const wx = {
    createCanvas: () => createCanvas(), createOffscreenCanvas: (options) => createCanvas(true, options), createImage, createInnerAudioContext: innerAudioContext,
    getSystemInfoSync: systemInfo, getWindowInfo: systemInfo, getDeviceInfo: systemInfo,
    getMenuButtonBoundingClientRect: menuRect,
    getSystemInfo: asynchronous('getSystemInfo', systemInfo), getSystemInfoAsync: asynchronous('getSystemInfoAsync', systemInfo),
    getLaunchOptionsSync: () => ({ scene: 1001, query: {} }), getEnterOptionsSync: () => ({ scene: 1001, query: {} }),
    setPreferredFramesPerSecond(value) { active(); if (!Number.isFinite(value) || value < 1) throw new Error('setPreferredFramesPerSecond:fail expected positive fps'); fps = Math.min(60, Math.floor(value)); state(); },
    setStorageSync(key, value) { writable(); const next = Object.assign(Object.create(null), storage); next[storageKey(key)] = value; writeStorage(next); },
    getStorageSync(key) { const value = storage[storageKey(key)]; return value === undefined ? '' : clone(value); },
    removeStorageSync(key) { const next = Object.assign(Object.create(null), storage); delete next[storageKey(key)]; writeStorage(next); },
    clearStorageSync: () => writeStorage(Object.create(null)),
    getStorageInfoSync: () => ({ keys: Object.keys(storage), currentSize: new TextEncoder().encode(JSON.stringify(storage)).length / 1024, limitSize: 1024 }),
    getPerformance: () => ({ now: performance.now.bind(performance) }),
  };
  wx.setStorage = asynchronous('setStorage', (o) => wx.setStorageSync(o.key, o.data));
  wx.getStorage = asynchronous('getStorage', (o) => { if (!Object.prototype.hasOwnProperty.call(storage, storageKey(o.key))) throw new Error('data not found'); return { data: wx.getStorageSync(o.key) }; });
  wx.removeStorage = asynchronous('removeStorage', (o) => wx.removeStorageSync(o.key));
  wx.clearStorage = asynchronous('clearStorage', wx.clearStorageSync);
  wx.getStorageInfo = asynchronous('getStorageInfo', wx.getStorageInfoSync);
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Show', 'Hide', 'Error', 'WindowResize']) { wx['on' + name] = (fn) => on(name, fn); wx['off' + name] = (fn) => off(name, fn); }
  for (const name of ['request', 'downloadFile', 'uploadFile', 'connectSocket', 'login', 'checkSession', 'requestPayment', 'loadSubpackage', 'getUserInfo', 'authorize']) wx[name] = unsupported(name);
  for (const name of ['createWorker', 'getOpenDataContext', 'getSharedCanvas', 'getFileSystemManager']) wx[name] = unsupported(name, true);
  wx.canIUse = (name) => typeof wx[name] === 'function' && !unsupportedNames.has(name);
  window.wx = new Proxy(wx, { get(target, name) {
    if (typeof name !== 'string' || name in target) return target[name];
    if (name === 'then' || name === 'toJSON') return undefined;
    if (name === 'cloud') return new Proxy({}, { get: (_value, method) => unsupported('cloud.' + String(method)) });
    return unsupported(name, /^(?:create|get.*Sync)/.test(name));
  } });
  window.GameGlobal = window;
  window.Image = function (width, height) {
    const image = createImage();
    if (width !== undefined) image.width = width;
    if (height !== undefined) image.height = height;
    return image;
  };
  window.Image.prototype = native.Image.prototype;
  window.URL.createObjectURL = (blob) => {
    active();
    if (!native.createObjectURL) throw new Error('createObjectURL:fail unavailable in this browser');
    if (objectUrls.size >= 1024) throw new Error('createObjectURL:fail preview resource limit exceeded');
    const url = native.createObjectURL(blob); objectUrls.set(url, String(blob?.type || '')); return url;
  };
  window.URL.revokeObjectURL = (url) => { objectUrls.delete(String(url)); native.revokeObjectURL?.(url); };
  window.Worker = function () { return unsupported('Worker', true)(); };
  window.WXWebAssembly = new Proxy({}, { get: (_target, name) => unsupported('WXWebAssembly.' + String(name)) });
  window.WebAssembly = new Proxy({}, { get: (_target, name) => unsupported('WebAssembly.' + String(name), true) });

  const pointerNames = { pointerdown: 'TouchStart', pointermove: 'TouchMove', pointerup: 'TouchEnd', pointercancel: 'TouchCancel' };
  for (const [domName, name] of Object.entries(pointerNames)) listen(document, domName, (event) => {
    if (paused || disposed || !mainCanvas || (domName === 'pointerdown' && !viewport.contains(event.target))) return;
    if (domName !== 'pointerdown' && !touches.has(event.pointerId)) return;
    const box = mainCanvas.getBoundingClientRect(), size = dimensions();
    const point = { identifier: event.pointerId ?? 0, clientX: (event.clientX - box.left) * size.width / (box.width || size.width), clientY: (event.clientY - box.top) * size.height / (box.height || size.height) };
    point.pageX = point.clientX; point.pageY = point.clientY;
    if (domName === 'pointerup' || domName === 'pointercancel') touches.delete(point.identifier); else touches.set(point.identifier, point);
    event.preventDefault();
    emit(name, { touches: [...touches.values()].map((item) => ({ ...item })), changedTouches: [{ ...point }], timeStamp: performance.now() });
  }, { capture: true, passive: false });
  for (const name of ['pointerdown', 'pointermove', 'pointerup', 'click', 'keydown', 'keyup', 'input', 'touchstart', 'touchmove', 'touchend']) listen(window, name, (event) => {
    if (paused || disposed) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, passive: false });
  function setVisibility(value) { visible = value; updatePause(); }
  listen(document, 'visibilitychange', () => setVisibility(document.visibilityState !== 'hidden'));

  function releaseResources() {
    disposed = true; paused = true;
    for (const record of timers.values()) if (record.nativeId !== null) native.clearTimeout(record.nativeId);
    timers.clear(); animationFrames.clear(); cancelNativeFrame();
    for (const timer of completionTimers) native.clearTimeout(timer); completionTimers.clear();
    for (const record of [...listeners]) removeRecord(record);
    for (const cleanup of cleanupCallbacks) cleanup(); cleanupCallbacks.clear(); pendingCompletions.clear();
    for (const audio of [...audios]) audio.dispose();
    for (const gl of graphics) gl.dispose(); graphics.clear();
    for (const image of images) { image.removeAttribute('src'); } images.clear();
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; canvas.remove(); } canvases.clear();
    for (const url of objectUrls.keys()) native.revokeObjectURL?.(url); objectUrls.clear();
    events.clear(); touches.clear(); modules.clear(); flushLogs();
    viewport.inert = true; overlay.hidden = false; overlay.textContent = failed ? '小游戏启动失败，请查看诊断后重新启动' : '小游戏预览已停止';
    for (const level of Object.keys(consoles)) console[level] = consoles[level];
  }
  function dispose(requestId) {
    if (!disposed) {
      userPaused = true; updatePause(); releaseResources();
    }
    post({ type: 'game-disposed', ...(requestId ? { requestId } : {}) });
  }
  function initialize(data) {
    if (initialized || disposed) return;
    initialized = true; device = window.__WX_PREVIEW_DEVICES__.get(data.device); visible = data.visible !== false;
    if (build.projectKind !== 'minigame' || String(build.runtimeVersion) !== '2' || typeof build.entryModule !== 'string') throw new Error('Unsupported Mini Game payload');
    storage = JSON.parse(encodeStorage(data.storage || {})); resize();
    paused = !visible;
    trackTarget(window); trackTarget(document);
    loadModule(normalizedPath(build.entryModule));
    if (!mainCanvas) diagnostic('limited', 'game-canvas-missing', 'Game entry has not created a screen canvas');
    if (visible) emit('Show', { scene: 1001, query: {} });
    updatePause(); post({ type: 'started' }); post({ type: 'preview-status', status, details: details.slice() });
  }
  native.windowAdd('message', (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.source !== 'wx-shell' || !['previewId', 'projectId', 'serverEpoch', 'buildId', 'clientId', 'instanceId', 'leaseEpoch'].every((key) => data[key] === frame[key])) return;
    try {
      if (data.type === 'init') initialize(data);
      else if (data.type === 'dispose') dispose(data.requestId);
      else if (!initialized || disposed) return;
      else if (data.type === 'game-control') {
        if (!['pause', 'resume'].includes(data.action)) throw new Error('Unknown game control action');
        userPaused = data.action === 'pause'; updatePause(data.requestId);
      } else if (data.type === 'visibility') setVisibility(data.visible === true);
      else if (data.type === 'quiesce-storage') {
        quiescing = true; quiesceRequest = data.requestId; finalStorageWrite = true;
        try { updatePause(); } finally { finalStorageWrite = false; }
        post({ type: 'storage-flushed', requestId: data.requestId, storage: clone(storage), data: clone(storage) });
      } else if (data.type === 'flush-storage') post({ type: 'storage-flushed', requestId: data.requestId, storage: clone(storage), data: clone(storage) });
      else if (data.type === 'resume-storage' && (!data.requestId || data.requestId === quiesceRequest)) { quiescing = false; quiesceRequest = null; updatePause(); }
    } catch (err) {
      error(err, 'game-startup');
      if (data.type === 'init') { failed = true; releaseResources(); state(); post({ type: 'startup-error' }); }
    }
  });
  native.windowAdd('pagehide', () => dispose());
  post({ type: 'ready' });
})();
