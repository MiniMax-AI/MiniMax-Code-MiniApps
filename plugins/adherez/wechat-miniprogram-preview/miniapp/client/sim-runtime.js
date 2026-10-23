/* WeChat Mini Program H5 approximation runtime.
 * Executes the build produced by node/compiler.mjs inside a sandboxed iframe.
 * It reproduces layout and basic interaction only; native capabilities are stubbed and
 * reported through the console so the shell and the Agent can see them. */
(function () {
  'use strict';

  var BUILD = window.__WX_BUILD__;
  var FRAME = window.__WX_PREVIEW_FRAME__ || {};
  var PROJECT_ID = FRAME.projectId || (location.pathname.match(/\/sim\/([0-9a-f]{12})\//) || [])[1] || '';
  var INSTANCE_ID = FRAME.instanceId || new URLSearchParams(location.search || '').get('instance') || '';
  var PREVIEW_ID = FRAME.previewId || new URLSearchParams(location.search || '').get('previewId') || '';
  var viewport = document.getElementById('wx-viewport');
  var overlay = document.getElementById('wx-overlay');
  var navEl = document.getElementById('wx-nav');
  var statusEl = document.getElementById('wx-status');
  var titleEl = document.getElementById('wx-title');
  var backEl = document.getElementById('wx-back');
  var capsuleEl = document.getElementById('wx-capsule');
  var tabbarEl = document.getElementById('wx-tabbar');
  var devices = window.__WX_PREVIEW_DEVICES__;
  var DEVICE = devices.get(devices.defaultId);
  var viewportMetrics = null;
  function updateViewportMetrics(entry) {
    var route = entry ? entry.route : BUILD.entryPage;
    var config = entry ? entry.window : windowFor(route);
    var options = { customNavigation: config.navigationStyle === 'custom', tabBarVisible: entry ? !tabbarEl.hidden : isTabRoute(route), tabBarPosition: tabBar && tabBar.position };
    if (entry && viewport.clientHeight > 0) {
      options.contentHeight = viewport.clientHeight;
      var top = 0;
      for (var element = viewport; element; element = element.offsetParent) top += element.offsetTop || 0;
      options.contentTop = top;
    }
    viewportMetrics = devices.metrics(DEVICE.id, options);
    Object.keys(viewportMetrics.cssVariables).forEach(function (key) { document.documentElement.style.setProperty(key, viewportMetrics.cssVariables[key]); });
    return viewportMetrics;
  }
  function applyDevice(deviceId) {
    DEVICE = devices.get(deviceId);
    var root = document.documentElement.style;
    root.setProperty('--wx-status-height', DEVICE.statusBarHeight + 'px');
    root.setProperty('--wx-nav-height', DEVICE.navHeight + 'px');
    root.setProperty('--wx-capsule-width', DEVICE.capsule.width + 'px');
    root.setProperty('--wx-capsule-height', DEVICE.capsule.height + 'px');
    root.setProperty('--wx-capsule-top', DEVICE.capsule.top + 'px');
    root.setProperty('--wx-capsule-right', DEVICE.capsule.right + 'px');
    root.setProperty('--wx-safe-bottom', DEVICE.safeAreaBottom + 'px');
  }
  applyDevice(DEVICE.id);

  // ------------------------------------------------------------------ bridge + console
  function post(message) {
    message.source = 'wx-sim';
    message.projectId = PROJECT_ID;
    message.instanceId = INSTANCE_ID;
    try {
      window.parent.postMessage(message, '*');
    } catch (error) {
      /* standalone */
    }
  }
  var pendingLogs = [];
  var logTimer = null;
  var currentRoute = '';
  function diagnosticState(route) { return { route: route, status: 'rendered', details: [], keys: new Set(), warned: new Set() }; }
  var appDiagnostics = diagnosticState('');
  var executingDiagnostics = null;
  var creatingDiagnostics = null;
  var previewMounted = false;
  function diagnosticsFor(owner) {
    if (owner && owner === appInstance) return appDiagnostics;
    if (owner && owner.__diagnostics) return owner.__diagnostics;
    if (owner && owner.__page && owner.__page.__diagnostics) return owner.__page.__diagnostics;
    return executingDiagnostics || creatingDiagnostics || (pageStack && currentEntry() && currentEntry().diagnostics) || appDiagnostics;
  }
  function reportPreviewStatus(status, code, message, owner) {
    var scope = diagnosticsFor(owner);
    if (status === 'error' || (status === 'limited' && scope.status !== 'error')) scope.status = status;
    var key = code + ':' + message;
    if (message && !scope.keys.has(key) && scope.details.length < 100) {
      scope.keys.add(key);
      scope.details.push({ code: String(code || 'runtime').slice(0, 100), message: String(message).slice(0, 2000), route: scope.route });
    }
    var visible = pageStack && currentEntry() ? currentEntry().diagnostics : scope;
    var scopes = visible === appDiagnostics ? [appDiagnostics] : [appDiagnostics, visible];
    var combined = scopes.some(function (item) { return item.status === 'error'; }) ? 'error' : scopes.some(function (item) { return item.status === 'limited'; }) ? 'limited' : 'rendered';
    if (previewMounted || combined === 'error') post({ type: 'preview-status', status: combined, details: scopes.reduce(function (all, item) { return all.concat(item.details); }, []) });
  }
  function reportRuntimeError(error, code, owner) {
    reportPreviewStatus('error', code || 'runtime-error', error && error.message ? error.message : String(error), owner);
  }
  function formatArg(value) {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
    try {
      var seen = [];
      return JSON.stringify(value, function (_key, item) {
        if (item && typeof item === 'object') {
          if (seen.indexOf(item) >= 0) return '[Circular]';
          seen.push(item);
        }
        return item;
      });
    } catch (error) {
      return String(value);
    }
  }
  function emitLog(level, args, source) {
    var message = Array.prototype.map.call(args, formatArg).join(' ');
    pendingLogs.push({ level: level, message: message.slice(0, 4000), source: source || 'console', route: currentRoute });
    if (!logTimer) {
      logTimer = setTimeout(function () {
        logTimer = null;
        var batch = pendingLogs.splice(0, pendingLogs.length);
        if (batch.length) post({ type: 'log', entries: batch });
      }, 120);
    }
  }
  var nativeConsole = {};
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    nativeConsole[level] = console[level].bind(console);
    console[level] = function () {
      nativeConsole[level].apply(null, arguments);
      emitLog(level, arguments, 'console');
    };
  });
  window.addEventListener('error', function (event) {
    emitLog('error', [event.error || event.message], 'runtime');
    reportRuntimeError(event.error || event.message);
  });
  window.addEventListener('unhandledrejection', function (event) {
    emitLog('error', ['Unhandled promise rejection:', event.reason], 'runtime');
    reportRuntimeError(event.reason, 'unhandled-rejection');
  });
  function warnOnce(key, message) {
    var scope = diagnosticsFor();
    if (scope.warned.has(key)) return;
    scope.warned.add(key);
    emitLog('warn', ['[H5 预览] ' + message], 'runtime');
    reportPreviewStatus('limited', key, message);
  }

  // ------------------------------------------------------------------ utils
  function clone(value) {
    if (value === undefined) return undefined;
    try {
      return structuredClone(value);
    } catch (error) {
      return JSON.parse(JSON.stringify(value));
    }
  }
  function camel(name) {
    return name.replace(/-([a-z])/g, function (_m, ch) {
      return ch.toUpperCase();
    });
  }
  function convertRpx(text, ownerFile) {
    return window.WxComponentRuntime.rewriteCssUrls(window.WxComponentRuntime.convertStyleValues(text), function (url) {
      if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) return url;
      return resolveAsset(url, ownerFile || currentRoute);
    });
  }
  function parsePath(pathText) {
    var tokens = [];
    String(pathText).replace(/[^.[\]]+|\[(\d+)\]/g, function (match, index) {
      tokens.push(index !== undefined ? Number(index) : match);
      return match;
    });
    return tokens;
  }
  function setPath(target, pathText, value) {
    var tokens = parsePath(pathText);
    var node = target;
    for (var i = 0; i < tokens.length - 1; i++) {
      var key = tokens[i];
      if (node[key] === null || typeof node[key] !== 'object') node[key] = typeof tokens[i + 1] === 'number' ? [] : {};
      node = node[key];
    }
    node[tokens[tokens.length - 1]] = value;
    return tokens[0];
  }
  function getPath(target, pathText) {
    var tokens = parsePath(pathText);
    var node = target;
    for (var i = 0; i < tokens.length; i++) {
      if (node === null || node === undefined) return undefined;
      node = node[tokens[i]];
    }
    return node;
  }
  function dirOf(id) {
    var index = id.lastIndexOf('/');
    return index < 0 ? '' : id.slice(0, index);
  }
  function normalize(pathText) {
    var parts = [];
    pathText.split('/').forEach(function (part) {
      if (!part || part === '.') return;
      if (part === '..') parts.pop();
      else parts.push(part);
    });
    return parts.join('/');
  }
  function resolveFrom(fromId, spec) {
    if (spec.charAt(0) === '/') return normalize(spec);
    return normalize((dirOf(fromId) ? dirOf(fromId) + '/' : '') + spec);
  }
  function resolveAsset(src, ownerId) {
    if (!src || typeof src !== 'string') return src;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
    var suffix = src.match(/[?#].*$/);
    var local = src.indexOf('asset/') === 0 ? src : 'asset/' + resolveFrom(ownerId || '', src.split(/[?#]/)[0]) + (suffix ? suffix[0] : '');
    return previewAsset(local);
  }
  function previewAsset(src) {
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
    if (FRAME.assets && src.indexOf('asset/') === 0) {
      var key = src.slice(6).split(/[?#]/)[0];
      var dataUrl = Object.prototype.hasOwnProperty.call(FRAME.assets, key) ? FRAME.assets[key] : null;
      if (typeof dataUrl === 'string' && /^data:/i.test(dataUrl)) return dataUrl;
      warnOnce('asset:' + key, 'Local preview asset is unavailable: ' + key);
      return '';
    }
    if (!PREVIEW_ID) return src;
    var hash = src.indexOf('#');
    var fragment = hash < 0 ? '' : src.slice(hash);
    var base = hash < 0 ? src : src.slice(0, hash);
    var at = base.indexOf('?');
    var query = new URLSearchParams(at < 0 ? '' : base.slice(at + 1));
    query.set('previewId', PREVIEW_ID);
    return (at < 0 ? base : base.slice(0, at)) + '?' + query.toString() + fragment;
  }

  // ------------------------------------------------------------------ modules
  var moduleCache = {};
  window.__wxInteropDefault = function (mod) {
    return mod && mod.__esModule ? mod.default : mod;
  };
  window.__wxExportStar = function (target, mod) {
    Object.keys(mod || {}).forEach(function (key) {
      if (key !== 'default' && key !== '__esModule') target[key] = mod[key];
    });
  };
  window.getRegExp = function (pattern, flags) {
    return new RegExp(pattern, flags);
  };
  window.getDate = function () {
    var args = Array.prototype.slice.call(arguments);
    return args.length ? new (Function.prototype.bind.apply(Date, [null].concat(args)))() : new Date();
  };
  function resolveModule(fromId, spec) {
    var bases = [];
    if (spec.charAt(0) === '/' || spec.charAt(0) === '.') bases.push(resolveFrom(fromId, spec));
    else bases.push(resolveFrom(fromId, spec), normalize(spec), 'miniprogram_npm/' + spec);
    for (var i = 0; i < bases.length; i++) {
      var base = bases[i];
      var candidates = [base, base + '.js', base + '.wxs', base + '.json', base + '/index.js'];
      for (var j = 0; j < candidates.length; j++) {
        if (Object.prototype.hasOwnProperty.call(BUILD.modules, candidates[j])) return candidates[j];
      }
    }
    return null;
  }
  function loadModule(id) {
    if (moduleCache[id]) return moduleCache[id].exports;
    var source = BUILD.modules[id];
    if (source === undefined) throw new Error('module "' + id + '" is not defined');
    var module = { exports: {}, id: id };
    moduleCache[id] = module;
    var factory;
    try {
      factory = new Function('require', 'module', 'exports', source + '\n//# sourceURL=wx:///' + id);
    } catch (error) {
      delete moduleCache[id];
      throw new Error(id + ': ' + error.message);
    }
    factory.call(module.exports, makeRequire(id), module, module.exports);
    return module.exports;
  }
  function makeRequire(fromId) {
    var req = function (spec) {
      var id = resolveModule(fromId, String(spec));
      if (!id) throw new Error('module "' + spec + '" is not defined (required from ' + fromId + ')');
      return loadModule(id);
    };
    req.async = function (spec) {
      return Promise.resolve().then(function () {
        return req(spec);
      });
    };
    return req;
  }
  window.require = makeRequire('app.js');
  window.requirePlugin = function (name) {
    warnOnce('plugin:' + name, 'requirePlugin("' + name + '") 不支持，插件能力需要在微信开发者工具中验证');
    return {};
  };

  // ------------------------------------------------------------------ definitions
  var appInstance = null;
  var defining = null;
  var unitDefs = {};
  window.App = function (def) {
    appInstance = def || {};
    if (!appInstance.globalData) appInstance.globalData = appInstance.globalData || {};
  };
  window.getApp = function () {
    return appInstance || { globalData: {} };
  };
  window.Page = function (def) {
    if (defining) {
      defining.result = { type: 'page', def: def || {} };
      getComponentEngine().register(defining.id, def || {}, true);
    }
  };
  window.Component = function (def) {
    if (defining) {
      defining.result = { type: 'component', def: def || {} };
      getComponentEngine().register(defining.id, def || {});
    }
  };
  window.Behavior = function (def) {
    return getComponentEngine().behavior(def || {});
  };
  window.getCurrentPages = function () {
    return pageStack.map(function (entry) {
      return entry.instance;
    });
  };
  function loadUnitDef(id) {
    if (unitDefs[id]) return unitDefs[id];
    var unit = BUILD.units[id];
    if (!unit || !unit.js) throw new Error('"' + id + '" has no script');
    var previousDefinition = defining;
    defining = { id: id, result: null };
    try {
      loadModule(unit.js);
    } finally {
      var result = defining.result;
      defining = previousDefinition;
      if (result) unitDefs[id] = result;
    }
    if (!unitDefs[id]) throw new Error(unit.js + ' did not call ' + (unit.kind === 'page' ? 'Page()' : 'Component()'));
    return unitDefs[id];
  }

  // ------------------------------------------------------------------ expressions
  var exprCache = {};
  var GLOBAL_PASS = { undefined: 1, NaN: 1, Infinity: 1, Math: 1, JSON: 1, Number: 1, String: 1, parseInt: 1, parseFloat: 1, Date: 1, Array: 1, Object: 1, Boolean: 1, isNaN: 1, encodeURIComponent: 1, decodeURIComponent: 1 };
  var scopeHandler = {
    has: function (_target, key) {
      return typeof key === 'string' && !GLOBAL_PASS[key];
    },
    get: function (target, key) {
      if (key === Symbol.unscopables) return undefined;
      return target[key];
    },
  };
  function compileExpr(expr) {
    if (exprCache[expr]) return exprCache[expr];
    var fn;
    try {
      fn = new Function('__s', 'with(__s){return (' + expr + ');}');
    } catch (error) {
      warnOnce('expr:' + expr, 'WXML 表达式无法解析：{{' + expr + '}} (' + error.message + ')');
      fn = function () {
        return undefined;
      };
    }
    exprCache[expr] = fn;
    return fn;
  }
  function evalExpr(expr, scope) {
    try {
      return compileExpr(expr)(new Proxy(scope, scopeHandler));
    } catch (error) {
      warnOnce('eval:' + expr + ':' + error.message, 'WXML 表达式求值失败：{{' + expr + '}} — ' + error.message);
      return undefined;
    }
  }
  function interpolate(value, scope) {
    if (typeof value !== 'string') return value;
    if (value.indexOf('{{') < 0) return value;
    var single = value.match(/^\{\{([\s\S]*?)\}\}$/);
    if (single && single[1].indexOf('}}') < 0) return evalExpr(single[1], scope);
    return value.replace(/\{\{([\s\S]*?)\}\}/g, function (_m, expr) {
      var result = evalExpr(expr, scope);
      return result === undefined || result === null ? '' : String(result);
    });
  }
  function evalTemplateData(value, scope) {
    if (typeof value !== 'string') return {};
    var single = value.match(/^\{\{([\s\S]*)\}\}$/);
    if (!single) return {};
    var expr = single[1].trim();
    if (/^\.\.\.|^[\w$]+\s*:|,/.test(expr)) {
      var result = evalExpr('({' + expr + '})', scope);
      return result && typeof result === 'object' ? result : {};
    }
    var obj = evalExpr(expr, scope);
    return obj && typeof obj === 'object' ? obj : {};
  }
  function truthy(value) {
    return !!value;
  }

  // ------------------------------------------------------------------ template files
  var fileCtxCache = {};
  function fileCtx(id) {
    if (fileCtxCache[id]) return fileCtxCache[id];
    var template = BUILD.templates[id];
    var ctx = { id: id, nodes: template ? template.ast : [], templates: {}, wxs: {} };
    fileCtxCache[id] = ctx;
    var scan = function (nodes) {
      nodes.forEach(function (node) {
        if (node.t !== 'e') return;
        if (node.n === 'template' && typeof node.a.name === 'string') ctx.templates[node.a.name] = { nodes: node.c, file: ctx };
        if (node.n === 'wxs' && typeof node.a.module === 'string' && typeof node.a.src === 'string') {
          try {
            ctx.wxs[node.a.module] = loadModule(node.a.src);
          } catch (error) {
            console.error('WXS module "' + node.a.module + '" failed in ' + id + '.wxml:', error);
            reportRuntimeError(error, 'wxs-error');
          }
        }
        if (node.n !== 'template') scan(node.c);
      });
    };
    scan(ctx.nodes);
    ctx.nodes.forEach(function (node) {
      if (node.t === 'e' && node.n === 'import' && typeof node.a.src === 'string') {
        var imported = fileCtx(node.a.src);
        Object.keys(imported.templates).forEach(function (name) {
          if (imported.templates[name].file === imported && !ctx.templates[name]) ctx.templates[name] = imported.templates[name];
        });
      }
    });
    return ctx;
  }
  function withWxs(base, file) {
    var names = Object.keys(file.wxs);
    if (!names.length) return base;
    var scope = Object.create(base);
    names.forEach(function (name) {
      scope[name] = file.wxs[name];
    });
    return scope;
  }

  // ------------------------------------------------------------------ render (AST -> vnodes)
  var EVENT_ATTR = /^(capture-bind|capture-catch|mut-bind|bind|catch):?(.+)$/;
  var SKIP_ATTR = /^(wx:|generic:|mark:|slot$|is$|data$)/;
  var UNSUPPORTED_TAGS = { map: 1, canvas: 1, camera: 1, 'web-view': 1, 'live-player': 1, 'live-pusher': 1, ad: 1, editor: 1, 'open-data': 1, 'official-account': 1, audio: 1, 'voip-room': 1 };
  var renderDepth = 0;

  function renderNodes(nodes, scope, ctx, out, depth) {
    var chain = null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.t === 'x') {
        chain = null;
        var text = interpolate(node.v, scope);
        if (text !== undefined && text !== null && text !== '') out.push({ text: String(text) });
        continue;
      }
      var a = node.a;
      if ('wx:for' in a || 'wx:for-items' in a) {
        chain = null;
        renderFor(node, scope, ctx, out, depth);
        continue;
      }
      if ('wx:if' in a) {
        chain = truthy(interpolate(a['wx:if'], scope));
        if (!chain) continue;
      } else if ('wx:elif' in a) {
        if (chain) continue;
        chain = truthy(interpolate(a['wx:elif'], scope));
        if (!chain) continue;
      } else if ('wx:else' in a) {
        if (chain) {
          chain = null;
          continue;
        }
        chain = null;
      } else {
        chain = null;
      }
      renderElement(node, scope, ctx, out, depth, undefined);
    }
  }

  function renderFor(node, scope, ctx, out, depth) {
    var a = node.a;
    var list = interpolate(a['wx:for'] !== undefined ? a['wx:for'] : a['wx:for-items'], scope);
    var itemName = typeof a['wx:for-item'] === 'string' ? a['wx:for-item'] : 'item';
    var indexName = typeof a['wx:for-index'] === 'string' ? a['wx:for-index'] : 'index';
    var keyName = typeof a['wx:key'] === 'string' ? a['wx:key'] : null;
    var entries = [];
    if (Array.isArray(list)) list.forEach(function (item, index) { entries.push([index, item]); });
    else if (typeof list === 'number') for (var n = 0; n < list; n++) entries.push([n, n]);
    else if (typeof list === 'string') list.split('').forEach(function (ch, index) { entries.push([index, ch]); });
    else if (list && typeof list === 'object') Object.keys(list).forEach(function (key) { entries.push([key, list[key]]); });
    entries.forEach(function (entry) {
      var itemScope = Object.create(scope);
      itemScope[itemName] = entry[1];
      itemScope[indexName] = entry[0];
      if ('wx:if' in a && !truthy(interpolate(a['wx:if'], itemScope))) return;
      var key;
      if (keyName) key = 'k:' + String(keyName === '*this' ? entry[1] : entry[1] && typeof entry[1] === 'object' ? entry[1][keyName] : entry[0]);
      renderElement(node, itemScope, ctx, out, depth, key);
    });
  }

  function collectCommon(node, scope, ctx) {
    var attrs = {};
    var ev = [];
    var dataset = {};
    var props = {};
    Object.keys(node.a).forEach(function (name) {
      var raw = node.a[name];
      var eventMatch = name.match(EVENT_ATTR);
      if (eventMatch) {
        var handler = interpolate(raw, scope);
        if (typeof handler === 'string' && handler) {
          ev.push({ type: eventMatch[2].toLowerCase(), handler: handler, catch: eventMatch[1].indexOf('catch') >= 0, capture: eventMatch[1].indexOf('capture-') === 0, mut: eventMatch[1] === 'mut-bind', owner: ctx.owner });
        }
        return;
      }
      if (SKIP_ATTR.test(name)) return;
      var value = interpolate(raw, scope);
      if (name.indexOf('data-') === 0) {
        dataset[camel(name.slice(5).toLowerCase())] = value;
        return;
      }
      props[name] = value;
    });
    return { attrs: attrs, ev: ev, dataset: dataset, props: props };
  }

  function styleScope(kind, id) {
    return kind === 'app' ? 'app' : kind + ':' + encodeURIComponent(id);
  }
  function acceptedStyleScopes(owner) {
    if (!owner) return [];
    var page = owner.__isPage ? owner : owner.__page;
    var own = owner.__styleToken || styleScope(owner.__isPage ? 'page' : 'component', owner.route || owner.is);
    var scopes = [own];
    if (owner.__isPage || owner.__styleIsolation !== 'isolated') {
      scopes.push('app');
      if (page) {
        scopes.push(styleScope('page', page.route));
        if (page.__sharedStyleScopes) page.__sharedStyleScopes.forEach(function (scope) { scopes.push(scope); });
      }
    }
    return Array.from(new Set(scopes));
  }
  function classBindings(value, owner) {
    var text = value === undefined || value === null || value === false ? '' : String(value);
    var external = owner && owner.__externalClasses;
    var bindings = [];
    text.split(/\s+/).filter(Boolean).forEach(function (name) {
      if (external && Object.prototype.hasOwnProperty.call(external, name)) {
        var source = external[name];
        classBindings(source.value, source.owner).forEach(function (binding) {
          bindings.push({ name: binding.name, scopes: binding.scopes, external: true });
        });
      } else bindings.push({ name: name, scopes: acceptedStyleScopes(owner), external: false });
    });
    return bindings;
  }
  function applyStyleScopes(el, vnode) {
    el.setAttribute('data-wx-style-scope', acceptedStyleScopes(vnode.owner).join(' '));
    var external = [];
    classBindings(vnode.props['class'], vnode.owner).forEach(function (binding) {
      if (binding.external) binding.scopes.forEach(function (scope) { external.push(scope + '|' + encodeURIComponent(binding.name)); });
    });
    if (external.length) el.setAttribute('data-wx-external', Array.from(new Set(external)).join(' '));
    else el.removeAttribute('data-wx-external');
  }
  function refreshPageStyleScopes(page) {
    if (!page || !page.__el) return;
    page.__el.setAttribute('data-wx-style-scope', acceptedStyleScopes(page).join(' '));
    if (renderDepth || !page.__stylesDirty) return;
    page.__stylesDirty = false;
    Array.prototype.forEach.call(page.__el.querySelectorAll('*'), function (el) {
      if (el.__v && el.__v.props) {
        // Forwarded external classes may change without a child data update.
        // Their resolved class and scope must be refreshed together.
        var classes = classBindings(el.__v.props['class'], el.__v.owner).map(function (binding) { return binding.name; }).join(' ');
        var extra = el.__adapter && el.__adapter.className ? el.__adapter.className(el.__v) : '';
        var value = [classes, extra].filter(Boolean).join(' ');
        if (value) el.setAttribute('class', value);
        else el.removeAttribute('class');
        applyStyleScopes(el, el.__v);
      }
      if (el.__syncPlaceholder) el.__syncPlaceholder();
    });
  }
  function classValue(value, ctx) {
    return classBindings(value, ctx.owner).map(function (binding) { return binding.name; }).join(' ');
  }

  function renderElement(node, scope, ctx, out, depth, key) {
    if (depth > 200) {
      warnOnce('depth', '模板嵌套过深，已停止渲染');
      return;
    }
    var tag = node.n;
    if (tag === 'block') {
      renderNodes(node.c, scope, ctx, out, depth + 1);
      return;
    }
    if (tag === 'import' || tag === 'wxs') return;
    if (tag === 'template') {
      if (typeof node.a.name === 'string') return;
      var name = interpolate(node.a.is, scope);
      var def = ctx.file.templates[name];
      if (!def) {
        warnOnce('tpl:' + name, '<template is="' + name + '"> 未定义');
        return;
      }
      var data = evalTemplateData(node.a.data, scope);
      var tctx = Object.assign({}, ctx, { file: def.file });
      renderNodes(def.nodes, withWxs(data, def.file), tctx, out, depth + 1);
      return;
    }
    if (tag === 'include') {
      var included = fileCtx(node.a.src);
      var ictx = Object.assign({}, ctx, { file: included });
      var content = included.nodes.filter(function (child) {
        return !(child.t === 'e' && (child.n === 'template' || child.n === 'wxs' || child.n === 'import'));
      });
      renderNodes(content, withWxs(scope, included), ictx, out, depth + 1);
      return;
    }
    if (tag === 'slot') {
      out.push({ type: 'slot', slotName: interpolate(node.a.name, scope) || '' });
      return;
    }
    var common = collectCommon(node, scope, ctx);
    var slot = typeof node.a.slot === 'string' ? interpolate(node.a.slot, scope) : undefined;
    var compId = ctx.using && ctx.using[tag];
    if (compId) {
      var slots = [];
      renderNodes(node.c, scope, ctx, slots, depth + 1);
      out.push({
        type: 'comp:' + compId,
        comp: compId,
        tag: tag.indexOf('-') > 0 ? tag : 'wx-c-' + tag,
        props: common.props,
        ev: common.ev,
        dataset: common.dataset,
        children: slots,
        key: key,
        owner: ctx.owner,
        ownerFile: ctx.file.id,
        slot: slot,
        cls: classValue(common.props['class'], ctx),
      });
      return;
    }
    var children = [];
    renderNodes(node.c, scope, ctx, children, depth + 1);
    out.push({
      type: tag,
      tag: tag,
      props: common.props,
      ev: common.ev,
      dataset: common.dataset,
      children: children,
      key: key,
      owner: ctx.owner,
      ownerFile: ctx.file.id,
      slot: slot,
      cls: classValue(common.props['class'], ctx),
    });
  }

  // ------------------------------------------------------------------ DOM patching
  var ATTR_NAME = /^[a-zA-Z_][\w-]*$/;
  var REFLECT_SKIP = { class: 1, style: 1, value: 1, checked: 1 };

  function applyAttributes(el, vnode, extraClass) {
    var prev = el.__attrs || {};
    var next = {};
    Object.keys(vnode.props).forEach(function (name) {
      if (!ATTR_NAME.test(name) || REFLECT_SKIP[name]) return;
      var value = vnode.props[name];
      if (value === false || value === null || value === undefined || value === 'false') return;
      if (typeof value === 'object') return;
      next[name] = value === true ? '' : String(value);
    });
    Object.keys(prev).forEach(function (name) {
      if (!(name in next)) el.removeAttribute(name);
    });
    Object.keys(next).forEach(function (name) {
      if (el.getAttribute(name) !== next[name]) el.setAttribute(name, next[name]);
    });
    el.__attrs = next;
    var cls = [vnode.cls, extraClass].filter(Boolean).join(' ');
    if ((el.getAttribute('class') || '') !== cls) {
      if (cls) el.setAttribute('class', cls);
      else el.removeAttribute('class');
    }
    var style = vnode.props.style;
    var styleText = style === undefined || style === null || style === false ? '' : convertRpx(style, vnode.ownerFile);
    if (el.__styleText !== styleText) {
      el.setAttribute('style', styleText);
      el.__styleText = styleText;
    }
    if (truthy(vnode.props.hidden) && vnode.props.hidden !== 'false') el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
    el.__wx = { ev: vnode.ev, dataset: vnode.dataset, id: vnode.props.id ? String(vnode.props.id) : '', owner: vnode.owner };
    applyStyleScopes(el, vnode);
  }

  // ------------------------------------------------------------------ instances
  var dirty = new Set();
  var flushScheduled = false;
  function scheduleRender(instance, callback) {
    dirty.add(instance);
    if (callback) (instance.__callbacks = instance.__callbacks || []).push(callback);
    if (flushScheduled) return;
    flushScheduled = true;
    Promise.resolve().then(flush);
  }
  function flush() {
    flushScheduled = false;
    var items = Array.from(dirty);
    dirty.clear();
    items.forEach(function (item) {
      if (!item.__alive) return;
      try {
        item.__render();
      } catch (error) {
        console.error('Render failed for ' + (item.route || item.is) + ':', error);
        reportRuntimeError(error, 'render-error', item);
      }
    });
    items.forEach(function (item) {
      var callbacks = item.__callbacks;
      item.__callbacks = null;
      if (!item.__alive) return;
      (callbacks || []).forEach(function (fn) {
        safeCall(fn, item, []);
      });
    });
  }
  function safeCall(fn, self, args) {
    var previousDiagnostics = executingDiagnostics;
    executingDiagnostics = diagnosticsFor(self);
    try {
      return fn.apply(self, args);
    } catch (error) {
      console.error(error);
      reportRuntimeError(error, 'callback-error', self);
      return undefined;
    } finally {
      executingDiagnostics = previousDiagnostics;
    }
  }
  function makeSetData(instance) {
    return function (patch, callback) {
      if (!instance.__alive || !patch || typeof patch !== 'object') return;
      Object.keys(patch).forEach(function (pathText) {
        var value = patch[pathText];
        setPath(instance.data, pathText, value === undefined ? undefined : value);
      });
      scheduleRender(instance, callback);
    };
  }
  function selectorQueryFor(rootGetter) {
    return function () {
      return createSelectorQuery(rootGetter);
    };
  }
  var componentEngine = null;
  function getComponentEngine() {
    if (componentEngine) return componentEngine;
    if (!window.WxComponentRuntime) throw new Error('Component runtime bundle is missing');
    componentEngine = window.WxComponentRuntime.createRuntime({
      units: BUILD.units,
      loadDefinition: loadUnitDef,
      render: function (id, data, owner) {
        var unit = BUILD.units[id];
        var file = fileCtx(id);
        var result = [];
        renderNodes(file.nodes, withWxs(data, file), { owner: owner, file: file, using: unit.using }, result, 0);
        return result;
      },
      prepareOwner: function (owner, definition, host, page, serial) {
        if (definition.synthetic) return;
        var id = definition.id;
        var pageComponent = BUILD.units[id].kind === 'page';
        owner.__page = page;
        owner.__diagnostics = page.__diagnostics || creatingDiagnostics;
        (definition.notices || []).forEach(function (message) { reportPreviewStatus('limited', 'component-option', message, owner); });
        owner.getPageId = function () { return page.__pageId; };
        owner.animate = function () { reportPreviewStatus('limited', 'component-animate', 'this.animate() is not supported in H5 preview', owner); };
        owner.clearAnimation = function () { reportPreviewStatus('limited', 'component-clear-animation', 'this.clearAnimation() is not supported in H5 preview', owner); };
        owner.__host = host;
        owner.__isPage = pageComponent;
        owner.__styleIsolation = definition.isolation;
        if (pageComponent) {
          owner.route = id;
          owner.__styleToken = styleScope('page', id);
          owner.__sharedStyleScopes = new Set();
          return;
        }
        var base = styleScope('component', id);
        var token = base + ':instance-' + serial;
        owner.__styleToken = token;
        var css = BUILD.componentStyles && BUILD.componentStyles[id];
        if (host) host.setAttribute('data-wx-style-host', token);
        if (css) {
          var sheet = document.createElement('style');
          sheet.textContent = css
            .split('[data-wx-style-scope~=' + JSON.stringify(base) + ']').join('[data-wx-style-scope~=' + JSON.stringify(token) + ']')
            .split('[data-wx-external~="' + base + '|').join('[data-wx-external~="' + token + '|')
            .split('[data-wx-comp=' + JSON.stringify(id) + ']').join('[data-wx-style-host=' + JSON.stringify(token) + ']');
          document.head.appendChild(sheet);
          owner.__previewStyle = sheet;
        }
        if (definition.isolation === 'shared' && page) {
          page.__sharedStyleScopes.add(token);
          page.__stylesDirty = true;
        }
      },
      updateOwner: function (owner, vnode, hasExternalClass) {
        var external = {};
        var previous = owner.__externalClasses || {};
        var changed = false;
        Object.keys(vnode.props).forEach(function (name) {
          if (hasExternalClass(name)) {
            external[name] = { value: vnode.props[name], owner: vnode.owner };
            if (!previous[name] || previous[name].value !== vnode.props[name] || previous[name].owner !== vnode.owner) changed = true;
          }
        });
        if (Object.keys(previous).length !== Object.keys(external).length) changed = true;
        owner.__externalClasses = external;
        return changed;
      },
      disposeOwner: function (owner, page) {
        if (owner.__previewStyle) { owner.__previewStyle.remove(); owner.__previewStyle = null; }
        if (owner.__styleIsolation === 'shared' && page && page.__sharedStyleScopes) {
          page.__sharedStyleScopes.delete(owner.__styleToken);
          page.__stylesDirty = true;
          refreshPageStyleScopes(page);
        }
      },
      updateHost: function (el, vnode, id) {
        el.__v = vnode;
        applyAttributes(el, vnode, '');
        el.setAttribute('data-wx-comp', id);
      },
      createNative: function (vnode) {
        var adapter = ADAPTERS[vnode.tag] || (UNSUPPORTED_TAGS[vnode.tag] ? UNSUPPORTED_ADAPTER : GENERIC_ADAPTER);
        var el = adapter.create(vnode);
        el.__adapter = adapter;
        return el;
      },
      nativeContainer: function (el) { return el.__adapter.container ? el.__adapter.container(el) : el; },
      updateNative: function (el, vnode, previous, page) {
        el.__v = vnode;
        el.__page = page;
        var adapter = el.__adapter;
        applyAttributes(el, vnode, adapter.className ? adapter.className(vnode) : '');
        adapter.update(el, vnode, previous, page);
      },
      afterNative: function (el, vnode, previous, page) { if (el.__adapter.after) el.__adapter.after(el, vnode, previous, page); },
      disposeNative: function (el) { if (el.__dispose) { el.__dispose(); el.__dispose = null; } },
      afterRender: function (page) { page.__stylesDirty = true; refreshPageStyleScopes(page); },
      invoke: invokeHandler,
      reportError: function (error, owner) { reportRuntimeError(error, 'component-error', owner); },
      reportWarning: function (message) { warnOnce('component:' + message, message); },
    });
    return componentEngine;
  }

  var pageCounter = 0;
  function createPageInstance(route, query, el) {
    var loaded = loadUnitDef(route);
    var def = loaded.def;
    var instance = { route: route, __route__: route, options: query, __isPage: true, __pageId: ++pageCounter, __el: el, __alive: true, __diagnostics: creatingDiagnostics, __sharedStyleScopes: new Set() };
    var componentPage = loaded.type === 'component';
    if (!componentPage) {
      instance.data = clone(def.data) || {};
      Object.keys(def).forEach(function (name) {
        if (name === 'data') return;
        var value = def[name];
        instance[name] = typeof value === 'function' ? value.bind(instance) : value;
      });
      instance.setData = makeSetData(instance);
    }
    var handle = getComponentEngine().createPageRoot({ id: route, container: el, caller: instance, componentPage: componentPage, query: query });
    if (componentPage) {
      instance = handle.caller;
      instance.route = route;
      instance.__route__ = route;
      instance.options = query;
      instance.__isPage = true;
      instance.__pageId = pageCounter;
      instance.__el = el;
      instance.__alive = true;
    } else {
      instance.selectComponent = function (selector) { return handle.select(selector, false); };
      instance.selectAllComponents = function (selector) { return handle.select(selector, true); };
      instance.createSelectorQuery = selectorQueryFor(function () { return el; });
      instance.createIntersectionObserver = function () { return stubIntersectionObserver(); };
    }
    instance.__handle = handle;
    instance.getOpenerEventChannel = function () { return { emit: function () {}, on: function () {}, once: function () {}, off: function () {} }; };
    instance.__render = function () { if (instance.__alive) handle.update(instance.data); };
    instance.__call = function (name, args) {
      if (instance.__alive && typeof instance[name] === 'function') return safeCall(instance[name], instance, args || []);
      return undefined;
    };
    return instance;
  }

  // ------------------------------------------------------------------ events
  function nodeInfo(el) {
    var info = el && el.__wx;
    return { id: info ? info.id : '', dataset: info ? info.dataset : {}, offsetLeft: el ? el.offsetLeft : 0, offsetTop: el ? el.offsetTop : 0 };
  }
  function invokeHandler(handler, event) {
    var owner = handler.owner;
    var fn = owner && owner[handler.handler];
    if (typeof fn !== 'function') {
      warnOnce('handler:' + handler.handler, '事件处理函数 "' + handler.handler + '" 未在 ' + (owner && (owner.route || owner.is) || '当前页面') + ' 中定义');
      return undefined;
    }
    return safeCall(fn, owner, [event]);
  }
  function closestWx(el) {
    while (el && el !== document.body) {
      if (el.nodeType === 1 && el.__wx) return el;
      el = el.parentNode;
    }
    return null;
  }
  function dispatchEventPath(type, startEl, detail, nativeEvent, options) {
    return getComponentEngine().dispatch(type, startEl, detail, nativeEvent, options || {});
  }
  function dispatchBubbling(type, startEl, detail, nativeEvent) {
    return dispatchEventPath(type, startEl, detail, nativeEvent, { bubbles: true, composed: true, capturePhase: true });
  }
  function fireLocal(el, type, detail) {
    return dispatchEventPath(type, el, detail, null, {});
  }
  var longPressTimer = null;
  var longPressFired = false;
  var pressStart = null;
  ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      var element = event.target && event.target.closest ? event.target.closest('wx-button') : null;
      if (!element || !element.__v || !isOn(element.__v.props.disabled)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  });
  document.addEventListener('pointerdown', function (event) {
    if (!viewport.contains(event.target)) return;
    longPressFired = false;
    pressStart = event;
    dispatchBubbling('touchstart', event.target, {}, event);
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(function () {
      longPressFired = true;
      dispatchBubbling('longpress', event.target, { x: event.clientX, y: event.clientY }, event);
      dispatchBubbling('longtap', event.target, { x: event.clientX, y: event.clientY }, event);
    }, 350);
  }, true);
  document.addEventListener('pointermove', function (event) {
    if (!pressStart) return;
    if (Math.abs(event.clientX - pressStart.clientX) + Math.abs(event.clientY - pressStart.clientY) > 10) clearTimeout(longPressTimer);
    dispatchBubbling('touchmove', event.target, {}, event);
  }, true);
  document.addEventListener('pointerup', function (event) {
    clearTimeout(longPressTimer);
    if (pressStart) dispatchBubbling('touchend', event.target, {}, event);
    pressStart = null;
  }, true);
  document.addEventListener('click', function (event) {
    if (!viewport.contains(event.target)) return;
    if (longPressFired) {
      longPressFired = false;
      var hasLong = closestHandler(event.target, 'longpress');
      if (hasLong) return;
    }
    dispatchBubbling('tap', event.target, { x: event.clientX, y: event.clientY }, event);
  });
  function closestHandler(el, type) {
    while (el && el !== document.body) {
      if (el.__wx && el.__wx.ev.some(function (h) { return h.type === type; })) return el;
      el = el.parentNode;
    }
    return null;
  }

  // ------------------------------------------------------------------ built-in components
  function elementFor(tag) {
    return document.createElement('wx-' + tag);
  }
  var GENERIC_ADAPTER = {
    create: function (vnode) {
      if (['view', 'text', 'cover-view', 'swiper-item', 'checkbox-group', 'radio-group'].indexOf(vnode.tag) < 0) {
        warnOnce('tag:' + vnode.tag, '<' + vnode.tag + '> 仅提供 H5 布局占位，未实现组件行为');
      }
      return elementFor(vnode.tag);
    },
    update: function () {},
  };
  var UNSUPPORTED_ADAPTER = {
    create: function (vnode) {
      var el = elementFor(vnode.tag);
      el.classList.add('wx-unsupported');
      var label = document.createElement('span');
      label.className = 'wx-unsupported-label';
      label.textContent = '<' + vnode.tag + '> 暂不支持 H5 预览';
      label.__wxInternal = true;
      el.appendChild(label);
      warnOnce('tag:' + vnode.tag, '<' + vnode.tag + '> 暂不支持 H5 预览，请在微信开发者工具或真机验证');
      return el;
    },
    update: function () {},
    className: function () { return 'wx-unsupported'; },
    container: function () { return null; },
  };
  function inner(el, tagName, setup) {
    if (!el.__inner) {
      el.__inner = document.createElement(tagName);
      el.__inner.__wxInternal = true;
      if (setup) setup(el.__inner);
      el.appendChild(el.__inner);
    }
    return el.__inner;
  }
  function isOn(value) {
    return value === true || value === '' || (value !== undefined && value !== null && value !== false && value !== 'false' && value !== 0);
  }
  function setControlValue(control, value, el) {
    var text = value === undefined || value === null ? '' : String(value);
    // Unrelated setData (including onShow/timers) must not erase a native draft.
    if (el.__lastValue !== text) {
      if (control.value !== text) control.value = text;
    }
    el.__lastValue = text;
  }
  var placeholderCounter = 0;
  var placeholderProperties = ['color', 'font-size', 'font-family', 'font-weight', 'font-style', 'letter-spacing', 'word-spacing', 'text-transform', 'text-decoration', 'text-indent', 'line-height', 'opacity'];
  function configurePlaceholder(el, control, vnode) {
    if (!el.__placeholder) {
      var token = 'placeholder-' + (++placeholderCounter);
      control.setAttribute('data-wx-placeholder', token);
      var mirror = document.createElement('wx-placeholder');
      mirror.setAttribute('aria-hidden', 'true');
      mirror.setAttribute('data-wx-placeholder-mirror', token);
      mirror.__wxInternal = true;
      mirror.style.setProperty('display', 'none', 'important');
      el.appendChild(mirror);
      var sheet = document.createElement('style');
      sheet.setAttribute('data-wx-placeholder-sheet', token);
      document.head.appendChild(sheet);
      el.__placeholder = { token: token, mirror: mirror, sheet: sheet };
      el.__syncPlaceholder = function () {
        var state = el.__placeholder;
        if (!state || !el.__v) return;
        var current = el.__v;
        var placeholderVnode = { props: { class: current.props['placeholder-class'] || '' }, owner: current.owner };
        state.mirror.__v = placeholderVnode;
        state.mirror.className = classBindings(placeholderVnode.props.class, current.owner).map(function (binding) { return binding.name; }).join(' ');
        applyStyleScopes(state.mirror, placeholderVnode);
        var declarations = document.createElement('span').style;
        if (el.isConnected) {
          var computed = getComputedStyle(state.mirror);
          placeholderProperties.forEach(function (name) {
            var value = computed.getPropertyValue(name);
            if (value) declarations.setProperty(name, value);
          });
        }
        var inline = document.createElement('span').style;
        inline.cssText = convertRpx(current.props['placeholder-style'] || '', current.ownerFile);
        placeholderProperties.forEach(function (name) {
          var value = inline.getPropertyValue(name);
          if (value) declarations.setProperty(name, value, inline.getPropertyPriority(name));
        });
        state.sheet.textContent = ':where([data-wx-placeholder-mirror="' + state.token + '"]){color:#999;opacity:1}' +
          '[data-wx-placeholder="' + state.token + '"]::placeholder{' + declarations.cssText + '}';
      };
      var previousDispose = el.__dispose;
      el.__dispose = function () {
        if (previousDispose) previousDispose();
        el.__placeholder.sheet.remove();
        el.__placeholder.mirror.remove();
        el.__placeholder = null;
        el.__syncPlaceholder = null;
      };
    }
    el.__syncPlaceholder();
  }
  function inputLikeAdapter(tagName) {
    return {
      create: function (vnode) {
        var el = elementFor(vnode.tag);
        var control = inner(el, tagName);
        control.addEventListener('input', function () {
          var result = fireLocal(el, 'input', { value: control.value, cursor: control.selectionStart, keyCode: 0 });
          if (typeof result === 'string' || typeof result === 'number') control.value = String(result);
          else if (result && typeof result === 'object' && 'value' in result) control.value = String(result.value);
        });
        control.addEventListener('focus', function () { fireLocal(el, 'focus', { value: control.value, height: 0 }); });
        control.addEventListener('blur', function () { fireLocal(el, 'blur', { value: control.value }); });
        control.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' && (tagName === 'input' || event.metaKey || event.ctrlKey)) fireLocal(el, 'confirm', { value: control.value });
        });
        return el;
      },
      update: function (el, vnode, prev) {
        var p = vnode.props;
        var control = el.__inner;
        if (tagName === 'input') {
          var type = p.password !== undefined && isOn(p.password) ? 'password' : p.type === 'number' || p.type === 'digit' ? 'text' : 'text';
          if (control.type !== type) control.type = type;
          control.inputMode = p.type === 'number' ? 'numeric' : p.type === 'digit' ? 'decimal' : 'text';
        }
        control.placeholder = p.placeholder === undefined || p.placeholder === null ? '' : String(p.placeholder);
        control.disabled = isOn(p.disabled);
        var max = p.maxlength === undefined ? 140 : Number(p.maxlength);
        if (max > 0) control.maxLength = max;
        else control.removeAttribute('maxlength');
        configurePlaceholder(el, control, vnode);
        setControlValue(control, p.value, el);
        var focus = isOn(p.focus) || (!prev && isOn(p['auto-focus']));
        if (focus && (!prev || !isOn(prev.props.focus))) setTimeout(function () { if (el.isConnected && !storageQuiescing) control.focus(); }, 0);
      },
      container: function () { return null; },
    };
  }
  function checkAdapter(kind) {
    return {
      create: function (vnode) {
        var el = elementFor(vnode.tag);
        var control = inner(el, 'input', function (input) { input.type = kind; });
        var box = document.createElement('span');
        box.className = 'wx-' + kind + '-box';
        box.__wxInternal = true;
        el.insertBefore(box, control.nextSibling);
        el.__box = box;
        el.addEventListener('click', function (event) {
          if (event.target === control) return;
          if (control.disabled) return;
          if (kind === 'radio') control.checked = true;
          else control.checked = !control.checked;
          control.dispatchEvent(new Event('change', { bubbles: true }));
        });
        control.addEventListener('change', function () {
          el.toggleAttribute('data-checked', control.checked);
          var group = el.parentNode;
          while (group && group.tagName !== (kind === 'radio' ? 'WX-RADIO-GROUP' : 'WX-CHECKBOX-GROUP')) group = group.parentNode;
          if (!group) return;
          if (kind === 'radio') {
            Array.prototype.forEach.call(group.querySelectorAll('wx-radio'), function (other) {
              if (other !== el && other.__inner) {
                other.__inner.checked = false;
                other.removeAttribute('data-checked');
              }
            });
            fireLocal(group, 'change', { value: el.__v.props.value === undefined ? '' : String(el.__v.props.value) });
          } else {
            var values = [];
            Array.prototype.forEach.call(group.querySelectorAll('wx-checkbox'), function (item) {
              if (item.__inner && item.__inner.checked) values.push(item.__v.props.value === undefined ? '' : String(item.__v.props.value));
            });
            fireLocal(group, 'change', { value: values });
          }
        });
        return el;
      },
      update: function (el, vnode, prev) {
        var control = el.__inner;
        var checked = isOn(vnode.props.checked);
        if (!prev || isOn(prev.props.checked) !== checked) control.checked = checked;
        el.toggleAttribute('data-checked', control.checked);
        control.disabled = isOn(vnode.props.disabled);
        if (vnode.props.color) el.__box.style.color = String(vnode.props.color);
      },
      container: function (el) { return el; },
    };
  }

  var ADAPTERS = {
    image: {
      create: function (vnode) {
        var el = elementFor('image');
        var img = inner(el, 'img');
        img.alt = '';
        img.addEventListener('load', function () {
          if (el.__v && el.__v.props.mode === 'widthFix') el.style.height = 'auto';
          fireLocal(el, 'load', { width: img.naturalWidth, height: img.naturalHeight });
        });
        img.addEventListener('error', function () { fireLocal(el, 'error', { errMsg: 'GET ' + img.src + ' failed' }); });
        return el;
      },
      update: function (el, vnode) {
        var img = el.__inner;
        var src = resolveAsset(vnode.props.src, vnode.ownerFile);
        if (src && img.getAttribute('src') !== src) img.setAttribute('src', src);
        if (!src) img.removeAttribute('src');
        el.setAttribute('data-mode', vnode.props.mode || 'scaleToFill');
      },
      container: function () { return null; },
    },
    input: inputLikeAdapter('input'),
    textarea: inputLikeAdapter('textarea'),
    button: {
      create: function (vnode) {
        var el = elementFor('button');
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.addEventListener('click', function () {
          var p = el.__v.props;
          if (isOn(p.disabled)) return;
          var formType = p['form-type'];
          if (formType === 'submit' || formType === 'reset') {
            var form = el.parentNode;
            while (form && form.tagName !== 'WX-FORM') form = form.parentNode;
            if (form && form.__formAction) form.__formAction(formType);
          }
          if (p['open-type']) warnOnce('open-type:' + p['open-type'], '<button open-type="' + p['open-type'] + '"> 需要在微信环境中验证');
        });
        el.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            el.click();
          }
        });
        return el;
      },
      update: function (el, vnode) {
        el.setAttribute('aria-disabled', String(isOn(vnode.props.disabled)));
        el.tabIndex = isOn(vnode.props.disabled) ? -1 : 0;
      },
    },
    switch: {
      create: function (vnode) {
        var el = elementFor('switch');
        var control = inner(el, 'input', function (input) {
          input.type = 'checkbox';
          input.setAttribute('role', 'switch');
        });
        control.addEventListener('change', function () {
          el.toggleAttribute('data-checked', control.checked);
          fireLocal(el, 'change', { value: control.checked });
        });
        return el;
      },
      update: function (el, vnode, prev) {
        var control = el.__inner;
        var checked = isOn(vnode.props.checked);
        if (!prev || isOn(prev.props.checked) !== checked) control.checked = checked;
        el.toggleAttribute('data-checked', control.checked);
        control.disabled = isOn(vnode.props.disabled);
        el.style.setProperty('--wx-switch-color', vnode.props.color ? String(vnode.props.color) : '#04be02');
      },
      container: function () { return null; },
    },
    checkbox: checkAdapter('checkbox'),
    radio: checkAdapter('radio'),
    slider: {
      create: function () {
        var el = elementFor('slider');
        var control = inner(el, 'input', function (input) { input.type = 'range'; });
        var value = document.createElement('span');
        value.className = 'wx-slider-value';
        value.__wxInternal = true;
        el.appendChild(value);
        el.__valueEl = value;
        control.addEventListener('input', function () {
          value.textContent = control.value;
          fireLocal(el, 'changing', { value: Number(control.value) });
        });
        control.addEventListener('change', function () { fireLocal(el, 'change', { value: Number(control.value) }); });
        return el;
      },
      update: function (el, vnode, prev) {
        var p = vnode.props;
        var control = el.__inner;
        control.min = p.min === undefined ? '0' : String(p.min);
        control.max = p.max === undefined ? '100' : String(p.max);
        control.step = p.step === undefined ? '1' : String(p.step);
        control.disabled = isOn(p.disabled);
        if (!prev || prev.props.value !== p.value) control.value = p.value === undefined ? control.min : String(p.value);
        el.__valueEl.hidden = !isOn(p['show-value']);
        el.__valueEl.textContent = control.value;
        control.style.accentColor = p.activeColor || p['active-color'] || p.selectedColor || '#1aad19';
      },
      container: function () { return null; },
    },
    progress: {
      create: function () {
        var el = elementFor('progress');
        var track = inner(el, 'span');
        track.className = 'wx-progress-track';
        var bar = document.createElement('span');
        bar.className = 'wx-progress-bar';
        track.appendChild(bar);
        var info = document.createElement('span');
        info.className = 'wx-progress-info';
        info.__wxInternal = true;
        el.appendChild(info);
        el.__bar = bar;
        el.__info = info;
        el.setAttribute('role', 'progressbar');
        return el;
      },
      update: function (el, vnode) {
        var p = vnode.props;
        var percent = Math.max(0, Math.min(100, Number(p.percent) || 0));
        el.__bar.style.width = percent + '%';
        el.__bar.style.background = p.activeColor || p['active-color'] || p.color || '#09bb07';
        el.__inner.style.background = p.backgroundColor || p['background-color'] || '#ebebeb';
        el.__inner.style.height = (Number(p['stroke-width']) || 6) + 'px';
        el.__inner.style.borderRadius = p['border-radius'] !== undefined ? Number(p['border-radius']) + 'px' : '0';
        el.__info.hidden = !isOn(p['show-info']);
        el.__info.textContent = percent + '%';
        el.setAttribute('aria-valuenow', String(percent));
      },
      container: function () { return null; },
    },
    icon: {
      create: function () { return elementFor('icon'); },
      update: function (el, vnode) {
        var p = vnode.props;
        var size = p.size === undefined ? 23 : Number(String(p.size).replace(/px$/, '')) || 23;
        var color = p.color ? String(p.color) : ICON_COLORS[p.type] || '#09bb07';
        var key = [p.type, size, color].join('|');
        if (el.__iconKey === key) return;
        el.__iconKey = key;
        el.innerHTML = iconSvg(String(p.type || 'success'), size, color);
      },
      container: function () { return null; },
    },
    'rich-text': {
      create: function () { return elementFor('rich-text'); },
      update: function (el, vnode) {
        var nodes = vnode.props.nodes;
        var key = typeof nodes === 'string' ? nodes : JSON.stringify(nodes || []);
        if (el.__richKey === key) return;
        el.__richKey = key;
        el.textContent = '';
        if (typeof nodes === 'string') {
          var template = document.createElement('template');
          template.innerHTML = nodes.replace(/<script[\s\S]*?<\/script>/gi, '');
          Array.prototype.forEach.call(template.content.querySelectorAll('*'), function (node) {
            Array.prototype.slice.call(node.attributes).forEach(function (attr) {
              if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
              if (attr.name === 'style') node.setAttribute('style', convertRpx(attr.value, vnode.ownerFile));
              if (node.tagName === 'IMG' && attr.name === 'src') node.setAttribute('src', resolveAsset(attr.value, vnode.ownerFile));
            });
          });
          el.appendChild(template.content);
        } else if (Array.isArray(nodes)) {
          nodes.forEach(function (node) { el.appendChild(buildRichNode(node, vnode.ownerFile)); });
        }
      },
      container: function () { return null; },
    },
    navigator: {
      create: function () {
        var el = elementFor('navigator');
        el.setAttribute('role', 'link');
        el.tabIndex = 0;
        el.addEventListener('click', function () {
          var p = el.__v.props;
          var type = p['open-type'] || 'navigate';
          var url = p.url ? String(p.url) : '';
          var owner = el.__v.ownerFile;
          var target = url && url.charAt(0) !== '/' ? '/' + resolveFrom(owner, url) : url;
          if (type === 'navigateBack') wx.navigateBack({ delta: Number(p.delta) || 1 });
          else if (type === 'redirect') wx.redirectTo({ url: target });
          else if (type === 'switchTab') wx.switchTab({ url: target });
          else if (type === 'reLaunch') wx.reLaunch({ url: target });
          else if (type === 'exit') warnOnce('navigator-exit', '<navigator open-type="exit"> 在 H5 预览中无效');
          else wx.navigateTo({ url: target });
        });
        return el;
      },
      update: function () {},
    },
    'scroll-view': {
      create: function () {
        var el = elementFor('scroll-view');
        var lastTop = 0;
        var lastLeft = 0;
        var lowerFired = false;
        var upperFired = false;
        el.addEventListener('scroll', function () {
          var p = el.__v.props;
          fireLocal(el, 'scroll', { scrollTop: el.scrollTop, scrollLeft: el.scrollLeft, scrollHeight: el.scrollHeight, scrollWidth: el.scrollWidth, deltaX: el.scrollLeft - lastLeft, deltaY: el.scrollTop - lastTop });
          lastTop = el.scrollTop;
          lastLeft = el.scrollLeft;
          var lower = Number(p['lower-threshold']) || 50;
          var upper = Number(p['upper-threshold']) || 50;
          var horizontal = isOn(p['scroll-x']) && !isOn(p['scroll-y']);
          var remaining = horizontal ? el.scrollWidth - el.clientWidth - el.scrollLeft : el.scrollHeight - el.clientHeight - el.scrollTop;
          var offset = horizontal ? el.scrollLeft : el.scrollTop;
          if (remaining <= lower) {
            if (!lowerFired) fireLocal(el, 'scrolltolower', { direction: horizontal ? 'right' : 'bottom' });
            lowerFired = true;
          } else lowerFired = false;
          if (offset <= upper) {
            if (!upperFired) fireLocal(el, 'scrolltoupper', { direction: horizontal ? 'left' : 'top' });
            upperFired = true;
          } else upperFired = false;
        }, { passive: true });
        return el;
      },
      update: function () {},
      after: function (el, vnode, prev) {
        var p = vnode.props;
        if (p['scroll-top'] !== undefined && (!prev || prev.props['scroll-top'] !== p['scroll-top'])) el.scrollTop = parseFloat(convertPx(p['scroll-top'])) || 0;
        if (p['scroll-left'] !== undefined && (!prev || prev.props['scroll-left'] !== p['scroll-left'])) el.scrollLeft = parseFloat(convertPx(p['scroll-left'])) || 0;
        if (p['scroll-into-view'] && (!prev || prev.props['scroll-into-view'] !== p['scroll-into-view'])) {
          var target = el.querySelector('#' + CSS.escape(String(p['scroll-into-view'])));
          if (target) target.scrollIntoView({ behavior: isOn(p['scroll-with-animation']) ? 'smooth' : 'auto', block: 'start', inline: 'start' });
        }
      },
    },
    swiper: {
      create: function () {
        var el = elementFor('swiper');
        var track = document.createElement('div');
        track.className = 'wx-swiper-track';
        track.__wxInternal = true;
        var dots = document.createElement('div');
        dots.className = 'wx-swiper-dots';
        dots.__wxInternal = true;
        el.appendChild(track);
        el.appendChild(dots);
        el.__track = track;
        el.__dots = dots;
        el.__current = 0;
        var startX = null;
        var startY = null;
        el.addEventListener('pointerdown', function (event) { startX = event.clientX; startY = event.clientY; });
        el.addEventListener('pointerup', function (event) {
          if (startX === null) return;
          var vertical = isOn(el.__v.props.vertical);
          var delta = vertical ? event.clientY - startY : event.clientX - startX;
          startX = null;
          if (Math.abs(delta) < 40) return;
          swiperGo(el, el.__current + (delta < 0 ? 1 : -1), 'touch');
        });
        el.__dispose = function () { clearInterval(el.__timer); };
        return el;
      },
      update: function () {},
      container: function (el) { return el.__track; },
      after: function (el, vnode, prev) {
        var p = vnode.props;
        if (p.current !== undefined && (!prev || prev.props.current !== p.current)) el.__current = Number(p.current) || 0;
        el.toggleAttribute('data-vertical', isOn(p.vertical));
        swiperLayout(el, false);
        clearInterval(el.__timer);
        if (isOn(p.autoplay)) {
          el.__timer = setInterval(function () { swiperGo(el, el.__current + 1, 'autoplay'); }, Number(p.interval) || 5000);
        }
      },
    },
    picker: {
      create: function () {
        var el = elementFor('picker');
        el.addEventListener('click', function () { openPicker(el); });
        return el;
      },
      update: function () {},
    },
    form: {
      create: function () {
        var el = elementFor('form');
        el.__formAction = function (action) {
          var value = {};
          Array.prototype.forEach.call(el.querySelectorAll('[name]'), function (field) {
            var name = field.getAttribute('name');
            if (!name || !field.__v) return;
            var tag = field.tagName.toLowerCase();
            if (action === 'reset') {
              if (field.__inner && 'value' in field.__inner && tag !== 'wx-switch') field.__inner.value = '';
              if (field.__inner && field.__inner.type === 'checkbox') field.__inner.checked = false;
              return;
            }
            if (tag === 'wx-input' || tag === 'wx-textarea') value[name] = field.__inner.value;
            else if (tag === 'wx-switch') value[name] = field.__inner.checked;
            else if (tag === 'wx-slider') value[name] = Number(field.__inner.value);
            else if (tag === 'wx-checkbox-group') value[name] = Array.prototype.filter.call(field.querySelectorAll('wx-checkbox'), function (item) { return item.__inner && item.__inner.checked; }).map(function (item) { return String(item.__v.props.value || ''); });
            else if (tag === 'wx-radio-group') {
              var selected = Array.prototype.filter.call(field.querySelectorAll('wx-radio'), function (item) { return item.__inner && item.__inner.checked; })[0];
              value[name] = selected ? String(selected.__v.props.value || '') : '';
            } else if (tag === 'wx-picker') value[name] = field.__pickerValue !== undefined ? field.__pickerValue : field.__v.props.value;
          });
          if (action === 'reset') fireLocal(el, 'reset', {});
          else fireLocal(el, 'submit', { value: value, target: nodeInfo(el) });
        };
        return el;
      },
      update: function () {},
    },
    video: {
      create: function () {
        var el = elementFor('video');
        var video = inner(el, 'video');
        video.controls = true;
        video.playsInline = true;
        video.addEventListener('play', function () { fireLocal(el, 'play', {}); });
        video.addEventListener('pause', function () { fireLocal(el, 'pause', {}); });
        video.addEventListener('ended', function () { fireLocal(el, 'ended', {}); });
        return el;
      },
      update: function (el, vnode) {
        var src = resolveAsset(vnode.props.src, vnode.ownerFile);
        if (src && el.__inner.getAttribute('src') !== src) el.__inner.setAttribute('src', src);
        el.__inner.poster = vnode.props.poster ? resolveAsset(vnode.props.poster, vnode.ownerFile) : '';
        el.__inner.controls = vnode.props.controls === undefined || isOn(vnode.props.controls);
        el.__inner.loop = isOn(vnode.props.loop);
        el.__inner.muted = isOn(vnode.props.muted);
        el.__inner.autoplay = isOn(vnode.props.autoplay);
      },
      container: function () { return null; },
    },
  };
  ADAPTERS['cover-image'] = ADAPTERS.image;

  function convertPx(value) {
    var text = String(value);
    var rpx = text.match(/^(-?\d*\.?\d+)rpx$/);
    if (rpx) return String(Number(rpx[1]) * window.innerWidth / 750);
    return text;
  }
  function swiperItems(el) {
    return Array.prototype.filter.call(el.__track.children, function (child) { return child.tagName === 'WX-SWIPER-ITEM' || !child.__wxInternal; });
  }
  function swiperLayout(el, animate) {
    var p = el.__v.props;
    var items = swiperItems(el);
    var count = items.length;
    if (!count) return;
    var circular = isOn(p.circular);
    if (el.__current >= count) el.__current = circular ? 0 : count - 1;
    if (el.__current < 0) el.__current = circular ? count - 1 : 0;
    var vertical = isOn(p.vertical);
    el.__track.style.transitionDuration = animate ? (Number(p.duration) || 500) + 'ms' : '0ms';
    el.__track.style.transform = vertical ? 'translateY(' + (-100 * el.__current) + '%)' : 'translateX(' + (-100 * el.__current) + '%)';
    var dots = el.__dots;
    dots.hidden = !isOn(p['indicator-dots']);
    if (dots.children.length !== count) {
      dots.textContent = '';
      for (var i = 0; i < count; i++) dots.appendChild(document.createElement('i'));
    }
    Array.prototype.forEach.call(dots.children, function (dot, index) {
      dot.style.background = index === el.__current ? (p['indicator-active-color'] || '#000000') : (p['indicator-color'] || 'rgba(0,0,0,.3)');
    });
  }
  function swiperGo(el, index, source) {
    var count = swiperItems(el).length;
    if (!count) return;
    var p = el.__v.props;
    var next = index;
    if (next >= count) next = isOn(p.circular) || source === 'autoplay' ? 0 : count - 1;
    if (next < 0) next = isOn(p.circular) ? count - 1 : 0;
    if (next === el.__current) return;
    el.__current = next;
    swiperLayout(el, true);
    fireLocal(el, 'change', { current: next, currentItemId: '', source: source });
  }
  function buildRichNode(node, ownerFile) {
    if (!node || typeof node !== 'object') return document.createTextNode('');
    if (node.type === 'text') return document.createTextNode(node.text || '');
    var name = String(node.name || 'div').toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(name) || name === 'script') name = 'span';
    var el = document.createElement(name);
    Object.keys(node.attrs || {}).forEach(function (key) {
      if (/^on/i.test(key)) return;
      var value = String(node.attrs[key]);
      el.setAttribute(key, key === 'style' ? convertRpx(value, ownerFile) : name === 'img' && key === 'src' ? resolveAsset(value, ownerFile) : value);
    });
    (node.children || []).forEach(function (child) { el.appendChild(buildRichNode(child, ownerFile)); });
    return el;
  }
  var ICON_COLORS = { success: '#09bb07', success_no_circle: '#09bb07', info: '#10aeff', warn: '#f76260', waiting: '#10aeff', cancel: '#f43530', download: '#b2b2b2', search: '#b2b2b2', clear: '#b2b2b2', info_circle: '#09bb07' };
  function iconSvg(type, size, color) {
    var paths = {
      success: '<circle cx="12" cy="12" r="11" fill="C"/><path d="M6.5 12.5l3.5 3.5 7.5-8" stroke="#fff" stroke-width="2" fill="none"/>',
      success_no_circle: '<path d="M4 12.5l5 5 11-11" stroke="C" stroke-width="2.4" fill="none"/>',
      info: '<circle cx="12" cy="12" r="11" fill="C"/><rect x="11" y="10" width="2" height="8" fill="#fff"/><rect x="11" y="6" width="2" height="2" fill="#fff"/>',
      warn: '<circle cx="12" cy="12" r="11" fill="C"/><rect x="11" y="6" width="2" height="8" fill="#fff"/><rect x="11" y="16" width="2" height="2" fill="#fff"/>',
      waiting: '<circle cx="12" cy="12" r="11" fill="C"/><path d="M12 6v6l4 3" stroke="#fff" stroke-width="2" fill="none"/>',
      cancel: '<circle cx="12" cy="12" r="11" fill="C"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2"/>',
      clear: '<circle cx="12" cy="12" r="10" fill="C"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#fff" stroke-width="1.8"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5" stroke="C" stroke-width="2" fill="none"/><path d="M15.5 15.5l5 5" stroke="C" stroke-width="2"/>',
      download: '<circle cx="12" cy="12" r="11" fill="C"/><path d="M12 6v9M8 11l4 4 4-4" stroke="#fff" stroke-width="2" fill="none"/>',
    };
    var body = (paths[type] || paths.info).replace(/"C"/g, '"' + color.replace(/"/g, '') + '"');
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true">' + body + '</svg>';
  }

  // ------------------------------------------------------------------ overlays
  function clearOverlay(kind) {
    Array.prototype.forEach.call(overlay.querySelectorAll('[data-kind="' + kind + '"]'), function (node) { node.remove(); });
  }
  var toastTimer = null;
  function showToast(options) {
    clearOverlay('toast');
    clearTimeout(toastTimer);
    var box = document.createElement('div');
    box.dataset.kind = 'toast';
    box.className = 'wx-toast' + (options.icon === 'none' ? ' wx-toast-text' : '');
    box.setAttribute('role', 'status');
    if (options.icon !== 'none') {
      var icon = document.createElement('div');
      icon.className = 'wx-toast-icon';
      icon.innerHTML = options.icon === 'loading' ? '<span class="wx-spinner"></span>' : iconSvg(options.icon === 'error' ? 'cancel' : 'success_no_circle', 40, '#ffffff');
      box.appendChild(icon);
    }
    var text = document.createElement('div');
    text.textContent = options.title || '';
    box.appendChild(text);
    if (options.mask) box.classList.add('wx-has-mask');
    overlay.appendChild(box);
    if (options.duration !== Infinity) toastTimer = setTimeout(function () { clearOverlay('toast'); }, options.duration || 1500);
  }
  function showDialog(options) {
    return new Promise(function (resolve) {
      clearOverlay('modal');
      var mask = document.createElement('div');
      mask.dataset.kind = 'modal';
      mask.className = 'wx-mask';
      var dialog = document.createElement('div');
      dialog.className = 'wx-modal';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      if (options.title) {
        var title = document.createElement('strong');
        title.className = 'wx-modal-title';
        title.textContent = options.title;
        dialog.appendChild(title);
      }
      var input = null;
      if (options.editable) {
        input = document.createElement('input');
        input.className = 'wx-modal-input';
        input.placeholder = options.placeholderText || '';
        input.value = options.content || '';
        dialog.appendChild(input);
      } else if (options.content) {
        var content = document.createElement('p');
        content.className = 'wx-modal-content';
        content.textContent = options.content;
        dialog.appendChild(content);
      }
      var actions = document.createElement('div');
      actions.className = 'wx-modal-actions';
      var finish = function (confirm) {
        mask.remove();
        resolve({ confirm: confirm, cancel: !confirm, content: input ? input.value : undefined });
      };
      if (options.showCancel !== false) {
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = options.cancelText || '取消';
        cancel.style.color = options.cancelColor || '#000000';
        cancel.addEventListener('click', function () { finish(false); });
        actions.appendChild(cancel);
      }
      var ok = document.createElement('button');
      ok.type = 'button';
      ok.textContent = options.confirmText || '确定';
      ok.style.color = options.confirmColor || '#576b95';
      ok.addEventListener('click', function () { finish(true); });
      actions.appendChild(ok);
      dialog.appendChild(actions);
      mask.appendChild(dialog);
      overlay.appendChild(mask);
      (input || ok).focus();
    });
  }
  function showSheet(items, options) {
    return new Promise(function (resolve) {
      clearOverlay('sheet');
      var mask = document.createElement('div');
      mask.dataset.kind = 'sheet';
      mask.className = 'wx-mask wx-sheet-mask';
      var sheet = document.createElement('div');
      sheet.className = 'wx-sheet';
      sheet.setAttribute('role', 'menu');
      if (options && options.title) {
        var title = document.createElement('div');
        title.className = 'wx-sheet-title';
        title.textContent = options.title;
        sheet.appendChild(title);
      }
      items.forEach(function (item, index) {
        var button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.textContent = item;
        if (options && options.itemColor) button.style.color = options.itemColor;
        if (options && options.selected === index) button.classList.add('wx-sheet-selected');
        button.addEventListener('click', function (event) {
          event.stopPropagation();
          mask.remove();
          resolve(index);
        });
        sheet.appendChild(button);
      });
      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'wx-sheet-cancel';
      cancel.textContent = '取消';
      cancel.addEventListener('click', function (event) {
        event.stopPropagation();
        mask.remove();
        resolve(-1);
      });
      sheet.appendChild(cancel);
      mask.addEventListener('click', function (event) {
        if (event.target === mask) {
          mask.remove();
          resolve(-1);
        }
      });
      mask.appendChild(sheet);
      overlay.appendChild(mask);
    });
  }
  function openPicker(el) {
    var p = el.__v.props;
    if (isOn(p.disabled)) return;
    var mode = p.mode || 'selector';
    if (mode === 'selector') {
      var range = Array.isArray(p.range) ? p.range : [];
      var rangeKey = p['range-key'];
      var labels = range.map(function (item) { return rangeKey && item && typeof item === 'object' ? String(item[rangeKey]) : String(item); });
      showSheet(labels, { selected: Number(p.value) || 0 }).then(function (index) {
        if (index < 0) return fireLocal(el, 'cancel', {});
        el.__pickerValue = index;
        fireLocal(el, 'change', { value: index });
      });
      return;
    }
    if (mode === 'date' || mode === 'time') {
      var input = document.createElement('input');
      input.type = mode === 'date' ? (p.fields === 'month' ? 'month' : 'date') : 'time';
      input.value = p.value ? String(p.value) : '';
      if (p.start) input.min = String(p.start);
      if (p.end) input.max = String(p.end);
      input.className = 'wx-hidden-native';
      overlay.appendChild(input);
      input.addEventListener('change', function () {
        el.__pickerValue = input.value;
        fireLocal(el, 'change', { value: input.value });
        input.remove();
      });
      input.addEventListener('blur', function () { setTimeout(function () { input.remove(); }, 200); });
      if (input.showPicker) {
        try {
          input.showPicker();
          return;
        } catch (error) {
          /* fall back to focus */
        }
      }
      input.focus();
      return;
    }
    warnOnce('picker:' + mode, '<picker mode="' + mode + '"> 暂不支持 H5 预览');
  }
  function previewImages(urls, current) {
    clearOverlay('preview');
    var mask = document.createElement('div');
    mask.dataset.kind = 'preview';
    mask.className = 'wx-image-preview';
    var img = document.createElement('img');
    img.src = resolveAsset(current || urls[0], currentRoute);
    img.alt = '';
    mask.appendChild(img);
    mask.addEventListener('click', function () { mask.remove(); });
    overlay.appendChild(mask);
  }

  // ------------------------------------------------------------------ selector query
  function createSelectorQuery(rootGetter) {
    var tasks = [];
    var root = rootGetter ? rootGetter() : currentPageEl();
    var query = {
      in: function (component) {
        if (component && !component.__isPage && typeof component.createSelectorQuery === 'function') return component.createSelectorQuery();
        if (component && component.__isPage && component.__el) root = component.__el;
        if (component && component.__host) root = component.__host;
        return query;
      },
      select: function (selector) { return nodesRef(selector, false); },
      selectAll: function (selector) { return nodesRef(selector, true); },
      selectViewport: function () { return nodesRef(null, false); },
      exec: function (callback) {
        requestAnimationFrame(function () {
          var results = tasks.map(function (task) { return task(); });
          if (callback) safeCall(callback, null, [results]);
        });
        return query;
      },
    };
    function nodesRef(selector, all) {
      var resolve = function () {
        if (!selector) return [currentPageEl()];
        try {
          return Array.prototype.slice.call((root || document).querySelectorAll(selector));
        } catch (error) {
          console.warn('SelectorQuery: invalid selector ' + selector);
          return [];
        }
      };
      var push = function (map, callback) {
        tasks.push(function () {
          var nodes = resolve();
          var mapped = nodes.map(map);
          var result = all ? mapped : mapped[0] || null;
          if (callback) safeCall(callback, null, [result]);
          return result;
        });
        return query;
      };
      var rect = function (el) {
        var box = el.getBoundingClientRect();
        var base = viewport.getBoundingClientRect();
        return { id: el.id, dataset: el.__wx ? el.__wx.dataset : {}, left: box.left, right: box.right, top: box.top - base.top + base.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      return {
        boundingClientRect: function (callback) { return push(rect, callback); },
        scrollOffset: function (callback) {
          return push(function (el) { return { id: el.id, dataset: el.__wx ? el.__wx.dataset : {}, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight }; }, callback);
        },
        fields: function (fields, callback) {
          return push(function (el) {
            var result = {};
            if (fields.id) result.id = el.id;
            if (fields.dataset) result.dataset = el.__wx ? el.__wx.dataset : {};
            if (fields.rect || fields.size) Object.assign(result, rect(el));
            if (fields.scrollOffset) Object.assign(result, { scrollLeft: el.scrollLeft, scrollTop: el.scrollTop });
            if (fields.computedStyle) {
              var style = getComputedStyle(el);
              fields.computedStyle.forEach(function (name) { result[name] = style.getPropertyValue(name.replace(/[A-Z]/g, function (ch) { return '-' + ch.toLowerCase(); })); });
            }
            if (fields.node) warnOnce('selector-node', 'SelectorQuery fields({ node: true }) 不支持 Canvas/ScrollView 节点');
            return result;
          }, callback);
        },
        node: function (callback) {
          warnOnce('selector-node', 'SelectorQuery.node() 不支持 Canvas/ScrollView 节点');
          return push(function () { return null; }, callback);
        },
        context: function (callback) { return push(function () { return null; }, callback); },
      };
    }
    return query;
  }
  function stubIntersectionObserver() {
    warnOnce('intersection', 'IntersectionObserver 仅提供空实现');
    var observer = { relativeTo: function () { return observer; }, relativeToViewport: function () { return observer; }, observe: function () {}, disconnect: function () {} };
    return observer;
  }

  // ------------------------------------------------------------------ pages + navigation
  var pageStack = [];
  var tabPages = {};
  var tabBar = BUILD.tabBar && !BUILD.tabBar.custom ? BUILD.tabBar : BUILD.tabBar;
  var tabButtons = [];
  function currentEntry() {
    return pageStack[pageStack.length - 1];
  }
  function currentPageEl() {
    var entry = currentEntry();
    return entry ? entry.el : viewport;
  }
  function parseUrl(url, fromRoute) {
    var text = String(url || '');
    var question = text.indexOf('?');
    var pathPart = question >= 0 ? text.slice(0, question) : text;
    var query = {};
    if (question >= 0) {
      text.slice(question + 1).split('&').forEach(function (pair) {
        if (!pair) return;
        var index = pair.indexOf('=');
        var key = decodeURIComponent(index >= 0 ? pair.slice(0, index) : pair);
        query[key] = index >= 0 ? decodeURIComponent(pair.slice(index + 1)) : '';
      });
    }
    var route = pathPart.charAt(0) === '/' ? normalize(pathPart) : resolveFrom(fromRoute || '', pathPart);
    return { route: route, query: query };
  }
  function isTabRoute(route) {
    return !!(tabBar && tabBar.list.some(function (item) { return item.pagePath === route; }));
  }
  function windowFor(route) {
    var unit = BUILD.units[route] || { json: {} };
    var merged = Object.assign({}, BUILD.window);
    Object.keys(unit.json || {}).forEach(function (key) {
      if (unit.json[key] !== undefined && unit.json[key] !== null) merged[key] = unit.json[key];
    });
    return merged;
  }
  function updateCapsule(entry) {
    // DevTools follows navigation configuration, not pixels beneath the capsule.
    if (capsuleEl && entry) capsuleEl.dataset.tone = entry.window.navigationBarTextStyle === 'black' ? 'dark' : 'light';
  }
  function applyChrome(entry) {
    var config = entry.window;
    var custom = config.navigationStyle === 'custom';
    navEl.hidden = false;
    navEl.classList.toggle('wx-nav-custom', custom);
    statusEl.classList.toggle('wx-status-overlay', custom);
    var bg = config.navigationBarBackgroundColor || '#000000';
    var fg = config.navigationBarTextStyle === 'black' ? '#000000' : '#ffffff';
    navEl.style.background = bg;
    navEl.style.color = fg;
    statusEl.style.background = custom ? 'transparent' : bg;
    statusEl.style.color = fg;
    titleEl.textContent = entry.title !== undefined ? entry.title : config.navigationBarTitleText || '';
    backEl.hidden = pageStack.length <= 1;
    viewport.style.background = config.backgroundColor || '#ffffff';
    document.body.classList.toggle('wx-nav-custom', custom);
    var tab = isTabRoute(entry.route);
    tabbarEl.hidden = !tab;
    tabButtons.forEach(function (item) {
      var active = item.pagePath === entry.route;
      item.button.setAttribute('aria-selected', String(active));
      item.button.style.color = active ? tabBar.selectedColor : tabBar.color;
      var src = active ? item.selectedIconPath || item.iconPath : item.iconPath;
      item.icon.hidden = !src;
      if (src) item.icon.src = previewAsset(src);
    });
    currentRoute = entry.route;
    updateViewportMetrics(entry);
    updateCapsule(entry);
    post({ type: 'route', route: entry.route + queryString(entry.query), title: titleEl.textContent });
  }
  function queryString(query) {
    var keys = Object.keys(query || {});
    return keys.length ? '?' + keys.map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(query[key]); }).join('&') : '';
  }
  function buildTabBar() {
    if (!tabBar) return;
    tabbarEl.style.background = tabBar.backgroundColor;
    tabbarEl.style.borderTopColor = tabBar.borderStyle === 'white' ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.15)';
    if (tabBar.position === 'top') document.body.classList.add('wx-tabbar-top');
    tabBar.list.forEach(function (item, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      var icon = document.createElement('img');
      icon.alt = '';
      var badge = document.createElement('span');
      badge.className = 'wx-tab-badge';
      badge.hidden = true;
      var label = document.createElement('span');
      label.className = 'wx-tab-label';
      label.textContent = item.text;
      button.appendChild(icon);
      button.appendChild(badge);
      button.appendChild(label);
      button.addEventListener('click', function () {
        var entry = currentEntry();
        if (entry && entry.route === item.pagePath) {
          entry.instance.__call('onTabItemTap', [{ index: index, pagePath: item.pagePath, text: item.text }]);
          return;
        }
        switchTabTo(item.pagePath, { index: index, pagePath: item.pagePath, text: item.text });
      });
      tabbarEl.appendChild(button);
      tabButtons.push({ pagePath: item.pagePath, button: button, icon: icon, badge: badge, iconPath: item.iconPath, selectedIconPath: item.selectedIconPath });
    });
  }

  function mountPage(route, query) {
    var diagnostics = diagnosticState(route);
    var previousDiagnostics = creatingDiagnostics;
    creatingDiagnostics = diagnostics;
    var el = document.createElement('wx-page');
    el.setAttribute('data-wx-route', route);
    el.addEventListener('scroll', function () {
      var entry = el.__entry;
      if (!entry) return;
      entry.instance.__call('onPageScroll', [{ scrollTop: el.scrollTop }]);
      var remaining = el.scrollHeight - el.clientHeight - el.scrollTop;
      var threshold = 50;
      if (remaining <= threshold) {
        if (!entry.bottomFired) entry.instance.__call('onReachBottom', []);
        entry.bottomFired = true;
      } else entry.bottomFired = false;
    }, { passive: true });
    viewport.appendChild(el);
    var instance;
    try {
      instance = createPageInstance(route, query, el);
    } catch (error) {
      console.error('Page "' + route + '" failed to load:', error);
      reportRuntimeError(error, 'page-error');
      el.innerHTML = '';
      var panel = document.createElement('div');
      panel.className = 'wx-error-panel';
      panel.setAttribute('role', 'alert');
      panel.textContent = '页面 ' + route + ' 加载失败：' + (error && error.message ? error.message : String(error));
      el.appendChild(panel);
      instance = { route: route, options: query, data: {}, __isPage: true, __diagnostics: diagnostics, __call: function () {}, __render: function () {}, setData: function () {} };
    } finally {
      creatingDiagnostics = previousDiagnostics;
    }
    var entry = { alive: true, visible: false, ready: false, route: route, query: query, el: el, instance: instance, diagnostics: diagnostics, window: windowFor(route), title: undefined, bottomFired: false };
    el.__entry = entry;
    return entry;
  }
  function setEntryVisible(entry, visible) {
    // Keep layout and animation timelines alive; display:none restarts CSS animations.
    entry.el.toggleAttribute('data-wx-page-inactive', !visible);
    entry.el.toggleAttribute('inert', !visible);
    if (visible) entry.el.removeAttribute('aria-hidden');
    else entry.el.setAttribute('aria-hidden', 'true');
  }
  function retainPageLayout(entry) {
    // Another route can change navigation/tab-bar height. Do not resize a covered scroller.
    var style = getComputedStyle(entry.el);
    if (entry.el.clientWidth > 0) entry.el.style.width = style.width;
    if (entry.el.clientHeight > 0) entry.el.style.height = style.height;
    Object.keys(viewportMetrics ? viewportMetrics.cssVariables : {}).forEach(function (key) {
      entry.el.style.setProperty(key, viewportMetrics.cssVariables[key]);
    });
  }
  function releasePageLayout(entry) {
    entry.el.style.removeProperty('width');
    entry.el.style.removeProperty('height');
    Object.keys(viewportMetrics ? viewportMetrics.cssVariables : {}).forEach(function (key) {
      entry.el.style.removeProperty(key);
    });
  }
  function showEntry(entry, isNew) {
    pageStack.forEach(function (item) { setEntryVisible(item, item === entry); });
    Object.keys(tabPages).forEach(function (route) { setEntryVisible(tabPages[route], tabPages[route] === entry); });
    setEntryVisible(entry, true);
    entry.visible = true;
    applyChrome(entry);
    releasePageLayout(entry);
    if (isNew) {
      entry.instance.__call('onLoad', [entry.query]);
      if (!entry.alive || currentEntry() !== entry) return;
      try {
        entry.instance.__render();
      } catch (error) {
        console.error('Render failed for ' + entry.route + ':', error);
        reportRuntimeError(error, 'render-error', entry.instance);
      }

    }
    if (!entry.alive || currentEntry() !== entry) return;
    applyChrome(entry);
    entry.instance.__call('onShow', []);
    if (!entry.alive || currentEntry() !== entry) return;
    if (entry.instance.__handle) entry.instance.__handle.pageLifetime('show', []);
    if (!entry.ready) {
      clearTimeout(entry.readyTimer);
      entry.readyTimer = setTimeout(function () {
        if (!entry.alive || currentEntry() !== entry || entry.ready) return;
        entry.ready = true;
        entry.instance.__call('onReady', []);
      }, 0);
    }
    if (previewMounted) reportPreviewStatus('rendered');
  }
  function hideEntry(entry) {
    if (!entry || !entry.visible) return;
    retainPageLayout(entry);
    entry.visible = false;
    setEntryVisible(entry, false);
    entry.instance.__call('onHide', []);
    if (entry.instance.__handle) entry.instance.__handle.pageLifetime('hide', []);
  }
  function unloadEntry(entry) {
    if (!entry || !entry.alive) return;
    entry.instance.__call('onUnload', []);
    entry.alive = false;
    entry.instance.__alive = false;
    clearTimeout(entry.readyTimer);
    dirty.delete(entry.instance);
    if (entry.instance.__handle) entry.instance.__handle.dispose();
    entry.el.remove();
  }
  function assertPage(route, api) {
    if (BUILD.pages.indexOf(route) < 0) throw new Error(api + ':fail page "' + route + '" is not found');
  }
  function navigateTo(url) {
    var from = currentEntry();
    var target = parseUrl(url, from && dirOf(from.route) ? from.route : '');
    assertPage(target.route, 'navigateTo');
    if (isTabRoute(target.route)) throw new Error('navigateTo:fail can not navigateTo a tabbar page');
    if (pageStack.length >= 10) throw new Error('navigateTo:fail webview count limit exceed');
    hideEntry(from);
    var entry = mountPage(target.route, target.query);
    pageStack.push(entry);
    showEntry(entry, true);
  }
  function redirectTo(url) {
    var from = currentEntry();
    var target = parseUrl(url, from ? from.route : '');
    assertPage(target.route, 'redirectTo');
    if (isTabRoute(target.route)) throw new Error('redirectTo:fail can not redirectTo a tabbar page');
    pageStack.pop();
    if (from && !isTabRoute(from.route)) unloadEntry(from);
    else hideEntry(from);
    var entry = mountPage(target.route, target.query);
    pageStack.push(entry);
    showEntry(entry, true);
  }
  function navigateBack(delta) {
    if (pageStack.length <= 1) throw new Error('navigateBack:fail cannot navigate back at first page.');
    var count = Math.min(Math.max(1, delta || 1), pageStack.length - 1);
    for (var i = 0; i < count; i++) {
      var entry = pageStack.pop();
      if (isTabRoute(entry.route)) hideEntry(entry);
      else unloadEntry(entry);
    }
    showEntry(currentEntry(), false);
  }
  function clearStack() {
    while (pageStack.length) {
      var entry = pageStack.pop();
      if (isTabRoute(entry.route)) hideEntry(entry);
      else unloadEntry(entry);
    }
  }
  function switchTabTo(url, tapInfo) {
    var target = parseUrl(url, '');
    assertPage(target.route, 'switchTab');
    if (!isTabRoute(target.route)) throw new Error('switchTab:fail can not switch to no-tabBar page');
    var current = currentEntry();
    if (current && current.route === target.route && pageStack.length === 1) return;
    clearStack();
    var entry = tabPages[target.route];
    var isNew = !entry;
    if (!entry) {
      entry = mountPage(target.route, {});
      tabPages[target.route] = entry;
    }
    pageStack.push(entry);
    showEntry(entry, isNew);
    if (tapInfo) entry.instance.__call('onTabItemTap', [tapInfo]);
  }
  function reLaunch(url) {
    var target = parseUrl(url, '');
    assertPage(target.route, 'reLaunch');
    clearStack();
    Object.keys(tabPages).forEach(function (route) {
      unloadEntry(tabPages[route]);
      delete tabPages[route];
    });
    var entry = mountPage(target.route, target.query);
    if (isTabRoute(target.route)) tabPages[target.route] = entry;
    pageStack.push(entry);
    showEntry(entry, true);
  }
  backEl.addEventListener('click', function () {
    try {
      navigateBack(1);
    } catch (error) {
      console.warn(error.message);
    }
  });

  // ------------------------------------------------------------------ wx API
  var storage = Object.create(null);
  var storageQuiescing = false;
  var quiesceRequestId = null;
  var quiesceOverlay = null;
  function assertStorageWritable() {
    if (storageQuiescing) throw new Error('storage:fail temporarily unavailable during preview transition');
  }
  function setQuiescing(value, requestId) {
    storageQuiescing = value;
    quiesceRequestId = value ? requestId : null;
    [viewport, navEl, tabbarEl, overlay].forEach(function (node) { node.inert = value; });
    if (value && !quiesceOverlay) {
      quiesceOverlay = document.createElement('div');
      quiesceOverlay.setAttribute('data-wx-quiescing', '');
      quiesceOverlay.setAttribute('role', 'status');
      quiesceOverlay.setAttribute('aria-live', 'polite');
      quiesceOverlay.textContent = '正在保存预览状态';
      quiesceOverlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.4);color:#333;pointer-events:auto';
      document.body.appendChild(quiesceOverlay);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    } else if (!value && quiesceOverlay) {
      quiesceOverlay.remove();
      quiesceOverlay = null;
    }
  }
  ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'input', 'change', 'submit'].forEach(function (name) {
    window.addEventListener(name, function (event) {
      if (!storageQuiescing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  });
  var STORAGE_LIMIT = 1024 * 1024;
  function storageKey(key) {
    var value = String(key);
    if (value === '__proto__' || value === 'prototype' || value === 'constructor') throw new Error('storage:fail unsafe key');
    return value;
  }
  function utf8Size(text) {
    var size = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 0x80) size++;
      else if (code < 0x800) size += 2;
      else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
      else size += 3;
    }
    return size;
  }
  function encodeStorage(snapshot) {
    var ancestors = new Set();
    var nodes = 0;
    var invalid = function () { throw new Error('storage:fail only bounded JSON data without unsafe keys is supported'); };
    var visit = function (value, depth) {
      if (++nodes > 100000 || depth > 64) invalid();
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
      if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return; }
      if (typeof value !== 'object' || ancestors.has(value)) invalid();
      var array = Array.isArray(value);
      var prototype = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
      if (Object.getOwnPropertySymbols(value).length || (array && value.length > 100000)) invalid();
      ancestors.add(value);
      var descriptors = Object.getOwnPropertyDescriptors(value);
      var keys = Object.keys(descriptors);
      if (array && keys.length !== value.length + 1) invalid();
      keys.forEach(function (key) {
        if (array && key === 'length') return;
        storageKey(key);
        var descriptor = descriptors[key];
        if (!descriptor.enumerable || !('value' in descriptor)) invalid();
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) invalid();
        visit(descriptor.value, depth + 1);
      });
      ancestors.delete(value);
    };
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) invalid();
    visit(snapshot, 0);
    var encoded = JSON.stringify(snapshot);
    if (utf8Size(encoded) > STORAGE_LIMIT) throw new Error('storage:fail quota exceeded (1 MiB per project)');
    return encoded;
  }
  function persistStorage() {
    post({ type: 'storage', data: storage });
  }
  function settle(name, options, run) {
    options = options || {};
    var hasCallback = typeof options.success === 'function' || typeof options.fail === 'function' || typeof options.complete === 'function';
    var promise = Promise.resolve().then(function () { return run(options); }).then(function (result) {
      var payload = Object.assign({ errMsg: name + ':ok' }, result || {});
      if (typeof options.success === 'function') safeCall(options.success, null, [payload]);
      if (typeof options.complete === 'function') safeCall(options.complete, null, [payload]);
      return payload;
    }, function (error) {
      var payload = { errMsg: error && error.message && error.message.indexOf(name + ':fail') === 0 ? error.message : name + ':fail ' + (error && error.message ? error.message : String(error)) };
      if (typeof options.fail === 'function') safeCall(options.fail, null, [payload]);
      if (typeof options.complete === 'function') safeCall(options.complete, null, [payload]);
      if (!hasCallback) throw payload;
      return payload;
    });
    if (!hasCallback) return promise;
    promise.catch(function () {});
    return undefined;
  }
  function api(name, run) {
    return function (options) {
      return settle(name, options, run);
    };
  }
  function unsupported(name, hint) {
    var fn = function (options) {
      warnOnce('api:' + name, 'wx.' + name + ' 暂不支持 H5 预览' + (hint ? '，' + hint : '，请在微信开发者工具或真机验证'));
      if (/Sync$/.test(name)) return undefined;
      return settle(name, options, function () { throw new Error(name + ':fail not supported in H5 preview'); });
    };
    fn.__wxUnsupported = true;
    return fn;
  }
  function systemInfo() {
    var entry = currentEntry();
    var route = entry ? entry.route : launchOptions.path;
    var metrics = updateViewportMetrics(entry);
    return {
      brand: 'devtools', model: DEVICE.model, pixelRatio: DEVICE.pixelRatio,
      screenWidth: metrics.screenWidth, screenHeight: metrics.screenHeight,
      windowWidth: metrics.windowWidth, windowHeight: metrics.windowHeight, statusBarHeight: metrics.statusBarHeight,
      language: 'zh_CN', version: DEVICE.version, system: DEVICE.system, platform: DEVICE.platform,
      fontSizeSetting: 16, SDKVersion: DEVICE.sdkVersion, theme: 'light', safeArea: metrics.safeArea,
      screenTop: metrics.screenTop, enableDebug: false, deviceOrientation: 'portrait', host: { env: 'WeChat' },
    };
  }
  var clipboard = '';
  var appEvents = { show: [], hide: [], error: [] };
  var wxImpl = {
    env: { USER_DATA_PATH: 'wxfile://usr' },
    canIUse: function (name) {
      var apiName = String(name || '').split('.')[0];
      return Object.prototype.hasOwnProperty.call(wxImpl, apiName) && !/^(login|checkSession|requestPayment|authorize|getUserInfo|getUserProfile|cloud)$/.test(apiName);
    },
    navigateTo: api('navigateTo', function (o) { navigateTo(o.url); }),
    redirectTo: api('redirectTo', function (o) { redirectTo(o.url); }),
    navigateBack: api('navigateBack', function (o) { navigateBack(Number(o.delta) || 1); }),
    switchTab: api('switchTab', function (o) { switchTabTo(o.url); }),
    reLaunch: api('reLaunch', function (o) { reLaunch(o.url); }),
    setStorageSync: function (key, value) {
      assertStorageWritable();
      var candidate = Object.assign(Object.create(null), storage);
      candidate[storageKey(key)] = value;
      storage = JSON.parse(encodeStorage(candidate));
      persistStorage();
    },
    getStorageSync: function (key) { var value = storage[storageKey(key)]; return value === undefined ? '' : clone(value); },
    removeStorageSync: function (key) { assertStorageWritable(); delete storage[storageKey(key)]; persistStorage(); },
    clearStorageSync: function () { assertStorageWritable(); storage = Object.create(null); persistStorage(); },
    getStorageInfoSync: function () { return { keys: Object.keys(storage), currentSize: utf8Size(JSON.stringify(storage)) / 1024, limitSize: 1024 }; },
    setStorage: api('setStorage', function (o) { wxImpl.setStorageSync(o.key, o.data); }),
    getStorage: api('getStorage', function (o) {
      var key = storageKey(o.key);
      if (!Object.prototype.hasOwnProperty.call(storage, key)) throw new Error('getStorage:fail data not found');
      return { data: clone(storage[key]) };
    }),
    removeStorage: api('removeStorage', function (o) { wxImpl.removeStorageSync(o.key); }),
    clearStorage: api('clearStorage', function () { wxImpl.clearStorageSync(); }),
    getStorageInfo: api('getStorageInfo', function () { return wxImpl.getStorageInfoSync(); }),
    showToast: api('showToast', function (o) { showToast({ title: o.title, icon: o.icon || 'success', duration: o.duration, mask: o.mask }); }),
    hideToast: api('hideToast', function () { clearOverlay('toast'); }),
    showLoading: api('showLoading', function (o) { showToast({ title: o.title, icon: 'loading', duration: Infinity, mask: o.mask }); }),
    hideLoading: api('hideLoading', function () { clearOverlay('toast'); }),
    showModal: api('showModal', function (o) { return showDialog(o); }),
    showActionSheet: api('showActionSheet', function (o) {
      return showSheet(o.itemList || [], { title: o.alertText, itemColor: o.itemColor }).then(function (index) {
        if (index < 0) throw new Error('showActionSheet:fail cancel');
        return { tapIndex: index };
      });
    }),
    setNavigationBarTitle: api('setNavigationBarTitle', function (o) {
      var entry = currentEntry();
      if (entry) {
        entry.title = String(o.title || '');
        applyChrome(entry);
      }
    }),
    setNavigationBarColor: api('setNavigationBarColor', function (o) {
      var entry = currentEntry();
      if (!entry) return;
      if (o.backgroundColor) entry.window.navigationBarBackgroundColor = o.backgroundColor;
      if (o.frontColor) entry.window.navigationBarTextStyle = o.frontColor === '#ffffff' ? 'white' : 'black';
      applyChrome(entry);
    }),
    showNavigationBarLoading: api('showNavigationBarLoading', function () {}),
    hideNavigationBarLoading: api('hideNavigationBarLoading', function () {}),
    hideHomeButton: api('hideHomeButton', function () {}),
    setBackgroundColor: api('setBackgroundColor', function (o) {
      if (o.backgroundColor) {
        var entry = currentEntry();
        if (entry) entry.window.backgroundColor = o.backgroundColor;
        viewport.style.background = o.backgroundColor;
      }
    }),
    setBackgroundTextStyle: api('setBackgroundTextStyle', function () {}),
    setTabBarBadge: api('setTabBarBadge', function (o) { var item = tabButtons[o.index]; if (item) { item.badge.hidden = false; item.badge.textContent = String(o.text || ''); } }),
    removeTabBarBadge: api('removeTabBarBadge', function (o) { var item = tabButtons[o.index]; if (item) item.badge.hidden = true; }),
    showTabBarRedDot: api('showTabBarRedDot', function (o) { var item = tabButtons[o.index]; if (item) { item.badge.hidden = false; item.badge.textContent = ''; } }),
    hideTabBarRedDot: api('hideTabBarRedDot', function (o) { var item = tabButtons[o.index]; if (item) item.badge.hidden = true; }),
    showTabBar: api('showTabBar', function () { var entry = currentEntry(); tabbarEl.hidden = !(entry && isTabRoute(entry.route)); }),
    hideTabBar: api('hideTabBar', function () { tabbarEl.hidden = true; }),
    setTabBarItem: api('setTabBarItem', function (o) { var item = tabButtons[o.index]; if (item && o.text) item.button.querySelector('.wx-tab-label').textContent = o.text; }),
    setTabBarStyle: api('setTabBarStyle', function (o) { if (o.backgroundColor) tabbarEl.style.background = o.backgroundColor; }),
    getSystemInfoSync: systemInfo,
    getSystemInfo: api('getSystemInfo', systemInfo),
    getSystemInfoAsync: api('getSystemInfoAsync', systemInfo),
    getWindowInfo: function () { var info = systemInfo(); return { pixelRatio: info.pixelRatio, screenWidth: info.screenWidth, screenHeight: info.screenHeight, windowWidth: info.windowWidth, windowHeight: info.windowHeight, statusBarHeight: info.statusBarHeight, safeArea: info.safeArea, screenTop: info.screenTop }; },
    getDeviceInfo: function () { var info = systemInfo(); return { brand: info.brand, model: info.model, system: info.system, platform: info.platform, pixelRatio: info.pixelRatio }; },
    getAppBaseInfo: function () { var info = systemInfo(); return { SDKVersion: info.SDKVersion, language: info.language, version: info.version, theme: info.theme, enableDebug: false, host: info.host }; },
    getSystemSetting: function () { return { bluetoothEnabled: false, locationEnabled: false, wifiEnabled: true, deviceOrientation: 'portrait' }; },
    getAppAuthorizeSetting: function () { return {}; },
    getMenuButtonBoundingClientRect: function () { return devices.metrics(DEVICE.id).menu; },
    getAccountInfoSync: function () { return { miniProgram: { appId: 'h5-preview', envVersion: 'develop', version: '' } }; },
    getLaunchOptionsSync: function () { return launchOptions; },
    getEnterOptionsSync: function () { return launchOptions; },
    request: unsupported('request'),
    downloadFile: unsupported('downloadFile'),
    uploadFile: unsupported('uploadFile'),
    connectSocket: unsupported('connectSocket'),
    nextTick: function (fn) { setTimeout(fn, 0); },
    createSelectorQuery: function () { return createSelectorQuery(null); },
    createIntersectionObserver: function () { return stubIntersectionObserver(); },
    pageScrollTo: api('pageScrollTo', function (o) {
      var el = currentPageEl();
      var top = o.scrollTop || 0;
      if (o.selector) {
        var target = el.querySelector(o.selector);
        if (target) top = target.offsetTop + (o.offsetTop || 0);
      }
      el.scrollTo({ top: top, behavior: o.duration === 0 ? 'auto' : 'smooth' });
    }),
    startPullDownRefresh: api('startPullDownRefresh', function () { var entry = currentEntry(); if (entry) entry.instance.__call('onPullDownRefresh', []); }),
    stopPullDownRefresh: api('stopPullDownRefresh', function () {}),
    vibrateShort: api('vibrateShort', function () {}),
    vibrateLong: api('vibrateLong', function () {}),
    setClipboardData: api('setClipboardData', function (o) {
      clipboard = String(o.data || '');
      showToast({ title: '内容已复制', icon: 'none' });
      if (navigator.clipboard) return navigator.clipboard.writeText(clipboard).catch(function () {});
    }),
    getClipboardData: api('getClipboardData', function () { return { data: clipboard }; }),
    makePhoneCall: api('makePhoneCall', function (o) { warnOnce('phone', 'wx.makePhoneCall 在预览中仅提示号码'); showToast({ title: '拨打 ' + (o.phoneNumber || ''), icon: 'none' }); }),
    previewImage: api('previewImage', function (o) { previewImages(o.urls || [], o.current); }),
    previewMedia: api('previewMedia', function (o) { var first = (o.sources || [])[0]; if (first) previewImages([first.url], first.url); }),
    getImageInfo: api('getImageInfo', function (o) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () { resolve({ width: img.naturalWidth, height: img.naturalHeight, path: img.src, type: 'unknown', orientation: 'up' }); };
        img.onerror = function () { reject(new Error('getImageInfo:fail image load failed')); };
        img.src = resolveAsset(o.src, currentRoute);
      });
    }),
    chooseImage: api('chooseImage', function (o) { return pickFiles('image/*', (o.count || 9) > 1).then(function (files) { return { tempFilePaths: files.map(function (f) { return f.path; }), tempFiles: files }; }); }),
    chooseMedia: api('chooseMedia', function (o) {
      var types = o.mediaType || ['image', 'video'];
      var accept = types.map(function (type) { return type === 'mix' ? 'image/*,video/*' : type + '/*'; }).join(',');
      return pickFiles(accept, (o.count || 9) > 1).then(function (files) {
        return { type: 'mix', tempFiles: files.map(function (f) { return { tempFilePath: f.path, size: f.size, fileType: /^video/.test(f.type) ? 'video' : 'image' }; }) };
      });
    }),
    chooseMessageFile: api('chooseMessageFile', function (o) { return pickFiles('*/*', (o.count || 1) > 1).then(function (files) { return { tempFiles: files }; }); }),
    login: api('login', function () {
      throw new Error('H5 预览不支持微信登录，请使用微信开发者工具或真机');
    }),
    checkSession: api('checkSession', function () {}),
    getSetting: api('getSetting', function () { return { authSetting: {} }; }),
    openSetting: unsupported('openSetting'),
    authorize: unsupported('authorize'),
    getUserProfile: unsupported('getUserProfile', '用户信息授权需要在微信环境中验证'),
    getUserInfo: unsupported('getUserInfo', '用户信息授权需要在微信环境中验证'),
    getPhoneNumber: unsupported('getPhoneNumber'),
    requestPayment: unsupported('requestPayment', '支付需要在真机上验证'),
    requestSubscribeMessage: unsupported('requestSubscribeMessage'),
    getLocation: unsupported('getLocation'),
    chooseLocation: unsupported('chooseLocation'),
    openLocation: unsupported('openLocation'),
    scanCode: unsupported('scanCode'),
    showShareMenu: api('showShareMenu', function () {}),
    hideShareMenu: api('hideShareMenu', function () {}),
    updateShareMenu: api('updateShareMenu', function () {}),
    getNetworkType: api('getNetworkType', function () { return { networkType: 'wifi' }; }),
    onNetworkStatusChange: function () {},
    offNetworkStatusChange: function () {},
    onAppShow: function (fn) { appEvents.show.push(fn); },
    offAppShow: function () {},
    onAppHide: function (fn) { appEvents.hide.push(fn); },
    offAppHide: function () {},
    onError: function (fn) { appEvents.error.push(fn); },
    offError: function () {},
    onUnhandledRejection: function () {},
    onPageNotFound: function () {},
    onThemeChange: function () {},
    onWindowResize: function () {},
    offWindowResize: function () {},
    onMemoryWarning: function () {},
    getUpdateManager: function () { return { onCheckForUpdate: function () {}, onUpdateReady: function () {}, onUpdateFailed: function () {}, applyUpdate: function () {} }; },
    getPerformance: function () { return { now: function () { return performance.now(); }, getEntries: function () { return []; }, createObserver: function () { return { observe: function () {}, disconnect: function () {} }; } }; },
    reportAnalytics: function () {},
    reportEvent: function () {},
    reportMonitor: function () {},
    getRealtimeLogManager: function () { return { info: console.info, warn: console.warn, error: console.error, setFilterMsg: function () {}, addFilterMsg: function () {} }; },
    getLogManager: function () { return { log: console.log, info: console.info, warn: console.warn, debug: console.debug }; },
    arrayBufferToBase64: function (buffer) { var bytes = new Uint8Array(buffer); var text = ''; for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]); return btoa(text); },
    base64ToArrayBuffer: function (base64) { var text = atob(base64); var bytes = new Uint8Array(text.length); for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i); return bytes.buffer; },
    createAnimation: function () {
      warnOnce('animation', 'wx.createAnimation 在 H5 预览中不产生动画');
      var animation = { actions: [] };
      ['opacity', 'backgroundColor', 'width', 'height', 'left', 'top', 'right', 'bottom', 'rotate', 'rotateX', 'rotateY', 'rotateZ', 'scale', 'scaleX', 'scaleY', 'translate', 'translateX', 'translateY', 'skew', 'matrix', 'step'].forEach(function (name) {
        animation[name] = function () { return animation; };
      });
      animation.export = function () { return { actions: [] }; };
      return animation;
    },
    createInnerAudioContext: function () {
      var audio = new Audio();
      var context = { play: function () { audio.play().catch(function () {}); }, pause: function () { audio.pause(); }, stop: function () { audio.pause(); audio.currentTime = 0; }, seek: function (t) { audio.currentTime = t; }, destroy: function () { audio.pause(); } };
      Object.defineProperty(context, 'src', { get: function () { return audio.src; }, set: function (value) { audio.src = resolveAsset(value, currentRoute); } });
      ['autoplay', 'loop', 'volume'].forEach(function (key) { Object.defineProperty(context, key, { get: function () { return audio[key]; }, set: function (value) { audio[key] = value; } }); });
      ['onPlay', 'onPause', 'onEnded', 'onError', 'onCanplay', 'onTimeUpdate', 'onStop'].forEach(function (name) {
        var event = name.slice(2).toLowerCase().replace('timeupdate', 'timeupdate').replace('canplay', 'canplay').replace('stop', 'pause');
        context[name] = function (fn) { audio.addEventListener(event, function () { safeCall(fn, null, []); }); };
        context['off' + name.slice(2)] = function () {};
      });
      return context;
    },
    createVideoContext: function () { return { play: function () {}, pause: function () {}, seek: function () {}, stop: function () {}, requestFullScreen: function () {}, exitFullScreen: function () {} }; },
    createCanvasContext: unsupported('createCanvasContext'),
    canvasToTempFilePath: unsupported('canvasToTempFilePath'),
    getFileSystemManager: function () {
      warnOnce('fs', 'wx.getFileSystemManager 在 H5 预览中不可用');
      return new Proxy({}, { get: function (_t, key) { return function () { throw new Error('FileSystemManager.' + String(key) + ' is not supported in H5 preview'); }; } });
    },
    cloud: {
      init: function () { warnOnce('cloud', '云开发（wx.cloud）在 H5 预览中不可用，数据相关功能请在微信开发者工具中验证'); },
      callFunction: unsupported('cloud.callFunction', '云函数请在微信开发者工具中验证'),
      uploadFile: unsupported('cloud.uploadFile', '云存储请在微信开发者工具中验证'),
      downloadFile: unsupported('cloud.downloadFile', '云存储请在微信开发者工具中验证'),
      getTempFileURL: unsupported('cloud.getTempFileURL', '云存储请在微信开发者工具中验证'),
      database: function () {
        warnOnce('cloud-db', '云数据库在 H5 预览中不可用，查询会失败，请在微信开发者工具中验证');
        var fail = function () { return Promise.reject({ errMsg: 'cloud.database:fail not supported in H5 preview' }); };
        var chain = new Proxy(function () {}, {
          get: function (_t, key) {
            if (key === 'then') return undefined;
            if (key === 'get' || key === 'add' || key === 'update' || key === 'remove' || key === 'count' || key === 'set') return function (opts) { if (opts && typeof opts.fail === 'function') opts.fail({ errMsg: 'cloud.database:fail not supported in H5 preview' }); return fail(); };
            if (key === 'command') return chain;
            if (key === 'serverDate') return function () { return new Date(); };
            return chain;
          },
          apply: function () { return chain; },
        });
        return chain;
      },
    },
  };
  function pickFiles(accept, multiple) {
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.className = 'wx-hidden-native';
      input.addEventListener('change', function () {
        var files = Array.prototype.map.call(input.files || [], function (file) {
          return { path: URL.createObjectURL(file), size: file.size, type: file.type, name: file.name };
        });
        input.remove();
        if (files.length) resolve(files);
        else reject(new Error('cancel'));
      });
      overlay.appendChild(input);
      input.click();
    });
  }
  // No network bridge, native identity or authorization in the approximation runtime.
  var unavailableApis = ['request', 'downloadFile', 'uploadFile', 'connectSocket', 'login', 'checkSession', 'authorize', 'getSetting', 'openSetting', 'getUserInfo', 'getUserProfile', 'requestPayment', 'getLocation', 'chooseLocation', 'openLocation', 'scanCode', 'chooseAddress', 'getPhoneNumber'];
  unavailableApis.forEach(function (name) { wxImpl[name] = unsupported(name); });
  var stubApis = ['cloud', 'createAnimation', 'createVideoContext', 'createIntersectionObserver', 'getFileSystemManager', 'getUpdateManager', 'getPerformance', 'vibrateShort', 'vibrateLong', 'makePhoneCall', 'showShareMenu', 'hideShareMenu', 'updateShareMenu', 'getNetworkType', 'onNetworkStatusChange', 'offNetworkStatusChange', 'offAppShow', 'offAppHide', 'offError', 'onUnhandledRejection', 'onPageNotFound', 'onThemeChange', 'onWindowResize', 'offWindowResize', 'onMemoryWarning', 'reportAnalytics', 'reportEvent', 'reportMonitor', 'showNavigationBarLoading', 'hideNavigationBarLoading', 'hideHomeButton', 'setBackgroundTextStyle', 'stopPullDownRefresh'];
  stubApis.forEach(function (name) {
    if (typeof wxImpl[name] !== 'function') return;
    var implementation = wxImpl[name];
    wxImpl[name] = function () {
      warnOnce('api-stub:' + name, 'wx.' + name + ' 仅提供 H5 占位实现，不能用于验证原生能力');
      return implementation.apply(wxImpl, arguments);
    };
    wxImpl[name].__wxUnsupported = true;
  });
  wxImpl.canIUse = function (name) {
    var parts = String(name || '').split('.');
    if (stubApis.indexOf(parts[0]) >= 0) return false;
    var value = wxImpl;
    for (var i = 0; i < parts.length; i++) {
      if (!value || !Object.prototype.hasOwnProperty.call(value, parts[i]) || value.__wxUnsupported) return false;
      value = value[parts[i]];
    }
    return typeof value === 'function' && !value.__wxUnsupported;
  };
  var wx = new Proxy(wxImpl, {
    get: function (target, key) {
      if (typeof key !== 'string') return target[key];
      if (key in target) return target[key];
      if (key === 'then' || key === 'toJSON') return undefined;
      return unsupported(key);
    },
  });
  window.wx = wx;

  // ------------------------------------------------------------------ boot
  var launchOptions = { path: BUILD.entryPage, query: {}, scene: 1001, referrerInfo: {}, apiCategory: 'default' };
  function showFatal(message) {
    viewport.innerHTML = '';
    var panel = document.createElement('div');
    panel.className = 'wx-error-panel';
    panel.setAttribute('role', 'alert');
    panel.textContent = message;
    viewport.appendChild(panel);
    emitLog('error', [message], 'startup');
    reportRuntimeError(message, 'startup-error');
    var batch = pendingLogs.splice(0, pendingLogs.length);
    if (batch.length) post({ type: 'log', entries: batch });
    post({ type: 'startup-error' });
  }
  function boot(init) {
    applyDevice(init && init.device);
    document.body.toggleAttribute('data-style-v2', !!BUILD.styleV2);
    updateViewportMetrics(null);
    try {
      storage = init && init.storage ? JSON.parse(encodeStorage(init.storage)) : Object.create(null);
    } catch (error) {
      storage = Object.create(null);
      warnOnce('storage-init', '预览 Storage 无效，未载入：' + error.message);
    }
    var requestedRoute = init && init.route ? parseUrl(init.route, '') : { route: BUILD.entryPage, query: {} };
    if (BUILD.pages.indexOf(requestedRoute.route) < 0) requestedRoute = { route: BUILD.entryPage, query: {} };
    launchOptions = { path: requestedRoute.route, query: requestedRoute.query, scene: 1001, referrerInfo: {}, apiCategory: 'default' };
    buildTabBar();
    if (!BUILD.modules['app.js']) {
      showFatal('app.js 缺失，无法启动预览');
      return;
    }
    try {
      defining = null;
      loadModule('app.js');
    } catch (error) {
      console.error('app.js 执行失败:', error);
      showFatal('app.js 执行失败：' + (error && error.message ? error.message : String(error)));
      return;
    }
    var app = appInstance || {};
    ['onLaunch', 'onShow', 'onHide', 'onError', 'onPageNotFound'].forEach(function () {});
    Object.keys(app).forEach(function (key) {
      if (typeof app[key] === 'function') app[key] = app[key].bind(app);
    });
    var target = init && init.route ? parseUrl(init.route, '') : { route: BUILD.entryPage, query: {} };
    if (BUILD.pages.indexOf(target.route) < 0) target = { route: BUILD.entryPage, query: {} };
    launchOptions = { path: target.route, query: target.query, scene: 1001, referrerInfo: {}, apiCategory: 'default' };
    if (typeof app.onLaunch === 'function') safeCall(app.onLaunch, app, [launchOptions]);
    if (typeof app.onShow === 'function') safeCall(app.onShow, app, [launchOptions]);
    appEvents.show.forEach(function (fn) { safeCall(fn, null, [launchOptions]); });
    try {
      var url = '/' + target.route + queryString(target.query);
      if (isTabRoute(target.route)) {
        switchTabTo(url);
        if (Object.keys(target.query).length) currentEntry().query = target.query;
      } else reLaunch(url);
    } catch (error) {
      console.error(error);
      showFatal(error.message);
      return;
    }
    // This proves mount completion, not pixels on screen. Do not gate the shell on
    // rAF: a covered cross-origin iframe may not receive animation callbacks.
    post({ type: 'started' });
    previewMounted = true;
    reportPreviewStatus('rendered');
  }

  var booted = false;
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== 'wx-shell' || data.instanceId !== INSTANCE_ID) return;
    if (data.type === 'init' && !booted) {
      booted = true;
      boot(data);
    } else if (data.type === 'quiesce-storage' && booted && typeof data.requestId === 'string') {
      setQuiescing(true, data.requestId);
      post({ type: 'storage-flushed', requestId: data.requestId, storage: storage, data: storage });
    } else if (data.type === 'resume-storage' && booted) {
      if (data.requestId && data.requestId !== quiesceRequestId) return;
      setQuiescing(false);
    } else if (data.type === 'flush-storage' && booted && typeof data.requestId === 'string') {
      post({ type: 'storage-flushed', requestId: data.requestId, data: storage });
    } else if (data.type === 'navigate' && booted) {
      try {
        var target = parseUrl(data.url, '');
        if (isTabRoute(target.route)) switchTabTo('/' + target.route);
        else reLaunch('/' + target.route + queryString(target.query));
      } catch (error) {
        console.error(error.message);
        reportRuntimeError(error, 'navigation-error');
      }
    }
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(function () {
    if (booted) updateViewportMetrics(currentEntry());
  }).observe(viewport);
  post({ type: 'ready' });
  // Embedded previews must receive the selected device/route/storage from the
  // shell. Do not silently boot with defaults when parent initialization is late.
  if (window.parent === window) {
    booted = true;
    boot({});
  }
})();
