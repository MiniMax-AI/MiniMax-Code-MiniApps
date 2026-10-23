var WxComponentRuntime = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/component-runtime.mjs
  var component_runtime_exports = {};
  __export(component_runtime_exports, {
    convertStyleValues: () => convertStyleValues,
    createRuntime: () => createRuntime,
    rewriteCssUrls: () => rewriteCssUrls
  });

  // node_modules/.pnpm/glass-easel@1.2.0/node_modules/glass-easel/dist/glass_easel.all.es.js
  var e;
  var t;
  !(function(e3) {
    e3[e3.Shadow = 1] = "Shadow", e3[e3.Composed = 2] = "Composed", e3[e3.Domlike = 3] = "Domlike";
  })(e || (e = {})), (function(e3) {
    e3[e3.ContentBox = 1] = "ContentBox", e3[e3.BorderBox = 2] = "BorderBox";
  })(t || (t = {}));
  var n;
  var s = Object.freeze({ __proto__: null, BM: { DYNAMIC: true, SHADOW: false, COMPOSED: false, DOMLIKE: false }, get BackendMode() {
    return e;
  }, get ResizeObserverMode() {
    return t;
  } });
  var o = Object.freeze({ __proto__: null });
  var i = Object.freeze({ __proto__: null });
  !(function(e3) {
    e3.None = "none", e3.Simple = "simple", e3.SimpleWithRecursion = "simple-recursion";
  })(n || (n = {}));
  var r = { defaultComponentSpace: null, externalComponent: false, templateEngine: null, styleScope: null, extraStyleScope: null, inheritStyleScope: false, hostNodeTagName: "wx-x", multipleSlots: false, dynamicSlots: false, reflectToAttributes: false, writeFieldsToNode: true, writeIdToDOM: false, useMethodCallerListeners: false, idPrefixGenerator: null, pureDataPattern: null, dataDeepCopy: n.Simple, propertyPassingDeepCopy: n.Simple, listenerChangeLifetimes: false, virtualHost: false, propertyEarlyInit: false, propertyComparer: null, unknownPropertyHandler: null, throwGlobalError: false, writeExtraInfoToAttr: false, backendContext: null, devTools: null };
  var l = (e3, t2) => {
    const n3 = void 0 === t2 ? r : t2;
    if (void 0 === e3 && n3 !== r) return n3;
    const s3 = null != e3 ? e3 : {};
    return { externalComponent: void 0 !== s3.externalComponent ? s3.externalComponent : n3.externalComponent, templateEngine: void 0 !== s3.templateEngine ? s3.templateEngine : n3.templateEngine, styleScope: void 0 !== s3.styleScope ? s3.styleScope : n3.styleScope, hostNodeTagName: void 0 !== s3.hostNodeTagName ? s3.hostNodeTagName : n3.hostNodeTagName, extraStyleScope: void 0 !== s3.extraStyleScope ? s3.extraStyleScope : n3.extraStyleScope, inheritStyleScope: void 0 !== s3.inheritStyleScope ? s3.inheritStyleScope : n3.inheritStyleScope, multipleSlots: void 0 !== s3.multipleSlots ? s3.multipleSlots : n3.multipleSlots, dynamicSlots: void 0 !== s3.dynamicSlots ? s3.dynamicSlots : n3.dynamicSlots, reflectToAttributes: void 0 !== s3.reflectToAttributes ? s3.reflectToAttributes : n3.reflectToAttributes, writeFieldsToNode: void 0 !== s3.writeFieldsToNode ? s3.writeFieldsToNode : n3.writeFieldsToNode, writeIdToDOM: void 0 !== s3.writeIdToDOM ? s3.writeIdToDOM : n3.writeIdToDOM, useMethodCallerListeners: void 0 !== s3.useMethodCallerListeners ? s3.useMethodCallerListeners : n3.useMethodCallerListeners, idPrefixGenerator: void 0 !== s3.idPrefixGenerator ? s3.idPrefixGenerator : n3.idPrefixGenerator, pureDataPattern: void 0 !== s3.pureDataPattern ? s3.pureDataPattern : n3.pureDataPattern, dataDeepCopy: void 0 !== s3.dataDeepCopy ? s3.dataDeepCopy : n3.dataDeepCopy, propertyPassingDeepCopy: void 0 !== s3.propertyPassingDeepCopy ? s3.propertyPassingDeepCopy : n3.propertyPassingDeepCopy, listenerChangeLifetimes: void 0 !== s3.listenerChangeLifetimes ? s3.listenerChangeLifetimes : n3.listenerChangeLifetimes, virtualHost: void 0 !== s3.virtualHost ? s3.virtualHost : n3.virtualHost, propertyEarlyInit: void 0 !== s3.propertyEarlyInit ? s3.propertyEarlyInit : n3.propertyEarlyInit, propertyComparer: void 0 !== s3.propertyComparer ? s3.propertyComparer : n3.propertyComparer, unknownPropertyHandler: void 0 !== s3.unknownPropertyHandler ? s3.unknownPropertyHandler : n3.unknownPropertyHandler };
  };
  var a = class {
    constructor(e3) {
      this.empty = true, this._$arr = null, this._$type = e3;
    }
    add(e3) {
      this._$arr ? this._$arr = this._$arr.concat(e3) : this._$arr = [e3], this.empty = false;
    }
    remove(e3) {
      let t2 = null;
      if (this._$arr) {
        const n3 = [], s3 = this._$arr;
        for (let o3 = 0; o3 < s3.length; o3 += 1) {
          if (s3[o3] === e3) {
            n3.push(...s3.slice(o3 + 1)), t2 = e3;
            break;
          }
          n3.push(s3[o3]);
        }
        this._$arr = n3, this.empty = 0 === this._$arr.length;
      }
      return t2;
    }
    call(e3, t2, n3) {
      const s3 = this._$arr;
      let o3 = true;
      if (s3) for (let i3 = 0; i3 < s3.length; i3 += 1) {
        false === h(this._$type, s3[i3], e3, t2, n3) && (o3 = false);
      }
      return o3;
    }
  };
  var d = class {
    constructor(e3) {
      this.empty = true, this._$arr = null, this._$type = e3;
    }
    getArr() {
      return this._$arr;
    }
    hasFunc() {
      return null !== this._$arr && this._$arr.length > 0;
    }
    add(e3, t2) {
      const n3 = { f: e3, data: t2 };
      this._$arr ? this._$arr = this._$arr.concat(n3) : this._$arr = [n3], this.empty = false;
    }
    remove(e3) {
      let t2 = null;
      if (this._$arr) {
        const n3 = [], s3 = this._$arr;
        for (let o3 = 0; o3 < s3.length; o3 += 1) {
          const i3 = s3[o3];
          if (i3.f === e3) {
            n3.push(...s3.slice(o3 + 1)), t2 = i3.data;
            break;
          }
          n3.push(i3);
        }
        this._$arr = n3, this.empty = 0 === this._$arr.length;
      }
      return t2;
    }
    call(e3, t2, n3, s3, o3) {
      const i3 = this._$arr;
      let r3 = true;
      if (i3) for (let l3 = 0; l3 < i3.length; l3 += 1) {
        const { f: a3, data: d3 } = i3[l3];
        if (!n3(d3)) continue;
        const c3 = h(this._$type, a3, e3, t2, s3);
        false === (o3 ? o3(c3) : c3) && (r3 = false);
      }
      return r3;
    }
  };
  var c = () => {
  };
  function h(e3, t2, n3, s3, o3) {
    try {
      return t2.apply(n3, s3);
    } catch (n4) {
      return void c(n4, `${e3 || "Listener"} ${t2.name || "(anonymous)"}`, o3);
    }
  }
  var u = Symbol("TextNode");
  var p = Symbol("Element");
  var f = Symbol("NativeNode");
  var g = Symbol("VirtualNode");
  var $ = Symbol("ShadowRootSymbol");
  var m = Symbol("Component");
  var _ = (e3) => !!e3 && e3[u];
  var v = (e3) => !!e3 && e3[p];
  var b = (e3) => !!e3 && e3[f];
  var y = (e3) => !!e3 && e3[g];
  var S = (e3) => !!e3 && e3[$];
  var C = (e3) => !!e3 && e3[m];
  var w = (e3) => {
    if (v(e3)) {
      let t2;
      return t2 = y(e3) ? `(virtual):${e3.is}` : C(e3) ? `${e3.tagName}:${e3.is}` : b(e3) ? e3.is : "(unknown)", `<${t2}${((e4) => {
        let t3 = "";
        if (v(e4)) {
          null !== e4._$slotName && (t3 += ` (slot) name="${e4._$slotName}"`), e4.id && (t3 += ` id="${e4.id}"`), e4.slot && (t3 += ` slot="${e4.slot}"`);
          const n3 = e4.class;
          n3 && (t3 += ` class="${n3}"`), e4.style && (t3 += ` style="${e4.style}"`);
        }
        return y(e4) || (C(e4) ? Object.keys(e4._$behavior._$propertyMap).forEach(((n3) => {
          t3 += ` ${n3}="${String(e4.data[n3])}"`;
        })) : e4.attributes.forEach(((e5) => {
          t3 += ` ${e5.name}="${String(e5.value)}"`;
        }))), t3;
      })(e3)}>`;
    }
    return _(e3) ? e3.textContent.trim() : null === e3 ? "<(null)>" : void 0 === e3 ? "<(undefined)>" : "<(unknown)>";
  };
  var k = false;
  var x = new a("error");
  var O = new a("warning");
  function L(e3, t2, n3, s3) {
    if (!k) {
      k = true, C(n3) && n3.triggerLifetime("error", [e3]);
      const o3 = false === x.call(e3, [e3, t2, n3, s3]);
      if (k = false, o3) return;
    }
    if (r.throwGlobalError) throw e3;
    console.error([e3 instanceof Error ? `${e3.message}` : String(e3), s3 ? `	@${w(s3)}` : void 0, n3 ? `	${t2 || ""}@${"string" == typeof n3 ? `<${n3}>` : w(n3 || false)}` : void 0].filter(Boolean).join("\n"));
  }
  function R(e3, t2, n3) {
    O.call(null, [e3, t2 || "", n3]) && console.warn(e3);
  }
  c = L;
  var M = class extends Error {
    constructor(e3, t2, n3, s3) {
      super(e3), this.additionalStack = t2, this.relatedComponent = n3, this.element = s3, L(this, t2, n3, s3);
    }
  };
  function A(e3) {
    x.add(e3);
  }
  function T(e3) {
    x.remove(e3);
  }
  function B(e3) {
    O.add(e3);
  }
  function D(e3) {
    O.remove(e3);
  }
  var P = ["touchstart", "touchmove", "touchend", "touchcancel", "mousedown", "mousemove", "mouseout", "mouseover", "mouseup", "mouseenter", "mouseleave", "click"];
  var I = ["before", "after"];
  var j = class {
    constructor() {
      this.mode = 3, this.document = document, this._$styleSheets = [], this._$styleSheetRegistry = /* @__PURE__ */ Object.create(null), this._$delegatedEventListeners = /* @__PURE__ */ Object.create(null), this._$elementEventListeners = /* @__PURE__ */ new WeakMap(), this._$elementCaptureEventListeners = /* @__PURE__ */ new WeakMap(), this._$triggedEvents = /* @__PURE__ */ new WeakSet(), this.iframe = null, this._stopOverlayInspectHandler = null;
    }
    destroy() {
    }
    getWindowWidth() {
      return document.documentElement.clientWidth;
    }
    getWindowHeight() {
      return document.documentElement.clientHeight;
    }
    getDevicePixelRatio() {
      return window.devicePixelRatio;
    }
    getTheme() {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    registerStyleSheetContent(e3, t2) {
      this._$styleSheetRegistry[e3] = String(t2);
    }
    appendStyleSheetPath(e3, t2) {
      const n3 = this._$styleSheetRegistry[e3];
      if (void 0 === n3) throw new Error(`No style sheet registry "${e3}"`);
      if ("" === n3) {
        const e4 = this._$styleSheets.length;
        return this._$styleSheets.push(void 0), e4;
      }
      const s3 = document.createElement("style");
      s3.type = "text/css", s3.innerHTML = n3, void 0 !== t2 && s3.setAttribute("wx-style-scope", String(t2)), document.head.appendChild(s3);
      const o3 = this._$styleSheets.length;
      return this._$styleSheets.push(s3), o3;
    }
    disableStyleSheet(e3) {
      const t2 = this._$styleSheets[e3];
      t2 && document.head.removeChild(t2);
    }
    render(e3) {
      window.requestAnimationFrame((() => {
        h("Render Callback", e3, this, [null]);
      }));
    }
    getRootNode() {
      return document.body;
    }
    associateValue(e3, t2) {
      e3.__wxElement = t2;
    }
    onEvent(e3) {
      this._$eventListener || this._$initEvent(), this._$eventListener = e3;
    }
    _$getEventDetail(e3) {
      const t2 = {};
      let n3 = e3;
      for (; Object.getPrototypeOf(n3) !== Event.prototype; ) {
        const s3 = Object.keys(n3);
        for (let n4 = 0; n4 < s3.length; n4 += 1) {
          const o3 = s3[n4];
          "function" != typeof e3[o3] && (t2[o3] = e3[o3]);
        }
        n3 = Object.getPrototypeOf(n3);
      }
      return t2;
    }
    _$trigger(e3, t2, n3, s3, o3) {
      if (!this._$eventListener || !e3.target) return;
      const i3 = e3.target;
      let r3 = i3;
      for (; r3 && !r3.__wxElement; ) r3 = r3.parentNode;
      if (!r3) return;
      1 === this._$eventListener(r3.__wxElement, t2, n3, { originalEvent: e3, bubbles: s3, composed: o3, capturePhase: true }, i3) && e3.preventDefault();
    }
    _$initEvent() {
      const e3 = /* @__PURE__ */ Object.create(null);
      let t2 = false;
      const n3 = (t3, n4) => {
        e3[n4.identifier] = { x: n4.clientX, y: n4.clientY };
      }, s3 = (t3, n4) => {
        const s4 = n4.identifier;
        if (e3[s4]) {
          const o4 = e3[s4];
          (Math.abs(o4.x - n4.clientX) > 10 || Math.abs(o4.y - n4.clientY) > 10) && (delete e3[s4], this._$trigger(t3, "canceltap", o4, true, true));
        }
      }, o3 = (t3, n4) => {
        const s4 = n4.identifier;
        if (e3[s4]) {
          const o4 = e3[s4];
          delete e3[s4], Math.abs(o4.x - n4.clientX) > 10 || Math.abs(o4.y - n4.clientY) > 10 ? this._$trigger(t3, "canceltap", o4, true, true) : this._$trigger(t3, "tap", o4, true, true);
        }
      }, i3 = (t3, n4) => {
        const s4 = n4.identifier;
        if (e3[s4]) {
          const n5 = e3[s4];
          delete e3[s4], this._$trigger(t3, "canceltap", n5, true, true);
        }
      }, r3 = (e4) => {
        const t3 = e4.changedTouches;
        for (let n5 = 0; n5 < t3.length; n5 += 1) o3(e4, t3[n5]);
        const n4 = e4.target;
        n4.__touchCount -= t3.length, n4.__touchCount <= 0 && (n4.__touchCount = 0, n4.removeEventListener("touchend", r3), n4.removeEventListener("touchcancel", l3));
      }, l3 = (e4) => {
        const t3 = e4.changedTouches;
        for (let n5 = 0; n5 < t3.length; n5 += 1) i3(e4, t3[n5]);
        const n4 = e4.target;
        n4.__touchCount -= t3.length, n4.__touchCount <= 0 && (n4.__touchCount = 0, n4.removeEventListener("touchend", r3), n4.removeEventListener("touchcancel", l3));
      };
      document.body.addEventListener("touchstart", ((e4) => {
        t2 = true;
        const s4 = e4.changedTouches;
        for (let e5 = 0; e5 < s4.length; e5 += 1) n3(0, s4[e5]);
        const o4 = e4.target;
        o4.__touchCount || (o4.__touchCount = 0, o4.addEventListener("touchend", r3), o4.addEventListener("touchcancel", l3)), o4.__touchCount += s4.length;
      }), { capture: true }), document.body.addEventListener("touchmove", ((e4) => {
        const t3 = e4.changedTouches;
        for (let n4 = 0; n4 < t3.length; n4 += 1) s3(e4, t3[n4]);
      }), { capture: true }), document.body.addEventListener("mousedown", ((e4) => {
        t2 || n3(0, { identifier: -1, clientX: e4.clientX, clientY: e4.clientY });
      }), { capture: true }), document.body.addEventListener("mousemove", ((e4) => {
        t2 || s3(e4, { identifier: -1, clientX: e4.clientX, clientY: e4.clientY });
      }), { capture: true }), document.body.addEventListener("mouseup", ((e4) => {
        t2 || o3(e4, { identifier: -1, clientX: e4.clientX, clientY: e4.clientY });
      }), { capture: true });
    }
    setListenerStats(e3, t2, n3, s3) {
      if (!e3) return;
      const o3 = P.includes(t2), i3 = 2 === s3;
      if (o3) {
        if (this._$delegatedEventListeners[t2]) return;
        return this._$delegatedEventListeners[t2] = true, void document.body.addEventListener(t2, ((e4) => {
          i3 && e4.preventDefault(), this._$trigger(e4, t2, this._$getEventDetail(e4), e4.bubbles, e4.composed);
        }), { capture: true });
      }
      const r3 = n3 ? this._$elementCaptureEventListeners : this._$elementEventListeners;
      r3.has(e3) || r3.set(e3, /* @__PURE__ */ Object.create(null));
      const l3 = r3.get(e3);
      l3[t2] || (l3[t2] = true, e3.addEventListener(t2, ((e4) => {
        this._$triggedEvents.has(e4) || (this._$triggedEvents.add(e4), i3 && e4.preventDefault(), this._$trigger(e4, t2, this._$getEventDetail(e4), e4.bubbles, e4.composed));
      }), { capture: n3 }));
    }
    setModelBindingStat(e3, t2, n3) {
      const s3 = (s4, o4) => {
        if (e3._$wxArgs || (e3._$wxArgs = { modelListeners: /* @__PURE__ */ Object.create(null) }), void 0 === e3._$wxArgs.modelListeners[t2]) {
          if (!n3) return;
          e3._$wxArgs.modelListeners[t2] = n3, e3.addEventListener(s4, (() => {
            var n4;
            const s5 = null === (n4 = e3._$wxArgs) || void 0 === n4 ? void 0 : n4.modelListeners[t2];
            null == s5 || s5(o4());
          }));
        }
        e3._$wxArgs.modelListeners[t2] = n3;
      }, o3 = e3.tagName;
      let i3 = false;
      if ("INPUT" === o3) {
        const n4 = e3, o4 = n4.type;
        "checkbox" === o4 || "radio" === o4 ? "checked" === t2 && (i3 = true, s3("change", (() => n4.checked))) : "value" === t2 && (i3 = true, s3("input", (() => n4.value)));
      } else if ("TEXTAREA" === o3) {
        const n4 = e3;
        "value" === t2 && (i3 = true, s3("input", (() => n4.value)));
      } else if ("SELECT" === o3) {
        const n4 = e3;
        "value" === t2 && (i3 = true, s3("change", (() => n4.value)));
      }
      i3 || R(`unsupported model binding on "${t2}" of "${o3.toLowerCase()}" element.`);
    }
    createIntersectionObserver(e3, t2, n3, s3, o3) {
      const i3 = new IntersectionObserver(((e4) => {
        e4.forEach(((e5) => {
          o3({ intersectionRatio: e5.intersectionRatio, boundingClientRect: e5.boundingClientRect, intersectionRect: e5.intersectionRect, rootBounds: e5.rootBounds, time: e5.time, isIntersecting: e5.isIntersecting });
        }));
      }), { root: t2, rootMargin: n3, threshold: s3 });
      return i3.observe(e3), { disconnect() {
        i3.disconnect();
      } };
    }
    createResizeObserver(e3, t2, n3) {
      const s3 = new ResizeObserver(((e4) => {
        e4.forEach(((e5) => {
          const t3 = e5.target, s4 = window.getComputedStyle(t3).writingMode.startsWith("vertical-");
          if (1 !== e5.contentBoxSize.length || 1 !== e5.borderBoxSize.length) return void console.error("currently multiple boxes are not supported in resize observer");
          const o4 = e5.contentBoxSize[0], i3 = e5.borderBoxSize[0];
          n3({ boundingContentBoxWidth: s4 ? o4.blockSize : o4.inlineSize, boundingContentBoxHeight: s4 ? o4.inlineSize : o4.blockSize, boundingBorderBoxWidth: s4 ? i3.blockSize : i3.inlineSize, boundingBorderBoxHeight: s4 ? i3.inlineSize : i3.blockSize });
        }));
      })), o3 = 2 === t2 ? "border-box" : "content-box";
      return s3.observe(e3, { box: o3 }), { disconnect() {
        s3.disconnect();
      } };
    }
    createMediaQueryObserver(e3, t2) {
      let n3 = null;
      const s3 = () => {
        const s4 = (() => {
          const t3 = document.documentElement.clientWidth, n4 = document.documentElement.clientHeight;
          return (void 0 === e3.width || t3 === e3.width) && (!(void 0 !== e3.maxWidth && t3 > e3.maxWidth) && (!(void 0 !== e3.minWidth && t3 < e3.minWidth) && ((void 0 === e3.width || n4 === e3.height) && (!(void 0 !== e3.maxHeight && n4 > e3.maxHeight) && (!(void 0 !== e3.minHeight && n4 < e3.minHeight) && (t3 > n4 ? "landscape" : "portrait") === e3.orientation)))));
        })();
        n3 !== s4 && (n3 = s4, t2({ matches: s4 }));
      };
      return setTimeout(s3, 0), window.addEventListener("resize", s3), { disconnect() {
        window.removeEventListener("resize", s3);
      } };
    }
    getContext(e3, t2) {
      t2(e3);
    }
    setFocusedNode(e3) {
      e3.focus();
    }
    getFocusedNode(e3) {
      var t2;
      let n3 = document.activeElement;
      for (; !(null == n3 ? void 0 : n3.__wxElement); ) n3 = (null == n3 ? void 0 : n3.parentNode) || null;
      e3(null !== (t2 = null == n3 ? void 0 : n3.__wxElement) && void 0 !== t2 ? t2 : null);
    }
    onWindowResize(e3) {
      window.addEventListener("resize", (() => {
        e3({ width: this.getWindowWidth(), height: this.getWindowHeight(), devicePixelRatio: this.getDevicePixelRatio() });
      }));
    }
    onThemeChange(e3) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (() => {
        e3({ theme: this.getTheme() });
      }));
    }
    elementFromPoint(e3, t2, n3) {
      var s3;
      let o3 = document.elementFromPoint(e3, t2);
      for (; null !== o3 && !o3.__wxElement; ) o3 = (null == o3 ? void 0 : o3.parentNode) || null;
      n3(null !== (s3 = null == o3 ? void 0 : o3.__wxElement) && void 0 !== s3 ? s3 : null);
    }
    getAllComputedStyles(e3, t2) {
      const n3 = window.getComputedStyle(e3);
      t2({ properties: U(n3) });
    }
    getPartialComputedStyles(e3, t2, n3) {
      const s3 = window.getComputedStyle(e3);
      n3({ properties: U(s3, t2) });
    }
    getPseudoComputedStyles(e3, t2, n3) {
      const s3 = window.getComputedStyle(e3, `::${t2}`);
      n3({ properties: U(s3) });
    }
    getPartialPseudoComputedStyles(e3, t2, n3, s3) {
      const o3 = window.getComputedStyle(e3, `::${t2}`);
      s3({ properties: U(o3, n3) });
    }
    getBoxModel(e3, t2) {
      const n3 = e3.getBoundingClientRect(), s3 = window.getComputedStyle(e3), o3 = parseFloat(s3.marginLeft), i3 = parseFloat(s3.marginTop), r3 = parseFloat(s3.marginRight), l3 = parseFloat(s3.marginBottom), a3 = parseFloat(s3.borderLeftWidth), d3 = parseFloat(s3.borderTopWidth), c3 = parseFloat(s3.borderRightWidth), h3 = parseFloat(s3.borderBottomWidth), u3 = parseFloat(s3.paddingLeft), p3 = parseFloat(s3.paddingTop), f3 = parseFloat(s3.paddingRight), g3 = parseFloat(s3.paddingBottom), $3 = n3, m3 = { left: $3.left - o3, top: $3.top - i3, width: $3.width + r3 + o3, height: $3.height + i3 + l3 }, _3 = { left: $3.left + a3, top: $3.top + d3, width: $3.width - c3 - a3, height: $3.height - d3 - h3 };
      t2({ margin: m3, border: $3, padding: _3, content: { left: _3.left + u3, top: _3.top + p3, width: _3.width - f3 - u3, height: _3.height - p3 - g3 } });
    }
    getPseudoTypes(e3, t2) {
      const n3 = [], s3 = e3;
      I.forEach(((e4) => {
        const t3 = `::${e4}`, o3 = window.getComputedStyle(s3, t3);
        "none" !== o3.getPropertyValue("content") && "none" !== o3.getPropertyValue("display") && "hidden" !== o3.getPropertyValue("visibility") && n3.push(e4);
      })), t2(n3);
    }
    setScrollPosition(e3, t2, n3, s3) {
      if (t2 <= 0 && n3 <= 0) e3.scrollIntoView({ behavior: 0 !== s3 ? "smooth" : "auto" });
      else {
        const { left: o3, top: i3 } = e3.getBoundingClientRect();
        window.scrollTo({ left: o3 + t2, top: i3 + n3, behavior: 0 !== s3 ? "smooth" : "auto" });
      }
    }
    queryMatchedRules(e3, t2, n3, s3) {
      const o3 = [], i3 = s3 ? new RegExp(`:{1,2}${s3}$`) : null;
      return V(t2, ((t3, s4, r3) => {
        if (s4 instanceof CSSStyleRule) {
          const l3 = [];
          for (let e4 = 0; e4 < r3.length; e4 += 1) {
            const t4 = r3[e4];
            if (t4 instanceof CSSMediaRule) {
              if (!matchMedia(t4.conditionText).matches) return;
              l3.push(`@media ${t4.conditionText}`);
            } else "undefined" != typeof CSSLayerBlockRule && t4 instanceof CSSLayerBlockRule && l3.push(`@layer ${t4.name}`);
          }
          const a3 = s4.selectorText;
          let d3 = false;
          const c3 = (function(e4) {
            let t4 = "";
            const n4 = [];
            let s5 = 0, o4 = false, i4 = false, r4 = false;
            for (let l4 = 0; l4 < e4.length; l4 += 1) {
              const a4 = e4[l4];
              if (i4) t4 += a4, i4 = false;
              else if (r4) "*" === a4 && l4 < e4.length - 1 && "/" === e4[l4 + 1] && (r4 = false, l4 += 1);
              else if (o4) "\\" === a4 ? i4 = true : a4 === o4 && (o4 = false), t4 += a4;
              else switch (a4) {
                case "/":
                  if ("*" === e4[l4 + 1]) {
                    r4 = true, l4 += 1;
                    break;
                  }
                  t4 += a4;
                  break;
                case "\\":
                  i4 = true, t4 += a4;
                  break;
                case '"':
                case "'":
                  o4 = a4, t4 += a4;
                  break;
                case "(":
                case "[":
                case "{":
                  s5 += 1, t4 += a4;
                  break;
                case ")":
                case "]":
                case "}":
                  s5 > 0 && (s5 -= 1), t4 += a4;
                  break;
                case ",":
                  0 === s5 ? (n4.push(t4.trim()), t4 = "") : t4 += a4;
                  break;
                default:
                  t4 += a4;
              }
            }
            t4.trim() && n4.push(t4.trim());
            return n4;
          })(a3).map(((e4) => {
            const t4 = i3 ? i3.test(e4) && n3.matches(e4.replace(i3, "")) : n3.matches(e4);
            return d3 || (d3 = t4), { text: e4, matches: t4 };
          }));
          if (!d3) return;
          const h3 = s4.style.cssText, u3 = U(s4.style);
          o3.push({ sheetIndex: e3, ruleIndex: t3, inlineText: s4.cssText, mediaQueries: l3, selector: a3, selectors: c3, properties: u3, propertyText: h3, weightHighBits: 0 });
        }
      })), o3;
    }
    getMatchedRules(e3, t2) {
      const n3 = e3, s3 = document.styleSheets, o3 = [];
      for (let e4 = 0; e4 < s3.length; e4 += 1) {
        const t3 = s3[e4];
        o3.push(...this.queryMatchedRules(e4, t3, n3));
      }
      const i3 = n3.style.cssText;
      t2({ inline: U(n3.style), inlineText: i3, rules: o3 });
    }
    getPseudoMatchedRules(e3, t2, n3) {
      const s3 = e3, o3 = document.styleSheets, i3 = [];
      for (let e4 = 0; e4 < o3.length; e4 += 1) {
        const n4 = o3[e4];
        i3.push(...this.queryMatchedRules(e4, n4, s3, t2));
      }
      n3({ inline: [], rules: i3 });
    }
    getIframe() {
      return this.iframe || (this.iframe = document.createElement("iframe"), this.iframe.style.display = "none", document.body.appendChild(this.iframe)), this.iframe;
    }
    getDefaultComputedStyles(e3) {
      const t2 = this.getIframe().contentWindow, n3 = t2.document, s3 = n3.createElement(e3.tagName);
      n3.body.appendChild(s3);
      const o3 = t2.getComputedStyle(s3), i3 = {};
      for (let e4 = 0; e4 < o3.length; e4 += 1) {
        const t3 = o3[e4];
        i3[t3] = o3.getPropertyValue(t3);
      }
      return s3.remove(), i3;
    }
    getModifiedComputedStyles(e3) {
      const t2 = this.getDefaultComputedStyles(e3), n3 = window.getComputedStyle(e3), s3 = {};
      for (let e4 = 0; e4 < n3.length; e4 += 1) {
        const o3 = n3[e4];
        ["blockSize"].includes(o3) || n3.getPropertyValue(o3) !== t2[o3] && (s3[o3] = n3.getPropertyValue(o3));
      }
      return s3;
    }
    getInheritedRules(e3, t2) {
      const n3 = this.getModifiedComputedStyles(e3), s3 = window.document.documentElement, o3 = [];
      for (let t3 = e3.parentNode; t3 && t3 !== s3; t3 = t3.parentNode) {
        const e4 = [];
        let s4;
        this.getMatchedRules(t3, (({ rules: e5 }) => {
          s4 = e5;
        }));
        for (let t4 = 0; t4 < s4.length; t4 += 1) {
          const o4 = s4[t4];
          o4.properties.some(((e5) => e5.name.replace(/-(.|$)/g, ((e6) => e6[1] ? e6[1].toUpperCase() : "")) in n3)) && e4.push(o4);
        }
        e4.length && o3.push(e4);
      }
      t2({ rules: o3 });
    }
    findStyleRule(e3, t2) {
      const n3 = document.styleSheets[e3], s3 = null == n3 ? void 0 : n3.cssRules[t2];
      return "CSSStyleRule" === (null == s3 ? void 0 : s3.constructor.name) ? s3 : null;
    }
    replaceStyleSheetAllProperties(e3, t2, n3, s3) {
      const o3 = this.findStyleRule(e3, t2);
      o3 ? (o3.style.cssText = n3, s3(0)) : s3(null);
    }
    startOverlayInspect(e3) {
      if (this._stopOverlayInspectHandler) return;
      const t2 = window.document.body.style.pointerEvents;
      window.document.body.style.pointerEvents = "none";
      const n3 = (n4) => {
        n4.preventDefault();
        const { x: s4, y: o3 } = n4;
        window.document.body.style.pointerEvents = t2, this.elementFromPoint(s4, o3, ((t3) => {
          this._stopOverlayInspectHandler && (window.document.body.style.pointerEvents = "none", e3("tap", t3));
        }));
      }, s3 = F(((n4) => {
        if ("mouseout" === n4.type) e3("mouseout", null);
        else if ("mousemove" === n4.type) {
          const { x: s4, y: o3 } = n4;
          window.document.body.style.pointerEvents = t2, this.elementFromPoint(s4, o3, ((t3) => {
            this._stopOverlayInspectHandler && (window.document.body.style.pointerEvents = "none", e3("mouseover", t3));
          }));
        }
      }), 100);
      window.addEventListener("click", n3), window.addEventListener("mousemove", s3, { passive: true, capture: true }), window.addEventListener("mouseout", s3, { passive: true, capture: true }), this._stopOverlayInspectHandler = () => {
        window.document.body.style.pointerEvents = t2, window.removeEventListener("click", n3), window.removeEventListener("mousemove", s3, { capture: true }), window.removeEventListener("mouseout", s3, { capture: true });
      };
    }
    stopOverlayInspect() {
      this._stopOverlayInspectHandler && (this._stopOverlayInspectHandler(), this._stopOverlayInspectHandler = null);
    }
    getActiveElement(e3) {
      var t2;
      let n3 = document.activeElement;
      for (; null !== n3 && !n3.__wxElement; ) n3 = (null == n3 ? void 0 : n3.parentNode) || null;
      e3(null !== (t2 = null == n3 ? void 0 : n3.__wxElement) && void 0 !== t2 ? t2 : null);
    }
  };
  var F = (e3, t2) => {
    let n3 = null;
    return (...s3) => {
      null !== n3 && clearTimeout(n3), n3 = setTimeout((() => {
        n3 = null, e3(...s3);
      }), t2);
    };
  };
  var U = (e3, t2) => {
    const n3 = [], s3 = t2 || e3;
    for (let t3 = 0; t3 < s3.length; t3 += 1) {
      const o3 = s3[t3], i3 = "important" === e3.getPropertyPriority(o3), r3 = e3.getPropertyValue(o3);
      n3.push({ name: o3, value: r3, important: i3 });
    }
    return n3;
  };
  var V = (e3, t2) => {
    let n3 = 0;
    const s3 = [], o3 = (e4) => {
      for (let i3 = 0; i3 < e4.length; i3 += 1) {
        const r3 = e4[i3];
        r3 instanceof CSSConditionRule || "undefined" != typeof CSSLayerBlockRule && r3 instanceof CSSLayerBlockRule ? (s3.push(r3), o3(r3.cssRules), s3.pop()) : (t2(n3, r3, s3), n3 += 1);
      }
    };
    o3(e3.cssRules);
  };
  var H;
  !(function(e3) {
    e3[e3.Fragment = 0] = "Fragment", e3[e3.Element = 1] = "Element", e3[e3.TextNode = 2] = "TextNode", e3[e3.Component = 3] = "Component", e3[e3.VirtualNode = 4] = "VirtualNode";
  })(H || (H = {}));
  var G = class {
    constructor() {
      this.mode = 1, this._$styleSheetIdInc = 1, this._$renderCallbacks = null, this._$shadowRoot = new z();
    }
    destroy() {
    }
    getWindowWidth() {
      return 1;
    }
    getWindowHeight() {
      return 1;
    }
    getDevicePixelRatio() {
      return 1;
    }
    getTheme() {
      return "light";
    }
    registerStyleSheetContent(e3, t2) {
    }
    appendStyleSheetPath(e3, t2) {
      const n3 = this._$styleSheetIdInc;
      return this._$styleSheetIdInc += 1, n3;
    }
    disableStyleSheet(e3) {
    }
    render(e3) {
      if (this._$renderCallbacks) this._$renderCallbacks.push(e3);
      else {
        const t2 = this._$renderCallbacks = [e3];
        setTimeout((() => {
          this._$renderCallbacks = null, t2.forEach(((e4) => {
            h("Render Callback", e4, this, [null]);
          }));
        }), 16);
      }
    }
    getRootNode() {
      return this._$shadowRoot;
    }
    createFragment() {
      return new W(0);
    }
    onEvent(e3, t2) {
    }
  };
  var W = class {
    constructor(e3) {
      this._$shadowRoot = 3 === e3 ? new z() : null;
    }
    release() {
    }
    associateValue(e3) {
    }
    getShadowRoot() {
      return this._$shadowRoot || void 0;
    }
    appendChild(e3) {
    }
    removeChild(e3, t2) {
    }
    insertBefore(e3, t2, n3) {
    }
    replaceChild(e3, t2, n3) {
    }
    spliceBefore(e3, t2, n3) {
    }
    spliceAppend(e3) {
    }
    spliceRemove(e3, t2) {
    }
    setId(e3) {
    }
    setSlot(e3) {
    }
    setSlotName(e3) {
    }
    setSlotElement(e3) {
    }
    setInheritSlots() {
    }
    setStyle(e3, t2) {
    }
    addClass(e3) {
    }
    removeClass(e3) {
    }
    setClassAlias(e3, t2) {
    }
    setAttribute(e3, t2) {
    }
    removeAttribute(e3) {
    }
    setDataset(e3, t2) {
    }
    setText(e3) {
    }
    setListenerStats(e3, t2, n3) {
    }
    setModelBindingStat(e3, t2) {
    }
  };
  var z = class extends W {
    constructor() {
      super(4);
    }
    createElement(e3, t2) {
      return new W(1);
    }
    createTextNode(e3) {
      return new W(2);
    }
    createComponent(e3, t2, n3, s3, o3, i3, r3, l3) {
      return new W(3);
    }
    createVirtualNode(e3) {
      return new W(4);
    }
  };
  var K = /[^\s.,]+/g;
  var Y = (e3) => {
    const t2 = [];
    let n3;
    for (K.lastIndex = 0; null !== (n3 = K.exec(e3)); ) t2.push(String(n3[0]));
    return t2;
  };
  var Z = class {
    constructor() {
      this._$names = [""];
    }
    static globalScope() {
      return 0;
    }
    register(e3) {
      const t2 = this._$names.length;
      return this._$names.push(e3), t2;
    }
    queryName(e3) {
      return this._$names[e3];
    }
  };
  var Q = class {
    constructor(e3, t2, n3, s3, o3, i3) {
      this._$externalNames = void 0, this._$externalRawAlias = null, this._$dirtyExternalNames = null, this._$rawNames = [], this._$backendNames = [], this._$backendNameScopes = [], this._$backendNamesCount = [], this._$hasAliasNames = false, this._$element = e3, this._$owner = n3, this._$defaultScope = s3, this._$extraScope = o3, this._$rootScope = (null == n3 ? void 0 : n3._$owner) ? n3._$rootScope : s3, this._$prefixManager = i3, t2 && (this._$externalNames = t2, this._$externalRawAlias = []);
    }
    _$resolvePrefixes(e3, t2) {
      const n3 = this._$owner, s3 = null == n3 ? void 0 : n3._$externalNames, o3 = s3 ? s3.indexOf(e3) : -1;
      if (n3 && -1 !== o3) {
        this._$hasAliasNames = true;
        const e4 = n3._$externalRawAlias[o3];
        if (e4) for (let s4 = 0; s4 < e4.length; s4 += 1) n3._$resolvePrefixes(e4[s4], t2);
      } else if ("~" === e3[0]) t2(this._$rootScope, e3.slice(1));
      else if ("^" === e3[0]) {
        let n4 = e3.slice(1), s4 = this._$owner;
        for (; "^" === n4[0]; ) n4 = n4.slice(1), s4 = null == s4 ? void 0 : s4._$owner;
        t2((null == s4 ? void 0 : s4._$owner) ? s4._$defaultScope : this._$rootScope, n4);
      } else void 0 !== this._$extraScope && t2(this._$extraScope, e3), t2(this._$defaultScope, e3);
    }
    _$hasAlias(e3) {
      return !!this._$externalNames && this._$externalNames.includes(e3);
    }
    _$setAlias(e3, t2) {
      if (!this._$externalNames) return;
      let n3;
      if (null == t2) n3 = [];
      else if (Array.isArray(t2)) {
        n3 = Array(t2.length);
        for (let e4 = 0, s4 = t2.length; e4 < s4; e4 += 1) n3[e4] = String(t2[e4]);
      } else n3 = Y(String(t2));
      const s3 = this._$externalNames.indexOf(e3);
      -1 !== s3 && (this._$dirtyExternalNames = this._$dirtyExternalNames || [], this._$dirtyExternalNames.push(e3), this._$externalRawAlias[s3] = n3);
    }
    _$getAlias() {
      var e3;
      const t2 = /* @__PURE__ */ Object.create(null);
      return null === (e3 = this._$externalNames) || void 0 === e3 || e3.forEach(((e4, n3) => {
        t2[e4] = this._$externalRawAlias[n3];
      })), t2;
    }
    _$spreadExternalClassUpdate() {
      const e3 = this._$owner;
      if (!(null == e3 ? void 0 : e3._$dirtyExternalNames) || !this._$hasAliasNames) return false;
      const t2 = e3._$dirtyExternalNames, n3 = this._$externalNames;
      if (n3) for (let e4 = 0; e4 < n3.length; e4 += 1) {
        const s4 = this._$externalRawAlias[e4] || [];
        for (let o3 = 0; o3 < t2.length; o3 += 1) s4.includes(t2[o3]) && (this._$dirtyExternalNames = this._$dirtyExternalNames || [], this._$dirtyExternalNames.push(n3[e4]));
      }
      const s3 = this._$rawNames.some(((e4) => e4.some(((e5) => t2.includes(e5)))));
      return s3 && this._$updateResolvedNames(), !!this._$dirtyExternalNames || s3;
    }
    _$shouldUpdateExternalClass() {
      var e3;
      if (!this._$dirtyExternalNames) return false;
      if (1 === this._$element.getBackendMode()) {
        const t2 = this._$dirtyExternalNames;
        for (let n3 = 0; n3 < t2.length; n3 += 1) {
          const s3 = t2[n3], o3 = this._$externalNames.indexOf(s3), i3 = this._$externalRawAlias[o3] || [];
          null === (e3 = this._$element._$backendElement) || void 0 === e3 || e3.setClassAlias(s3, i3);
        }
        return this._$dirtyExternalNames = null, false;
      }
      return true;
    }
    _$markExternalClassUpdated() {
      this._$dirtyExternalNames = null;
    }
    _$fasterAddUpdateResolvedNames() {
      const e3 = this._$element._$backendElement;
      if (!e3) return false;
      const t2 = this._$rawNames;
      this._$hasAliasNames = false;
      for (let n3 = 0, s3 = t2.length; n3 < s3; n3 += 1) {
        const s4 = t2[n3];
        if (s4) for (let t3 = 0, n4 = s4.length; t3 < n4; t3 += 1) {
          const n5 = s4[t3];
          1 === this._$element.getBackendMode() ? this._$addClass(n5, void 0, e3) : this._$resolvePrefixes(n5, ((t4, n6) => {
            this._$addClass(n6, t4, e3);
          }));
        }
      }
      return true;
    }
    _$updateResolvedNames() {
      const e3 = this._$element._$backendElement;
      if (!e3) return false;
      const t2 = this._$rawNames, n3 = this._$backendNames, s3 = this._$backendNameScopes, o3 = this._$backendNamesCount, i3 = [], r3 = [], l3 = [];
      if (this._$hasAliasNames = false, 1 === this._$element.getBackendMode()) for (let e4 = 0, n4 = t2.length; e4 < n4; e4 += 1) {
        const n5 = t2[e4];
        if (n5) for (let e5 = 0, t3 = n5.length; e5 < t3; e5 += 1) {
          const t4 = n5[e5];
          let s4 = false;
          for (let e6 = 0; e6 < i3.length; e6 += 1) if (t4 === i3[e6]) {
            l3[e6] += 1, s4 = true;
            break;
          }
          s4 || (i3.push(t4), r3.push(void 0), l3.push(1));
        }
      }
      else for (let e4 = 0, n4 = t2.length; e4 < n4; e4 += 1) {
        const n5 = t2[e4];
        if (n5) for (let e5 = 0, t3 = n5.length; e5 < t3; e5 += 1) {
          const t4 = n5[e5];
          this._$resolvePrefixes(t4, ((e6, t5) => {
            for (let n6 = 0; n6 < i3.length; n6 += 1) if (t5 === i3[n6] && e6 === r3[n6]) return void (l3[n6] += 1);
            i3.push(t5), r3.push(e6), l3.push(1);
          }));
        }
      }
      let a3 = false;
      for (let t3 = 0; t3 < i3.length; t3 += 1) {
        let l4 = false;
        for (let e4 = 0; e4 < n3.length; e4 += 1) if (i3[t3] === n3[e4] && r3[t3] === s3[e4]) {
          l4 = true, o3[e4] = 0;
          break;
        }
        l4 || (a3 = true, this._$addClassToBackend(i3[t3], r3[t3], e3));
      }
      for (let t3 = 0; t3 < n3.length; t3 += 1) 0 !== o3[t3] && (a3 = true, this._$removeClassFromBackend(n3[t3], s3[t3], e3));
      return this._$backendNames = i3, this._$backendNameScopes = r3, this._$backendNamesCount = l3, a3;
    }
    _$addClassToBackend(e3, t2, n3) {
      var s3;
      if (3 === this._$element.getBackendMode()) {
        const o3 = void 0 === t2 ? "" : null === (s3 = this._$prefixManager) || void 0 === s3 ? void 0 : s3.queryName(t2), i3 = o3 ? `${o3}--${e3}` : e3;
        n3.classList.add(i3);
      } else 2 === this._$element.getBackendMode() ? n3.addClass(e3, t2) : n3.addClass(e3);
    }
    _$removeClassFromBackend(e3, t2, n3) {
      var s3;
      if (3 === this._$element.getBackendMode()) {
        const o3 = t2 && (null === (s3 = this._$prefixManager) || void 0 === s3 ? void 0 : s3.queryName(t2)), i3 = o3 ? `${o3}--${e3}` : e3;
        n3.classList.remove(i3);
      } else 2 === this._$element.getBackendMode() ? n3.removeClass(e3, t2) : n3.removeClass(e3);
    }
    _$addClass(e3, t2, n3) {
      const s3 = this._$backendNames, o3 = this._$backendNameScopes, i3 = this._$backendNamesCount;
      let r3 = false;
      for (let n4 = 0; n4 < s3.length; n4 += 1) if (e3 === s3[n4] && t2 === o3[n4]) {
        r3 = true, i3[n4] += 1;
        break;
      }
      r3 || (s3.push(e3), o3.push(t2), i3.push(1), this._$addClassToBackend(e3, t2, n3));
    }
    _$removeClass(e3, t2, n3) {
      const s3 = this._$backendNames, o3 = this._$backendNameScopes, i3 = this._$backendNamesCount;
      for (let r3 = 0; r3 < s3.length; r3 += 1) if (e3 === s3[r3] && t2 === o3[r3]) {
        i3[r3] <= 1 ? (s3.splice(r3, 1), o3.splice(r3, 1), i3.splice(r3, 1), this._$removeClassFromBackend(e3, t2, n3)) : i3[r3] -= 1;
        break;
      }
    }
    toggle(e3, t2, n3 = 0) {
      const s3 = this._$element._$backendElement, o3 = this._$rawNames[n3] ? this._$rawNames[n3].indexOf(e3) : -1;
      let i3 = false;
      if (void 0 === t2 ? -1 === o3 : !!t2) {
        if (-1 === o3) {
          const t3 = this._$rawNames;
          t3[n3] || (t3[n3] = []);
          t3[n3].push(e3), s3 && (1 === this._$element.getBackendMode() ? this._$addClass(e3, void 0, s3) : this._$resolvePrefixes(e3, ((e4, t4) => {
            this._$addClass(t4, e4, s3);
          }))), i3 = true;
        }
      } else if (-1 !== o3) {
        const t3 = this._$rawNames[n3];
        t3 && t3.splice(o3, 1), s3 && (1 === this._$element.getBackendMode() ? this._$removeClass(e3, void 0, s3) : this._$resolvePrefixes(e3, ((e4, t4) => {
          this._$removeClass(t4, e4, s3);
        }))), i3 = true;
      }
      return i3;
    }
    contains(e3, t2 = 0) {
      const n3 = this._$rawNames[t2] || [];
      for (let t3 = 0; t3 < n3.length; t3 += 1) {
        const s3 = n3[t3];
        if ("~" === s3[0]) {
          if (s3.slice(1) === e3) return true;
        } else if ("^" === s3[0]) {
          let t4 = s3.slice(1);
          for (; "^" === t4[0]; ) t4 = t4.slice(1);
          if (t4 === e3) return true;
        } else if (s3 === e3) return true;
      }
      return false;
    }
    setClassNames(e3, t2 = 0) {
      let n3;
      n3 = null == e3 ? [] : Array.isArray(e3) ? Y(e3.join(" ")) : Y(String(e3));
      const s3 = 0 === this._$rawNames.length;
      return this._$rawNames[t2] = n3, s3 ? this._$fasterAddUpdateResolvedNames() : this._$updateResolvedNames();
    }
    setClassNameList(e3, t2 = 0) {
      const n3 = 0 === this._$rawNames.length;
      return this._$rawNames[t2] = e3.filter(((e4) => "" !== e4)), n3 ? this._$fasterAddUpdateResolvedNames() : this._$updateResolvedNames();
    }
    getClassNames(e3 = 0) {
      const t2 = this._$rawNames[e3] || [];
      return t2 ? t2.join(" ") : "";
    }
  };
  var J = Symbol("method");
  var ee = Object.freeze({ __proto__: null, METHOD_TAG: J });
  var te = class {
    constructor(e3, t2) {
      this.ownerSpace = e3, this._$trans = t2;
    }
    _$implement(e3) {
      var t2;
      return (null === (t2 = this._$trans) || void 0 === t2 ? void 0 : t2.call(this, e3)) || e3;
    }
  };
  var ne = class {
    constructor() {
      this._$traits = /* @__PURE__ */ new WeakMap();
    }
    implement(e3, t2) {
      const n3 = e3._$implement(t2);
      this._$traits.set(e3, n3);
    }
    get(e3) {
      return this._$traits.get(e3);
    }
  };
  var se = (e3, t2) => {
    let n3;
    n3 = "/" !== e3[0] ? t2.split("/").slice(0, -1).concat(e3.split("/")) : e3.split("/");
    const s3 = [];
    for (let e4 = 0; e4 < n3.length; e4 += 1) {
      const t3 = n3[e4];
      "" !== t3 && "." !== t3 && (".." !== t3 ? s3.push(t3) : s3.pop());
    }
    return s3.join("/");
  };
  var oe = (e3, t2) => {
    const n3 = e3.indexOf("://");
    if (n3 > 0) {
      const t3 = e3.indexOf("/", n3 + 3);
      if (t3 > 0) {
        return { domain: e3.slice(0, t3), absPath: se(e3.slice(t3 + 1), "") };
      }
      return { domain: e3.slice(0, n3 + 3), absPath: se(e3.slice(n3 + 3), "") };
    }
    const s3 = t2.indexOf("://");
    if (s3 > 0) {
      return { domain: t2.slice(0, s3 + 3), absPath: se(e3, t2.slice(s3 + 3)) };
    }
    return { domain: null, absPath: se(e3, t2) };
  };
  var ie = class {
    constructor(e3, t2, n3) {
      this._$callbacks = [], this._$ownerSpace = e3, this._$isPub = t2, this._$alias = n3;
    }
    add(e3) {
      this._$callbacks.push(e3);
    }
    hintUsed(e3) {
      var t2, n3;
      null === (n3 = (t2 = this._$ownerSpace)._$componentWaitingListener) || void 0 === n3 || n3.call(t2, this._$isPub, this._$alias, e3);
    }
    remove(e3) {
      const t2 = this._$callbacks.indexOf(e3);
      -1 !== t2 && this._$callbacks.splice(t2, 1);
    }
    call(e3) {
      for (; this._$callbacks.length > 0; ) {
        this._$callbacks.shift()(e3);
      }
    }
  };
  var re = class {
    constructor(e3, t2, n3, s3 = true) {
      this._$behaviorList = /* @__PURE__ */ Object.create(null), this._$pubBehaviorList = /* @__PURE__ */ Object.create(null), this._$list = /* @__PURE__ */ Object.create(null), this._$pubList = /* @__PURE__ */ Object.create(null), this._$using = /* @__PURE__ */ Object.create(null), this._$importedSpaces = /* @__PURE__ */ Object.create(null), this._$listWaiting = /* @__PURE__ */ Object.create(null), this._$pubListWaiting = /* @__PURE__ */ Object.create(null), this._$groupingListWaiting = null, this._$componentWaitingListener = null, this._$allowUnusedNativeNode = true, this._$sharedStyleScope = 0, this.hooks = { createTextNode: (e4, t3) => e4(t3), createNativeNode: (e4, t3, n4) => e4(t3, n4), createComponent: (e4, t3, n4) => e4(t3, n4) }, t2 && (Object.assign(this._$list, t2._$pubList), Object.assign(this._$behaviorList, t2._$pubBehaviorList)), this._$defaultComponent = null != e3 ? e3 : "", this._$componentOptions = l({}, null == t2 ? void 0 : t2._$componentOptions), this.styleScopeManager = n3 || new Z(), this._$allowUnusedNativeNode = s3;
    }
    updateComponentOptions(e3) {
      this._$componentOptions = l(e3, this._$componentOptions);
    }
    getComponentOptions() {
      return this._$componentOptions;
    }
    setSharedStyleScope(e3) {
      this._$sharedStyleScope = e3;
    }
    setGlobalUsingComponent(e3, t2) {
      this._$using[e3] = t2;
    }
    importSpace(e3, t2, n3) {
      this._$importedSpaces[e3] = { space: t2, privateUse: n3 };
    }
    getComponentByUrl(e3, t2) {
      const { domain: n3, absPath: s3 } = oe(e3, t2), o3 = this.getComponent(s3, true, n3);
      if (!o3) throw new Error(`There is no component "${s3}" in the space and no default component can be used`);
      return o3;
    }
    getComponentByUrlWithoutDefault(e3, t2) {
      const { domain: n3, absPath: s3 } = oe(e3, t2);
      return this.getComponent(s3, false, n3) || null;
    }
    getComponent(e3, t2 = true, n3 = null) {
      let s3;
      if (n3) {
        const e4 = this._$importedSpaces[n3];
        if (e4) {
          const { space: t3, privateUse: n4 } = e4;
          s3 = n4 ? t3._$list : t3._$pubList;
        }
      } else s3 = this._$list;
      if (s3) {
        const t3 = s3[e3];
        if (t3) return t3;
      }
      if (t2) return this._$list[this._$defaultComponent];
    }
    getDefaultComponent() {
      return this._$list[this._$defaultComponent] || null;
    }
    isDefaultComponent(e3) {
      return this._$list[this._$defaultComponent] === e3;
    }
    getGlobalUsingComponent(e3) {
      return this._$using[e3] || null;
    }
    getBehaviorByUrl(e3, t2) {
      const { domain: n3, absPath: s3 } = oe(e3, t2);
      return this._$getBehavior(s3, n3) || null;
    }
    _$getBehavior(e3, t2 = null) {
      let n3;
      if (t2) {
        const e4 = this._$importedSpaces[t2];
        if (e4) {
          const { space: t3, privateUse: s3 } = e4;
          n3 = s3 ? t3._$behaviorList : t3._$pubBehaviorList;
        }
      } else n3 = this._$behaviorList;
      if (n3) {
        const t3 = n3[e3];
        if (t3) return t3;
      }
    }
    defineComponent(e3) {
      const t2 = e3.is;
      return new Ut(t2, this).definition(e3).registerComponent();
    }
    defineBehavior(e3) {
      const t2 = e3.is;
      return new Ut(t2, this).definition(e3).registerBehavior();
    }
    define(e3) {
      return new Ut(e3, this);
    }
    defineWithMethodCaller(e3) {
      return new Ut(e3, this);
    }
    registerComponent(e3, t2) {
      this._$list[e3] = t2, this._$behaviorList[e3] = t2.behavior;
      const n3 = this._$listWaiting[e3];
      n3 && (delete this._$listWaiting[e3], this._$groupingListWaiting ? this._$groupingListWaiting.push({ waiting: n3, comp: t2 }) : n3.call(t2));
    }
    _$registerBehavior(e3, t2) {
      this._$behaviorList[e3] = t2;
    }
    startGroupRegister() {
      this._$groupingListWaiting = [];
    }
    endGroupRegister() {
      const e3 = this._$groupingListWaiting;
      if (e3) {
        this._$groupingListWaiting = null;
        for (let t2 = 0; t2 < e3.length; t2 += 1) {
          const { waiting: n3, comp: s3 } = e3[t2];
          n3.call(s3);
        }
      }
    }
    groupRegister(e3) {
      this.startGroupRegister();
      const t2 = h("group register", e3, this, []);
      return this.endGroupRegister(), t2;
    }
    exportComponent(e3, t2) {
      const n3 = this._$list[t2];
      if (!n3) throw new Error(`There is no component "${t2}" for aliasing`);
      this._$pubList[e3] = n3;
      const s3 = this._$pubListWaiting[e3];
      s3 && (delete this._$pubListWaiting[e3], s3.call(n3));
    }
    getExportedComponent(e3) {
      return this._$pubList[e3];
    }
    getExportedBehavior(e3) {
      return this._$pubBehaviorList[e3];
    }
    exportBehavior(e3, t2) {
      const n3 = this._$behaviorList[t2];
      if (!n3) throw new Error(`There is no behavior "${t2}" for aliasing`);
      this._$pubBehaviorList[e3] = n3;
    }
    _$componentWaitingList(e3, t2) {
      const { domain: n3, absPath: s3 } = oe(e3, t2);
      let o3, i3, r3;
      if (n3) {
        const e4 = this._$importedSpaces[n3];
        if (!e4) return null;
        if (i3 = e4.space, r3 = !e4.privateUse, r3) {
          if (i3._$pubList[s3]) return null;
          o3 = i3._$pubListWaiting;
        } else {
          if (i3._$list[s3]) return null;
          o3 = i3._$listWaiting;
        }
      } else {
        if (i3 = this, r3 = false, this._$list[s3]) return null;
        o3 = this._$listWaiting;
      }
      let l3 = o3[s3];
      return l3 || (l3 = o3[s3] = new ie(i3, r3, s3), l3);
    }
    setComponentWaitingListener(e3) {
      this._$componentWaitingListener = e3;
    }
    createComponentByUrl(e3, t2, n3, s3) {
      let o3 = t2, i3 = null;
      const r3 = o3.indexOf("#");
      r3 >= 0 && (o3 = o3.slice(0, r3));
      const l3 = o3.indexOf("?");
      l3 >= 0 && (i3 = o3.slice(l3 + 1), o3 = o3.slice(0, l3));
      const a3 = this.getComponentByUrl(o3, "");
      let d3 = null;
      n3 && (d3 = /* @__PURE__ */ Object.create(null), Object.keys(n3).forEach(((e4) => {
        const t3 = n3[e4], s4 = this.getComponentByUrl(t3, "");
        d3[e4] = s4;
      })));
      return Ft.createWithGenericsAndContext(e3, a3, d3, s3, ((e4) => {
        if (i3) {
          let t3 = false;
          i3.split("&").forEach(((n4) => {
            const s4 = n4.indexOf("=");
            if (s4 >= 0) {
              const o4 = decodeURIComponent(n4.slice(0, s4)), i4 = decodeURIComponent(n4.slice(s4 + 1));
              e4._$dataGroup.replaceProperty(o4, i4) && (t3 = true);
            }
          })), t3 && e4.applyDataUpdates();
        }
      }));
    }
    defineTraitBehavior(e3) {
      return new te(this, e3);
    }
  };
  var le = null;
  var ae = () => {
    if (le) return le;
    const e3 = new re();
    return le = e3, e3;
  };
  var de = (e3) => {
    const t2 = e3.str;
    for (; e3.cur < t2.length; ) {
      const n3 = t2[e3.cur];
      if (" " !== n3 && "\n" !== n3 && "\r" !== n3 && "	" !== n3 && "\f" !== n3) break;
      e3.cur += 1;
    }
    return e3.cur < t2.length;
  };
  var ce = (e3) => {
    const t2 = e3.str;
    let n3 = "";
    for (; e3.cur < t2.length; ) {
      const s3 = t2[e3.cur];
      if (!(s3 >= "0" && s3 <= "9")) break;
      n3 += s3, e3.cur += 1;
    }
    if (!n3) throw new Error(`data path descriptor "${t2}" is illegal at char ${e3.cur} (illegal index)`);
    return parseInt(n3, 10);
  };
  var he = (e3) => {
    const t2 = e3.str;
    let n3 = "";
    for (; e3.cur < t2.length; ) {
      const s3 = t2[e3.cur];
      if ("\\" === s3) if (e3.cur + 1 === t2.length) ;
      else {
        n3 += t2[e3.cur + 1], e3.cur += 1;
      }
      else if (/^[_a-zA-Z]$/.test(s3)) n3 += s3;
      else {
        if (!(s3 >= "0" && s3 <= "9")) break;
        if ("" === n3) throw new Error(`data path descriptor "${t2}" is illegal at char ${e3.cur} (field name cannot start with digits)`);
        n3 += s3;
      }
      e3.cur += 1;
    }
    return n3;
  };
  var ue = (e3) => {
    const t2 = e3.str;
    let n3 = "";
    for (; e3.cur < t2.length; ) {
      const s3 = t2[e3.cur];
      if ("\\" === s3) if (e3.cur + 1 === t2.length) n3 += "\\", e3.cur += 1;
      else {
        const s4 = t2[e3.cur + 1];
        "." === s4 || "[" === s4 || "]" === s4 || "\\" === s4 ? (n3 += s4, e3.cur += 2) : (n3 += "\\", e3.cur += 1);
      }
      else {
        if ("." === s3 || "[" === s3) break;
        n3 += s3, e3.cur += 1;
      }
    }
    return n3;
  };
  var pe = (e3) => {
    const t2 = e3.str;
    if (de(e3), "*" === t2[e3.cur] && "*" === t2[e3.cur + 1]) return e3.cur += 2, ["**"];
    const n3 = he(e3);
    if (!n3) throw new Error(`data path descriptor "${t2}" is illegal at char ${e3.cur} (first field name illegal)`);
    const s3 = [n3];
    for (; e3.cur < t2.length && de(e3); ) {
      const n4 = t2[e3.cur];
      if ("." === n4) {
        if (e3.cur += 1, de(e3), "*" === t2[e3.cur] && "*" === t2[e3.cur + 1]) {
          s3.push("**"), e3.cur += 2;
          break;
        }
        const n5 = he(e3);
        if (!n5) throw new Error(`data path descriptor "${t2}" is illegal at char ${e3.cur} (field name illegal)`);
        s3.push(n5);
      } else {
        if ("[" !== n4) break;
        {
          e3.cur += 1, de(e3);
          const n5 = ce(e3);
          de(e3);
          if ("]" !== t2[e3.cur]) throw new Error(`data path descriptor "${t2}" is illegal at char ${e3.cur} (illegal index)`);
          e3.cur += 1, s3.push(n5);
        }
      }
    }
    return s3;
  };
  var fe = (e3) => {
    const t2 = ((e4) => {
      const t3 = e4.str, n3 = [];
      for (; e4.cur < t3.length; ) {
        const s3 = t3[e4.cur];
        if ("." === s3) {
          e4.cur += 1;
          const t4 = ue(e4);
          "" !== t4 && n3.push(t4);
        } else if ("[" === s3) {
          e4.cur += 1;
          const s4 = ce(e4);
          if ("]" !== t3[e4.cur] && e4.cur < t3.length) throw new Error(`data path descriptor "${t3}" is illegal at char ${e4.cur} (illegal index)`);
          e4.cur += 1, n3.push(s4);
        } else {
          const t4 = ue(e4);
          n3.push(t4);
        }
      }
      return 0 === n3.length && n3.push(""), n3;
    })({ str: e3, cur: 0 });
    return t2;
  };
  var ge = (e3) => {
    if ("string" != typeof e3) return e3.map(((e4) => pe({ str: e4, cur: 0 })));
    const t2 = { str: e3, cur: 0 }, n3 = ((e4) => {
      const t3 = [];
      for (t3.push(pe(e4)), de(e4); "," === e4.str[e4.cur]; ) e4.cur += 1, t3.push(pe(e4)), de(e4);
      return t3;
    })(t2);
    if (t2.cur !== e3.length) throw new Error(`data path descriptor "${e3}" is illegal at char ${t2.cur}`);
    return n3;
  };
  var $e = Object.freeze({ __proto__: null, parseMultiPaths: ge, parseSinglePath: fe });
  var me = (e3, t2) => {
    if ("object" == typeof e3 && null !== e3) {
      const n3 = t2.get(e3);
      if (void 0 !== n3) return n3;
      if (Array.isArray(e3)) {
        const n4 = [];
        t2.set(e3, n4);
        for (let s4 = 0; s4 < e3.length; s4 += 1) n4[s4] = me(e3[s4], t2);
        return n4;
      }
      const s3 = {};
      t2.set(e3, s3);
      const o3 = Object.keys(e3);
      for (let n4 = 0; n4 < o3.length; n4 += 1) {
        const i3 = o3[n4];
        s3[i3] = me(e3[i3], t2);
      }
      return s3;
    }
    return "symbol" == typeof e3 ? Symbol(e3.description) : e3;
  };
  var _e = (e3) => {
    if ("object" == typeof e3 && null !== e3) {
      if (Array.isArray(e3)) {
        const t3 = [];
        for (let n4 = 0; n4 < e3.length; n4 += 1) t3[n4] = _e(e3[n4]);
        return t3;
      }
      const t2 = {}, n3 = Object.keys(e3);
      for (let s3 = 0; s3 < n3.length; s3 += 1) {
        const o3 = n3[s3];
        t2[o3] = _e(e3[o3]);
      }
      return t2;
    }
    return "symbol" == typeof e3 ? Symbol(e3.description) : e3;
  };
  var ve = (e3, t2) => t2 ? me(e3, /* @__PURE__ */ new WeakMap()) : _e(e3);
  var be;
  !(function(e3) {
    e3[e3.Disabled = 0] = "Disabled", e3[e3.Enabled = 1] = "Enabled", e3[e3.Destroyed = 2] = "Destroyed";
  })(be || (be = {}));
  var ye = Object.freeze({ __proto__: null, get AutoDestroyState() {
    return be;
  }, deepCopy: ve, simpleDeepCopy: _e });
  var Se = class _Se {
    constructor(e3) {
      this._$subtreeObserversCount = 0, this.attrObservers = null, this.allAttrObservers = null, this.textObservers = null, this.childObservers = null, this.attachObservers = null, this._$bound = e3;
    }
    attachChild(e3) {
      e3._$mutationObserverTarget || (e3._$mutationObserverTarget = new _Se(e3)), this._$subtreeObserversCount > 0 && e3._$mutationObserverTarget.updateSubtreeCount(this._$subtreeObserversCount);
    }
    detachChild(e3) {
      e3._$mutationObserverTarget && e3._$mutationObserverTarget.updateSubtreeCount(-this._$subtreeObserversCount);
    }
    updateSubtreeCount(e3) {
      this._$subtreeObserversCount += e3;
      const t2 = this._$bound;
      if (!v(t2)) return;
      t2.childNodes.forEach(((t3) => {
        t3._$mutationObserverTarget || (t3._$mutationObserverTarget = new _Se(t3)), t3._$mutationObserverTarget.updateSubtreeCount(e3);
      }));
    }
    hasSubtreeListeners() {
      return this._$subtreeObserversCount > 0;
    }
    static callAttrObservers(e3, t2) {
      var n3;
      let s3 = e3;
      do {
        const e4 = s3._$mutationObserverTarget;
        null === (n3 = null == e4 ? void 0 : e4.allAttrObservers) || void 0 === n3 || n3.call(s3, [t2]), !(null == e4 ? void 0 : e4.attrObservers) || "basic" !== t2.nameType && "attribute" !== t2.nameType && "component-property" !== t2.nameType || e4.attrObservers.call(s3, [t2]);
        const o3 = s3.parentNode;
        if (!o3) break;
        if (s3 = o3, !s3._$mutationObserverTarget) break;
      } while (s3._$mutationObserverTarget._$subtreeObserversCount > 0);
    }
    static callTextObservers(e3, t2) {
      var n3;
      let s3 = e3;
      do {
        const e4 = s3._$mutationObserverTarget;
        null === (n3 = null == e4 ? void 0 : e4.textObservers) || void 0 === n3 || n3.call(s3, [t2]);
        const o3 = s3.parentNode;
        if (!o3) break;
        if (s3 = o3, !s3._$mutationObserverTarget) break;
      } while (s3._$mutationObserverTarget._$subtreeObserversCount > 0);
    }
    static callChildObservers(e3, t2) {
      var n3;
      let s3 = e3;
      do {
        const e4 = s3._$mutationObserverTarget;
        null === (n3 = null == e4 ? void 0 : e4.childObservers) || void 0 === n3 || n3.call(s3, [t2]);
        const o3 = s3.parentNode;
        if (!o3) break;
        if (s3 = o3, !s3._$mutationObserverTarget) break;
      } while (s3._$mutationObserverTarget._$subtreeObserversCount > 0);
    }
    static callAttachObservers(e3, t2) {
      var n3;
      const s3 = e3._$mutationObserverTarget;
      null === (n3 = null == s3 ? void 0 : s3.attachObservers) || void 0 === n3 || n3.call(e3, [t2]);
    }
  };
  var Ce = class _Ce {
    constructor(e3) {
      this._$subtreeListenersCount = 0, this._$boundFuncArrs = [], this._$boundTarget = null, this._$listener = e3, this._$normalizedListener = null;
    }
    static create(e3) {
      return new _Ce(e3);
    }
    observe(e3, t2 = { properties: false, childList: false, characterData: false, subtree: false, attachStatus: false }) {
      const n3 = this._$listener;
      if (!n3) throw new Error("A MutationObserver can only observe once");
      let s3;
      e3._$mutationObserverTarget ? s3 = e3._$mutationObserverTarget : (s3 = new Se(e3), e3._$mutationObserverTarget = s3), this._$listener = null;
      const o3 = t2.subtree ? n3 : function(e4) {
        e4.target === this && n3.call(this, e4);
      };
      this._$normalizedListener = o3, this._$boundTarget = s3, "all" === t2.properties ? (s3.allAttrObservers || (s3.allAttrObservers = new a("attributeObserver")), s3.allAttrObservers.add(o3), this._$boundFuncArrs.push(s3.allAttrObservers), this._$subtreeListenersCount += 1) : t2.properties && (s3.attrObservers || (s3.attrObservers = new a("attributeObserver")), s3.attrObservers.add(o3), this._$boundFuncArrs.push(s3.attrObservers), this._$subtreeListenersCount += 1), t2.childList && (s3.childObservers || (s3.childObservers = new a("childObserver")), s3.childObservers.add(o3), this._$boundFuncArrs.push(s3.childObservers), this._$subtreeListenersCount += 1), t2.characterData && (s3.textObservers || (s3.textObservers = new a("textObserver")), s3.textObservers.add(o3), this._$boundFuncArrs.push(s3.textObservers), this._$subtreeListenersCount += 1), t2.subtree && s3.updateSubtreeCount(this._$subtreeListenersCount), t2.attachStatus && (s3.attachObservers || (s3.attachObservers = new a("attachObserver")), s3.attachObservers.add(o3), this._$boundFuncArrs.push(s3.attachObservers));
    }
    disconnect() {
      var e3;
      null === (e3 = this._$boundTarget) || void 0 === e3 || e3.updateSubtreeCount(-this._$subtreeListenersCount);
      const t2 = this._$boundFuncArrs;
      this._$boundFuncArrs = [];
      const n3 = this._$normalizedListener;
      n3 && t2.forEach(((e4) => {
        e4.remove(n3);
      }));
    }
  };
  var we = Object.freeze({ __proto__: null, MutationObserver: Ce, MutationObserverTarget: Se });
  var Ne = Object.prototype.hasOwnProperty;
  var Ee;
  !(function(e3) {
    e3.Invalid = "invalid", e3.Any = "any", e3.String = "string", e3.Number = "number", e3.Boolean = "boolean", e3.Object = "object", e3.Array = "array", e3.Function = "function";
  })(Ee || (Ee = {}));
  var ke = (e3, t2) => {
    const n3 = Object.keys(t2);
    for (let s3 = 0; s3 < n3.length; s3 += 1) {
      const o3 = n3[s3];
      if (Object.prototype.hasOwnProperty.call(e3, o3)) if ("_" === o3[0] && R(`data field "${o3}" from different behaviors is overriding or merging.`), "object" != typeof e3[o3] || "object" != typeof t2[o3] || null === t2[o3] || Array.isArray(t2[o3])) e3[o3] = t2[o3];
      else {
        if (Array.isArray(e3[o3])) e3[o3] = e3[o3].slice();
        else {
          const t3 = e3[o3], n4 = {}, s4 = Object.keys(t3);
          for (let e4 = 0; e4 < s4.length; e4 += 1) {
            const o4 = s4[e4];
            n4[o4] = t3[o4];
          }
          e3[o3] = n4;
        }
        ke(e3[o3], t2[o3]);
      }
      else e3[o3] = t2[o3];
    }
  };
  var xe = (e3) => {
    switch (e3) {
      case "string":
        return "";
      case "number":
        return 0;
      case "boolean":
        return false;
      case "array":
        return [];
      case "function":
        return function() {
        };
      default:
        return null;
    }
  };
  var Oe = (e3) => "string" === e3 || e3 === String ? "string" : "number" === e3 || e3 === Number ? "number" : "boolean" === e3 || e3 === Boolean ? "boolean" : "object" === e3 || e3 === Object ? "object" : "array" === e3 || e3 === Array ? "array" : "function" === e3 || e3 === Function ? "function" : "any" === e3 || null == e3 ? "any" : "invalid";
  var Le = (e3, t2, n3) => {
    const s3 = n3.type, o3 = n3.optionalTypes;
    if (o3) {
      for (let t3 = 0; t3 < o3.length; t3 += 1) if (Re(o3[t3], e3)) return e3;
    }
    return "string" === s3 ? null == e3 ? (R(`property "${t2}" received type-incompatible value: expected <String> but get null value. Used default value instead.`), n3.defaultFn()) : ("object" == typeof e3 && R(`property "${t2}" received type-incompatible value: expected <String> but got object-typed value. Force converted.`), String(e3)) : "number" === s3 ? isFinite(e3) ? Number(e3) : (R("number" == typeof e3 ? `property "${t2}" received type-incompatible value: expected <Number> but got NaN or Infinity. Used default value instead.` : `property "${t2}" received type-incompatible value: expected <Number> but got non-number value. Used default value instead.`), n3.defaultFn()) : "boolean" === s3 ? !!e3 : "array" === s3 ? Array.isArray(e3) ? e3 : (R(`property "${t2}" received type-incompatible value: expected <Array> but got non-array value. Used default value instead.`), n3.defaultFn()) : "object" === s3 ? "object" == typeof e3 ? e3 : (R(`property "${t2}" received type-incompatible value: expected <Object> but got non-object value. Used default value instead.`), n3.defaultFn()) : "function" === s3 ? "function" == typeof e3 ? e3 : (R(`property "${t2}" received type-incompatible value: expected <Function> but got non-function value. Used default value instead.`), n3.defaultFn()) : void 0 === e3 ? n3.defaultFn() : e3;
  };
  var Re = (e3, t2) => {
    if ("string" === e3) {
      if ("string" != typeof t2) return false;
    } else if ("number" === e3) {
      if (!Number.isFinite(t2)) return false;
    } else if ("boolean" === e3) {
      if ("boolean" != typeof t2) return false;
    } else if ("object" === e3) {
      if ("object" != typeof t2 || Array.isArray(t2)) return false;
    } else if ("array" === e3) {
      if ("object" != typeof t2 || !Array.isArray(t2)) return false;
    } else if ("function" === e3) {
      if ("function" != typeof t2) return false;
    } else if (void 0 === t2) return false;
    return true;
  };
  var Me;
  !(function(e3) {
    e3[e3.None = 0] = "None", e3[e3.Simple = 1] = "Simple", e3[e3.SimpleWithRecursion = 2] = "SimpleWithRecursion";
  })(Me || (Me = {}));
  var Ae = class _Ae {
    constructor(e3) {
      this.observerRoot = { sub: {} }, this.observers = [], this.propFields = e3;
    }
    cloneSub() {
      const e3 = new _Ae(this.propFields);
      return this.observers.length > 0 && (e3.observerRoot = _e(this.observerRoot), e3.observers = this.observers.slice()), e3;
    }
    addObserver(e3, t2) {
      const n3 = this.observers.length;
      this.observers.push({ path: t2, f: e3 });
      for (let e4 = 0; e4 < t2.length; e4 += 1) {
        const s3 = t2[e4];
        let o3 = this.observerRoot, i3 = false;
        for (let e5 = 0; e5 < s3.length; e5 += 1) {
          const t3 = s3[e5];
          if ("**" === t3) {
            i3 = true;
            break;
          }
          o3.sub[t3] || (o3.sub[t3] = { sub: {} }), o3 = o3.sub[t3];
        }
        i3 ? o3.wildcard ? o3.wildcard.push(n3) : o3.wildcard = [n3] : o3.listener ? o3.listener.push(n3) : o3.listener = [n3];
      }
    }
  };
  var Te = (e3, t2, n3, s3) => {
    const o3 = new Array(n3.length);
    for (let e4 = 0; e4 < n3.length; e4 += 1) {
      const s4 = n3[e4];
      let i3 = t2;
      for (let e5 = 0; e5 < s4.length; e5 += 1) {
        const t3 = s4[e5];
        if ("**" === t3) break;
        if ("object" != typeof i3 || null === i3) {
          i3 = void 0;
          break;
        }
        i3 = i3[t3];
      }
      o3[e4] = i3;
    }
    h("Data Observer", s3, e3.getMethodCaller(), o3, e3 || void 0);
  };
  var Be = (e3, t2) => {
    if (e3.listener) for (let n4 = 0; n4 < e3.listener.length; n4 += 1) {
      t2[e3.listener[n4]] = true;
    }
    if (e3.wildcard) for (let n4 = 0; n4 < e3.wildcard.length; n4 += 1) {
      t2[e3.wildcard[n4]] = true;
    }
    const n3 = Object.keys(e3.sub);
    for (let s3 = 0; s3 < n3.length; s3 += 1) {
      const o3 = n3[s3];
      Be(e3.sub[o3], t2);
    }
  };
  var De = (e3, t2, n3) => {
    let s3 = e3, o3 = true;
    for (let e4 = 0; e4 < n3.length; e4 += 1) {
      const i3 = n3[e4];
      if (s3.wildcard) {
        const e5 = s3.wildcard;
        for (let n4 = 0; n4 < e5.length; n4 += 1) {
          t2[e5[n4]] = true;
        }
      }
      if (!Ne.call(s3.sub, i3)) {
        o3 = false;
        break;
      }
      s3 = s3.sub[i3];
    }
    o3 && Be(s3, t2);
  };
  var Pe = (e3, t2, n3, s3) => {
    for (let o3 = 0; o3 < e3.length; o3 += 1) {
      const { path: i3, f: r3 } = e3[o3];
      t2[o3] && (t2[o3] = false, n3 && Te(n3, s3, i3, r3));
    }
  };
  var Ie = (e3) => e3 === n.Simple ? 1 : e3 === n.SimpleWithRecursion ? 2 : 0;
  var je = class _je {
    _$generateInnerData(e3) {
      const t2 = this._$pureDataPattern, n3 = this._$dataDeepCopy;
      if (t2 || 0 !== n3) {
        const s3 = {}, o3 = Object.keys(e3);
        for (let i3 = 0; i3 < o3.length; i3 += 1) {
          const r3 = o3[i3], l3 = e3[r3];
          t2 && t2.test(r3) || (s3[r3] = 0 === n3 ? l3 : 2 === n3 ? ve(l3, true) : _e(l3));
        }
        return s3;
      }
      return null;
    }
    constructor(e3, t2, n3, s3, o3, i3, r3, l3, a3) {
      this._$modelBindingListener = null, this._$pendingChanges = [], this._$doingUpdates = null, this._$recUpdateLevel = 0, this._$comp = e3, this.data = t2, this._$pureDataPattern = n3, this._$dataDeepCopy = s3, this._$propertyPassingDeepCopy = o3, this._$reflectToAttributes = i3 && !!e3, this._$propFields = r3.propFields, this._$propDirty = /* @__PURE__ */ Object.create(null), this._$observerTree = r3, this._$observerStatus = new Array(r3.observers.length), this._$propertyComparer = l3, this._$unknownPropertyHandler = a3, this.innerData = this._$generateInnerData(t2);
    }
    static create(e3) {
      return new _je(null, e3, null, 0, 0, false, new Ae({}), null, null);
    }
    replaceWholeData(e3) {
      this.data = e3, this.innerData = this._$generateInnerData(e3);
    }
    replaceDataOnPath(e3, t2) {
      this._$pendingChanges.push([e3, t2, void 0, void 0]);
    }
    spliceArrayDataOnPath(e3, t2, n3, s3) {
      Array.isArray(s3) ? this._$pendingChanges.push([e3, s3, null != t2 ? t2 : -1, n3 || 0]) : R(`The splice insertion must be a string (on path "${e3.join(".")}"). The change is ignored.`);
    }
    replaceProperty(e3, t2) {
      var n3, s3;
      let o3 = t2;
      return this._$propFields[e3] ? (0 !== this._$propertyPassingDeepCopy && (o3 = 2 === this._$propertyPassingDeepCopy ? ve(t2, true) : _e(t2)), this._$pendingChanges.push([[e3], o3, void 0, void 0]), true) : null !== (s3 = null === (n3 = this._$unknownPropertyHandler) || void 0 === n3 ? void 0 : n3.call(this._$comp, e3, t2)) && void 0 !== s3 && s3;
    }
    setChanges(e3) {
      this._$pendingChanges = e3;
    }
    getChanges() {
      return this._$pendingChanges;
    }
    setModelBindingListener(e3, t2) {
      if (this._$modelBindingListener) this._$modelBindingListener[e3] = t2;
      else {
        (this._$modelBindingListener = /* @__PURE__ */ Object.create(null))[e3] = t2;
      }
    }
    applyDataUpdates(e3 = false) {
      var t2;
      const n3 = this._$propFields, s3 = this._$comp, o3 = this._$pureDataPattern, i3 = this._$dataDeepCopy, r3 = !!this._$doingUpdates;
      let l3, a3;
      this._$observerTree.observers.length > 0 ? this._$doingUpdates ? (l3 = this._$doingUpdates.combined, a3 = this._$doingUpdates.prop) : (this._$doingUpdates = { prop: [], combined: [], count: 0 }, l3 = this._$doingUpdates.combined, a3 = this._$doingUpdates.prop) : (l3 = [], a3 = []);
      const d3 = this._$pendingChanges;
      this._$pendingChanges = [];
      for (let t3 = 0; t3 < d3.length; t3 += 1) {
        const r4 = d3[t3], [c3, u3, p3, f3] = r4, g3 = void 0 !== f3, $3 = String(c3[0]), m3 = !!o3 && o3.test($3), _3 = !m3 && this.innerData, v3 = n3[$3];
        let b3 = true;
        if (v3 && 1 === c3.length) {
          const t4 = this.data[$3];
          let n4, o4, l4;
          if (g3) {
            if (Array.isArray(t4)) {
              const e4 = r4, s4 = p3;
              n4 = s4 >= 0 && s4 < t4.length ? s4 : t4.length, e4[2] = n4, t4.splice(n4, f3, ...u3);
            } else R(`An array splice change cannot be applied to a non-array value (on path "${c3.join(".")}"). The change is ignored.`);
            o4 = t4;
          } else o4 = Le(u3, $3, v3);
          if (_3) {
            let e4;
            if (0 === i3) r4[1] = e4 = o4;
            else if (void 0 !== n4) {
              let t5;
              e4 = this.innerData[$3], r4[1] = t5 = 2 === i3 ? ve(u3, true) : _e(u3), e4.splice(n4, f3, ...t5);
            } else r4[1] = e4 = 2 === i3 ? ve(o4, true) : _e(o4);
            this.innerData[$3] = e4;
          }
          if (this.data[$3] = o4, this._$reflectToAttributes) {
            const e4 = s3.getBackendElement();
            if (e4) {
              let t5 = o4;
              if (v3.reflectIdPrefix) {
                const e5 = s3.ownerShadowRoot;
                if (e5) {
                  const n6 = e5.getHostNode()._$idPrefix;
                  n6 && (t5 = `${n6}--${o4}`);
                }
              }
              const n5 = $3.replace(/[A-Z]/g, ((e5) => `-${e5.toLowerCase()}`)), i4 = typeof t5;
              "boolean" === i4 ? o4 ? e4.setAttribute(n5, "") : e4.removeAttribute(n5) : "object" === i4 ? e4.setAttribute(n5, JSON.stringify(t5)) : e4.setAttribute(n5, t5);
            }
          }
          g3 || !v3.comparer && !this._$propertyComparer ? l4 = t4 !== o4 : (l4 = !!h("Property Comparer", v3.comparer || this._$propertyComparer, s3, [u3, t4], null == s3 ? void 0 : s3.general()), b3 = l4), !m3 && l4 && a3.push({ propName: $3, prop: v3, oldValue: t4, newValue: o4, skipModelListener: e3 });
        } else {
          let t4, n4 = this.data, s4 = $3;
          for (let e4 = 1; e4 < c3.length; e4 += 1) {
            const t5 = c3[e4];
            Number.isFinite(t5) ? (Ne.call(n4, s4) && Array.isArray(n4[s4]) || (n4[s4] = []), _3 || m3 || t5 >= n4[s4].length && l3.push([c3.slice(0, e4).concat("length"), true, void 0, void 0])) : Ne.call(n4, s4) && null !== n4[s4] && "object" == typeof n4[s4] && !Array.isArray(n4[s4]) || (n4[s4] = {}), n4 = n4[s4], s4 = t5;
          }
          if (g3) {
            const e4 = n4.length, o4 = n4[s4];
            if (Array.isArray(o4)) {
              const s5 = r4, i4 = p3;
              t4 = i4 >= 0 && i4 < o4.length ? i4 : o4.length, s5[2] = t4, o4.splice(t4, f3, ...u3), _3 || m3 || n4.length === e4 || l3.push([c3.concat("length"), true, void 0, void 0]);
            } else R(`An array splice change cannot be applied to a non-array value (on path "${c3.join(".")}"). The change is ignored.`);
          } else n4[s4] = u3;
          if (_3) {
            n4 = this.innerData, s4 = $3;
            for (let e5 = 1; e5 < c3.length; e5 += 1) {
              const t5 = c3[e5];
              Number.isFinite(t5) ? (Ne.call(n4, s4) && Array.isArray(n4[s4]) || (n4[s4] = []), t5 >= n4[s4].length && l3.push([c3.slice(0, e5).concat("length"), true, void 0, void 0])) : Ne.call(n4, s4) && null !== n4[s4] && "object" == typeof n4[s4] && !Array.isArray(n4[s4]) || (n4[s4] = {}), n4 = n4[s4], s4 = t5;
            }
            let e4;
            if (0 === i3) r4[1] = e4 = u3;
            else if (void 0 !== t4) {
              const o4 = n4.length;
              let a4;
              e4 = n4[s4], r4[1] = a4 = 2 === i3 ? ve(u3, true) : _e(u3), e4.splice(t4, f3, ...a4), n4.length !== o4 && l3.push([c3.concat("length"), true, void 0, void 0]);
            } else r4[1] = e4 = 2 === i3 ? ve(u3, true) : _e(u3);
            n4[s4] = e4;
          }
          !m3 && v3 && a3.push({ propName: $3, prop: v3, oldValue: void 0, newValue: u3, skipModelListener: e3 || false });
        }
        De(this._$observerTree.observerRoot, this._$observerStatus, c3), !m3 && b3 && l3.push(r4), this._$doingUpdates && (this._$doingUpdates.count += 1);
      }
      if (!r3) {
        if (this._$doingUpdates) {
          let e4;
          do {
            e4 = this._$doingUpdates.count, Pe(this._$observerTree.observers, this._$observerStatus, s3, this.data);
          } while (e4 !== this._$doingUpdates.count);
          this._$doingUpdates = null;
        }
        if (this._$recUpdateLevel > 0 && s3 && R(`recursive update detected: a data update is applying during another data update for component "${s3.is}" - this may disorder node trees`, s3), this._$recUpdateLevel += 1, null === (t2 = this.updateListener) || void 0 === t2 || t2.call(this, this.innerData || this.data, l3), this._$recUpdateLevel -= 1, s3) for (let e4 = 0; e4 < a3.length; e4 += 1) {
          const { propName: t3, prop: n4, oldValue: o4, newValue: i4, skipModelListener: r4 } = a3[e4];
          if (!r4 && this._$modelBindingListener) {
            const e5 = this._$modelBindingListener[t3];
            e5 && e5(i4);
          }
          n4.observer && h("Property Observer", n4.observer, s3.getMethodCaller(), [i4, o4], s3), this._$propDirty[t3] = true, s3._$mutationObserverTarget && Se.callAttrObservers(s3, { type: "properties", target: s3, nameType: "component-property", propertyName: t3 });
        }
      }
    }
  };
  var Fe;
  !(function(e3) {
    e3[e3.Normal = 0] = "Normal", e3[e3.NoDefault = 1] = "NoDefault";
  })(Fe || (Fe = {}));
  var Ue = Date.now();
  var Ve = Ue;
  var He;
  var Ge;
  var We;
  !(function(e3) {
    e3[e3.None = 0] = "None", e3[e3.Mut = 1] = "Mut", e3[e3.Final = 2] = "Final";
  })(He || (He = {})), (function(e3) {
    e3[e3.NotChanged = 0] = "NotChanged", e3[e3.Failed = 1] = "Failed", e3[e3.None = 2] = "None", e3[e3.Final = 3] = "Final", e3[e3.Mut = 4] = "Mut";
  })(Ge || (Ge = {})), (function(e3) {
    e3[e3.None = 0] = "None", e3[e3.CapturingPhase = 1] = "CapturingPhase", e3[e3.AtTarget = 2] = "AtTarget", e3[e3.BubblingPhase = 3] = "BubblingPhase";
  })(We || (We = {}));
  var ze = class {
    constructor() {
      this.listeners = /* @__PURE__ */ Object.create(null), this.captureListeners = null;
    }
    addListener(e3, t2, n3 = {}) {
      const s3 = n3.final ? 2 : n3.mutated ? 1 : 0;
      let o3, i3, r3;
      return n3.capture || n3.useCapture ? this.captureListeners ? o3 = this.captureListeners : (o3 = /* @__PURE__ */ Object.create(null), this.captureListeners = o3) : o3 = this.listeners, o3[e3] ? (r3 = true, i3 = o3[e3]) : (r3 = false, i3 = o3[e3] = { mutCount: 0, finalCount: 0, funcArr: new d("listener") }), i3.funcArr.add(t2, s3), 2 === s3 ? (i3.finalCount += 1, r3 && 1 !== i3.finalCount ? 0 : 3) : 1 === s3 ? (i3.mutCount += 1, !r3 || 1 === i3.mutCount && 0 === i3.finalCount ? 4 : 0) : r3 ? 0 : 2;
    }
    removeListener(e3, t2, n3 = {}) {
      const s3 = n3.capture || n3.useCapture ? this.captureListeners : this.listeners;
      if (!s3) return 1;
      const o3 = s3[e3];
      if (!o3) return 1;
      const i3 = o3.funcArr.remove(t2);
      return null === i3 ? 1 : 2 === i3 ? (o3.finalCount -= 1, 0 !== o3.finalCount ? 0 : o3.mutCount > 0 ? 4 : 2) : 1 === i3 ? (o3.mutCount -= 1, 0 !== o3.mutCount || 0 !== o3.finalCount ? 0 : 2) : 0;
    }
    getListeners() {
      const e3 = /* @__PURE__ */ Object.create(null), t2 = (t3, n3) => {
        const s3 = Object.keys(t3);
        for (let o3 = 0; o3 < s3.length; o3 += 1) {
          const i3 = s3[o3], r3 = t3[i3];
          e3[i3] || (e3[i3] = []);
          const l3 = r3.funcArr.getArr();
          if (l3) for (let t4 = 0; t4 < l3.length; t4 += 1) {
            const s4 = l3[t4];
            e3[i3].push({ listener: s4.f, mutated: 1 === s4.data, final: 2 === s4.data, capture: n3, useCapture: n3 });
          }
        }
      };
      return t2(this.listeners, false), this.captureListeners && t2(this.captureListeners, false), e3;
    }
  };
  var qe = class e2 {
    constructor(e3, t2, n3 = {}) {
      this.eventPhase = 0;
      const s3 = (() => {
        const e4 = Date.now();
        return e4 < Ve && (Ue += e4 - Ve), Ve = e4, e4 - Ue;
      })();
      this._$eventName = this.type = e3, this.timeStamp = s3, this.detail = t2, this.bubbles = n3.bubbles || false, this.composed = n3.composed || false, this._$capturePhase = n3.capturePhase || false, this._$eventBubblingControl = { stopped: false, mutated: false, noDefault: false }, this._$originalEvent = n3.originalEvent, this._$dispatched = false, this._$hasListener = false, this._$handleListenerReturn = n3.handleListenerReturn, n3.extraFields && (Object.assign(this, n3.extraFields), this.extraFields = n3.extraFields);
    }
    getEventBubbleStatus() {
      return this._$eventBubblingControl.noDefault ? 1 : 0;
    }
    wrapShadowedEvent(e3, t2, n3) {
      const s3 = Object.create(this);
      return s3.target = e3, s3.mark = t2, s3.currentTarget = n3, s3;
    }
    getEventName() {
      return this._$eventName;
    }
    getOriginalEvent() {
      return this._$originalEvent;
    }
    preventDefault() {
      this._$eventBubblingControl.noDefault = true;
    }
    defaultPrevented() {
      return this._$eventBubblingControl.noDefault;
    }
    stopPropagation() {
      this._$eventBubblingControl.stopped = true;
    }
    propagationStopped() {
      return this._$eventBubblingControl.stopped;
    }
    hasListener() {
      return this._$hasListener;
    }
    markMutated() {
      this._$eventBubblingControl.mutated = true;
    }
    mutatedMarked() {
      return this._$eventBubblingControl.mutated;
    }
    listenerReturnHandler() {
      return this._$handleListenerReturn;
    }
    isCapturePhase() {
      return 1 === this.eventPhase;
    }
    callListener(e3, t2, n3, s3) {
      const o3 = this._$eventName, i3 = e3._$eventTarget;
      if (!i3) return;
      const r3 = s3 ? i3.captureListeners : i3.listeners;
      if (!r3) return;
      const l3 = r3[o3];
      if (!l3) return;
      const a3 = this.mutatedMarked(), d3 = C(n3) && n3.getMethodCaller() || n3, c3 = C(e3) && e3.getMethodCaller() || e3;
      this._$hasListener || (this._$hasListener = l3.funcArr.hasFunc());
      const h3 = this.wrapShadowedEvent(d3, t2, c3);
      false === l3.funcArr.call(c3, [h3], ((e4) => !a3 || 1 !== e4), C(n3) ? n3 : void 0, this._$handleListenerReturn) || l3.finalCount > 0 ? (h3.stopPropagation(), h3.preventDefault()) : l3.mutCount > 0 && h3.markMutated();
    }
    dispatch(e3, t2) {
      if (this._$dispatched) throw new Error("Event cannot be dispatched twice");
      this._$dispatched = true;
      const n3 = this.composed, s3 = this.bubbles, o3 = t2 && C(e3) && e3._$external, i3 = !n3 && o3, r3 = this._$eventBubblingControl, l3 = (e4, t3) => {
        const s4 = (e5) => {
          let o5 = e5;
          const i4 = e5.collectMarks();
          for (; ; ) {
            if (false === t3(o5, e5, i4)) return null;
            let r4;
            if (n3) {
              if (S(o5)) return o5.getHostNode();
              if (null === o5.containingSlot) return null;
              if (o5.containingSlot) r4 = s4(o5.containingSlot);
              else for (r4 = o5.parentNode; null == r4 ? void 0 : r4._$inheritSlots; ) r4 = r4.parentNode;
            } else r4 = o5.parentNode;
            if (!r4) return null;
            o5 = r4;
          }
        };
        let o4 = e4;
        for (; ; ) {
          const e5 = s4(o4);
          if (!e5) break;
          o4 = e5;
        }
      };
      if (this._$capturePhase && !r3.stopped && !i3) {
        this.eventPhase = 1;
        const t3 = [];
        l3(e3, ((e4, n4, s4) => {
          t3.push([e4, n4, s4]);
        }));
        for (let e4 = t3.length - 1; e4 >= 0; e4 -= 1) {
          const [n4, s4, o4] = t3[e4];
          if (n4._$eventTarget && (this.callListener(n4, o4, s4, true), r3.stopped)) break;
        }
      }
      if (this.eventPhase = 2, !r3.stopped && t2 && C(e3) && e3._$external && e3.shadowRoot.handleEvent(t2, this), !r3.stopped && !i3) {
        let t3 = true;
        l3(e3, ((e4, n4, o4) => {
          if (!t3 && C(e4) && e4._$external) {
            const t4 = e4.shadowRoot;
            t4.slot && t4.handleEvent(t4.slot, this);
          }
          return t3 = false, this.eventPhase = 3, e4._$eventTarget && !r3.stopped && this.callListener(e4, o4, n4, false), s3 && !r3.stopped;
        }));
      }
      return this.eventPhase = 0, this.getEventBubbleStatus();
    }
    static dispatchEvent(e3, t2) {
      return t2.dispatch(e3);
    }
    static dispatchExternalEvent(e3, t2, n3) {
      let s3 = e3;
      return C(e3) && v(e3.shadowRoot) && (s3 = e3.shadowRoot), n3.dispatch(s3, t2);
    }
    static triggerEvent(t2, n3, s3, o3) {
      const i3 = new e2(n3, s3, o3);
      return e2.dispatchEvent(t2, i3);
    }
    static triggerExternalEvent(t2, n3, s3, o3, i3) {
      const r3 = new e2(s3, o3, i3);
      return e2.dispatchExternalEvent(t2, n3, r3);
    }
    static triggerBackendEvent(t2, n3, s3, o3, i3) {
      return i3 ? e2.triggerExternalEvent(t2, i3, n3, s3, o3) : e2.triggerEvent(t2, n3, s3, o3);
    }
  };
  var Xe;
  !(function(e3) {
    e3[e3.Child = 0] = "Child", e3[e3.Descendant = 1] = "Descendant", e3[e3.CrossShadowDescendant = 2] = "CrossShadowDescendant";
  })(Xe || (Xe = {}));
  var Ke = (e3) => {
    var t2;
    return null === (t2 = e3.ownerShadowRoot) || void 0 === t2 ? void 0 : t2.getHostNode().getRootBehavior().ownerSpace;
  };
  var Ye = class _Ye {
    static _$parseSegment(e3, t2) {
      const n3 = /^(#[_a-zA-Z][-_a-zA-Z0-9:]*|)((?:\.-?[_a-zA-Z][-_a-zA-Z0-9]*)+|)$/.exec(e3);
      if (!n3) return null;
      const s3 = n3[1].slice(1), o3 = n3[2].split(".");
      return o3.shift(), s3 || o3.length ? { id: s3, classes: o3, relation: t2 } : null;
    }
    constructor(e3) {
      this.unions = [];
      const t2 = String(e3 || "").split(",");
      for (let e4 = 0; e4 < t2.length; e4 += 1) {
        const n3 = t2[e4].split(/( |\t|>+)/g), s3 = [];
        let o3 = 1, i3 = 0;
        for (; i3 < n3.length; i3 += 1) {
          const e5 = n3[i3];
          if (!e5 || " " === e5 || "	" === e5 || ">>" === e5) continue;
          if (">" === e5[0]) {
            if (1 !== o3) break;
            o3 = 3 === e5.length ? 2 : 0;
            continue;
          }
          const t3 = _Ye._$parseSegment(e5, o3);
          if (o3 = 1, !t3) break;
          s3.push(t3);
        }
        i3 === n3.length && (s3.length && this.unions.push(s3));
      }
    }
    isEmpty() {
      return 0 === this.unions.length;
    }
    static _$testSelectorSegment(e3, t2, n3, s3, o3, i3) {
      var r3;
      if (n3 === e3) return false;
      const l3 = s3[o3];
      let a3 = true;
      (Ke(n3) !== t2 || l3.id && l3.id !== n3.id) && (a3 = false);
      const d3 = l3.classes;
      for (let e4 = 0; a3 && e4 < d3.length; e4 += 1) (null === (r3 = n3.classList) || void 0 === r3 ? void 0 : r3.contains(d3[e4])) || (a3 = false);
      if (!a3 && 0 === i3) return false;
      let c3 = n3;
      if (a3 && 0 === o3) {
        if (null === e3) return true;
        for (c3 = c3.parentNode; c3; c3 = c3.parentNode) if (c3 === e3) return true;
        if (2 !== i3) return false;
        c3 = n3, a3 = false;
      }
      const h3 = a3 ? l3.relation : i3;
      do {
        c3.parentNode ? c3 = c3.parentNode : 2 === h3 ? c3 = S(c3) ? c3.getHostNode() : null : 2 === i3 ? (a3 = false, c3 = S(c3) ? c3.getHostNode() : null) : c3 = null, c3 === e3 && (c3 = null);
      } while (y(c3));
      if (!c3) return false;
      if (a3) {
        if (_Ye._$testSelectorSegment(e3, t2, c3, s3, o3 - 1, h3)) return true;
        if (2 !== i3) return false;
      }
      return _Ye._$testSelectorSegment(e3, t2, c3, s3, o3, i3);
    }
    testSelector(e3, t2) {
      if (y(t2)) return false;
      const n3 = this.unions;
      let s3;
      if (s3 = null !== e3 && Ke(e3) || Ke(t2), void 0 === s3) return false;
      for (let o3 = 0; o3 < n3.length; o3 += 1) {
        const i3 = n3[o3];
        if (_Ye._$testSelectorSegment(e3, s3, t2, i3, i3.length - 1, 0)) return true;
      }
      return false;
    }
    query(e3, t2) {
      const n3 = [], s3 = (e4, t3, o4) => {
        if (this.testSelector(e4, t3)) {
          if (o4) return t3;
          n3.push(t3);
        }
        if (C(t3)) {
          const n4 = t3.getShadowRoot();
          if (n4) {
            const t4 = s3(e4, n4, o4);
            if (t4 && o4) return t4;
          }
        }
        const i3 = t3.childNodes;
        for (let t4 = 0; t4 < i3.length; t4 += 1) {
          const n4 = i3[t4];
          if (v(n4)) {
            const t5 = s3(e4, n4, o4);
            if (t5 && o4) return t5;
          }
        }
        return null;
      }, o3 = s3(e3, e3, t2);
      return t2 ? o3 : n3;
    }
  };
  var Ze;
  !(function(e3) {
    e3[e3.MAIN = 0] = "MAIN", e3[e3.TEMPLATE_EXTRA = 1] = "TEMPLATE_EXTRA", e3[e3.ANIMATION_EXTRA = 2] = "ANIMATION_EXTRA", e3[e3.TEMP_EXTRA = 3] = "TEMP_EXTRA";
  })(Ze || (Ze = {}));
  var Qe = { mode: 1, destroyed: true, dropBackendAfterRelease: true };
  var Je = { mode: 2, destroyed: true, dropBackendAfterRelease: true };
  var et = { mode: 3, destroyed: true, dropBackendAfterRelease: true };
  var tt = class _tt {
    constructor() {
      throw new Error("Element cannot be constructed directly");
    }
    _$initialize(e3, t2, n3, s3, o3) {
      this.is = e3, this._$backendElement = n3, this._$destroyOnRemoval = 0, this._$nodeTreeContext = o3, this._$nodeId = "", this._$nodeAttributes = null, this._$nodeSlot = "", this._$slotName = null, this._$slotElement = null, this._$slotValues = null, this._$subtreeSlotStart = null, this._$subtreeSlotEnd = null, this._$inheritSlots = false, this._$placeholderHandlerRemover = void 0, this._$virtual = t2, this.dataset = {}, this._$marks = null, this._$attached = false, this.classList = null, this._$styleSegments = [], this.parentNode = null, this.parentIndex = -1, this.childNodes = [], this.slotNodes = void 0, this.ownerShadowRoot = s3, this._$mutationObserverTarget = null, this._$eventTarget = new ze();
    }
    get $$() {
      return this._$backendElement;
    }
    get id() {
      return this._$nodeId;
    }
    set id(e3) {
      var t2;
      const n3 = String(e3);
      if (this._$nodeId === n3) return;
      this._$nodeId = n3;
      const s3 = this._$backendElement;
      if (this.ownerShadowRoot) {
        const e4 = this.ownerShadowRoot.getHostNode();
        if (this.ownerShadowRoot._$markIdCacheDirty(), e4.getComponentOptions().writeIdToDOM) {
          const t3 = e4._$idPrefix, o3 = t3 ? `${t3}--${n3}` : n3;
          s3 && (3 === this.getBackendMode() ? s3.id = o3 : 2 === this.getBackendMode() && s3.setId(o3));
        }
      }
      1 === this.getBackendMode() && (null == s3 || s3.setId(n3)), r.writeExtraInfoToAttr && (null === (t2 = this._$backendElement) || void 0 === t2 || t2.setAttribute("exparser:info-attr-id", n3)), this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "basic", attributeName: "id" });
    }
    get slot() {
      return this._$nodeSlot;
    }
    set slot(e3) {
      var t2;
      const n3 = String(e3);
      if (this._$nodeSlot === n3) return;
      if (this._$inheritSlots) throw new Error('slots-inherited nodes do not support "slot" attribute.');
      this._$nodeSlot = n3, 1 === this.getBackendMode() && (null === (t2 = this._$backendElement) || void 0 === t2 || t2.setSlot(n3));
      const s3 = _tt._$getParentHostShadowRoot(this.parentNode);
      if (s3) {
        if (3 === s3.getSlotMode()) throw new Error("nodes inside dynamic slots should change binding slots through Element#setSlotElement.");
        const e4 = _tt._$updateSubtreeSlotNodes(this.parentNode, [this], s3, s3, this.parentIndex);
        null == e4 || e4.removeSlotNodes();
        const t3 = this.containingSlot;
        null == e4 || e4.updateContainingSlot();
        const n4 = this.containingSlot;
        _tt.insertChildReassign(this.parentNode, this, t3, n4, this.parentIndex + 1), null == e4 || e4.insertSlotNodes();
      }
      this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "basic", attributeName: "slot" });
    }
    get attributes() {
      const e3 = [];
      return this._$nodeAttributes && Object.entries(this._$nodeAttributes).forEach((([t2, n3]) => {
        e3.push({ name: t2, value: n3 });
      })), e3;
    }
    get class() {
      return this.classList ? this.classList.getClassNames(0) : "";
    }
    set class(e3) {
      this.setNodeClass(e3, 0);
    }
    get style() {
      return this._$styleSegments[0] || "";
    }
    set style(e3) {
      this.setNodeStyle(e3, 0);
    }
    asTextNode() {
      return null;
    }
    asElement() {
      return this;
    }
    asNativeNode() {
      return b(this) ? this : null;
    }
    asVirtualNode() {
      return y(this) ? this : null;
    }
    asShadowRoot() {
      return S(this) ? this : null;
    }
    asGeneralComponent() {
      return C(this) ? this : null;
    }
    asInstanceOf(e3) {
      return C(this) ? this.asInstanceOf(e3) : null;
    }
    getBackendContext() {
      const e3 = this._$nodeTreeContext;
      return e3 === Qe || e3 === Je || e3 === et ? null : e3;
    }
    getBackendMode() {
      return this._$nodeTreeContext.mode;
    }
    getBackendElement() {
      return this._$backendElement;
    }
    destroyBackendElement() {
      this._$backendElement && 3 !== this.getBackendMode() && this._$backendElement.release(), this._$nodeTreeContext.dropBackendAfterRelease && (this._$backendElement = null, 2 === this.getBackendMode() ? this._$nodeTreeContext = Je : 3 === this.getBackendMode() ? this._$nodeTreeContext = et : this._$nodeTreeContext = Qe);
    }
    destroyBackendElementOnSubtree() {
      const e3 = function(t2) {
        for (let n3 = 0; n3 < t2.childNodes.length; n3 += 1) {
          const s3 = t2.childNodes[n3];
          v(s3) ? e3(s3) : s3.destroyBackendElement();
        }
        if (C(t2)) {
          const n3 = t2.getShadowRoot();
          n3 && e3(n3);
        }
        t2.destroyBackendElement();
      };
      e3(this);
    }
    destroyBackendElementOnRemoval() {
      this._$destroyOnRemoval = 1;
    }
    cancelDestroyBackendElementOnRemoval() {
      this._$destroyOnRemoval = 0;
    }
    destroyBackendElementOnDetach() {
      this._$destroyOnRemoval = 1;
    }
    cancelDestroyBackendElementOnDetach() {
      this._$destroyOnRemoval = 0;
    }
    isVirtual() {
      return this._$virtual;
    }
    setNodeClass(e3, t2 = 0) {
      var n3;
      (null === (n3 = this.classList) || void 0 === n3 ? void 0 : n3.setClassNames(e3, t2)) && this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "basic", attributeName: "class" });
    }
    setNodeClassList(e3, t2 = 0) {
      var n3;
      (null === (n3 = this.classList) || void 0 === n3 ? void 0 : n3.setClassNameList(e3, t2)) && this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "basic", attributeName: "class" });
    }
    toggleNodeClass(e3, t2, n3 = 0) {
      var s3;
      (null === (s3 = this.classList) || void 0 === s3 ? void 0 : s3.toggle(e3, t2, n3)) && this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "basic", attributeName: "class" });
    }
    setNodeStyle(e3, t2 = 0) {
      if (0 === t2 && this._$styleSegments[t2] === e3) return;
      this._$styleSegments[t2] = e3;
      const n3 = this._$styleSegments.join(";");
      this._$backendElement && (3 === this.getBackendMode() ? this._$backendElement.setAttribute("style", n3) : 2 === this.getBackendMode() ? this._$backendElement.setStyle(n3) : this._$backendElement.setStyle(e3, t2)), this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "basic", attributeName: "style" });
    }
    getNodeStyleSegments() {
      return this._$styleSegments;
    }
    static checkAndCallAttached(e3) {
      !(function e4(t2) {
        if (v(t2) && !t2._$attached) {
          t2._$attached = true;
          const n3 = C(t2);
          if (n3 && (t2.triggerLifetime("attached", []), t2._$relation && (t2._$relation.triggerLinkEvent(2, false), t2._$relation.triggerLinkEvent(4, false), t2._$relation.triggerLinkEvent(0, false))), t2._$mutationObserverTarget && Se.callAttachObservers(t2, { type: "attachStatus", target: t2, status: "attached" }), n3) {
            const n4 = t2.getShadowRoot();
            n4 && e4(n4);
          }
          const s3 = t2.childNodes;
          for (let t3 = 0; t3 < s3.length; t3 += 1) e4(s3[t3]);
        }
      })(e3);
    }
    static checkAndCallDetached(e3) {
      if ((function e4(t2) {
        if (v(t2) && t2._$attached) {
          if (C(t2) && t2.triggerLifetime("beforeDetach", []), t2.childNodes.forEach(e4), C(t2)) {
            const n3 = t2.getShadowRoot();
            n3 && e4(n3), t2._$attached = false, t2.triggerLifetime("detached", []), t2._$relation && (t2._$relation.triggerLinkEvent(2, true), t2._$relation.triggerLinkEvent(4, true), t2._$relation.triggerLinkEvent(0, true));
          } else t2._$attached = false;
          t2._$mutationObserverTarget && Se.callAttachObservers(t2, { type: "attachStatus", target: t2, status: "detached" });
        }
      })(e3), v(e3)) {
        const t2 = function(n3) {
          if (2 === e3._$destroyOnRemoval) return;
          for (let e4 = 0; e4 < n3.childNodes.length; e4 += 1) {
            const s4 = n3.childNodes[e4];
            v(s4) ? t2(s4) : 1 === s4._$destroyOnRemoval && (s4._$destroyOnRemoval = 2, s4.destroyBackendElement());
          }
          if (C(n3)) {
            const e4 = n3.getShadowRoot();
            e4 && t2(e4);
          }
          1 === n3._$destroyOnRemoval && (n3._$destroyOnRemoval = 2, n3.destroyBackendElement());
          const s3 = n3._$placeholderHandlerRemover;
          "function" == typeof s3 && s3();
        };
        t2(e3);
      } else 1 === e3._$destroyOnRemoval && (e3._$destroyOnRemoval = 2, e3.destroyBackendElement());
    }
    static checkAndCallMoved(e3) {
      !(function e4(t2) {
        if (v(t2) && t2._$attached && (t2.childNodes.forEach(e4), C(t2))) {
          const n3 = t2.getShadowRoot();
          n3 && e4(n3), t2.triggerLifetime("moved", []), t2._$relation && (t2._$relation.triggerLinkEvent(2, false), t2._$relation.triggerLinkEvent(4, false), t2._$relation.triggerLinkEvent(0, false));
        }
      })(e3);
    }
    static checkChildObservers(e3, t2, n3) {
      var s3;
      const o3 = e3._$mutationObserverTarget;
      if (o3 && (!(null === (s3 = o3.childObservers) || void 0 === s3 ? void 0 : s3.empty) || o3.hasSubtreeListeners())) {
        const s4 = [n3];
        let o4;
        o4 = "add" === t2 ? { type: "childList", target: e3, addedNodes: s4 } : "remove" === t2 ? { type: "childList", target: e3, removedNodes: s4 } : { type: "childList", target: e3, addedNodes: s4, removedNodes: s4 }, Se.callChildObservers(e3, o4);
      }
    }
    static hasSubtreeMutationObservers(e3) {
      var t2;
      return (null === (t2 = e3._$mutationObserverTarget) || void 0 === t2 ? void 0 : t2.hasSubtreeListeners()) || false;
    }
    static _$insertChildReassignSlot(e3, t2, n3, s3) {
      if (n3) if (s3) {
        const e4 = [...n3.slotNodes];
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const o3 = e4[t3];
          _tt._$spliceSlotNodes(n3, 0, 1, void 0), _tt._$spliceSlotNodes(s3, -1, 0, [o3]), _tt._$updateContainingSlot(o3, s3), o3._$inheritSlots || _tt.insertChildReassign(o3.parentNode, o3, n3, s3, o3.parentIndex);
        }
      } else {
        const e4 = [...n3.slotNodes];
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const o3 = e4[t3];
          _tt._$spliceSlotNodes(n3, 0, 1, void 0), _tt._$updateContainingSlot(o3, s3), o3._$inheritSlots || _tt.insertChildReassign(o3.parentNode, o3, n3, null, o3.parentIndex);
        }
      }
      else {
        const n4 = [];
        e3.forEachNodeInSpecifiedSlot(null, ((e4) => {
          if (null !== t2) {
            if ((v(e4) ? e4._$nodeSlot : "") !== t2) return;
          }
          n4.push(e4);
        }));
        for (let e4 = 0; e4 < n4.length; e4 += 1) {
          const t3 = n4[e4];
          _tt._$spliceSlotNodes(s3, -1, 0, [t3]), _tt._$updateContainingSlot(t3, s3), t3._$inheritSlots || _tt.insertChildReassign(t3.parentNode, t3, null, s3, t3.parentIndex);
        }
      }
    }
    static insertChildReassign(e3, t2, n3, s3, o3) {
      if (1 !== e3.getBackendMode()) {
        if (n3) if (s3 && 3 === e3.getBackendMode()) ;
        else {
          const s4 = _tt.findNearestNonVirtual(n3);
          if (s4) {
            const n4 = _tt.countNonVirtual(t2);
            if (n4) {
              const [t3, o4] = n4;
              if (3 === e3.getBackendMode()) {
                const e4 = t3._$backendElement;
                for (let t4 = 1; t4 < o4; t4 += 1) {
                  const t5 = e4.nextSibling;
                  t5 && s4.removeChild(t5);
                }
                o4 > 0 && s4.removeChild(e4);
              } else s4.spliceRemove(t3._$backendElement, o4);
            }
          }
        }
        s3 && _tt.insertChildComposed(e3, t2, void 0, false, o3);
      }
    }
    static findNearestNonVirtual(e3) {
      let t2 = e3;
      for (; null == t2 ? void 0 : t2._$virtual; ) t2 = S(t2) ? t2.getHostNode() : void 0 === t2.containingSlot ? t2.parentNode : t2.containingSlot;
      return C(t2) && t2._$external ? t2.shadowRoot.slot : t2 ? t2._$backendElement : null;
    }
    static countNonVirtual(e3) {
      let t2 = null, n3 = 0;
      const s3 = (e4) => {
        0 === n3 && (t2 = e4), n3 += 1;
      };
      var o3;
      return v(o3 = e3) && o3._$virtual ? o3.forEachNonVirtualComposedChild(s3) : s3(o3), t2 ? [t2, n3] : null;
    }
    static forEachNodeInSlot(e3, t2) {
      const n3 = (e4) => {
        if (false === t2(e4, e4.containingSlot)) return false;
        if (e4._$inheritSlots) {
          const t3 = e4.childNodes;
          for (let e5 = 0; e5 < t3.length; e5 += 1) if (!n3(t3[e5])) return false;
          return true;
        }
        return true;
      };
      return n3(e3);
    }
    static forEachNodeInSpecificSlot(e3, t2, n3) {
      const s3 = (e4) => {
        if (e4.containingSlot === t2 && false === n3(e4)) return false;
        if (e4._$inheritSlots) {
          const t3 = e4.childNodes;
          for (let e5 = 0; e5 < t3.length; e5 += 1) if (!s3(t3[e5])) return false;
          return true;
        }
        return true;
      };
      return s3(e3);
    }
    static forEachSlotContentInSlot(e3, t2) {
      const n3 = (e4) => {
        if (e4._$inheritSlots) {
          const t3 = e4.childNodes;
          for (let e5 = 0; e5 < t3.length; e5 += 1) if (!n3(t3[e5])) return false;
          return true;
        }
        return false !== t2(e4, e4.containingSlot);
      };
      return n3(e3);
    }
    static forEachSlotContentInSpecificSlot(e3, t2, n3) {
      const s3 = (e4) => {
        if (e4._$inheritSlots) {
          const t3 = e4.childNodes;
          for (let e5 = 0; e5 < t3.length; e5 += 1) if (!s3(t3[e5])) return false;
          return true;
        }
        return e4.containingSlot !== t2 || false !== n3(e4);
      };
      return s3(e3);
    }
    static _$findFirstNonVirtualChild(e3, t2) {
      const n3 = null !== e3._$slotName, s3 = n3 ? e3.slotNodes : e3.childNodes;
      if (t2 >= 0 && t2 < s3.length) for (let e4 = t2; e4 < s3.length; e4 += 1) {
        let t3 = null;
        const o4 = (e5) => (t3 = e5, false), i3 = (e5) => {
          if (!n3 && e5._$inheritSlots) {
            const t4 = e5.childNodes;
            for (let e6 = 0; e6 < t4.length; e6 += 1) if (false === i3(t4[e6])) return false;
          }
          return e5._$virtual ? e5.forEachNonVirtualComposedChild(o4) : o4(e5);
        };
        if (i3(s3[e4]), t3) return t3;
      }
      const o3 = (e4) => {
        if (!e4._$virtual) return null;
        const t3 = e4.containingSlot;
        if (null === t3) return null;
        if (void 0 !== t3) return _tt._$findFirstNonVirtualChild(t3, e4.slotIndex + 1);
        if (S(e4)) return o3(e4.getHostNode());
        const n4 = e4.parentNode;
        return n4 ? _tt._$findFirstNonVirtualChild(n4, e4.parentIndex + 1) : null;
      };
      return o3(e3);
    }
    static _$findFirstNonVirtualSibling(e3, t2) {
      const n3 = e3.containingSlot;
      if (null === n3) return null;
      if (void 0 !== n3) {
        if (!n3._$virtual) return null;
        if (void 0 !== e3.slotIndex) return _tt._$findFirstNonVirtualChild(n3, e3.slotIndex + 1);
        const s4 = _tt._$findSlotNodeInsertPosition(n3, e3, t2);
        return _tt._$findFirstNonVirtualChild(n3, s4);
      }
      let s3 = e3;
      if (S(e3)) return s3 = e3.getHostNode(), s3._$virtual ? _tt._$findFirstNonVirtualChild(s3, s3.parentIndex + 1) : null;
      const o3 = s3.parentNode;
      return o3 ? _tt._$findFirstNonVirtualChild(o3, t2) : null;
    }
    static insertChildComposed(e3, t2, n3, s3, o3) {
      var i3, l3, a3;
      let d3 = false, c3 = e3;
      for (; null == c3 ? void 0 : c3._$inheritSlots; ) d3 = true, c3 = c3.parentNode;
      if (!c3) return;
      const h3 = c3, u3 = h3._$nodeTreeContext;
      if (u3.destroyed) return;
      let p3;
      C(h3) ? h3._$external ? p3 = h3.shadowRoot.slot : d3 = true : (h3._$virtual && (d3 = true), p3 = _tt.findNearestNonVirtual(h3));
      let f3 = null;
      const g3 = (i4, r3) => {
        const l4 = i4 || (r3 ? _tt.findNearestNonVirtual(r3) : null);
        if (3 !== e3.getBackendMode() && !l4) return;
        let a4 = 0, c4 = null, h4 = null, p4 = null;
        if (t2) {
          const e4 = f3 || (3 === u3.mode ? u3.document.createDocumentFragment() : u3.createFragment());
          f3 = e4;
          const n4 = (t3) => {
            e4.appendChild(t3._$backendElement), h4 = e4;
          };
          _tt.forEachNodeInSpecificSlot(t2, r3, ((e5) => {
            p4 || (p4 = e5), e5._$virtual ? e5.forEachNonVirtualComposedChild(n4) : n4(e5);
          }));
        }
        if (3 !== e3.getBackendMode() || l4) {
          if ((n3 || d3) && (s3 && n3 ? (_tt.forEachSlotContentInSpecificSlot(n3, r3, ((e4) => {
            if (v(e4)) {
              const t3 = _tt.countNonVirtual(e4);
              t3 && (c4 || (c4 = t3[0]), a4 += t3[1]);
            } else c4 || (c4 = e4), a4 += 1;
            return true;
          })), 0 === a4 && h4 && p4 && (c4 = _tt._$findFirstNonVirtualSibling(void 0 === r3 ? t2 : p4, o3 + 1))) : h4 && p4 && (c4 = _tt._$findFirstNonVirtualSibling(void 0 === r3 ? t2 : p4, o3))), h4) if (c4) if (3 === u3.mode) {
            const e4 = c4._$backendElement;
            l4.insertBefore(h4, e4);
            for (let t3 = 1; t3 < a4; t3 += 1) {
              const t4 = e4.nextSibling;
              t4 && l4.removeChild(t4);
            }
            a4 > 0 && l4.removeChild(e4);
          } else l4.spliceBefore(c4._$backendElement, a4, h4);
          else 3 === u3.mode ? l4.appendChild(h4) : l4.spliceAppend(h4);
          else if (a4 > 0) if (3 === u3.mode) {
            const e4 = c4._$backendElement;
            for (let t3 = 1; t3 < a4; t3 += 1) {
              const t4 = e4.nextSibling;
              t4 && l4.removeChild(t4);
            }
            a4 > 0 && l4.removeChild(e4);
          } else l4.spliceRemove(c4._$backendElement, a4);
        } else f3 = null;
      };
      if (void 0 !== p3) null === p3 || (d3 || v(t2) && t2._$virtual || v(n3) && n3._$virtual ? g3(p3, void 0) : s3 ? t2 ? p3.replaceChild(t2._$backendElement, n3._$backendElement) : p3.removeChild(n3._$backendElement) : n3 ? p3.insertBefore(t2._$backendElement, n3._$backendElement) : p3.appendChild(t2._$backendElement));
      else if (t2 && t2._$inheritSlots || s3 && n3 && n3._$inheritSlots) {
        const e4 = /* @__PURE__ */ new Set();
        s3 && n3 && _tt.forEachSlotContentInSlot(n3, ((t3, n4) => {
          e4.add(n4);
        })), t2 && _tt.forEachSlotContentInSlot(t2, ((t3, n4) => {
          e4.add(n4);
        })), e4.forEach(((e5) => g3(null, e5)));
      } else t2 && g3(null, t2.containingSlot), !s3 || !n3 || t2 && n3.containingSlot === t2.containingSlot || g3(null, n3.containingSlot);
      3 !== u3.mode && f3 && f3.release(), r.writeExtraInfoToAttr && (s3 && v(n3) && (null === (i3 = n3._$backendElement) || void 0 === i3 || i3.removeAttribute("exparser:info-in-slot-of")), v(t2) && (C(e3) ? null === (l3 = t2._$backendElement) || void 0 === l3 || l3.setAttribute("exparser:info-in-slot-of", e3._$componentInstanceId) : null === (a3 = t2._$backendElement) || void 0 === a3 || a3.removeAttribute("exparser:info-in-slot-of")));
    }
    static _$updateSubtreeSlotsInsertion(e3, t2, n3, s3, o3) {
      if (!t2 || !n3) return;
      let i3 = e3, r3 = null, l3 = null;
      const a3 = (e4, t3) => {
        if (e4._$subtreeSlotStart) {
          const n5 = e4.childNodes;
          let s5 = t3 + 1, o4 = n5[s5];
          for (; o4 && !o4._$subtreeSlotStart; ) s5 += 1, o4 = n5[s5];
          return void (o4 ? (l3 = o4._$subtreeSlotStart, r3 = l3.prev) : (r3 = e4._$subtreeSlotEnd, r3 && (l3 = r3.next)));
        }
        let n4 = e4, s4 = e4.parentNode;
        for (; s4 && !s4._$subtreeSlotStart; ) n4 = s4, s4 = s4.parentNode;
        s4 && a3(s4, n4.parentIndex);
      };
      for (a3(i3, s3), r3 && (r3.next = t2, t2.prev = r3), l3 && (l3.prev = n3, n3.next = l3); i3; ) {
        let e4 = false;
        if (i3._$subtreeSlotStart ? i3._$subtreeSlotStart === l3 ? (i3._$subtreeSlotStart = t2, e4 = true) : i3._$subtreeSlotEnd === r3 && (i3._$subtreeSlotEnd = n3, e4 = true) : (i3._$subtreeSlotStart = t2, i3._$subtreeSlotEnd = n3, e4 = true), !e4 || !i3.parentNode) break;
        i3 = i3.parentNode;
      }
      const d3 = i3.ownerShadowRoot;
      (null == d3 ? void 0 : d3.isConnected(i3)) && d3._$applySlotsInsertion(t2, n3, o3);
    }
    static _$updateSubtreeSlotsRemoval(e3, t2, n3, s3) {
      if (!t2 || !n3) return;
      let o3 = e3;
      const i3 = t2.prev, r3 = n3.next;
      for (i3 && (i3.next = r3, t2.prev = null), r3 && (r3.prev = i3, n3.next = null); o3; ) {
        let e4 = false;
        if (o3._$subtreeSlotStart === t2 && o3._$subtreeSlotEnd === n3 && (o3._$subtreeSlotStart = o3._$subtreeSlotEnd = null, e4 = true), o3._$subtreeSlotStart === t2 ? (o3._$subtreeSlotStart = r3, e4 = true) : o3._$subtreeSlotEnd === n3 && (o3._$subtreeSlotEnd = i3, e4 = true), !e4 || !o3.parentNode) break;
        o3 = o3.parentNode;
      }
      const l3 = o3.ownerShadowRoot;
      (null == l3 ? void 0 : l3.isConnected(o3)) && l3._$applySlotsRemoval(t2, n3, s3);
    }
    static _$updateSubtreeSlotsReplacement(e3, t2, n3, s3, o3, i3, r3) {
      if (!t2 || !n3) return void _tt._$updateSubtreeSlotsRemoval(e3, s3, o3, r3);
      if (!s3 || !o3) return void _tt._$updateSubtreeSlotsInsertion(e3, t2, n3, i3, r3);
      let l3 = e3;
      const a3 = s3.prev, d3 = o3.next;
      for (a3 && (a3.next = t2, t2.prev = a3, s3.prev = null), d3 && (d3.prev = n3, n3.next = d3, o3.next = null); l3; ) {
        let e4 = false;
        if (l3._$subtreeSlotStart === s3 && (l3._$subtreeSlotStart = t2, e4 = true), l3._$subtreeSlotEnd === o3 && (l3._$subtreeSlotEnd = n3, e4 = true), !e4 || !l3.parentNode) break;
        l3 = l3.parentNode;
      }
      const c3 = l3.ownerShadowRoot;
      (null == c3 ? void 0 : c3.isConnected(l3)) && (c3._$applySlotsRemoval(s3, o3, false), c3._$applySlotsInsertion(t2, n3, r3));
    }
    static _$updateSubtreeSlotNodes(e3, t2, n3, s3, o3) {
      if (!n3 && !s3) return;
      const i3 = null == n3 ? void 0 : n3.getSlotMode(), r3 = null == s3 ? void 0 : s3.getSlotMode();
      if (!(void 0 !== i3 && 1 !== i3 || void 0 !== r3 && 1 !== r3)) {
        let e4 = -1, i4 = 0, r4 = -1;
        const l4 = [], a4 = t2[0].containingSlot, d4 = null == n3 ? void 0 : n3.getContainingSlot(t2[0]);
        for (let n4 = 0; n4 < t2.length; n4 += 1) {
          const s4 = t2[n4];
          _tt.forEachNodeInSlot(s4, ((t3) => {
            a4 && (i4 ? i4 += 1 : (e4 = t3.slotIndex, i4 = 1)), l4.push(t3);
          }));
        }
        if (d4 && l4.length) {
          const e5 = l4[0];
          r4 = _tt._$findSlotNodeInsertPosition(d4, e5, o3);
        }
        return { updateContainingSlot: () => {
          for (let e5 = l4.length - 1; e5 >= 0; e5 -= 1) {
            const t3 = l4[e5];
            _tt._$updateContainingSlot(t3, d4);
          }
        }, removeSlotNodes: () => {
          s3 && a4 && i4 && _tt._$spliceSlotNodes(a4, e4, i4, void 0);
        }, insertSlotNodes: () => {
          n3 && d4 && l4.length && _tt._$spliceSlotNodes(d4, r4, 0, l4);
        } };
      }
      const l3 = /* @__PURE__ */ new Map(), a3 = /* @__PURE__ */ new Map(), d3 = [];
      for (let e4 = 0; e4 < t2.length; e4 += 1) {
        const s4 = t2[e4];
        _tt.forEachNodeInSlot(s4, ((e5, t3) => {
          const s5 = null == n3 ? void 0 : n3.getContainingSlot(e5);
          if (t3) {
            const n4 = a3.get(t3);
            n4 ? n4.count += 1 : a3.set(t3, { start: e5.slotIndex, count: 1 });
          }
          if (s5) {
            const t4 = l3.get(s5);
            t4 ? t4.nodes.push(e5) : l3.set(s5, { nodes: [e5], insertPos: -1 });
          }
          d3.push([e5, s5]);
        }));
      }
      if (n3 && l3.size) {
        const e4 = l3.entries();
        for (let t3 = e4.next(); !t3.done; t3 = e4.next()) {
          const [e5, { nodes: n4 }] = t3.value, s4 = n4[0];
          t3.value[1].insertPos = _tt._$findSlotNodeInsertPosition(e5, s4, o3);
        }
      }
      return { updateContainingSlot: () => {
        for (let e4 = d3.length - 1; e4 >= 0; e4 -= 1) {
          const [t3, n4] = d3[e4];
          _tt._$updateContainingSlot(t3, n4);
        }
      }, removeSlotNodes: () => {
        if (s3 && a3.size) {
          const e4 = a3.entries();
          for (let t3 = e4.next(); !t3.done; t3 = e4.next()) {
            const [e5, { start: n4, count: s4 }] = t3.value;
            _tt._$spliceSlotNodes(e5, n4, s4, void 0);
          }
        }
      }, insertSlotNodes: () => {
        if (n3 && l3.size) {
          const e4 = l3.entries();
          for (let t3 = e4.next(); !t3.done; t3 = e4.next()) {
            const [e5, { nodes: n4, insertPos: s4 }] = t3.value;
            _tt._$spliceSlotNodes(e5, s4, 0, n4);
          }
        }
      } };
    }
    static insertChildSingleOperation(e3, t2, n3, s3) {
      var o3, i3, r3, l3, a3;
      if (t2 && e3.ownerShadowRoot !== t2.ownerShadowRoot) throw new Error("Cannot move the node from one shadow tree to another shadow tree.");
      let d3 = n3;
      const c3 = d3 >= 0 ? e3.childNodes[d3] : void 0;
      let h3, u3;
      if (h3 = !!s3 && (!!c3 && t2 !== c3), !h3 && !t2) return;
      if (t2) {
        if (u3 = t2.parentNode, u3) {
          const n4 = u3.childNodes, s4 = t2.parentIndex;
          n4.splice(s4, 1);
          for (let e4 = s4; e4 < n4.length; e4 += 1) n4[e4].parentIndex = e4;
          t2.parentIndex = -1, u3 === e3 && s4 < d3 && (d3 -= 1);
          const i4 = _tt._$updateSubtreeSlotNodes(e3, [t2], null, _tt._$getParentHostShadowRoot(u3), d3);
          null == i4 || i4.removeSlotNodes(), 3 === e3.getBackendMode() || (1 === e3.getBackendMode() ? null === (o3 = u3._$backendElement) || void 0 === o3 || o3.removeChild(t2._$backendElement, s4) : _tt.insertChildComposed(u3, null, t2, true, s4)), null == i4 || i4.updateContainingSlot();
        }
        t2.parentNode = e3, u3 !== e3 && (u3 && (null === (i3 = u3._$mutationObserverTarget) || void 0 === i3 || i3.detachChild(t2)), null === (r3 = e3._$mutationObserverTarget) || void 0 === r3 || r3.attachChild(t2));
      } else u3 = null;
      const p3 = _tt._$getParentHostShadowRoot(e3), f3 = t2 ? _tt._$updateSubtreeSlotNodes(e3, [t2], p3, null, d3) : null, g3 = c3 && h3 ? _tt._$updateSubtreeSlotNodes(e3, [c3], null, p3, d3) : null;
      if (null == f3 || f3.updateContainingSlot(), null == g3 || g3.removeSlotNodes(), 1 === e3.getBackendMode()) {
        if (e3._$backendElement) if (h3) t2 ? e3._$backendElement.replaceChild(t2._$backendElement, c3._$backendElement, d3) : e3._$backendElement.removeChild(c3._$backendElement, d3);
        else {
          const n4 = e3.childNodes[d3];
          n4 ? e3._$backendElement.insertBefore(t2._$backendElement, n4._$backendElement, d3) : e3._$backendElement.appendChild(t2._$backendElement);
        }
      } else _tt.insertChildComposed(e3, t2, c3, h3, d3);
      null == f3 || f3.insertSlotNodes(), null == g3 || g3.updateContainingSlot(), h3 && c3 && (v(c3) && (null === (l3 = e3._$mutationObserverTarget) || void 0 === l3 || l3.detachChild(c3)), c3.parentNode = null, c3.parentIndex = -1);
      const $3 = e3.childNodes;
      if (t2) if (d3 < 0) $3.push(t2), t2.parentIndex = $3.length - 1;
      else if (h3) $3[d3] = t2, t2.parentIndex = d3;
      else {
        $3.splice(d3, 0, t2);
        for (let e4 = d3; e4 < $3.length; e4 += 1) $3[e4].parentIndex = e4;
      }
      else if (h3) {
        $3.splice(d3, 1);
        for (let e4 = d3; e4 < $3.length; e4 += 1) $3[e4].parentIndex = e4;
      }
      const m3 = t2 ? t2._$subtreeSlotStart : null, _3 = t2 ? t2._$subtreeSlotEnd : null, b3 = c3 ? c3._$subtreeSlotStart : null, y3 = c3 ? c3._$subtreeSlotEnd : null;
      t2 ? (u3 && _tt._$updateSubtreeSlotsRemoval(u3, m3, _3, true), h3 ? _tt._$updateSubtreeSlotsReplacement(e3, m3, _3, b3, y3, d3, !!u3) : _tt._$updateSubtreeSlotsInsertion(e3, m3, _3, d3, !!u3)) : h3 && c3 && _tt._$updateSubtreeSlotsRemoval(e3, b3, y3, false), null === (a3 = e3.ownerShadowRoot) || void 0 === a3 || a3._$markIdCacheDirty(), h3 && (_tt.checkAndCallDetached(c3), _tt.checkChildObservers(e3, "remove", c3)), t2 && ((null == u3 ? void 0 : u3._$attached) ? e3._$attached ? _tt.checkAndCallMoved(t2) : _tt.checkAndCallDetached(t2) : e3._$attached && _tt.checkAndCallAttached(t2), u3 === e3 ? _tt.checkChildObservers(e3, "move", t2) : (u3 && _tt.checkChildObservers(u3, "remove", t2), _tt.checkChildObservers(e3, "add", t2)));
    }
    static insertChildBatchRemoval(e3, t2, n3) {
      var s3, o3;
      const i3 = e3.childNodes[t2];
      let r3 = e3;
      for (; null == r3 ? void 0 : r3._$inheritSlots; ) r3 = r3.parentNode;
      const l3 = C(r3) && !r3._$external ? r3.shadowRoot : null, a3 = e3.childNodes, d3 = a3.splice(t2, n3);
      for (let e4 = t2; e4 < a3.length; e4 += 1) a3[e4].parentIndex = e4;
      const c3 = _tt._$updateSubtreeSlotNodes(e3, d3, null, l3, t2);
      if (null == c3 || c3.removeSlotNodes(), 1 === e3.getBackendMode()) e3._$backendElement && e3._$backendElement.spliceRemove(i3._$backendElement, n3);
      else for (let t3 = n3 - 1; t3 >= 0; t3 -= 1) _tt.insertChildComposed(e3, null, d3[t3], true, t3);
      for (let t3 = 0; t3 < n3; t3 += 1) {
        const n4 = d3[t3];
        n4.parentNode = null, n4.parentIndex = -1, v(n4) && (null === (s3 = e3._$mutationObserverTarget) || void 0 === s3 || s3.detachChild(n4));
      }
      null == c3 || c3.updateContainingSlot();
      let h3 = null, u3 = null;
      for (let e4 = 0; e4 < n3; e4 += 1) {
        const t3 = d3[e4];
        h3 || (h3 = t3._$subtreeSlotStart), t3._$subtreeSlotEnd && (u3 = t3._$subtreeSlotEnd);
      }
      _tt._$updateSubtreeSlotsRemoval(e3, h3, u3, false), null === (o3 = e3.ownerShadowRoot) || void 0 === o3 || o3._$markIdCacheDirty();
      for (let t3 = 0; t3 < n3; t3 += 1) {
        const n4 = d3[t3];
        _tt.checkAndCallDetached(n4), _tt.checkChildObservers(e3, "remove", n4);
      }
    }
    static insertChildBatchInsertion(e3, t2, n3) {
      var s3, o3;
      const i3 = n3 >= 0 ? e3.childNodes[n3] : void 0, r3 = n3 >= 0 ? n3 : e3.childNodes.length;
      let l3 = e3;
      for (; null == l3 ? void 0 : l3._$inheritSlots; ) l3 = l3.parentNode;
      const a3 = C(l3) && !l3._$external ? l3.shadowRoot : null;
      let d3;
      if (1 === e3.getBackendMode() && t2.length >= 5) {
        d3 = e3.getBackendContext().createFragment();
      } else d3 = null;
      for (let n4 = 0; n4 < t2.length; n4 += 1) {
        const o4 = t2[n4];
        if (e3.ownerShadowRoot !== o4.ownerShadowRoot) throw new Error("Cannot move the node from one shadow tree to another shadow tree.");
        if (o4.parentNode) throw new Error("Cannot batch-insert the node which already has a parent.");
        if (o4.parentNode = e3, null === (s3 = e3._$mutationObserverTarget) || void 0 === s3 || s3.attachChild(o4), 1 === e3.getBackendMode() && d3) {
          const e4 = o4._$backendElement;
          d3.appendChild(e4);
        }
      }
      const c3 = _tt._$updateSubtreeSlotNodes(e3, t2, a3, null, n3);
      if (null == c3 || c3.updateContainingSlot(), 1 === e3.getBackendMode()) {
        if (e3._$backendElement) if (d3) i3 ? e3._$backendElement.spliceBefore(i3._$backendElement, 0, d3) : e3._$backendElement.spliceAppend(d3), d3.release();
        else if (i3) for (let n4 = 0; n4 < t2.length; n4 += 1) {
          const s4 = t2[n4];
          e3._$backendElement.insertBefore(s4._$backendElement, i3._$backendElement);
        }
        else for (let n4 = 0; n4 < t2.length; n4 += 1) {
          const s4 = t2[n4];
          e3._$backendElement.appendChild(s4._$backendElement);
        }
      } else {
        const s4 = n3 >= 0 ? n3 : e3.childNodes.length;
        for (let n4 = 0; n4 < t2.length; n4 += 1) {
          const o4 = t2[n4];
          _tt.insertChildComposed(e3, o4, i3, false, s4);
        }
      }
      null == c3 || c3.insertSlotNodes();
      const h3 = e3.childNodes;
      if (i3) {
        h3.splice(n3, 0, ...t2);
        for (let e4 = n3; e4 < h3.length; e4 += 1) h3[e4].parentIndex = e4;
      } else {
        h3.push(...t2);
        for (let e4 = h3.length - t2.length; e4 < h3.length; e4 += 1) h3[e4].parentIndex = e4;
      }
      let u3 = null, p3 = null;
      for (let e4 = 0; e4 < t2.length; e4 += 1) {
        const n4 = t2[e4], s4 = n4._$subtreeSlotStart, o4 = n4._$subtreeSlotEnd;
        s4 && (p3 ? (s4.prev = p3, p3.next = s4, p3 = o4) : (u3 = s4, p3 = o4));
      }
      _tt._$updateSubtreeSlotsInsertion(e3, u3, p3, r3 + t2.length - 1, false), null === (o3 = e3.ownerShadowRoot) || void 0 === o3 || o3._$markIdCacheDirty();
      for (let n4 = 0; n4 < t2.length; n4 += 1) {
        const s4 = t2[n4];
        e3._$attached && _tt.checkAndCallAttached(s4), _tt.checkChildObservers(e3, "add", s4);
      }
    }
    static insertChildPlaceholderReplace(e3, t2, n3) {
      var s3, o3, i3, r3, l3, a3, d3;
      if (n3 && e3.ownerShadowRoot !== n3.ownerShadowRoot) throw new Error("Cannot move the node from one shadow tree to another shadow tree.");
      if (n3.parentNode) throw new Error("Cannot replace with the node which already has a parent.");
      const c3 = e3.childNodes[t2];
      if (!v(c3)) throw new Error("Cannot replace on text nodes.");
      if (null !== c3._$slotName || null !== n3._$slotName) throw new Error("Cannot replace on slot nodes.");
      if (c3 === n3) return;
      let h3 = null;
      const u3 = c3.childNodes;
      if (1 === e3.getBackendMode() && u3.length > 0) {
        const e4 = c3._$backendElement;
        e4 && e4.spliceRemove(u3[0]._$backendElement, u3.length);
      }
      for (let t3 = 0; t3 < u3.length; t3 += 1) {
        const r4 = u3[t3];
        if (3 === e3.getBackendMode()) ;
        else if (1 === e3.getBackendMode()) {
          if (!h3) {
            const t5 = e3.getBackendContext();
            h3 = null !== (s3 = null == t5 ? void 0 : t5.createFragment()) && void 0 !== s3 ? s3 : null;
          }
          const t4 = r4._$backendElement;
          null == h3 || h3.appendChild(t4);
        } else _tt.insertChildComposed(c3, null, r4, true, t3);
        r4.parentNode = n3, null === (o3 = c3._$mutationObserverTarget) || void 0 === o3 || o3.detachChild(r4), null === (i3 = e3._$mutationObserverTarget) || void 0 === i3 || i3.attachChild(r4);
      }
      c3.childNodes = [], c3.parentNode = null, c3.parentIndex = -1, n3.parentNode = e3;
      const p3 = c3.containingSlot, f3 = c3.slotIndex;
      void 0 !== p3 && (_tt._$updateContainingSlot(n3, p3), p3 && _tt._$spliceSlotNodes(p3, f3, 1, void 0));
      const g3 = u3.length ? _tt._$updateSubtreeSlotNodes(n3, u3, _tt._$getParentHostShadowRoot(n3), _tt._$getParentHostShadowRoot(c3), 0) : null;
      if (null == g3 || g3.updateContainingSlot(), null == g3 || g3.removeSlotNodes(), e3.childNodes[t2] = n3, n3.parentIndex = t2, 1 === e3.getBackendMode()) e3._$backendElement && (e3._$backendElement.replaceChild(n3._$backendElement, c3._$backendElement, t2), h3 && (null === (r3 = n3._$backendElement) || void 0 === r3 || r3.spliceAppend(h3))), h3 && h3.release();
      else {
        _tt.insertChildComposed(e3, n3, c3, true, t2);
        for (let e4 = 0; e4 < u3.length; e4 += 1) {
          const t3 = u3[e4];
          _tt.insertChildComposed(n3, t3, void 0, false, e4);
        }
      }
      null == g3 || g3.insertSlotNodes(), void 0 !== p3 && (_tt._$updateContainingSlot(c3, void 0), p3 && _tt._$spliceSlotNodes(p3, f3, 0, [n3])), n3._$subtreeSlotStart = c3._$subtreeSlotStart, n3._$subtreeSlotEnd = c3._$subtreeSlotEnd, null === (l3 = e3._$mutationObserverTarget) || void 0 === l3 || l3.detachChild(c3), null === (a3 = e3._$mutationObserverTarget) || void 0 === a3 || a3.attachChild(n3), n3.childNodes.push(...u3);
      for (let e4 = n3.childNodes.length - u3.length; e4 < n3.childNodes.length; e4 += 1) n3.childNodes[e4].parentIndex = e4;
      if (null === (d3 = e3.ownerShadowRoot) || void 0 === d3 || d3._$markIdCacheDirty(), e3._$attached) {
        _tt.checkAndCallDetached(c3), _tt.checkChildObservers(e3, "remove", c3), _tt.checkAndCallAttached(n3), _tt.checkChildObservers(e3, "add", n3);
        for (let t3 = 0; t3 < u3.length; t3 += 1) {
          const n4 = u3[t3];
          _tt.checkAndCallMoved(n4), _tt.checkChildObservers(e3, "move", n4);
        }
      }
    }
    appendChild(e3) {
      _tt.insertChildSingleOperation(this, e3, this.childNodes.length, false);
    }
    insertChildAt(e3, t2) {
      _tt.insertChildSingleOperation(this, e3, t2, false);
    }
    insertBefore(e3, t2) {
      const n3 = t2 ? t2.parentIndex : -1;
      _tt.insertChildSingleOperation(this, e3, n3, false);
    }
    removeChildAt(e3) {
      _tt.insertChildSingleOperation(this, null, e3, true);
    }
    removeChild(e3) {
      const t2 = e3.parentIndex;
      _tt.insertChildSingleOperation(this, null, t2, true);
    }
    replaceChildAt(e3, t2) {
      _tt.insertChildSingleOperation(this, e3, t2, true);
    }
    replaceChild(e3, t2) {
      const n3 = t2.parentIndex;
      _tt.insertChildSingleOperation(this, e3, n3, true);
    }
    insertChildren(e3, t2) {
      _tt.insertChildBatchInsertion(this, e3, t2);
    }
    removeChildren(e3, t2) {
      _tt.insertChildBatchRemoval(this, e3, t2);
    }
    selfReplaceWith(e3) {
      const t2 = this.parentNode;
      t2 && _tt.insertChildPlaceholderReplace(t2, this.parentIndex, e3);
    }
    static _$generateIdMap(e3) {
      const t2 = /* @__PURE__ */ Object.create(null);
      return (function e4(n3) {
        if (v(n3)) {
          const s3 = n3._$nodeId;
          s3 && (t2[s3] || (t2[s3] = n3)), n3.childNodes.forEach(e4);
        }
      })(e3), t2;
    }
    triggerEvent(e3, t2, n3) {
      qe.triggerEvent(this, e3, t2, n3);
    }
    dispatchEvent(e3) {
      qe.dispatchEvent(this, e3);
    }
    _$setListenerStats(e3, t2, n3 = {}) {
      if (!this._$backendElement) return;
      const s3 = !!n3.capture || !!n3.useCapture;
      let o3;
      switch (t2) {
        case 2:
          o3 = 0;
          break;
        case 4:
          o3 = 1;
          break;
        case 3:
          o3 = 2;
          break;
        default:
          return;
      }
      this._$nodeTreeContext && (3 === this.getBackendMode() ? this._$nodeTreeContext.setListenerStats(this._$backendElement, e3, s3, o3) : this._$backendElement.setListenerStats(e3, s3, o3));
    }
    addListener(e3, t2, n3) {
      const s3 = this._$eventTarget.addListener(e3, t2, n3);
      this._$setListenerStats(e3, s3, n3), C(this) && this._$definition._$options.listenerChangeLifetimes && this.triggerLifetime("listenerChange", [true, e3, t2, n3]);
    }
    removeListener(e3, t2, n3) {
      const s3 = this._$eventTarget.removeListener(e3, t2, n3);
      1 !== s3 && (this._$setListenerStats(e3, s3, n3), C(this) && this._$definition._$options.listenerChangeLifetimes && this.triggerLifetime("listenerChange", [false, e3, t2, n3]));
    }
    getListeners() {
      return this._$eventTarget.getListeners();
    }
    getAttribute(e3) {
      return this._$nodeAttributes && Object.prototype.hasOwnProperty.call(this._$nodeAttributes, e3) ? this._$nodeAttributes[e3] : null;
    }
    updateAttribute(e3, t2) {
      this.setAttribute(e3, t2);
    }
    setAttribute(e3, t2) {
      let n3;
      this._$nodeAttributes ? n3 = this._$nodeAttributes : (n3 = /* @__PURE__ */ Object.create(null), this._$nodeAttributes = n3), n3[e3] = t2;
      const s3 = this._$backendElement;
      s3 && (3 === this.getBackendMode() ? false === t2 ? s3.removeAttribute(e3) : s3.setAttribute(e3, true === t2 || null == t2 ? "" : String(t2)) : s3.setAttribute(e3, t2)), this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "attribute", attributeName: e3 });
    }
    removeAttribute(e3) {
      this._$nodeAttributes && delete this._$nodeAttributes[e3];
      const t2 = this._$backendElement;
      t2 && t2.removeAttribute(e3), this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "attribute", attributeName: e3 });
    }
    setDataset(e3, t2) {
      this.dataset[e3] = t2, this._$backendElement && 1 === this.getBackendMode() && this._$backendElement.setDataset(e3, t2), this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "dataset", attributeName: `data:${e3}` });
    }
    setMark(e3, t2) {
      if (this._$marks) this._$marks[e3] = t2;
      else {
        const n3 = {};
        n3[e3] = t2, this._$marks = n3;
      }
      this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "mark", attributeName: `mark:${e3}` });
    }
    collectMarks() {
      const e3 = {};
      let t2;
      for (t2 = this; t2; t2 = t2.parentNode) {
        const n3 = t2._$marks;
        n3 && Object.keys(n3).forEach(((t3) => {
          Object.prototype.hasOwnProperty.call(e3, t3) || (e3[t3] = n3[t3]);
        }));
      }
      return e3;
    }
    static replaceDocumentElement(e3, t2, n3) {
      if (e3._$attached) throw new Error("An attached element cannot be attached again");
      e3._$backendElement && t2.replaceChild(e3._$backendElement, n3), _tt.checkAndCallAttached(e3);
    }
    static pretendAttached(e3) {
      e3._$attached || _tt.checkAndCallAttached(e3);
    }
    static pretendDetached(e3) {
      e3._$attached && _tt.checkAndCallDetached(e3);
    }
    static isAttached(e3) {
      return e3._$attached;
    }
    static setSlotName(e3, t2) {
      var n3;
      if (e3._$inheritSlots) throw new Error("Slot-inherit mode is not usable in slot element");
      const s3 = t2 ? String(t2) : "", o3 = e3._$slotName;
      if (o3 === s3) return;
      const i3 = null === o3;
      e3._$slotName = s3, i3 && (e3._$subtreeSlotStart = e3._$subtreeSlotEnd = { value: e3, prev: null, next: null }), 1 === e3.getBackendMode() && (null === (n3 = e3._$backendElement) || void 0 === n3 || n3.setSlotName(s3));
      const r3 = e3.ownerShadowRoot;
      if (r3) if (i3) {
        3 === r3.getSlotMode() && (e3._$slotValues = /* @__PURE__ */ Object.create(null)), e3.slotNodes = [];
        const t3 = e3.parentNode;
        t3 && _tt._$updateSubtreeSlotsInsertion(t3, e3._$subtreeSlotStart, e3._$subtreeSlotEnd, e3.parentIndex, false);
      } else r3.isConnected(e3) && r3._$applySlotRename(e3, s3, o3);
      e3._$mutationObserverTarget && Se.callAttrObservers(e3, { type: "properties", target: e3, nameType: "basic", attributeName: "name" });
    }
    static getSlotName(e3) {
      const t2 = e3._$slotName;
      return null === t2 ? void 0 : t2;
    }
    static setInheritSlots(e3) {
      if (!e3._$virtual) throw new Error("Cannot set slot-inherit on non-virtual node");
      if (null !== e3._$slotName || 0 !== e3.childNodes.length) throw new Error("Slot-inherit mode cannot be set when the element has any child node");
      if (1 === e3.getBackendMode()) {
        const t2 = e3._$backendElement;
        t2 && t2.setInheritSlots();
      }
      e3._$inheritSlots = true;
    }
    static getInheritSlots(e3) {
      return e3._$inheritSlots;
    }
    isInheritSlots() {
      return this._$inheritSlots;
    }
    static setSlotElement(e3, t2) {
      var n3;
      if (e3._$slotElement === t2) return;
      e3._$slotElement = t2, 1 === e3.ownerShadowRoot.getBackendMode() && (null === (n3 = e3._$backendElement) || void 0 === n3 || n3.setSlotElement(t2 ? t2.getBackendElement() : null));
      const s3 = _tt._$getParentHostShadowRoot(e3.parentNode);
      if (s3) {
        const t3 = _tt._$updateSubtreeSlotNodes(e3.parentNode, [e3], s3, s3, e3.parentIndex), n4 = e3.containingSlot;
        null == t3 || t3.updateContainingSlot(), null == t3 || t3.removeSlotNodes();
        const o3 = e3.containingSlot, i3 = (e4) => {
          if (v(e4) && e4._$inheritSlots) for (let t4 = 0; t4 < e4.childNodes.length; t4 += 1) i3(e4.childNodes[t4]);
          else _tt.insertChildReassign(e4.parentNode, e4, n4, o3, e4.parentIndex);
        };
        i3(e3), null == t3 || t3.insertSlotNodes();
      }
    }
    static getSlotElement(e3) {
      return e3._$slotElement;
    }
    static _$updateContainingSlot(e3, t2) {
      e3.containingSlot = t2;
    }
    static _$spliceSlotNodes(e3, t2, n3, s3) {
      const o3 = e3.slotNodes = e3.slotNodes || [], i3 = t2 >= 0 && t2 < o3.length;
      if (null == s3 ? void 0 : s3.length) if (i3) {
        for (let e4 = t2; e4 < t2 + n3; e4 += 1) o3[e4].slotIndex = void 0;
        o3.splice(t2, n3, ...s3);
        for (let e4 = t2; e4 < o3.length; e4 += 1) o3[e4].slotIndex = e4;
      } else {
        const e4 = o3.length;
        o3.push(...s3);
        for (let t3 = e4; t3 < o3.length; t3 += 1) o3[t3].slotIndex = t3;
      }
      else if (n3) {
        for (let e4 = t2; e4 < t2 + n3; e4 += 1) o3[e4].slotIndex = void 0;
        o3.splice(t2, n3);
        for (let e4 = t2; e4 < o3.length; e4 += 1) o3[e4].slotIndex = e4;
      }
    }
    static _$findSlotNodeInsertPosition(e3, t2, n3) {
      const s3 = e3.ownerShadowRoot.getHostNode(), o3 = (e4) => {
        let t3 = 0, n4 = e4;
        for (; n4 && n4 !== s3; ) t3 += 1, n4 = n4.parentNode;
        return t3;
      }, i3 = o3(t2), r3 = (e4, t3, n4, s4, o4, i4, l4) => {
        if (e4 === s4) return 0;
        if (e4.parentNode === s4.parentNode) return t3 - (-1 === o4 ? l4 : o4);
        if (i4 < n4) {
          const t4 = e4.parentNode;
          return r3(t4, t4.parentIndex, n4 - 1, s4, o4, i4, l4);
        }
        const a4 = n4 < i4 ? e4 : e4.parentNode, d3 = n4 < i4 ? n4 : n4 - 1, c3 = s4.parentNode, h3 = i4 - 1, u3 = r3(a4, a4.parentIndex, d3, c3, c3.parentIndex, h3, l4);
        return 0 === u3 ? -1 : u3;
      }, l3 = e3.slotNodes;
      let a3 = l3.length - 1;
      for (; a3 >= 0; a3 -= 1) {
        const e4 = l3[a3];
        if (r3(e4, e4.parentIndex, o3(e4), t2, t2.parentIndex, i3, n3 >= 0 ? n3 - 0.5 : l3.length) < 0) break;
      }
      return a3 + 1;
    }
    getComposedParent() {
      if (S(this)) return this.getHostNode();
      if (void 0 !== this.containingSlot) return this.containingSlot;
      let e3 = this.parentNode;
      for (; null == e3 ? void 0 : e3._$inheritSlots; ) e3 = e3.parentNode;
      return e3;
    }
    getComposedChildren() {
      const e3 = [];
      return this.forEachComposedChild(((t2) => {
        e3.push(t2);
      })), e3;
    }
    forEachComposedChild(e3) {
      if (this._$inheritSlots) return true;
      if (C(this) && !this._$external) return false !== e3(this.shadowRoot);
      if (null !== this._$slotName) {
        const t3 = this.ownerShadowRoot;
        return !t3 || t3.forEachNodeInSpecifiedSlot(this, e3);
      }
      const t2 = (n3) => {
        for (let s3 = 0; s3 < n3.length; s3 += 1) {
          const o3 = n3[s3];
          if (false === e3(o3)) return false;
          if (o3._$inheritSlots && !t2(o3.childNodes)) return false;
        }
        return true;
      };
      return t2(this.childNodes);
    }
    *iterateComposedChild() {
      if (this._$inheritSlots) return;
      if (C(this) && !this._$external) return void (yield this.shadowRoot);
      if (null !== this._$slotName) {
        if (!this.ownerShadowRoot) return;
        const e4 = this.slotNodes;
        for (let t2 = 0; t2 < e4.length; t2 += 1) yield e4[t2];
        return;
      }
      const e3 = function* (t2) {
        for (let n3 = 0; n3 < t2.length; n3 += 1) {
          const s3 = t2[n3];
          yield s3, s3._$inheritSlots && (yield* e3(s3.childNodes));
        }
      };
      yield* e3(this.childNodes);
    }
    forEachNonVirtualComposedChild(e3) {
      if (this._$inheritSlots) return true;
      const t2 = (t3) => t3._$virtual ? t3.forEachNonVirtualComposedChild(e3) : false !== e3(t3);
      if (C(this) && !this._$external) return t2(this.shadowRoot);
      if (null !== this._$slotName) {
        const e4 = this.ownerShadowRoot;
        return !e4 || e4.forEachSlotContentInSpecifiedSlot(this, t2);
      }
      const n3 = (e4) => {
        for (let s3 = 0; s3 < e4.length; s3 += 1) {
          const o3 = e4[s3];
          if (!t2(o3)) return false;
          if (o3._$inheritSlots && !n3(o3.childNodes)) return false;
        }
        return true;
      };
      return n3(this.childNodes);
    }
    static parseSelector(e3) {
      return new Ye(e3);
    }
    querySelector(e3) {
      return (e3 instanceof Ye ? e3 : new Ye(e3)).query(this, true);
    }
    querySelectorAll(e3) {
      return (e3 instanceof Ye ? e3 : new Ye(e3)).query(this, false);
    }
    static matchSelector(e3, t2) {
      return (e3 instanceof Ye ? e3 : new Ye(e3)).testSelector(null, t2);
    }
    matchSelector(e3, t2) {
      return (e3 instanceof Ye ? e3 : new Ye(e3)).testSelector(this, t2);
    }
    getBoundingClientRect(e3) {
      var t2;
      const n3 = this._$backendElement;
      if (n3) if (3 === this.getBackendMode()) {
        const s3 = n3, o3 = (null === (t2 = s3.getBoundingClientRect) || void 0 === t2 ? void 0 : t2.call(s3)) || { left: 0, top: 0, width: 0, height: 0 };
        setTimeout((() => {
          e3(o3);
        }), 0);
      } else {
        const t3 = n3;
        t3.getBoundingClientRect ? t3.getBoundingClientRect(e3) : setTimeout((() => {
          e3({ left: 0, top: 0, width: 0, height: 0 });
        }), 0);
      }
      else setTimeout((() => {
        e3({ left: 0, top: 0, width: 0, height: 0 });
      }), 0);
    }
    getScrollOffset(e3) {
      const t2 = this._$backendElement;
      if (t2) if (3 === this.getBackendMode()) {
        const n3 = t2, s3 = { scrollLeft: n3.scrollLeft || 0, scrollTop: n3.scrollTop || 0, scrollWidth: n3.scrollWidth || 0, scrollHeight: n3.scrollHeight || 0 };
        setTimeout((() => {
          e3(s3);
        }), 0);
      } else {
        const n3 = t2;
        n3.getScrollOffset ? n3.getScrollOffset(e3) : setTimeout((() => {
          e3({ scrollLeft: 0, scrollTop: 0, scrollWidth: 0, scrollHeight: 0 });
        }), 0);
      }
      else setTimeout((() => {
        e3({ scrollLeft: 0, scrollTop: 0, scrollWidth: 0, scrollHeight: 0 });
      }), 0);
    }
    createIntersectionObserver(e3, t2, n3, s3) {
      const o3 = this._$backendElement;
      if (o3) {
        if (e3 && !e3._$backendElement) return null;
        if (3 === this.getBackendMode()) {
          const i4 = this._$nodeTreeContext;
          return i4 && i4.createIntersectionObserver ? i4.createIntersectionObserver(o3, (null == e3 ? void 0 : e3._$backendElement) || null, t2, n3, s3) : null;
        }
        const i3 = o3;
        return i3.createIntersectionObserver ? i3.createIntersectionObserver((null == e3 ? void 0 : e3._$backendElement) || null, t2, n3, s3) : null;
      }
      return null;
    }
    createResizeObserver(e3, t2) {
      const n3 = this._$backendElement;
      if (n3) {
        if (3 === this.getBackendMode()) {
          const s4 = this._$nodeTreeContext;
          return s4 && s4.createResizeObserver ? s4.createResizeObserver(n3, e3, t2) : null;
        }
        const s3 = n3;
        return s3.createResizeObserver ? s3.createResizeObserver(e3, t2) : null;
      }
      return null;
    }
    getContext(e3) {
      const t2 = this._$backendElement;
      if (t2) if (3 === this.getBackendMode()) {
        const n3 = this._$nodeTreeContext;
        (null == n3 ? void 0 : n3.getContext) ? n3.getContext(t2, e3) : e3(null);
      } else {
        const n3 = t2;
        n3.getContext ? n3.getContext(e3) : e3(null);
      }
    }
  };
  var nt;
  tt.isElement = v, tt._$getParentHostShadowRoot = (e3) => {
    let t2 = e3;
    for (; null == t2 ? void 0 : t2._$inheritSlots; ) t2 = t2.parentNode;
    return C(t2) && !t2._$external ? t2.shadowRoot : null;
  }, tt.prototype[p] = true, (function(e3) {
    e3[e3.Ancestor = 0] = "Ancestor", e3[e3.Descendant = 1] = "Descendant", e3[e3.ParentNonVirtualNode = 2] = "ParentNonVirtualNode", e3[e3.ChildNonVirtualNode = 3] = "ChildNonVirtualNode", e3[e3.ParentComponent = 4] = "ParentComponent", e3[e3.ChildComponent = 5] = "ChildComponent";
  })(nt || (nt = {}));
  var st = (e3, t2, n3, s3) => {
    const o3 = (e4) => "function" == typeof e4 ? e4 : (void 0 !== e4 && R(`the "${n3}" relation listener is not a function (when preparing behavior "${t2}").`), null);
    let i3;
    if ("parent" === s3.type) i3 = 4;
    else if ("child" === s3.type) i3 = 5;
    else if ("parent-common-node" === s3.type) i3 = 2;
    else if ("child-common-node" === s3.type) i3 = 3;
    else if ("ancestor" === s3.type) i3 = 0;
    else {
      if ("descendant" !== s3.type) {
        const e4 = s3.type;
        return R(`the "${n3}" relation has an invalid relation type "${e4}" (when preparing behavior "${t2}").`), null;
      }
      i3 = 1;
    }
    let r3 = null;
    if (s3.target instanceof Pt) r3 = s3.target.behavior;
    else if (s3.target instanceof Vt || s3.target instanceof te) r3 = s3.target;
    else {
      const o4 = String(s3.target || n3), i4 = e3.getBehaviorByUrl(o4, t2);
      if (i4) r3 = i4;
      else {
        const t3 = e3.getGlobalUsingComponent(o4);
        r3 = "object" == typeof t3 && null !== t3 ? t3.behavior : o4;
      }
    }
    return r3 ? { target: r3, type: i3, linked: o3(s3.linked), linkChanged: o3(s3.linkChanged), unlinked: o3(s3.unlinked), linkFailed: o3(s3.linkFailed) } : (R(`the target of relation "${n3}" is not a valid behavior or component (when preparing behavior "${t2}").`), null);
  };
  var ot = class {
    constructor(e3, t2) {
      this._$comp = e3;
      const n3 = new Array(6);
      if (t2) for (let e4 = 0; e4 < 6; e4 += 1) {
        const s3 = t2.definitions[e4];
        if (s3) {
          const t3 = new Array(s3.length);
          for (let e5 = 0; e5 < s3.length; e5 += 1) t3[e5] = null;
          n3[e4] = t3;
        }
      }
      this._$group = t2, this._$sharedGroup = true, this._$links = n3;
    }
    add(e3) {
      if (this._$sharedGroup) {
        this._$sharedGroup = false;
        const e4 = this._$group;
        this._$group = e4 ? { definitions: e4.definitions.slice(), keyMap: Object.assign(/* @__PURE__ */ Object.create(null), e4.keyMap) } : { definitions: new Array(6), keyMap: /* @__PURE__ */ Object.create(null) };
      }
      const t2 = Symbol(""), n3 = this._$group.definitions, s3 = this._$group.keyMap, o3 = e3.type;
      n3[o3] ? (s3[t2] = [o3, n3[o3].length], n3[o3].push(e3)) : (s3[t2] = [o3, 0], n3[o3] = [e3]);
      const i3 = this._$links;
      return void 0 === i3[o3] ? i3[o3] = [null] : i3[o3].push(null), t2;
    }
    triggerLinkEvent(e3, t2) {
      var n3, s3;
      const o3 = this._$comp, i3 = this._$links, r3 = null === (n3 = this._$group) || void 0 === n3 ? void 0 : n3.definitions[e3];
      if (r3) for (let n4 = 0; n4 < r3.length; n4 += 1) {
        const l3 = i3[e3], a3 = l3[n4];
        let d3 = null;
        const c3 = r3[n4], u3 = c3.target;
        if (!t2) {
          let t3 = o3;
          for (; ; ) {
            const n5 = t3.parentNode;
            if (!n5) break;
            if (t3 = n5, !y(t3)) {
              if (C(t3)) {
                if (t3.hasBehavior(u3)) {
                  const n6 = t3._$relation;
                  if (n6) {
                    let o4;
                    o4 = 4 === e3 ? 5 : 0 === e3 ? 1 : 3;
                    const i4 = null === (s3 = n6._$group) || void 0 === s3 ? void 0 : s3.definitions[o4];
                    if (i4) {
                      for (let e4 = 0; e4 < i4.length; e4 += 1) {
                        const n7 = i4[e4];
                        if (n7.target && this._$comp.hasBehavior(n7.target)) {
                          d3 = { target: t3, def: n7 };
                          break;
                        }
                      }
                      if (d3) break;
                    }
                  }
                }
                if (4 === e3) break;
              }
              if (2 === e3) break;
            }
          }
        }
        if (l3[n4] = d3, a3) {
          const e4 = a3.target, t3 = a3.def;
          d3 && a3.target === d3.target && a3.def === d3.def ? (t3.linkChanged && h("Relation Link Changed Callback", t3.linkChanged, e4.getMethodCaller(), [o3.getMethodCaller()], e4), c3.linkChanged && h("Relation Link Changed Callback", c3.linkChanged, o3.getMethodCaller(), [e4.getMethodCaller()], o3)) : (t3.unlinked && h("Relation Unlinked Callback", t3.unlinked, e4.getMethodCaller(), [o3.getMethodCaller()], e4), c3.unlinked && h("Relation Unlinked Callback", c3.unlinked, o3.getMethodCaller(), [e4.getMethodCaller()], o3));
        }
        if (d3) {
          const e4 = d3.target, t3 = d3.def;
          a3 && a3.target === d3.target && a3.def === d3.def || (t3.linked && h("Relation Linked Callback", t3.linked, e4.getMethodCaller(), [o3.getMethodCaller()], e4), c3.linked && h("Relation Linked Callback", c3.linked, o3.getMethodCaller(), [e4.getMethodCaller()], o3));
        }
        t2 || d3 || !c3.linkFailed || h("Relation Link Failed Callback", c3.linkFailed, o3.getMethodCaller(), [], o3);
      }
    }
    getLinkedTargets(e3) {
      var t2, n3, s3, o3;
      const i3 = null === (t2 = this._$group) || void 0 === t2 ? void 0 : t2.keyMap[e3];
      if (!i3) return R(`no relation "${String(e3)}" found.`), [];
      const [r3, l3] = i3;
      if (4 === r3 || 2 === r3 || 0 === r3) {
        const e4 = null === (n3 = this._$links[r3]) || void 0 === n3 ? void 0 : n3[l3];
        return e4 ? [e4.target] : [];
      }
      const a3 = [], d3 = this._$comp, c3 = null === (o3 = null === (s3 = this._$group) || void 0 === s3 ? void 0 : s3.definitions[r3]) || void 0 === o3 ? void 0 : o3[l3], h3 = (e4) => {
        const t3 = e4.childNodes;
        for (let e5 = 0; e5 < t3.length; e5 += 1) {
          const n4 = t3[e5];
          if (v(n4)) if (y(n4)) h3(n4);
          else if (C(n4)) {
            if (n4._$relation) {
              let e6;
              if (e6 = 5 === r3 ? n4._$relation._$links[4] : 1 === r3 ? n4._$relation._$links[0] : n4._$relation._$links[2], e6) for (let t4 = 0; t4 < e6.length; t4 += 1) {
                const s4 = e6[t4];
                if (s4 && s4.target === d3 && s4.def === c3) {
                  a3.push(n4);
                  break;
                }
              }
            }
            1 === r3 && h3(n4);
          } else 5 !== r3 && 1 !== r3 || h3(n4);
        }
      };
      return h3(this._$comp), a3;
    }
  };
  var it = class _it extends tt {
    constructor() {
      throw new Error("Element cannot be constructed directly");
    }
    static create(e3, t2, n3, s3) {
      var o3, i3;
      const l3 = Object.create(_it.prototype);
      l3.stylingName = null != n3 ? n3 : e3;
      const a3 = t2.getBackendContext();
      let d3 = null;
      if (a3) if (3 === t2.getBackendMode()) d3 = a3.document.createElement(e3);
      else if (1 === t2.getBackendMode()) d3 = null !== (i3 = null === (o3 = t2._$backendShadowRoot) || void 0 === o3 ? void 0 : o3.createElement(e3, l3.stylingName)) && void 0 !== i3 ? i3 : null;
      else {
        d3 = a3.createElement(e3, l3.stylingName);
      }
      l3._$initialize(e3, false, d3, t2, t2._$nodeTreeContext), l3._$placeholderHandlerRemover = s3;
      const c3 = t2.getHostNode(), [h3, u3, p3] = c3.getStyleScopes();
      if (l3.classList = new Q(l3, void 0, c3.classList, null != h3 ? h3 : Z.globalScope(), null != u3 ? u3 : void 0, p3), d3) {
        if (2 === t2.getBackendMode() && d3.setStyleScope(null != h3 ? h3 : Z.globalScope(), null != u3 ? u3 : void 0), r.writeExtraInfoToAttr) {
          const e4 = p3.queryName(null != h3 ? h3 : Z.globalScope());
          e4 && d3.setAttribute("exparser:info-class-prefix", `${e4}--`);
        }
        d3.__wxElement = l3, 3 !== t2.getBackendMode() ? d3.associateValue(l3) : t2.getBackendContext().associateValue(d3, l3);
      }
      return l3;
    }
    setModelBindingListener(e3, t2) {
      if (this._$modelBindingListeners || (this._$modelBindingListeners = /* @__PURE__ */ Object.create(null)), !this._$modelBindingListeners[e3]) {
        const t3 = this.getBackendElement();
        if (t3) {
          const n3 = (t4) => {
            var n4;
            const s3 = null === (n4 = this._$modelBindingListeners) || void 0 === n4 ? void 0 : n4[e3];
            s3 && s3.call(this, t4);
          };
          3 === this.getBackendMode() ? this.getBackendContext().setModelBindingStat(t3, e3, n3) : t3.setModelBindingStat(e3, n3);
        }
      }
      this._$modelBindingListeners[e3] = t2;
    }
    getModelBindingListeners() {
      const e3 = /* @__PURE__ */ Object.create(null);
      return this._$modelBindingListeners && Object.keys(this._$modelBindingListeners).forEach(((t2) => {
        e3[t2] = (e4) => {
          var n3;
          const s3 = null === (n3 = this._$modelBindingListeners) || void 0 === n3 ? void 0 : n3[t2];
          s3 && s3.call(this, e4);
        };
      })), e3;
    }
  };
  it.isNativeNode = b, it.prototype[f] = true;
  var rt = class _rt {
    constructor(e3, t2) {
      var n3;
      this._$slotElement = null, this._$destroyOnRemoval = 0, this._$subtreeSlotStart = null, this._$subtreeSlotEnd = null, this._$mutationObserverTarget = null, this._$text = String(e3);
      let s3 = null;
      const o3 = t2.getBackendContext();
      if (o3) if (3 === t2.getBackendMode()) s3 = o3.document.createTextNode(e3);
      else if (1 === t2.getBackendMode()) {
        const o4 = t2._$backendShadowRoot;
        s3 = null !== (n3 = null == o4 ? void 0 : o4.createTextNode(e3)) && void 0 !== n3 ? n3 : null;
      } else {
        s3 = o3.createTextNode(e3);
      }
      this._$backendElement = s3, this.ownerShadowRoot = t2, this.parentNode = null, this.parentIndex = -1, this.containingSlot = void 0;
    }
    static create(e3, t2) {
      return new _rt(e3, t2);
    }
    asTextNode() {
      return this;
    }
    asElement() {
      return null;
    }
    asNativeNode() {
      return null;
    }
    asVirtualNode() {
      return null;
    }
    asShadowRoot() {
      return null;
    }
    asGeneralComponent() {
      return null;
    }
    asInstanceOf() {
      return null;
    }
    destroyBackendElement() {
      this._$backendElement && 3 !== this.ownerShadowRoot.getBackendMode() && this._$backendElement.release(), this.ownerShadowRoot._$nodeTreeContext.dropBackendAfterRelease && (this._$backendElement = null);
    }
    destroyBackendElementOnRemoval() {
      this._$destroyOnRemoval = 1;
    }
    cancelDestroyBackendElementOnRemoval() {
      this._$destroyOnRemoval = 0;
    }
    destroyBackendElementOnDetach() {
      this._$destroyOnRemoval = 1;
    }
    cancelDestroyBackendElementOnDetach() {
      this._$destroyOnRemoval = 0;
    }
    getBackendElement() {
      return this._$backendElement;
    }
    getBackendContext() {
      return this.ownerShadowRoot.getBackendContext();
    }
    getComposedParent() {
      if (void 0 !== this.containingSlot) return this.containingSlot;
      let e3 = this.parentNode;
      for (; null == e3 ? void 0 : e3._$inheritSlots; ) e3 = e3.parentNode;
      return e3;
    }
    get $$() {
      return this._$backendElement;
    }
    get textContent() {
      return this._$text;
    }
    set textContent(e3) {
      const t2 = String(e3);
      t2 !== this._$text && (this._$text = t2, this._$backendElement && (3 === this.ownerShadowRoot.getBackendMode() ? this._$backendElement.textContent = this._$text : this._$backendElement.setText(this._$text)), this._$mutationObserverTarget && Se.callTextObservers(this, { type: "characterData", target: this }));
    }
  };
  rt.isTextNode = _, rt.prototype[u] = true;
  var lt = class _lt extends tt {
    constructor() {
      throw new Error("Element cannot be constructed directly");
    }
    _$initializeVirtual(e3, t2, n3) {
      var s3;
      const o3 = String(e3);
      if (n3 && 1 === n3.mode) {
        const i3 = t2._$backendShadowRoot, r3 = null !== (s3 = null == i3 ? void 0 : i3.createVirtualNode(e3)) && void 0 !== s3 ? s3 : null;
        this._$initialize(o3, true, r3, t2, n3), r3 && (r3.__wxElement = this, r3.associateValue(this));
      } else this._$initialize(o3, true, null, t2, t2._$nodeTreeContext);
    }
    static create(e3, t2) {
      const n3 = Object.create(_lt.prototype);
      return n3._$initializeVirtual(e3, t2, t2.getBackendContext()), n3;
    }
  };
  var at;
  lt.isVirtualNode = y, lt.prototype[g] = true, (function(e3) {
    e3[e3.Single = 1] = "Single", e3[e3.Multiple = 2] = "Multiple", e3[e3.Dynamic = 3] = "Dynamic";
  })(at || (at = {}));
  var dt = class _dt extends lt {
    constructor() {
      throw new Error("Element cannot be constructed directly");
    }
    static createShadowRoot(e3) {
      const t2 = Object.create(_dt.prototype);
      let n3 = null;
      1 === e3.getBackendMode() && e3._$backendElement && (n3 = e3._$backendElement.getShadowRoot()), t2._$idMap = null;
      let s3 = 1;
      const o3 = e3.getComponentOptions();
      return o3.multipleSlots ? s3 = 2 : o3.dynamicSlots && (s3 = 3), t2._$slotMode = s3, 1 === s3 ? t2._$singleSlot = null : 2 === s3 ? (t2._$slots = /* @__PURE__ */ Object.create(null), t2._$slotsList = /* @__PURE__ */ Object.create(null)) : 3 === s3 && (t2._$dynamicSlotsInserted = false, t2._$propertyPassingDeepCopy = Ie(o3.propertyPassingDeepCopy), t2._$insertDynamicSlotHandler = void 0, t2._$removeDynamicSlotHandler = void 0, t2._$updateDynamicSlotHandler = void 0, t2._$updateDynamicSlotValueHandler = void 0), t2._$backendShadowRoot = n3, t2._$initialize("shadow", true, n3, t2, e3._$nodeTreeContext), t2._$host = e3, t2._$hooks = e3.getOwnerSpace().hooks, e3.shadowRoot = t2, n3 && (n3.__wxElement = t2, n3.associateValue(t2)), t2;
    }
    getHostNode() {
      return this._$host;
    }
    createTextNode(e3 = "") {
      return this._$hooks.createTextNode.call(this, ((e4) => new rt(e4, this)), e3);
    }
    createNativeNode(e3) {
      return this._$hooks.createNativeNode.call(this, ((e4, t2) => it.create(e4, this, t2)), e3, e3);
    }
    createVirtualNode(e3 = "virtual") {
      return lt.create(e3, this);
    }
    createNativeNodeWithInit(e3, t2, n3, s3) {
      const o3 = this._$hooks.createNativeNode.call(this, ((e4, t3) => it.create(e4, this, t3, n3)), e3, t2);
      return null == s3 || s3(o3), o3;
    }
    resolveComponent(e3, t2) {
      const n3 = this._$host, s3 = n3._$behavior, o3 = n3._$genericImpls, i3 = s3.ownerSpace, r3 = void 0 === t2 ? e3 : t2, l3 = [s3._$using[r3], o3 && o3[r3]];
      for (let e4 = 0; e4 < l3.length; e4 += 1) {
        const t3 = l3[e4];
        if (null != t3) {
          if ("string" == typeof t3) return { using: t3, waiting: void 0 };
          if (t3.final) return { using: t3.final, waiting: void 0 };
          if (null !== t3.placeholder) {
            return { using: Dt(t3.placeholder, i3, t3.source, o3), waiting: t3.waiting || void 0 };
          }
        }
      }
      let a3 = i3.getGlobalUsingComponent(r3);
      if (null === a3 && i3._$allowUnusedNativeNode && "" !== r3 && (a3 = r3), !a3) {
        if (a3 = i3.getDefaultComponent(), !a3) throw new M(`Cannot find component "${r3}"`, void 0, this._$host);
        R(`Cannot find component "${r3}", using default component.`, this._$host);
      }
      return { using: a3, waiting: void 0 };
    }
    createComponent(e3, t2, n3, s3, o3) {
      const { using: i3, waiting: r3 } = this.resolveComponent(e3, t2);
      let l3;
      if (r3) {
        const t3 = (t4) => {
          var i4;
          const r4 = this.createComponentByDef(e3, t4, n3, void 0, o3);
          r4.destroyBackendElementOnRemoval();
          const l4 = r4.getShadowRoot(), d3 = C(a3) ? a3.getShadowRoot() : null, c3 = 3 === (null == d3 ? void 0 : d3.getSlotMode()), h3 = 3 === (null == l4 ? void 0 : l4.getSlotMode());
          h3 !== c3 ? L(new Error(`The "dynamicSlots" option of component <${r4.is}> and its placeholder <${a3.is}> should be the same.`), "[render]", r4) : h3 ? null === (i4 = a3.parentNode) || void 0 === i4 || i4.replaceChild(r4, a3) : a3.selfReplaceWith(r4), null == s3 || s3(t4);
        };
        r3.add(t3), r3.hintUsed(this._$host), l3 = () => {
          r3.remove(t3);
        };
      }
      const a3 = this.createComponentByDef(e3, i3, n3, l3, o3);
      return a3;
    }
    createComponentByDef(e3, t2, n3, s3, o3) {
      const i3 = this._$host, r3 = i3._$behavior;
      return "string" == typeof t2 ? this.createNativeNodeWithInit(t2, e3, s3, o3) : this._$hooks.createComponent.call(this, ((e4, t3) => Ft._$advancedCreate(e4, t3, this, null, Bt(t3, r3, i3, n3), s3, o3)), e3, t2);
    }
    checkComponentPlaceholder(e3) {
      var t2;
      let n3;
      const s3 = this._$host._$behavior._$using[e3];
      if (void 0 !== s3) n3 = s3;
      else {
        const s4 = null === (t2 = this._$host._$genericImpls) || void 0 === t2 ? void 0 : t2[e3];
        if (!s4) return;
        n3 = s4;
      }
      return "string" != typeof n3 && (!n3.final && null !== n3.placeholder);
    }
    getElementById(e3) {
      return this._$getIdMap()[e3];
    }
    _$markIdCacheDirty() {
      this._$idMap = null;
    }
    _$getIdMap() {
      if (this._$idMap) return this._$idMap;
      const e3 = tt._$generateIdMap(this);
      return this._$idMap = e3, e3;
    }
    getSlotElementFromName(e3) {
      const t2 = this._$slotMode;
      if (1 === t2) return this._$singleSlot;
      if (2 === t2) return this._$slots[e3] || null;
      if (3 === t2) {
        const t3 = [];
        for (let n3 = this._$subtreeSlotStart; n3; n3 = n3.next) {
          const s3 = n3.value;
          (s3._$slotName || "") === e3 && t3.push(s3);
        }
        return t3;
      }
      return null;
    }
    getContainingSlot(e3) {
      var t2;
      const n3 = this._$slotMode;
      if (1 === n3) return this._$singleSlot;
      if (3 === n3) {
        if (!e3) return null;
        let n4 = e3;
        for (; null === (t2 = n4.parentNode) || void 0 === t2 ? void 0 : t2._$inheritSlots; ) n4 = n4.parentNode;
        const s3 = n4._$slotElement;
        if ((null == s3 ? void 0 : s3.ownerShadowRoot) === this) return s3;
      }
      if (2 === n3) {
        let t3;
        return t3 = v(e3) ? e3._$nodeSlot : "", this._$slots[t3] || null;
      }
      return null;
    }
    getSlotContentArray(e3) {
      if (null === e3._$slotName) return null;
      const t2 = [];
      return this.forEachNodeInSpecifiedSlot(e3, ((e4) => {
        t2.push(e4);
      })), t2;
    }
    forEachSlot(e3) {
      const t2 = this._$slotMode;
      if (1 === t2) this._$singleSlot && e3(this._$singleSlot);
      else if (2 === t2) {
        const t3 = Object.values(this._$slots);
        for (let n3 = 0; n3 < t3.length && false !== e3(t3[n3]); n3 += 1) ;
      } else if (3 === t2) for (let t3 = this._$subtreeSlotStart; t3 && false !== e3(t3.value); t3 = t3.next) ;
    }
    forEachNodeInSlot(e3) {
      const t2 = this._$host.childNodes;
      for (let n3 = 0; n3 < t2.length; n3 += 1) if (!tt.forEachNodeInSlot(t2[n3], e3)) return false;
      return true;
    }
    forEachNodeInSpecifiedSlot(e3, t2) {
      if (e3) {
        const n3 = e3.slotNodes;
        for (let e4 = 0; e4 < n3.length; e4 += 1) {
          const s3 = n3[e4];
          if (false === t2(s3)) return false;
        }
        return true;
      }
      return this.forEachNodeInSlot(((e4, n3) => null !== n3 || t2(e4)));
    }
    forEachSlotContentInSlot(e3) {
      const t2 = this._$host.childNodes;
      for (let n3 = 0; n3 < t2.length; n3 += 1) if (!tt.forEachSlotContentInSlot(t2[n3], e3)) return false;
      return true;
    }
    forEachSlotContentInSpecifiedSlot(e3, t2) {
      if (e3) {
        const n3 = e3.slotNodes;
        for (let e4 = 0; e4 < n3.length; e4 += 1) {
          const s3 = n3[e4];
          if (!s3._$inheritSlots && false === t2(s3)) return false;
        }
        return true;
      }
      return this.forEachSlotContentInSlot(((e4, n3) => null !== n3 || t2(e4)));
    }
    isConnected(e3) {
      if (e3.ownerShadowRoot !== this) return false;
      for (let t2 = e3; t2; t2 = t2.parentNode) if (t2 === this) return true;
      return false;
    }
    _$applyMultipleSlotInsertion(e3, t2, n3) {
      const s3 = this._$slotsList, o3 = this._$slots;
      if (s3[t2]) {
        const n4 = s3[t2];
        let o4 = { next: n4 }, i4 = true;
        for (let t3 = this._$subtreeSlotStart; t3 && o4.next && t3.value !== e3; t3 = t3.next) t3.value === o4.next.value && (i4 = false, o4 = o4.next);
        if (i4) s3[t2] = n4.prev = { value: e3, prev: null, next: n4 };
        else {
          const t3 = o4.next;
          o4.next = { value: e3, prev: o4, next: t3 }, t3 && (t3.prev = o4.next);
        }
      } else s3[t2] = { value: e3, prev: null, next: null };
      const i3 = o3[t2], r3 = s3[t2].value;
      i3 !== r3 && (o3[t2] = r3, tt._$insertChildReassignSlot(this, t2, i3 || null, r3));
    }
    _$applyMultipleSlotsRemoval(e3, t2, n3) {
      const s3 = this._$slotsList, o3 = this._$slots;
      let i3 = s3[t2] || null;
      for (; i3 && i3.value !== e3; i3 = i3.next) ;
      if (!i3) return;
      const r3 = i3.prev, l3 = i3.next;
      r3 && (r3.next = l3), l3 && (l3.prev = r3);
      if (!!r3) return;
      const a3 = l3;
      if (a3) {
        const i4 = a3.value;
        s3[t2] = a3, n3 || (o3[t2] = i4, tt._$insertChildReassignSlot(this, t2, e3, i4));
      } else delete s3[t2], n3 || (delete o3[t2], tt._$insertChildReassignSlot(this, t2, e3, null));
    }
    _$applySlotRename(e3, t2, n3) {
      const s3 = this._$slotMode;
      if (1 !== s3) {
        if (2 === s3) return this._$applyMultipleSlotsRemoval(e3, n3, false), void this._$applyMultipleSlotInsertion(e3, t2, false);
        if (3 === s3) {
          if (!this._$dynamicSlotsInserted) return;
          const n4 = this._$insertDynamicSlotHandler, s4 = this._$removeDynamicSlotHandler;
          null == s4 || s4([e3]), null == n4 || n4([{ slot: e3, name: t2, slotValues: e3._$slotValues }]);
        }
      }
    }
    _$applySlotsInsertion(e3, t2, n3) {
      const s3 = this._$slotMode;
      if (1 === s3) {
        const e4 = this._$singleSlot, t3 = this._$subtreeSlotStart.value;
        if (e4 === t3) return;
        return this._$singleSlot = t3, void tt._$insertChildReassignSlot(this, null, e4, t3);
      }
      if (2 !== s3) {
        if (3 === s3) {
          if (n3) return;
          if (!this._$dynamicSlotsInserted) return;
          const s4 = this._$insertDynamicSlotHandler, o3 = [];
          for (let n4 = e3; n4 && n4 !== t2.next; n4 = n4.next) {
            const e4 = n4.value, t3 = e4._$slotName;
            o3.push({ slot: e4, name: t3, slotValues: e4._$slotValues });
          }
          null == s4 || s4(o3);
        }
      } else for (let s4 = e3; s4 && s4 !== t2.next; s4 = s4.next) {
        const e4 = s4.value, t3 = e4._$slotName;
        this._$applyMultipleSlotInsertion(e4, t3, n3);
      }
    }
    _$applySlotsRemoval(e3, t2, n3) {
      var s3;
      const o3 = this._$slotMode;
      if (1 === o3) {
        if (n3) return;
        const e4 = this._$singleSlot, t3 = (null === (s3 = this._$subtreeSlotStart) || void 0 === s3 ? void 0 : s3.value) || null;
        if (e4 === t3) return;
        return this._$singleSlot = t3, void tt._$insertChildReassignSlot(this, null, e4, t3);
      }
      if (2 !== o3) {
        if (3 === o3) {
          if (n3) return;
          if (!this._$dynamicSlotsInserted) return;
          const s4 = this._$removeDynamicSlotHandler, o4 = [];
          for (let n4 = e3; n4 && n4 !== t2.next; n4 = n4.next) {
            const e4 = n4.value;
            o4.push(e4);
          }
          null == s4 || s4(o4);
        }
      } else for (let s4 = e3; s4 && s4 !== t2.next; s4 = s4.next) {
        const e4 = s4.value, t3 = e4._$slotName;
        this._$applyMultipleSlotsRemoval(e4, t3, n3);
      }
    }
    setDynamicSlotHandler(e3, t2, n3, s3) {
      3 === this._$slotMode && (this._$insertDynamicSlotHandler = e3, this._$removeDynamicSlotHandler = t2, this._$updateDynamicSlotHandler = n3, this._$updateDynamicSlotValueHandler = s3);
    }
    useDynamicSlotHandlerFrom(e3) {
      e3._$insertDynamicSlotHandler && this.setDynamicSlotHandler(e3._$insertDynamicSlotHandler, e3._$removeDynamicSlotHandler, e3._$updateDynamicSlotHandler, e3._$updateDynamicSlotValueHandler);
    }
    replaceSlotValue(e3, t2, n3) {
      var s3;
      const o3 = e3._$slotValues;
      if (!o3) return;
      const i3 = o3[t2];
      let r3 = n3;
      0 !== this._$propertyPassingDeepCopy && (r3 = 2 === this._$propertyPassingDeepCopy ? ve(n3, true) : _e(n3)), i3 !== r3 && (o3[t2] = r3, e3._$mutationObserverTarget && Se.callAttrObservers(e3, { type: "properties", target: e3, nameType: "slot-value", propertyName: t2 }), null === (s3 = this._$updateDynamicSlotValueHandler) || void 0 === s3 || s3.call(this, e3, t2));
    }
    applySlotValueUpdates(e3) {
      var t2;
      null === (t2 = this._$updateDynamicSlotHandler) || void 0 === t2 || t2.call(this, e3, e3._$slotValues);
    }
    applySlotUpdates() {
      var e3;
      if (this._$dynamicSlotsInserted) for (let t2 = this._$subtreeSlotStart; t2; t2 = t2.next) {
        const n3 = t2.value;
        null === (e3 = this._$updateDynamicSlotHandler) || void 0 === e3 || e3.call(this, n3, n3._$slotValues);
      }
      else {
        this._$dynamicSlotsInserted = true;
        const e4 = this._$insertDynamicSlotHandler, t2 = [];
        for (let e5 = this._$subtreeSlotStart; e5; e5 = e5.next) {
          const n3 = e5.value, s3 = n3._$slotName;
          t2.push({ slot: n3, name: s3, slotValues: n3._$slotValues });
        }
        t2.length && (null == e4 || e4(t2));
      }
    }
    getSlotMode() {
      return this._$slotMode;
    }
  };
  dt.isShadowRoot = S, dt.prototype[$] = true;
  var ct = class {
    constructor(e3, t2, n3, s3, o3) {
      this.ownerShadowRoot = s3, this.elem = n3, this.keyName = e3, this.updateKeys(t2);
      const i3 = this.items, r3 = this.indexes, l3 = [];
      for (let e4 = 0; e4 < i3.length; e4 += 1) {
        const t3 = i3[e4], n4 = null === r3 ? e4 : r3[e4];
        l3.push(o3(t3, n4));
      }
      n3.insertChildren(l3, -1);
    }
    updateKeys(e3) {
      let t2, n3;
      if (Array.isArray(e3)) t2 = e3, n3 = null;
      else if ("object" == typeof e3 && null !== e3) {
        const s4 = Object.keys(e3);
        t2 = new Array(s4.length), n3 = new Array(s4.length);
        for (let o4 = 0; o4 < s4.length; o4 += 1) {
          const i4 = s4[o4], r4 = e3[i4];
          t2[o4] = r4, n3[o4] = i4;
        }
      } else if ("string" == typeof e3) {
        R("Use string as for-list is generally for testing. Each character is treated as an item.", this.ownerShadowRoot.getHostNode(), this.elem), t2 = new Array(e3.length), n3 = null;
        for (let n4 = 0; n4 < e3.length; n4 += 1) t2[n4] = e3[n4];
      } else if ("number" == typeof e3) {
        R("Use number as for-list is generally for testing. The number is used as the repeated times of the item.", this.ownerShadowRoot.getHostNode(), this.elem);
        const s4 = Number.isSafeInteger(e3) && e3 >= 0 && e3 < Math.pow(2, 32) ? e3 : 0;
        t2 = new Array(s4), n3 = null;
        for (let e4 = 0; e4 < s4; e4 += 1) t2[e4] = e4;
      } else R(`The for-list data is neither Array nor Object, got type "${null === e3 ? "null" : typeof e3}".`, this.ownerShadowRoot.getHostNode(), this.elem), t2 = [], n3 = null;
      this.items = t2, this.indexes = n3;
      const s3 = this.keyName, o3 = new Array(t2.length), i3 = /* @__PURE__ */ Object.create(null);
      let r3;
      if (null !== s3) {
        for (let e4 = 0; e4 < t2.length; e4 += 1) {
          const n4 = t2[e4], l3 = "*this" === s3 ? n4 : null == n4 ? void 0 : n4[s3], a3 = null != l3 ? String(l3) : "";
          o3[e4] = a3, (null == r3 ? void 0 : r3[a3]) ? r3[a3].push(e4) : void 0 !== i3[a3] ? (r3 || (r3 = /* @__PURE__ */ Object.create(null)), r3[a3] = [i3[a3], e4]) : i3[a3] = e4;
        }
        if (r3) {
          const e4 = Object.keys(r3);
          R(`Some keys are not unique while list updates: "${e4.join('", "')}".`, this.ownerShadowRoot.getHostNode(), this.elem);
          for (let t3 = 0; t3 < e4.length; t3 += 1) {
            const n4 = e4[t3], s4 = r3[n4];
            let l3 = 0;
            for (let e5 = 1; e5 < s4.length; e5 += 1) {
              const t4 = s4[e5];
              for (; void 0 !== i3[`${n4}--${l3}`]; ) l3 += 1;
              const r4 = `${n4}--${l3}`;
              i3[r4] = t4, o3[t4] = r4;
            }
          }
        }
      }
      this.rawKeys = o3, this.keyMap = i3, this.sharedKeyMap = r3;
    }
    diff(e3, t2, n3, s3, o3) {
      const i3 = this.rawKeys, r3 = this.keyMap, l3 = this.sharedKeyMap, a3 = this.indexes;
      this.updateKeys(e3);
      const d3 = this.rawKeys, c3 = this.sharedKeyMap, h3 = this.items, u3 = this.indexes, p3 = this.keyName, f3 = "object" == typeof t2 && Array.isArray(Object.getPrototypeOf(t2));
      let g3, $3;
      if (true === t2) $3 = true, g3 = null === p3;
      else if (void 0 === t2) $3 = t2, g3 = true;
      else if (null === p3) $3 = true, g3 = true;
      else {
        let e4 = false;
        if (f3) e4 = true;
        else {
          const n4 = Object.keys(t2);
          for (let s4 = 0; s4 < n4.length; s4 += 1) {
            const o4 = t2[n4[s4]];
            if (true === o4 || ("*this" === p3 ? o4 : null == o4 ? void 0 : o4[p3])) {
              e4 = true;
              break;
            }
          }
        }
        if (e4) {
          $3 = new Array(d3.length);
          for (let e5 = 0; e5 < d3.length; e5 += 1) {
            const n4 = d3[e5];
            let s4 = false;
            if (l3 || c3) if (void 0 !== (null == l3 ? void 0 : l3[n4]) || void 0 !== (null == c3 ? void 0 : c3[n4])) s4 = true;
            else {
              const e6 = n4.lastIndexOf("--");
              if (e6 >= 0) {
                const t3 = n4.slice(0, e6);
                void 0 === (null == l3 ? void 0 : l3[t3]) && void 0 === (null == c3 ? void 0 : c3[t3]) || (s4 = true);
              }
            }
            if (s4) $3[e5] = true;
            else {
              const n5 = t2[e5];
              void 0 === n5 || (true === n5 || ("*this" === p3 ? n5 : null == n5 ? void 0 : n5[p3]) ? $3[e5] = true : $3[e5] = n5);
            }
          }
          g3 = false;
        } else $3 = t2, g3 = false;
      }
      if (g3) {
        let e4;
        e4 = !!f3 || t2;
        let r4 = 0;
        for (; r4 < i3.length && r4 < d3.length; ) {
          const t3 = h3[r4], s4 = null === u3 ? r4 : u3[r4], i4 = null === a3 ? r4 : a3[r4];
          o3(t3, s4, true === e4 || void 0 === e4 ? e4 : e4[s4], s4 !== i4, n3.childNodes[r4]), r4 += 1;
        }
        if (r4 < i3.length) n3.removeChildren(r4, i3.length - r4);
        else if (r4 < d3.length) {
          const e5 = [];
          for (; r4 < d3.length; r4 += 1) {
            const t3 = h3[r4], n4 = null === u3 ? r4 : u3[r4];
            e5.push(s3(t3, n4));
          }
          n3.insertChildren(e5, -1);
        }
        return;
      }
      const m3 = [], _3 = [], v3 = new Array(d3.length), b3 = new Array(d3.length);
      let y3 = -1, S3 = -1;
      for (let e4 = 0; e4 < d3.length; e4 += 1) {
        const t3 = d3[e4];
        if (i3[y3 + 1] === t3) {
          y3 += 1, S3 += 1, m3[S3] = y3, _3[S3] = e4, v3[e4] = S3 > 0 ? _3[S3 - 1] : -1, b3[e4] = y3;
          continue;
        }
        const n4 = r3[t3];
        if (void 0 === n4) {
          b3[e4] = -1;
          continue;
        }
        let s4 = 0, o4 = m3.length;
        for (; s4 < o4; ) {
          const e5 = Math.floor((s4 + o4) / 2);
          n4 < m3[e5] ? o4 = e5 : s4 = e5 + 1;
        }
        m3[o4] = n4, _3[o4] = e4, v3[e4] = o4 > 0 ? _3[o4 - 1] : -1, b3[e4] = n4, y3 = n4, S3 = o4;
      }
      const C3 = _3.length;
      if (C3 === d3.length && C3 === i3.length) {
        let e4 = 0;
        for (; e4 < i3.length && e4 < d3.length; ) {
          const t3 = h3[e4], s4 = null === u3 ? e4 : u3[e4], i4 = null === a3 ? e4 : a3[e4];
          o3(t3, s4, true === $3 || void 0 === $3 ? $3 : $3[e4], s4 !== i4, n3.childNodes[e4]), e4 += 1;
        }
        return;
      }
      let w3 = C3 > 0 ? _3[C3 - 1] : -1, N = C3;
      for (; -1 !== w3; ) N -= 1, m3[N] = w3, w3 = v3[w3];
      const E = m3;
      let k3;
      !(function(e4) {
        e4[e4.Stable = 0] = "Stable", e4[e4.ForwardMove = 1] = "ForwardMove", e4[e4.BackwardMove = 2] = "BackwardMove";
      })(k3 || (k3 = {}));
      const x3 = new Array(i3.length), O3 = new Array(d3.length);
      let L2 = -1;
      for (let e4 = 0; e4 < b3.length; e4 += 1) {
        const t3 = b3[e4];
        if (e4 !== E[N]) if (-1 !== t3) x3[t3] = t3 > L2 ? 2 : 1, O3[e4] = n3.childNodes[t3];
        else {
          const t4 = h3[e4], n4 = null === u3 ? e4 : u3[e4];
          O3[e4] = s3(t4, n4);
        }
        else L2 = t3, N += 1, x3[t3] = 0;
      }
      let R2 = 0, M3 = 0, A2 = 0;
      N = 0;
      do {
        const e4 = N < E.length ? E[N] : O3.length, t3 = N < E.length ? b3[e4] : x3.length;
        for (; M3 < t3; ) if (void 0 === x3[M3]) {
          const e5 = M3;
          M3 += 1;
          let s4 = 1;
          for (; M3 < t3 && void 0 === x3[M3]; ) M3 += 1, s4 += 1;
          n3.removeChildren(e5 + R2, s4), R2 -= s4;
        } else 2 === x3[M3] && (R2 -= 1), M3 += 1;
        for (; A2 < e4; ) {
          const s4 = O3[A2], i4 = b3[A2];
          if (-1 === i4) {
            const s5 = A2;
            A2 += 1;
            let o4 = 1;
            for (; A2 < e4 && -1 === b3[A2]; ) A2 += 1, o4 += 1;
            n3.insertChildren(O3.slice(s5, s5 + o4), t3 + R2), R2 += o4;
          } else {
            s4 && n3.insertChildAt(s4, t3 + R2);
            const e5 = h3[A2], r4 = null === u3 ? A2 : u3[A2], l4 = null === a3 ? i4 : a3[i4];
            o3(e5, r4, true === $3 || void 0 === $3 ? $3 : $3[A2], r4 !== l4, s4), 2 === x3[i4] && (R2 += 1), A2 += 1;
          }
        }
        if (N < E.length) {
          const s4 = h3[e4], i4 = null === u3 ? e4 : u3[e4], r4 = null === a3 ? t3 : a3[t3];
          o3(s4, i4, true === $3 || void 0 === $3 ? $3 : $3[e4], i4 !== r4, n3.childNodes[t3 + R2]);
        }
        M3 = t3 + 1, A2 = e4 + 1, N += 1;
      } while (N <= E.length);
    }
  };
  var ht = (e3) => e3;
  var ut = (e3, t2, n3) => (t3) => {
    var s3;
    return n3.call(null === (s3 = e3.ownerShadowRoot) || void 0 === s3 ? void 0 : s3.getHostNode().getMethodCaller(), t3);
  };
  var pt = (e3) => {
    const t2 = e3;
    return t2._$wxTmplArgs = t2._$wxTmplArgs || {};
  };
  var ft = (e3) => null == e3 ? "" : String(e3);
  var gt = (e3) => e3.replace(/-(.|$)/g, ((e4) => e4[1] ? e4[1].toUpperCase() : ""));
  var $t = (e3) => e3.replace(/[A-Z]/g, ((e4) => `-${e4.toLowerCase()}`));
  var mt = class {
    constructor(e3, t2, n3) {
      this.bindingMapDisabled = false, this.changePropFilter = ht, this.eventListenerWrapper = ut, this.s = (e4, t3) => {
        e4.slot = t3, this.tryCallPropertyChangeListener(e4, "slot", t3);
      }, this.l = (e4, t3, n4, s3) => {
        var o3;
        3 === this.shadowRoot.getSlotMode() ? this.shadowRoot.replaceSlotValue(e4, t3, n4) : this.checkFallbackEventListener(e4, t3, n4, s3) || R(`"${t3}" is not a valid event binding or slot value`, null === (o3 = e4.ownerShadowRoot) || void 0 === o3 ? void 0 : o3.getHostNode(), e4), this.tryCallPropertyChangeListener(e4, t3, n4);
      }, this.i = (e4, t3) => {
        e4.id = t3, this.tryCallPropertyChangeListener(e4, "id", t3);
      }, this.c = (e4, t3) => {
        if (C(e4)) {
          e4.hasExternalClass("class") && e4.setExternalClass("class", t3);
        }
        e4.setNodeClass(t3), this.tryCallPropertyChangeListener(e4, "class", t3);
      }, this.e = (e4, t3) => {
        const n4 = pt(e4);
        n4.staticClasses || (n4.staticClasses = new Array(t3.length));
        const s3 = n4.staticClasses;
        for (let e5 = 0; e5 < t3.length; e5 += 1) {
          const n5 = t3[e5];
          "string" == typeof n5 && (s3[e5] = n5);
        }
        this.applyClassListUpdates(e4);
      }, this.ei = (e4, t3, n4) => {
        const s3 = pt(e4);
        s3.staticClasses || (s3.staticClasses = []);
        s3.staticClasses[t3] = n4, s3.staticClassesDirty = true;
      }, this.y = (e4, t3) => {
        C(e4) && Ft.getDataProxy(e4).replaceProperty("style", t3) || e4.setNodeStyle(ft(t3), 0), this.tryCallPropertyChangeListener(e4, "style", t3);
      }, this.w = (e4, t3) => {
        const n4 = pt(e4);
        n4.styleNameValues || (n4.styleNameValues = new Array(t3.length));
        const s3 = n4.styleNameValues;
        for (let e5 = 0; e5 < t3.length; e5 += 2) {
          const n5 = t3[e5 + 1];
          "string" == typeof n5 && (s3[e5] = t3[e5], s3[e5 + 1] = n5);
        }
        this.applyStyleListUpdates(e4);
      }, this.wi = (e4, t3, n4) => {
        const s3 = pt(e4);
        s3.styleNameValues || (s3.styleNameValues = []);
        s3.styleNameValues[2 * t3 + 1] = n4, s3.styleNameValuesDirty = true;
      }, this.d = (e4, t3, n4, s3) => {
        if (s3 && C(e4)) {
          const s4 = Ft.getDataProxy(e4), o3 = `data${t3[0].toUpperCase()}${t3.slice(1)}`;
          if (s4.replaceProperty(o3, n4)) ;
          else {
            const o4 = `data-${$t(t3)}`;
            e4.hasExternalClass(o4) ? e4.setExternalClass(o4, n4) : s4.replaceProperty(o4, n4) || (e4.setDataset(t3, n4), e4.setAttribute(o4, n4));
          }
          this.tryCallPropertyChangeListener(e4, t3, n4);
        } else if (e4.setDataset(t3, n4), s3) {
          const s4 = `data-${$t(t3)}`;
          e4.setAttribute(s4, n4);
        }
      }, this.m = (e4, t3, n4) => {
        e4.setMark(t3, n4);
      }, this.v = (e4, t3, n4, s3, o3, i3, r3, l3) => {
        const a3 = "function" == typeof n4 ? n4 : ft(n4), d3 = this.eventListenerWrapper(e4, t3, (function(...t4) {
          const n5 = e4.ownerShadowRoot.getHostNode(), s4 = "function" == typeof a3 ? a3 : Ft.getMethod(n5, a3);
          if ("function" == typeof s4) return s4.call(this, ...t4);
        }), s3, o3, i3, l3);
        d3 && Object.defineProperty(d3, "name", { value: "string" == typeof a3 ? a3 : a3.name });
        const c3 = { final: s3, mutated: o3, capture: i3 };
        if (r3) {
          const n5 = pt(e4);
          n5.dynEvListeners || (n5.dynEvListeners = {});
          const s4 = n5.dynEvListeners;
          s4[t3] && e4.removeListener(t3, s4[t3], c3), s4[t3] = d3;
        }
        a3 && d3 && e4.addListener(t3, d3, c3);
      }, this.r = (e4, t3, n4, s3, o3) => {
        var i3;
        if (C(e4)) {
          const r3 = Ft.getDataProxy(e4), l3 = gt(t3);
          r3.replaceProperty(l3, n4) ? void 0 !== s3 && (null === s3 ? r3.setModelBindingListener(l3, (() => {
          })) : r3.setModelBindingListener(l3, ((t4) => {
            const n5 = e4.ownerShadowRoot.getHostNode(), o4 = Ft.getDataProxy(n5);
            o4.replaceDataOnPath(s3, t4), o4.applyDataUpdates(false);
          }))) : e4.hasExternalClass(t3) ? e4.setExternalClass(t3, n4) : this.checkFallbackEventListener(e4, l3, n4, o3) || R(`"${l3}" is not a valid property`, null === (i3 = e4.ownerShadowRoot) || void 0 === i3 ? void 0 : i3.getHostNode(), e4);
        } else if (b(e4)) {
          if (this.fallbackListenerOnNativeNode) {
            const s4 = gt(t3);
            this.checkFallbackEventListener(e4, s4, n4, o3) || e4.updateAttribute(t3, n4);
          } else e4.updateAttribute(t3, n4);
          s3 && e4.setModelBindingListener(t3, ((t4) => {
            const n5 = e4.ownerShadowRoot.getHostNode(), o4 = Ft.getDataProxy(n5);
            o4.replaceDataOnPath(s3, t4), o4.applyDataUpdates(false);
          }));
        }
        this.tryCallPropertyChangeListener(e4, t3, n4);
      }, this.a = (e4, t3, n4) => {
        e4.updateAttribute(t3, n4), this.tryCallPropertyChangeListener(e4, t3, n4);
      }, this.wl = (e4, t3, n4) => {
        C(e4) && e4.triggerWorkletChangeLifetime(t3, n4);
      }, this.p = (e4, t3, n4, s3) => {
        const o3 = pt(e4);
        o3.changeProp || (o3.changeProp = /* @__PURE__ */ Object.create(null)), o3.changeProp[t3] = { listener: this.changePropFilter(n4, s3, e4, t3), oldValue: void 0 };
      }, this.shadowRoot = e3, this.procGen = t2, this.fallbackListenerOnNativeNode = n3;
    }
    create(e3) {
      const { shadowRoot: t2, procGen: n3 } = this, s3 = n3(this, true, e3);
      return this.handleChildrenCreationAndInsert(s3.C, t2, void 0, void 0), s3.B;
    }
    update(e3, t2, n3) {
      const { shadowRoot: s3, procGen: o3 } = this, i3 = o3(this, false, e3, t2, n3);
      return this.handleChildrenUpdate(i3.C, s3, void 0, void 0), i3.B;
    }
    endBindingMapUpdateForElement(e3) {
      const t2 = e3._$wxTmplArgs;
      if (t2 && (t2.staticClassesDirty && (t2.staticClassesDirty = false, this.applyClassListUpdates(e3)), t2.styleNameValuesDirty && (t2.styleNameValuesDirty = false, this.applyStyleListUpdates(e3))), C(e3) && e3.hasPendingChanges()) {
        Ft.getDataProxy(e3).applyDataUpdates(true);
      }
    }
    bindingMapUpdate(e3, t2, n3) {
      if (this.bindingMapDisabled) return false;
      const s3 = n3[e3];
      if (!s3) return false;
      let o3 = null;
      for (let e4 = 0; e4 < s3.length; e4 += 1) {
        (0, s3[e4])(t2, ((e5) => {
          null !== o3 && e5 !== o3 && this.endBindingMapUpdateForElement(o3), o3 = e5;
        }), ((e5, t3) => {
          e5.textContent = t3;
        }));
      }
      const i3 = o3;
      return null !== i3 && this.endBindingMapUpdateForElement(i3), true;
    }
    handleChildrenCreation(e3, t2, n3) {
      const s3 = [];
      return e3(true, ((e4, o3) => {
        if (t2 && "" !== n3) {
          const e5 = this.createDynamicPlaceholder(t2);
          return void s3.push(e5);
        }
        const i3 = this.shadowRoot.createTextNode(e4);
        i3.destroyBackendElementOnRemoval(), t2 && tt.setSlotElement(i3, t2), o3 && o3(i3), s3.push(i3);
      }), ((e4, o3, i3, r3, l3, a3) => {
        if (t2 && n3 !== (l3 || "")) {
          const e5 = this.createDynamicPlaceholder(t2);
          return void s3.push(e5);
        }
        const d3 = this.createCommonElement(e4, o3, i3, r3, a3);
        if (t2) {
          tt.setSlotElement(d3, t2);
          pt(d3).dynamicSlotNameMatched = true;
        } else void 0 !== l3 && (d3.slot = l3);
        s3.push(d3);
      }), ((e4, o3) => {
        const i3 = this.shadowRoot.createVirtualNode("wx:if");
        i3.destroyBackendElementOnRemoval(), tt.setInheritSlots(i3), t2 && tt.setSlotElement(i3, t2);
        pt(i3).key = e4, this.handleChildrenCreationAndInsert(o3, i3, t2, n3), s3.push(i3);
      }), ((e4, o3, i3, r3, l3) => {
        const a3 = this.shadowRoot, d3 = a3.createVirtualNode("wx:for");
        d3.destroyBackendElementOnRemoval(), tt.setInheritSlots(d3), t2 && tt.setSlotElement(d3, t2);
        pt(d3).keyList = new ct(o3, e4, d3, a3, ((e5, s4) => {
          const o4 = a3.createVirtualNode("wx:for-item");
          return o4.destroyBackendElementOnRemoval(), tt.setInheritSlots(o4), t2 && tt.setSlotElement(d3, t2), this.handleChildrenCreationAndInsert(((t3, n4, o5, i4, a4, d4, c3) => {
            l3(true, e5, s4, void 0, void 0, r3 ? [...r3, s4] : null, n4, o5, i4, a4, d4, c3);
          }), o4, t2, n3), o4;
        })), s3.push(d3);
      }), ((e4, n4, o3) => {
        const i3 = this.shadowRoot.createVirtualNode("slot");
        i3.destroyBackendElementOnRemoval(), tt.setSlotName(i3, ft(e4)), t2 ? tt.setSlotElement(i3, t2) : void 0 !== o3 && (i3.slot = o3), n4 && n4(i3), s3.push(i3);
      }), ((e4, o3) => {
        if (void 0 !== o3) if (t2) if (n3 === o3) {
          const n4 = this.shadowRoot.createVirtualNode("virtual");
          n4.destroyBackendElementOnRemoval(), tt.setSlotElement(n4, t2);
          pt(n4).dynamicSlotNameMatched = true, this.handleChildrenCreationAndInsert(e4, n4, void 0, void 0), s3.push(n4);
        } else {
          const e5 = this.createDynamicPlaceholder(t2);
          s3.push(e5);
        }
        else {
          const t3 = this.shadowRoot.createVirtualNode("virtual");
          t3.destroyBackendElementOnRemoval(), t3.slot = o3, this.handleChildrenCreationAndInsert(e4, t3, void 0, void 0), s3.push(t3);
        }
        else {
          const o4 = this.shadowRoot.createVirtualNode("virtual");
          o4.destroyBackendElementOnRemoval(), tt.setInheritSlots(o4), t2 && tt.setSlotElement(o4, t2), this.handleChildrenCreationAndInsert(e4, o4, t2, n3), s3.push(o4);
        }
      }), void 0, void 0), s3;
    }
    handleChildrenCreationAndInsert(e3, t2, n3, s3) {
      const o3 = this.handleChildrenCreation(e3, n3, s3);
      o3.length && t2.insertChildren(o3, -1);
    }
    handleChildrenUpdate(e3, t2, n3, s3) {
      let o3 = 0;
      const i3 = n3 ? n3.slotNodes.filter(((e4) => e4.parentNode === t2)) : t2.childNodes;
      e3(false, ((e4) => {
        const t3 = i3[o3];
        if (o3 += 1, t3) {
          if (n3) {
            if (!pt(t3).dynamicSlotNameMatched) return;
          }
          void 0 !== e4 && (t3.textContent = e4);
        }
      }), ((e4, r3, l3, a3, d3, c3) => {
        const h3 = i3[o3];
        if (o3 += 1, !h3) return;
        const u3 = pt(h3);
        if (n3) {
          if (s3 !== (d3 || "")) {
            if (u3.dynamicSlotNameMatched) {
              const e5 = this.createDynamicPlaceholder(n3);
              t2.replaceChild(e5, h3);
            }
            return;
          }
          if (!u3.dynamicSlotNameMatched) {
            const s4 = this.createCommonElement(e4, r3, l3, a3, c3);
            tt.setSlotElement(s4, n3);
            return pt(s4).dynamicSlotNameMatched = true, void t2.replaceChild(s4, h3);
          }
        }
        l3(h3, false);
        let p3 = false;
        if (C(h3)) {
          const e5 = this.dynamicSlotUpdate(h3, c3, a3);
          if (e5 && (p3 = true), h3.hasPendingChanges()) {
            Ft.getDataProxy(h3).applyDataUpdates(true);
          }
          e5 && (e5.forEachSlot(((e6) => {
            pt(e6).dynamicSlotValueUpdatePathTree = /* @__PURE__ */ Object.create(null);
          })), e5.applySlotUpdates());
        }
        n3 || void 0 !== d3 && (h3.slot = d3), p3 || this.handleChildrenUpdate(a3, h3, void 0, void 0), u3.updateInitPropValues && u3.updateInitPropValues(this.getInitPropValuesCallback(l3, a3, c3));
      }), ((e4, r3) => {
        const l3 = i3[o3];
        if (o3 += 1, !l3) return;
        const a3 = pt(l3);
        if (a3.key === e4) this.handleChildrenUpdate(r3, l3, n3, s3);
        else {
          const i4 = this.shadowRoot.createVirtualNode("wx:if");
          i4.destroyBackendElementOnRemoval(), tt.setInheritSlots(i4), n3 && tt.setSlotElement(i4, n3);
          const d3 = pt(i4);
          a3.key = d3.key = e4, this.handleChildrenCreationAndInsert(r3, i4, n3, s3), n3 ? t2.replaceChild(i4, l3) : t2.replaceChildAt(i4, o3 - 1);
        }
      }), ((e4, t3, r3, l3, a3) => {
        const d3 = i3[o3];
        if (o3 += 1, !d3) return;
        pt(d3).keyList.diff(e4, r3, d3, ((e5, t4) => {
          const o4 = this.shadowRoot.createVirtualNode("wx:for-item");
          return o4.destroyBackendElementOnRemoval(), tt.setInheritSlots(o4), n3 && tt.setSlotElement(d3, n3), this.handleChildrenCreationAndInsert(((n4, s4, o5, i4, r4, d4, c3) => {
            a3(true, e5, t4, void 0, void 0, l3 ? [...l3, t4] : null, s4, o5, i4, r4, d4, c3);
          }), o4, n3, s3), o4;
        }), ((e5, t4, o4, i4, r4) => {
          r4 && this.handleChildrenUpdate(((n4, s4, r5, d4, c3, h3, u3) => {
            a3(false, e5, t4, o4, !!i4 || void 0, l3 ? [...l3, t4] : null, s4, r5, d4, c3, h3, u3);
          }), r4, n3, s3);
        }));
      }), ((e4, t3, s4) => {
        const r3 = i3[o3];
        o3 += 1, r3 && (void 0 !== e4 && tt.setSlotName(r3, ft(e4)), n3 || void 0 !== s4 && (r3.slot = s4), t3 && t3(r3), this.shadowRoot.applySlotValueUpdates(r3));
      }), ((e4, r3) => {
        const l3 = i3[o3];
        if (o3 += 1, l3) if (void 0 !== r3) if (n3) {
          const o4 = pt(l3);
          if (s3 === r3) if (o4.dynamicSlotNameMatched) this.handleChildrenUpdate(e4, l3, void 0, void 0);
          else {
            const s4 = this.shadowRoot.createVirtualNode("virtual");
            s4.destroyBackendElementOnRemoval(), tt.setSlotElement(s4, n3);
            pt(s4).dynamicSlotNameMatched = true, this.handleChildrenCreationAndInsert(e4, s4, void 0, void 0), t2.replaceChild(s4, l3);
          }
          else if (o4.dynamicSlotNameMatched) {
            const e5 = this.createDynamicPlaceholder(n3);
            t2.replaceChild(e5, l3);
          }
        } else l3.slot = r3, this.handleChildrenUpdate(e4, l3, void 0, void 0);
        else this.handleChildrenUpdate(e4, l3, n3, s3);
      }), void 0, void 0);
    }
    dynamicSlotUpdate(e3, t2, n3) {
      const s3 = e3.getShadowRoot();
      return 3 === (null == s3 ? void 0 : s3.getSlotMode()) ? (s3.setDynamicSlotHandler(((s4) => {
        const o3 = [];
        for (let e4 = 0; e4 < s4.length; e4 += 1) {
          const { slot: i3, name: r3, slotValues: l3 } = s4[e4], a3 = pt(i3);
          a3.dynamicSlotValueNames = t2, a3.dynamicSlotValueUpdatePathTree = void 0;
          const d3 = this.handleChildrenCreation(((e5, t3, s5, o4, i4, r4, a4) => {
            n3(true, t3, s5, o4, i4, r4, a4, l3, void 0);
          }), i3, r3);
          o3.push(...d3);
        }
        o3.length && e3.insertChildren(o3, -1);
      }), ((t3) => {
        if (!t3.length) return;
        const n4 = [];
        for (let e4 = 0; e4 < t3.length; e4 += 1) t3[e4].slotNodes.length && n4.push(t3[e4]);
        n4.sort(((e4, t4) => e4.slotNodes[0].parentIndex - t4.slotNodes[0].parentIndex));
        let s4 = 0, o3 = 0;
        for (let t4 = 0; t4 < n4.length; t4 += 1) {
          const i3 = n4[t4].slotNodes, r3 = i3[0].parentIndex;
          let l3 = r3;
          for (let t5 = i3.length - 1; t5 > 0; t5 -= 1) if (i3[t5].parentNode === e3) {
            l3 = i3[t5].parentIndex;
            break;
          }
          o3 !== r3 && (s4 >= 0 && e3.removeChildren(s4, o3 - s4), s4 = r3), o3 = l3 + 1;
        }
        s4 !== o3 && e3.removeChildren(s4, o3 - s4);
      }), ((t3, s4) => {
        const o3 = pt(t3), i3 = o3.dynamicSlotValueUpdatePathTree;
        if (!i3) return;
        o3.dynamicSlotValueUpdatePathTree = void 0;
        const r3 = t3._$slotName || "";
        this.handleChildrenUpdate(((e4, t4, o4, r4, l3, a3, d3) => {
          n3(false, t4, o4, r4, l3, a3, d3, s4, i3);
        }), e3, t3, r3);
      }), ((e4, t3) => {
        var n4;
        const s4 = pt(e4);
        if (null === (n4 = s4.dynamicSlotValueNames) || void 0 === n4 ? void 0 : n4.includes(t3)) {
          (s4.dynamicSlotValueUpdatePathTree = s4.dynamicSlotValueUpdatePathTree || /* @__PURE__ */ Object.create(null))[t3] = true;
        }
      })), s3) : null;
    }
    createDynamicPlaceholder(e3) {
      const t2 = this.shadowRoot.createVirtualNode("virtual");
      t2.destroyBackendElementOnRemoval(), tt.setSlotElement(t2, e3);
      return pt(t2).dynamicSlotNameMatched = false, t2;
    }
    checkFallbackEventListener(e3, t2, n3, s3) {
      if (t2.startsWith("bind")) this.v(e3, t2.slice(4), n3, false, false, false, true, s3);
      else if (t2.startsWith("captureBind")) this.v(e3, t2.slice(11), n3, false, false, true, true, s3);
      else if (t2.startsWith("catch")) this.v(e3, t2.slice(5), n3, true, false, false, true, s3);
      else if (t2.startsWith("captureCatch")) this.v(e3, t2.slice(12), n3, true, false, true, true, s3);
      else {
        if (!t2.startsWith("on")) return false;
        this.v(e3, t2.slice(2), n3, false, false, false, true, s3);
      }
      return true;
    }
    getInitPropValuesCallback(e3, t2, n3) {
      return (s3) => {
        const o3 = C(s3) ? this.dynamicSlotUpdate(s3, n3, t2) : null;
        if (e3(s3, true), C(s3)) {
          if (s3.hasPendingChanges()) {
            Ft.getDataProxy(s3).applyDataUpdates(true);
          }
          null == o3 || o3.applySlotUpdates();
        }
      };
    }
    createCommonElement(e3, t2, n3, s3, o3) {
      var i3;
      let r3 = this.getInitPropValuesCallback(n3, s3, o3);
      const l3 = this.shadowRoot.createComponent(e3, e3, t2, void 0, ((e4) => r3(e4)));
      this.shadowRoot.checkComponentPlaceholder(e3) && (pt(l3).updateInitPropValues = (e4) => {
        r3 = e4;
      });
      const a3 = C(l3) && 3 === (null === (i3 = l3.getShadowRoot()) || void 0 === i3 ? void 0 : i3.getSlotMode());
      return l3.destroyBackendElementOnRemoval(), a3 ? this.bindingMapDisabled = true : this.handleChildrenCreationAndInsert(s3, l3, void 0, void 0), l3;
    }
    tryCallPropertyChangeListener(e3, t2, n3) {
      var s3;
      const o3 = pt(e3);
      if (null === (s3 = o3.changeProp) || void 0 === s3 ? void 0 : s3[t2]) {
        const s4 = o3.changeProp[t2], i3 = s4.oldValue;
        if (i3 !== n3) {
          s4.oldValue = n3;
          const t3 = e3.ownerShadowRoot.getHostNode();
          h("Property Change Observer", s4.listener, null, [n3, i3, t3, e3], t3);
        }
      }
    }
    applyClassListUpdates(e3) {
      const t2 = pt(e3).staticClasses;
      e3.setNodeClassList(t2), this.tryCallPropertyChangeListener(e3, "class", t2);
    }
    applyStyleListUpdates(e3) {
      const t2 = pt(e3).styleNameValues;
      let n3 = "";
      for (let e4 = 0; e4 < t2.length; e4 += 2) {
        n3 += `${t2[e4]}:${t2[e4 + 1]};`;
      }
      C(e3) && Ft.getDataProxy(e3).replaceProperty("style", n3) || e3.setNodeStyle(ft(n3), 0), this.tryCallPropertyChangeListener(e3, "style", n3);
    }
    setFnFilter(e3) {
      this.changePropFilter = e3;
    }
    setEventListenerWrapper(e3) {
      "function" == typeof e3 && (this.eventListenerWrapper = e3);
    }
    devArgs(e3) {
      return ((e4) => {
        const t2 = e4;
        return t2._$wxTmplDevArgs = t2._$wxTmplDevArgs || {};
      })(e3);
    }
  };
  var _t;
  !(function(e3) {
    e3[e3.Data = 0] = "Data", e3[e3.Script = 1] = "Script", e3[e3.InlineScript = 2] = "InlineScript";
  })(_t || (_t = {}));
  var vt = () => {
  };
  var bt = class {
    constructor(e3, t2) {
      this.i = (e4, t3) => {
        this.shadowRoot.idMap[t3] = e4;
      }, this.v = (e4, t3, n3, s3) => {
        const o3 = (e5) => {
          const t4 = this.shadowRoot.comp.callMethod(n3, e5);
          return !s3 && t4;
        };
        Object.defineProperty(o3, "name", { value: n3 }), this.shadowRoot.setListener(e4, t3, o3);
      }, this.a = (e4, t3, n3) => {
        this.r(e4, t3, n3);
      }, this.shadowRoot = e3, this.procGen = t2;
    }
    create(e3) {
      const { shadowRoot: t2, procGen: n3 } = this, s3 = n3(this, true, e3);
      return this.handleChildrenCreation(s3.C, t2.shadowRootElement), s3.B;
    }
    bindingMapUpdate(e3, t2, n3) {
      const s3 = n3[e3];
      if (void 0 !== s3) for (let e4 = 0; e4 < s3.length; e4 += 1) {
        (0, s3[e4])(t2, (() => {
        }), ((e5, t3) => {
          e5.textContent = t3;
        }));
      }
    }
    handleChildrenCreation(e3, t2) {
      let n3 = true, s3 = false;
      const o3 = () => {
        n3 = false, s3 = false;
        const e4 = document.createElement("virtual");
        t2.appendChild(e4), this.shadowRoot.slot = e4;
      };
      e3(true, ((e4, i3) => {
        s3 ? o3() : n3 = false;
        const r3 = document.createTextNode(e4 || "");
        i3 && i3(r3), t2.appendChild(r3);
      }), ((e4, i3, r3, l3) => {
        s3 ? o3() : n3 = false;
        const a3 = document.createElement(e4);
        r3(a3, true), this.handleChildrenCreation(l3, a3), t2.appendChild(a3);
      }), vt, vt, (() => {
        n3 ? (s3 = true, this.shadowRoot.slot = t2) : o3();
      }), ((e4) => {
        s3 ? o3() : n3 = false;
        const i3 = document.createElement("virtual");
        this.handleChildrenCreation(e4, i3), t2.appendChild(i3);
      }));
    }
    s() {
    }
    l() {
    }
    c(e3, t2) {
      e3.setAttribute("class", t2);
    }
    e() {
    }
    ei() {
    }
    y(e3, t2) {
      e3.setAttribute("style", t2);
    }
    w() {
    }
    wi() {
    }
    d(e3, t2, n3) {
      e3.dataset[t2] = ft(n3);
    }
    m() {
    }
    r(e3, t2, n3) {
      "boolean" == typeof n3 ? n3 ? e3.setAttribute(t2, "") : e3.removeAttribute(t2) : e3.setAttribute(t2, ft(n3));
    }
    wl() {
    }
    p() {
    }
    setFnFilter() {
    }
    setEventListenerWrapper() {
    }
    devArgs(e3) {
      return ((e4) => {
        const t2 = e4;
        return t2._$wxTmplDevArgs = t2._$wxTmplDevArgs || {};
      })(e3);
    }
  };
  var yt = () => ({ C: (e3, t2, n3, s3, o3, i3) => {
    i3("");
  }, B: /* @__PURE__ */ Object.create(null) });
  var St = () => yt;
  var Ct = class {
    constructor(e3) {
      if ("object" != typeof e3._$template && void 0 !== e3._$template) throw new Error(`Component template of ${e3.is} must be a valid compiled template (or "null" for default template).`);
      {
        const t2 = e3._$template || { content: St };
        this.genObjectGroupEnv = { list: t2.groupList || /* @__PURE__ */ Object.create(null), group: t2.content };
      }
      this.updateMode = "";
    }
    createInstance(e3) {
      return new wt(this, e3);
    }
  };
  var wt = class {
    constructor(e3, t2) {
      if (3 !== t2.getBackendMode()) throw new Error(`Component template of ${t2.is} cannot be initialized since external rendering is only supported in Domlike backend currently.`);
      const n3 = t2.getBackendElement();
      if (!n3) throw new Error(`Component template of ${t2.is} cannot be initialized as external components since no suitable backend element found.`);
      this.comp = t2, this.shadowRoot = this, this.shadowRootElement = n3, this.root = n3, this.slot = n3, this.template = e3;
      const s3 = e3.genObjectGroupEnv.group("") || St();
      this.procGenWrapper = new bt(this, s3), this.idMap = /* @__PURE__ */ Object.create(null), this.listeners = [];
    }
    initValues(e3) {
      if (this.bindingMapGen = this.procGenWrapper.create(e3), !this.bindingMapGen) throw new Error("The component template does not support binding-map-update, so it cannot be used as external components.");
      const t2 = this.shadowRootElement;
      if (this.slot === t2 && t2.childNodes.length > 0) {
        const e4 = document.createElement("virtual");
        t2.appendChild(e4), this.slot = e4;
      }
    }
    getIdMap() {
      return this.idMap;
    }
    updateValues(e3, t2) {
      const n3 = this.bindingMapGen;
      for (let s3 = 0; s3 < t2.length; s3 += 1) {
        const [o3] = t2[s3];
        this.procGenWrapper.bindingMapUpdate(o3[0], e3, n3);
      }
    }
    setListener(e3, t2, n3) {
      const s3 = e3;
      s3._$wxTmplEv ? s3._$wxTmplEv[t2] = n3 : s3._$wxTmplEv = { [t2]: n3 };
    }
    handleEvent(e3, t2) {
      var n3;
      const s3 = e3;
      let o3 = s3;
      const i3 = this.shadowRootElement, r3 = t2.getEventName(), l3 = t2.bubbles;
      for (; ; ) {
        const e4 = t2.wrapShadowedEvent(s3, null, o3), a3 = null === (n3 = o3._$wxTmplEv) || void 0 === n3 ? void 0 : n3[r3];
        if (a3) {
          false === a3.call(o3, e4) && (t2.preventDefault(), t2.stopPropagation());
        }
        if (!l3 || t2.propagationStopped()) break;
        if (o3 === i3) break;
        const d3 = o3.parentNode;
        if (!d3) break;
        o3 = d3;
      }
    }
  };
  var Nt = (e3, t2, n3, s3, o3) => ({ C: (e4, t3, n4, s4, o4, i3) => {
    i3("");
  }, B: o3 || /* @__PURE__ */ Object.create(null) });
  var Et = () => Nt;
  var kt;
  !(function(e3) {
    e3[e3.Disabled = 0] = "Disabled", e3[e3.Enabled = 1] = "Enabled", e3[e3.Forced = 2] = "Forced";
  })(kt || (kt = {}));
  var xt = (e3) => String(e3 >>> 0) === e3;
  var Ot = class {
    create(e3, t2) {
      return t2.externalComponent ? new Ct(e3) : new Lt(e3);
    }
  };
  var Lt = class {
    constructor(e3) {
      this.updateTemplate(e3);
    }
    updateTemplate(e3) {
      const t2 = e3._$template;
      if ("object" != typeof t2 && void 0 !== t2) throw new Error(`Component template of ${e3.is} must be a valid compiled template (or "null" for default template).`);
      const n3 = t2 || { content: Et };
      this.genObjectGroupEnv = { list: n3.groupList || /* @__PURE__ */ Object.create(null), group: n3.content }, this.updateMode = n3.updateMode || "", this.fallbackListenerOnNativeNode = n3.fallbackListenerOnNativeNode || false;
    }
    createInstance(e3, t2) {
      return new Rt(this, e3, t2(e3));
    }
  };
  var Rt = class {
    constructor(e3, t2, n3) {
      this.comp = t2, this.shadowRoot = n3, this.shadowRoot.destroyBackendElementOnRemoval(), this._$applyTemplate(e3);
    }
    updateTemplate(e3, t2) {
      this._$applyTemplate(e3), this.shadowRoot.removeChildren(0, this.shadowRoot.childNodes.length), this.bindingMapGen = this.procGenWrapper.create(t2);
    }
    _$applyTemplate(e3) {
      const t2 = e3.genObjectGroupEnv.group("") || Et();
      "bindingMap" === e3.updateMode ? this.forceBindingMapUpdate = 2 : "virtualTree" === e3.updateMode ? this.forceBindingMapUpdate = 0 : this.forceBindingMapUpdate = 1, this.procGenWrapper = new mt(this.shadowRoot, t2, e3.fallbackListenerOnNativeNode), this.bindingMapGen = void 0;
    }
    initValues(e3) {
      return this.bindingMapGen = this.procGenWrapper.create(e3), this.shadowRoot;
    }
    updateValues(e3, t2) {
      if (2 === this.forceBindingMapUpdate) {
        for (let n4 = 0; n4 < t2.length; n4 += 1) this.tryBindingMapUpdate(e3, t2[n4]);
        return;
      }
      if (1 === this.forceBindingMapUpdate && t2.length <= 1 && this.bindingMapGen && this.tryBindingMapUpdate(e3, t2[0])) return;
      const n3 = /* @__PURE__ */ Object.create(null);
      for (let e4 = 0; e4 < t2.length; e4 += 1) {
        const [s4, o4, i3, r3] = t2[e4];
        let l3 = n3;
        for (let e5 = 0; e5 < s4.length; e5 += 1) {
          const t3 = s4[e5], n4 = l3[t3];
          if (true === n4) break;
          if (e5 === s4.length - 1) {
            if (void 0 === r3) l3[t3] = true;
            else {
              const e6 = i3;
              if (void 0 === n4) l3[t3] = Object.create(new Array(e6));
              else if (Array.isArray(Object.getPrototypeOf(n4))) {
                const t4 = Object.getPrototypeOf(n4);
                t4.length < e6 && (t4.length = e6);
                const s6 = n4, o5 = Object.keys(s6);
                for (let e7 = 0; e7 < o5.length; e7 += 1) {
                  const n5 = o5[e7];
                  xt(n5) && (t4[Number(n5)] = s6[n5], delete s6[n5]);
                }
              } else {
                const s6 = new Array(e6), o5 = Object.keys(n4);
                let i4 = false;
                for (let e7 = 0; e7 < o5.length; e7 += 1) {
                  const t4 = o5[e7], r5 = n4[t4];
                  xt(t4) ? s6[Number(t4)] = r5 : "length" === t4 && (i4 = true);
                }
                const r4 = Object.create(s6);
                i4 && (r4.length = true), l3[t3] = r4;
              }
              const s5 = Object.getPrototypeOf(l3[t3]), a3 = new Array(o4.length);
              a3.fill(true), s5.splice(i3, r3, ...a3);
            }
            break;
          }
          if (void 0 === n4) {
            const e6 = /* @__PURE__ */ Object.create(null);
            l3[t3] = e6, l3 = e6;
          } else l3 = n4;
        }
      }
      const s3 = this.bindingMapGen, o3 = this.bindingMapGen = this.procGenWrapper.update(e3, n3, s3) || s3;
      if (s3 && o3 && s3 !== o3) {
        const e4 = Object.keys(o3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const n4 = e4[t3], i3 = o3[n4];
          for (let e5 = 0; e5 < i3.length; e5 += 1) i3[e5] || (i3[e5] = s3[n4][e5]);
        }
      }
    }
    tryBindingMapUpdate(e3, t2) {
      if (!t2) return true;
      const n3 = this.bindingMapGen;
      if (!n3) return false;
      const [s3] = t2;
      return 1 === s3.length && this.procGenWrapper.bindingMapUpdate(s3[0], e3, n3);
    }
  };
  var Mt = null;
  var At = () => {
    if (Mt) return Mt;
    const e3 = new Ot();
    return Mt = e3, e3;
  };
  var Tt = Object.freeze({ __proto__: null, DEFAULT_PROC_GEN_GROUP: Et, get GeneralLvaluePathPrefix() {
    return _t;
  }, GlassEaselTemplateEngine: Ot, GlassEaselTemplateInstance: Rt, getDefaultTemplateEngine: At });
  var Bt = (e3, t2, n3, s3) => {
    const o3 = t2.ownerSpace, i3 = null == n3 ? void 0 : n3._$behavior._$using, r3 = null == n3 ? void 0 : n3._$genericImpls;
    e3._$detail || e3.prepare();
    const l3 = e3.behavior;
    let a3;
    const d3 = l3._$generics;
    if (d3) {
      const n4 = l3._$genericDefaults;
      a3 = /* @__PURE__ */ Object.create(null);
      for (let l4 = 0; l4 < d3.length; l4 += 1) {
        const c3 = d3[l4];
        if (s3 && Object.prototype.hasOwnProperty.call(s3, c3)) {
          const n5 = s3[c3];
          if ("string" == typeof n5) if (null == i3 ? void 0 : i3[n5]) a3[c3] = i3[n5];
          else if (r3 && r3[n5]) a3[c3] = r3[n5];
          else {
            const s4 = o3.getGlobalUsingComponent(n5);
            if ("string" == typeof s4) a3[c3] = s4;
            else if (s4) a3[c3] = { final: s4, source: t2, placeholder: null, waiting: null };
            else {
              R(`Generic "${c3}" value "${n5}" is not valid`, e3.is);
              const s5 = o3.getDefaultComponent();
              if (!s5) throw new M(`Cannot find default component for generic "${c3}"`, "[prepare]", e3.is);
              a3[c3] = { final: s5, source: t2, placeholder: null, waiting: null };
            }
          }
          else a3[c3] = n5;
        } else {
          let s4 = n4[c3];
          if (!s4) {
            if (s4 = o3.getDefaultComponent(), !s4) throw new M(`Cannot find default component for generic "${c3}"`, "[prepare]", e3.is);
            R(`No component specified for generic "${c3}", using default component (on component "${e3.is}")`);
          }
          a3[c3] = "string" == typeof s4 ? s4 : { final: s4, source: t2, placeholder: null, waiting: null };
        }
      }
    } else a3 = null;
    return a3;
  };
  var Dt = (e3, t2, n3, s3) => {
    const o3 = n3._$using[e3] || s3 && s3[e3];
    let i3 = null;
    if (o3 && ("string" == typeof o3 ? i3 = o3 : null === o3.placeholder ? i3 = o3.final : R("Placeholder on generic implementation is not valid", n3.is)), i3) return i3;
    let r3 = t2.getGlobalUsingComponent(e3);
    if (null === r3 && t2._$allowUnusedNativeNode && "" !== e3 && (r3 = e3), !r3) {
      if (r3 = t2.getDefaultComponent(), !r3) throw new M(`Cannot find placeholder target "${e3}"`, "[prepare]", n3.is);
      R(`Cannot find placeholder target "${e3}", using default component.`, n3.is);
    }
    return r3;
  };
  var Pt = class {
    constructor(e3) {
      this.behavior = e3, this.is = this.behavior.is, this._$detail = null, this._$options = l(e3._$options, e3.ownerSpace.getComponentOptions());
      const t2 = this._$options.templateEngine;
      this._$templateEngine = null != t2 ? t2 : At();
    }
    general() {
      return this;
    }
    getComponentOptions() {
      return this._$options;
    }
    getComponentDependencies() {
      return this.behavior.getComponentDependencies();
    }
    updateTemplate(e3) {
      var t2;
      if (!(null === (t2 = this._$detail) || void 0 === t2 ? void 0 : t2.template.updateTemplate)) throw new Error(`The template engine of component "${this.is}" does not support template update`);
      this.behavior._$updateTemplate(e3), this._$detail.template.updateTemplate(this.behavior);
    }
    isPrepared() {
      return !!this._$detail;
    }
    prepare() {
      if (this._$detail) return;
      this.behavior.prepare();
      const e3 = this.behavior, t2 = this._$options, n3 = {};
      if (t2.writeFieldsToNode) {
        const t3 = Object.keys(e3._$propertyMap);
        for (let e4 = 0; e4 < t3.length; e4 += 1) {
          const s5 = t3[e4];
          n3[s5] = { enumerable: true, get() {
            return this._$dataGroup.data[s5];
          }, set(e5) {
            const t4 = this._$dataGroup;
            t4.replaceDataOnPath([s5], e5), t4.applyDataUpdates();
          } };
        }
        const s4 = Object.keys(e3._$methodMap);
        for (let t4 = 0; t4 < s4.length; t4 += 1) {
          const o4 = s4[t4];
          n3[o4] = { enumerable: true, value: e3._$methodMap[o4] };
        }
      }
      const s3 = function() {
      };
      n3.constructor = { value: s3, writable: true };
      const o3 = s3.prototype = Object.create(Ft.prototype, n3);
      o3._$behavior = e3, o3._$definition = this, o3._$methodMap = e3._$methodMap, o3._$dataGroupObserverTree = e3._$generateObserverTree(), o3._$lifetimeFuncs = e3._$getAllLifetimeFuncs(), o3._$pageLifetimeFuncs = e3._$getAllPageLifetimeFuncs();
      const i3 = ((e4) => {
        if (void 0 === e4) return null;
        const t3 = { definitions: new Array(6), keyMap: /* @__PURE__ */ Object.create(null) }, n4 = t3.definitions, s4 = t3.keyMap, o4 = Object.keys(e4);
        for (let t4 = 0; t4 < o4.length; t4 += 1) {
          const i4 = o4[t4], r4 = e4[i4], l4 = r4.type;
          n4[l4] ? (s4[i4] = [l4, n4[l4].length], n4[l4].push(r4)) : (s4[i4] = [l4, 0], n4[l4] = [r4]);
        }
        return t3;
      })(e3._$relationMap), r3 = Ie(t2.dataDeepCopy), l3 = Ie(t2.propertyPassingDeepCopy), a3 = this._$templateEngine.create(e3, t2);
      this._$detail = { proto: o3, template: a3, dataDeepCopy: r3, propertyPassingDeepCopy: l3, relationDefinitionGroup: i3 };
    }
  };
  var It = 1;
  var jt = null;
  var Ft = class _Ft extends tt {
    constructor() {
      throw new Error("Element cannot be constructed directly");
    }
    general() {
      return this;
    }
    asInstanceOf(e3) {
      return this._$behavior !== e3.behavior ? null : this;
    }
    static register(e3, t2) {
      return (t2 || ae()).defineComponent(e3);
    }
    static _$tagMethod(e3) {
      const t2 = e3;
      return t2[J] = true, t2;
    }
    static isTaggedMethod(e3) {
      return "function" == typeof e3 && !!e3[J];
    }
    static _$advancedCreate(e3, t2, n3, s3, o3, i3, l3) {
      var a3, d3, c3;
      t2._$detail || t2.prepare();
      const { proto: u3, template: p3, dataDeepCopy: f3, propertyPassingDeepCopy: g3, relationDefinitionGroup: $3 } = t2._$detail, m3 = t2._$options, _3 = t2.behavior, v3 = n3 ? n3.getBackendContext() : s3 || r.backendContext || (() => {
        if (jt) return jt;
        let e4;
        return e4 = new G(), jt = e4, e4;
      })(), b3 = m3.externalComponent, y3 = m3.propertyEarlyInit, S3 = r.writeExtraInfoToAttr, C3 = m3.virtualHost, w3 = Object.create(u3);
      w3._$genericImpls = o3, w3._$external = b3, w3.tagName = e3, w3._$methodCaller = w3, w3.ownerShadowRoot = n3;
      const N = _3.ownerSpace, E = N._$sharedStyleScope, [k3, x3] = w3.getStyleScopes(), O3 = k3 && k3 !== E;
      let L2 = null;
      if (v3) {
        if (3 === v3.mode) {
          if (!C3) {
            const t3 = m3.hostNodeTagName.endsWith("*") ? m3.hostNodeTagName.slice(0, -1) : "";
            if (L2 = v3.document.createElement(t3 + e3), O3) {
              const e4 = N.styleScopeManager.queryName(k3);
              e4 && L2.setAttribute("wx-host", e4);
            }
          }
        } else if (2 === v3.mode) C3 || (L2 = v3.createElement(m3.hostNodeTagName, e3));
        else if (1 === v3.mode) {
          const t3 = n3 ? n3._$backendShadowRoot : v3.getRootNode();
          L2 = null !== (a3 = null == t3 ? void 0 : t3.createComponent(e3, b3, C3, null != k3 ? k3 : Z.globalScope(), x3, _3._$externalClasses, b3 ? null : m3.dynamicSlots ? 3 : m3.multipleSlots ? 2 : 1, m3.writeIdToDOM)) && void 0 !== a3 ? a3 : null;
        }
      }
      w3._$initialize(t2.is, C3, L2, n3, null !== (d3 = null == n3 ? void 0 : n3._$nodeTreeContext) && void 0 !== d3 ? d3 : v3), w3._$placeholderHandlerRemover = i3;
      const R2 = n3 ? n3.getHostNode() : void 0, [A2, T2, B2] = null !== (c3 = null == R2 ? void 0 : R2.getStyleScopes()) && void 0 !== c3 ? c3 : [null, null, w3.getOwnerSpace().styleScopeManager];
      if (w3.classList = new Q(w3, _3._$externalClasses, R2 ? R2.classList : null, null != A2 ? A2 : Z.globalScope(), null != T2 ? T2 : void 0, B2), L2) {
        const e4 = null != A2 ? A2 : k3;
        e4 && 2 === v3.mode && L2.setStyleScope(e4, null != T2 ? T2 : void 0, O3 ? null != k3 ? k3 : Z.globalScope() : void 0);
      }
      if (L2 && (L2.__wxElement = w3, 3 !== v3.mode ? L2.associateValue(w3) : v3.associateValue(L2, w3), B2 && S3)) {
        const e4 = B2.queryName(null != A2 ? A2 : Z.globalScope());
        e4 && L2.setAttribute("exparser:info-class-prefix", `${e4}--`);
      }
      const D3 = p3.createInstance(w3, dt.createShadowRoot);
      if (w3.templateInstance = D3, S3 && L2) {
        const e4 = It;
        It += 1, w3._$componentInstanceId = e4, L2.setAttribute("exparser:info-component-id", e4);
      }
      w3._$idPrefix = m3.idPrefixGenerator ? m3.idPrefixGenerator.call(w3) : "";
      const P2 = _3._$staticData, I2 = _3._$data;
      let j2;
      if (void 0 === P2) if (1 === I2.length) {
        j2 = (0, I2[0])();
      } else {
        j2 = {};
        for (let e4 = 0; e4 < I2.length; e4 += 1) {
          const t3 = I2[e4];
          Object.assign(j2, t3());
        }
      }
      else {
        j2 = _e(P2);
        for (let e4 = 0; e4 < I2.length; e4 += 1) {
          const t3 = I2[e4];
          Object.assign(j2, t3());
        }
      }
      const F2 = w3._$relation = new ot(w3, $3);
      w3._$traitGroup = new ne();
      const U2 = _3._$traitBehaviors;
      if (void 0 !== U2) for (let e4 = 0; e4 < U2.length; e4 += 1) {
        const { traitBehavior: t3, impl: n4 } = U2[e4];
        w3._$traitGroup.implement(t3, n4);
      }
      if (_3._$methodCallerInit) {
        const e4 = _3._$methodCallerInit.call(w3);
        w3._$methodCaller = e4;
      }
      let V2 = false;
      if (_3._$init.length > 0) {
        let e4 = true;
        const t3 = w3.getMethodCaller(), n4 = { self: t3, data: j2, setData: w3.setData.bind(w3), implement: (e5, t4) => {
          if (V2) throw new M("Cannot execute init-time functions after initialization", "[implement]", _3.is);
          w3._$traitGroup.implement(e5, t4);
        }, relation: function(e5) {
          if (V2) throw new M("Cannot execute init-time functions after initialization", "[implement]", _3.is);
          const t4 = e5.target, n5 = st(_3.ownerSpace, _3.is, "undefined", e5);
          let s5;
          return s5 = n5 ? F2.add(n5) : Symbol("invalid"), { list: () => F2.getLinkedTargets(s5).map(((e6) => e6.getMethodCaller())), listAsTrait: t4 instanceof te ? () => F2.getLinkedTargets(s5).map(((e6) => e6.traitBehavior(t4))) : void 0 };
        }, observer: (e5, t4) => {
          if (V2) throw new M("Cannot execute init-time functions after initialization", "[implement]", _3.is);
          w3.dynamicAddObserver(t4, e5);
        }, lifetime: (e5, t4) => {
          if (V2) throw new M("Cannot execute init-time functions after initialization", "[implement]", _3.is);
          w3.addLifetimeListener(e5, t4);
        }, pageLifetime: (e5, t4) => {
          if (V2) throw new M("Cannot execute init-time functions after initialization", "[implement]", _3.is);
          w3.addPageLifetimeListener(e5, t4);
        }, method: (e5) => _Ft._$tagMethod(e5), listener: (e5) => _Ft._$tagMethod(e5) }, s4 = _3._$init;
        for (let o4 = 0; o4 < s4.length; o4 += 1) {
          const i4 = h("Component Init", s4[o4].func, t3, [n4], void 0);
          if (i4) {
            const t4 = Object.keys(i4);
            for (let n5 = 0; n5 < t4.length; n5 += 1) {
              const s5 = t4[n5], o5 = i4[s5];
              _Ft.isTaggedMethod(o5) && (e4 && (e4 = false, w3._$methodMap = Object.create(w3._$methodMap)), w3._$methodMap[s5] = o5, m3.writeFieldsToNode && (w3[s5] = o5));
            }
          }
        }
      }
      V2 = true;
      const H2 = D3.shadowRoot;
      w3.shadowRoot = H2;
      const W2 = new je(w3, j2, m3.pureDataPattern || null, f3, g3, m3.reflectToAttributes, w3._$dataGroupObserverTree, m3.propertyComparer, m3.unknownPropertyHandler);
      w3._$dataGroup = W2, y3 && void 0 !== l3 && l3(w3), D3.initValues(W2.innerData || W2.data), W2.updateListener = (e4, t3) => {
        D3.updateValues(e4, t3);
      };
      const z2 = _3._$listeners;
      if (void 0 !== z2) for (let e4 = 0; e4 < z2.length; e4 += 1) {
        const { id: t3, ev: n4, listener: s4 } = z2[e4], o4 = s4;
        if ("this" === t3) w3.addListener(n4, ((e5) => o4.call(w3._$methodCaller, e5)));
        else if (b3) {
          const e5 = H2, s5 = t3 ? e5.getIdMap()[t3] : e5.root;
          s5 && e5.setListener(s5, n4, ((e6) => o4.call(w3._$methodCaller, e6)));
        } else {
          const e5 = H2, s5 = t3 ? e5.getElementById(t3) : e5;
          s5 && s5.addListener(n4, ((e6) => o4.call(w3._$methodCaller, e6)));
        }
      }
      return w3.triggerLifetime("created", []), y3 || void 0 === l3 || l3(w3), w3;
    }
    static createWithGenericsAndContext(e3, t2, n3, s3, o3) {
      const i3 = (e4) => {
        let t3;
        return n3 && (t3 = /* @__PURE__ */ Object.create(null), Object.entries(n3).forEach((([n4, s4]) => {
          t3[n4] = { final: s4, source: e4.behavior, placeholder: null, waiting: null };
        }))), Bt(e4, e4.behavior, void 0, t3);
      };
      if (t2) return _Ft._$advancedCreate(String(e3), t2, null, s3, i3(t2), void 0, o3);
      if (e3 instanceof Pt) return _Ft._$advancedCreate(e3.is, e3, null, s3, i3(e3), void 0);
      const r3 = ae().getComponentByUrl(e3, "");
      return _Ft._$advancedCreate(e3, r3, null, s3, i3(r3), void 0);
    }
    static createWithGenerics(e3, t2, n3, s3) {
      return _Ft.createWithGenericsAndContext(e3, t2, n3, null, s3);
    }
    static createWithContext(e3, t2, n3, s3) {
      return _Ft.createWithGenericsAndContext(e3, t2, null, n3, s3);
    }
    static create(e3, t2, n3) {
      return _Ft.createWithGenericsAndContext(e3, t2, null, null, n3);
    }
    get properties() {
      return this._$dataGroup.data;
    }
    get data() {
      return this._$dataGroup.data;
    }
    set data(e3) {
      const t2 = this._$dataGroup;
      if (void 0 === t2) throw new M("Cannot update data before component created", "data setter", this);
      Object.entries(e3).forEach((([e4, n3]) => t2.replaceDataOnPath([e4], n3))), t2.applyDataUpdates();
    }
    get $() {
      return this._$external ? this.shadowRoot.getIdMap() : this.shadowRoot._$getIdMap();
    }
    getShadowRoot() {
      return this._$external ? null : this.shadowRoot;
    }
    applyTemplateUpdates() {
      var e3;
      if (!(null === (e3 = this.templateInstance) || void 0 === e3 ? void 0 : e3.updateTemplate)) throw new Error(`The template engine of component "${this.is}" does not support template update`);
      const t2 = this._$dataGroup;
      this.templateInstance.updateTemplate(this._$definition._$detail.template, t2.innerData || t2.data);
    }
    getOwnerSpace() {
      return this._$behavior.ownerSpace;
    }
    isExternal() {
      return this._$external;
    }
    static listProperties(e3) {
      return Object.keys(e3._$behavior._$propertyMap);
    }
    static hasProperty(e3, t2) {
      return !!e3._$behavior._$propertyMap[t2];
    }
    static isDirtyProperty(e3, t2) {
      return !!e3._$dataGroup._$propDirty[t2];
    }
    static getMethodsFromDef(e3) {
      return e3.behavior._$methodMap;
    }
    static getMethod(e3, t2) {
      if (e3._$definition._$options.useMethodCallerListeners && Object.prototype.hasOwnProperty.call(e3._$methodCaller, t2)) {
        const n3 = e3._$methodCaller[t2];
        return "function" == typeof n3 ? n3 : void 0;
      }
      return e3._$methodMap[t2];
    }
    callMethod(e3, ...t2) {
      const n3 = _Ft.getMethod(this, e3);
      return null == n3 ? void 0 : n3.call(this, ...t2);
    }
    getComponentDefinition() {
      return this._$definition;
    }
    getComponentOptions() {
      return this._$definition._$options;
    }
    getStyleScopes() {
      const e3 = this.getComponentOptions();
      return e3.inheritStyleScope ? this.ownerShadowRoot ? this.ownerShadowRoot.getHostNode().getStyleScopes() : [null, null, this.getOwnerSpace().styleScopeManager] : [e3.styleScope, e3.extraStyleScope, this.getOwnerSpace().styleScopeManager];
    }
    hasBehavior(e3) {
      return e3 instanceof te ? void 0 !== this._$traitGroup.get(e3) : this._$behavior.hasBehavior(e3);
    }
    getRootBehavior() {
      return this._$behavior;
    }
    traitBehavior(e3) {
      return this._$traitGroup.get(e3);
    }
    setMethodCaller(e3) {
      this._$methodCaller = e3;
    }
    getMethodCaller() {
      return this._$methodCaller;
    }
    addLifetimeListener(e3, t2) {
      Object.prototype.hasOwnProperty.call(this, "_$lifetimeFuncs") || (this._$lifetimeFuncs = this._$behavior._$getAllLifetimeFuncs());
      const n3 = this._$lifetimeFuncs;
      (n3[e3] = n3[e3] || new a("lifetime")).add(t2);
    }
    removeLifetimeListener(e3, t2) {
      Object.prototype.hasOwnProperty.call(this, "_$lifetimeFuncs") || (this._$lifetimeFuncs = this._$behavior._$getAllLifetimeFuncs());
      const n3 = this._$lifetimeFuncs[e3];
      null == n3 || n3.remove(t2);
    }
    triggerLifetime(e3, t2) {
      const n3 = this._$lifetimeFuncs[e3];
      n3 && n3.call(this._$methodCaller, t2, this);
    }
    triggerLifeTime(e3, t2) {
      return this.triggerLifetime(e3, t2);
    }
    addPageLifetimeListener(e3, t2) {
      Object.prototype.hasOwnProperty.call(this, "_$pageLifetimeFuncs") || (this._$pageLifetimeFuncs = this._$behavior._$getAllPageLifetimeFuncs());
      const n3 = this._$pageLifetimeFuncs;
      (n3[e3] = n3[e3] || new a("pageLifetime")).add(t2);
    }
    removePageLifetimeListener(e3, t2) {
      Object.prototype.hasOwnProperty.call(this, "_$pageLifetimeFuncs") || (this._$pageLifetimeFuncs = this._$behavior._$getAllPageLifetimeFuncs());
      const n3 = this._$pageLifetimeFuncs[e3];
      null == n3 || n3.remove(t2);
    }
    triggerPageLifetime(e3, t2) {
      const n3 = (s3) => {
        if (C(s3)) {
          if (s3._$pageLifetimeFuncs) {
            const n4 = s3._$pageLifetimeFuncs[e3];
            n4 && n4.call(s3._$methodCaller, t2, this);
          }
          s3._$external || n3(s3.shadowRoot);
        }
        const o3 = s3.childNodes;
        for (let e4 = 0; e4 < o3.length; e4 += 1) {
          const t3 = o3[e4];
          v(t3) && n3(t3);
        }
      };
      n3(this);
    }
    triggerPageLifeTime(e3, t2) {
      return this.triggerPageLifetime(e3, t2);
    }
    dynamicAddObserver(e3, t2) {
      Object.prototype.hasOwnProperty.call(this, "_$dataGroupObserverTree") || (this._$dataGroupObserverTree = this._$dataGroupObserverTree.cloneSub(), this._$dataGroup && (this._$dataGroup._$observerTree = this._$dataGroupObserverTree));
      const n3 = this._$dataGroupObserverTree;
      try {
        n3.addObserver(e3, ge(t2));
      } catch (e4) {
        L(e4, "observer", this.is);
      }
    }
    getRelationNodes(e3) {
      var t2;
      return (null === (t2 = this._$relation) || void 0 === t2 ? void 0 : t2.getLinkedTargets(e3)) || [];
    }
    hasExternalClass(e3) {
      return this.classList._$hasAlias(e3);
    }
    setExternalClass(e3, t2) {
      this.scheduleExternalClassChange(e3, t2), this.applyExternalClassChanges(), this._$mutationObserverTarget && Se.callAttrObservers(this, { type: "properties", target: this, nameType: "external-class", attributeName: e3 });
    }
    getExternalClasses() {
      return this.classList._$getAlias();
    }
    scheduleExternalClassChange(e3, t2) {
      this.classList._$setAlias(e3, t2);
    }
    applyExternalClassChanges() {
      if (this._$external) return;
      if (!this.classList._$shouldUpdateExternalClass()) return;
      const e3 = (t2) => {
        if (!v(t2)) return;
        const n3 = t2.classList;
        (null == n3 ? void 0 : n3._$spreadExternalClassUpdate()) && C(t2) && t2.applyExternalClassChanges();
        const s3 = t2.childNodes;
        for (let t3 = 0, n4 = s3.length; t3 < n4; t3 += 1) e3(s3[t3]);
        null == n3 || n3._$markExternalClassUpdated();
      };
      e3(this.shadowRoot);
    }
    triggerWorkletChangeLifetime(e3, t2) {
      this.triggerLifetime("workletChange", [e3, t2]);
    }
    isInnerDataExcluded(e3) {
      var t2;
      return (null === (t2 = this._$definition._$options.pureDataPattern) || void 0 === t2 ? void 0 : t2.test(e3)) || false;
    }
    static getInnerData(e3) {
      return e3._$dataGroup.innerData;
    }
    static getDataProxy(e3) {
      return e3._$dataGroup;
    }
    static replaceWholeData(e3, t2) {
      e3._$dataGroup.replaceWholeData(t2);
    }
    replaceDataOnPath(e3, t2) {
      const n3 = this._$dataGroup;
      if (void 0 === n3) throw new M("Cannot update data before component created", "replaceDataOnPath", this);
      n3.replaceDataOnPath(e3, t2);
    }
    spliceArrayDataOnPath(e3, t2, n3, s3) {
      const o3 = this._$dataGroup;
      if (void 0 === o3) throw new M("Cannot update data before component created", "spliceArrayDataOnPath", this);
      o3.spliceArrayDataOnPath(e3, t2, n3, s3);
    }
    hasPendingChanges() {
      const e3 = this._$dataGroup;
      return void 0 !== e3 && e3.getChanges().length > 0;
    }
    applyDataUpdates() {
      const e3 = this._$dataGroup;
      if (void 0 === e3) throw new M("Cannot update data before component created", "applyDataUpdates", this);
      e3.applyDataUpdates();
    }
    groupUpdates(e3) {
      const t2 = this._$dataGroup;
      if (void 0 === t2) throw new M("Cannot update data before component created", "groupUpdates", this);
      const n3 = e3();
      return t2.applyDataUpdates(), n3;
    }
    updateData(e3) {
      const t2 = this._$dataGroup;
      if (void 0 === t2) throw new M("Cannot update data before component created", "updateData", this);
      if ("object" == typeof e3 && null !== e3) {
        const n3 = Object.keys(e3);
        for (let s3 = 0; s3 < n3.length; s3 += 1) {
          const o3 = n3[s3];
          try {
            const n4 = fe(o3);
            t2.replaceDataOnPath(n4, e3[o3]);
          } catch (e4) {
            L(e4, "updateData", this);
          }
        }
      }
    }
    setData(e3) {
      const t2 = this._$dataGroup;
      if (void 0 === t2) throw new M("Cannot update data before component created", "setData", this);
      if ("object" == typeof e3 && null !== e3) {
        const n3 = Object.keys(e3);
        for (let s3 = 0; s3 < n3.length; s3 += 1) {
          const o3 = n3[s3];
          try {
            const n4 = fe(o3);
            t2.replaceDataOnPath(n4, e3[o3]);
          } catch (e4) {
            L(e4, "setData", this);
          }
        }
      }
      t2.applyDataUpdates();
    }
  };
  Ft.isComponent = C, Ft.prototype[m] = true;
  var Ut = class {
    constructor(e3, t2) {
      this._$behaviors = [], this._$traitBehaviors = [], this._$staticData = void 0, this._$data = [], this._$methods = [], this._$lifetimes = [], this._$pageLifetimes = [], this._$init = [], this.is = e3, this._$ownerSpace = t2;
    }
    methodCallerInit(e3) {
      return this._$methodCallerInit = e3, this;
    }
    behavior(e3) {
      return this._$behaviors.push(e3), e3._$chainingFilter ? e3._$chainingFilter(this) : this;
    }
    chainingFilter(e3) {
      return this._$chainingFilter = e3, this;
    }
    options(e3) {
      const t2 = this._$options;
      return this._$options = t2 ? Object.assign(Object.assign({}, t2), e3) : e3, this;
    }
    implement(e3, t2) {
      return this._$traitBehaviors.push({ traitBehavior: e3, impl: t2 }), this;
    }
    template(e3) {
      return this._$template = e3, this;
    }
    usingComponents(e3) {
      return this._$using ? this._$using = Object.assign(Object.assign({}, this._$using), e3) : this._$using = e3, this;
    }
    placeholders(e3) {
      return this._$placeholders ? this._$placeholders = Object.assign(Object.assign({}, this._$placeholders), e3) : this._$placeholders = e3, this;
    }
    generics(e3) {
      return this._$generics ? this._$generics = Object.assign(Object.assign({}, this._$generics), e3) : this._$generics = e3, this;
    }
    externalClasses(e3) {
      return this._$externalClasses ? this._$externalClasses = this._$externalClasses.concat(e3) : this._$externalClasses = e3, this;
    }
    data(e3) {
      return this._$data.push((() => {
        var t2;
        return null !== (t2 = h("Data Generator", e3, null, [], this.is)) && void 0 !== t2 ? t2 : {};
      })), this;
    }
    staticData(e3) {
      return this._$staticData = e3, this;
    }
    property(e3, t2) {
      return this._$properties || (this._$properties = []), this._$properties.push({ name: e3, def: t2 }), this;
    }
    methods(e3) {
      const t2 = Object.keys(e3);
      for (let n3 = 0; n3 < t2.length; n3 += 1) {
        const s3 = t2[n3], o3 = e3[s3];
        this._$methods.push({ name: s3, func: o3 });
      }
      return this;
    }
    observer(e3, t2, n3 = false) {
      this._$observers || (this._$observers = []);
      try {
        this._$observers.push({ dataPaths: ge(e3), func: t2, once: n3 });
      } catch (e4) {
        L(e4, "observer", this.is);
      }
      return this;
    }
    lifetime(e3, t2, n3 = false) {
      return this._$lifetimes.push({ name: e3, func: t2, once: n3 }), this;
    }
    pageLifetime(e3, t2, n3 = false) {
      return this._$pageLifetimes || (this._$pageLifetimes = []), this._$pageLifetimes.push({ name: e3, func: t2, once: n3 }), this;
    }
    relation(e3, t2) {
      return this._$relations || (this._$relations = []), this._$relations.push({ name: e3, rel: t2 }), this;
    }
    init(e3, t2 = false) {
      return this._$init.push({ func: e3, once: t2 }), this;
    }
    definition(e3) {
      e3.behaviors && this._$behaviors.push(...e3.behaviors), e3.options && this.options(e3.options), e3.template && this.template(e3.template), e3.using && this.usingComponents(e3.using), e3.placeholders && this.placeholders(e3.placeholders), e3.generics && this.generics(e3.generics), e3.externalClasses && this.externalClasses(e3.externalClasses);
      const t2 = e3.data;
      void 0 !== t2 && ("function" == typeof t2 ? this._$data.push((() => {
        var e4;
        return null !== (e4 = h("Data Generator", t2, null, [], this.is)) && void 0 !== e4 ? e4 : {};
      })) : this._$staticData = t2);
      const n3 = e3.properties;
      if (void 0 !== n3) {
        this._$properties || (this._$properties = []);
        const e4 = Object.keys(n3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const s4 = e4[t3], o4 = n3[s4];
          this._$properties.push({ name: s4, def: o4 });
        }
      }
      const s3 = e3.methods;
      if (void 0 !== s3) {
        const e4 = Object.keys(s3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const n4 = e4[t3], o4 = s3[n4];
          this._$methods.push({ name: n4, func: o4 });
        }
      }
      const o3 = e3.observers;
      if (void 0 !== o3) if (this._$observers || (this._$observers = []), Array.isArray(o3)) for (let e4 = 0; e4 < o3.length; e4 += 1) {
        const { fields: t3, observer: n4 } = o3[e4];
        try {
          this._$observers.push({ dataPaths: ge(null != t3 ? t3 : "**"), func: n4, once: false });
        } catch (e5) {
          L(e5, "definition", this.is);
        }
      }
      else {
        const e4 = Object.keys(o3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const n4 = e4[t3], s4 = o3[n4];
          try {
            this._$observers.push({ dataPaths: ge(n4), func: s4, once: false });
          } catch (e5) {
            L(e5, "definition", this.is);
          }
        }
      }
      const i3 = e3.lifetimes;
      if (void 0 === (null == i3 ? void 0 : i3.created) && "function" == typeof e3.created && this._$lifetimes.push({ name: "created", func: e3.created, once: true }), void 0 === (null == i3 ? void 0 : i3.attached) && "function" == typeof e3.attached && this._$lifetimes.push({ name: "attached", func: e3.attached, once: true }), void 0 === (null == i3 ? void 0 : i3.moved) && "function" == typeof e3.moved && this._$lifetimes.push({ name: "moved", func: e3.moved, once: true }), void 0 === (null == i3 ? void 0 : i3.detached) && "function" == typeof e3.detached && this._$lifetimes.push({ name: "detached", func: e3.detached, once: true }), void 0 === (null == i3 ? void 0 : i3.ready) && "function" == typeof e3.ready && this._$lifetimes.push({ name: "ready", func: e3.ready, once: true }), i3) {
        const e4 = Object.keys(i3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const n4 = e4[t3], s4 = i3[n4];
          this._$lifetimes.push({ name: n4, func: s4, once: true });
        }
      }
      const r3 = e3.pageLifetimes;
      if (r3) {
        this._$pageLifetimes || (this._$pageLifetimes = []);
        const e4 = Object.keys(r3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const n4 = e4[t3], s4 = r3[n4];
          this._$pageLifetimes.push({ name: n4, func: s4, once: true });
        }
      }
      const l3 = e3.listeners;
      if (l3) {
        this._$listeners || (this._$listeners = {});
        const e4 = Object.keys(l3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const n4 = e4[t3], s4 = l3[n4];
          this._$listeners[n4] = { func: s4, once: true };
        }
      }
      const a3 = e3.relations;
      if (a3) {
        this._$relations || (this._$relations = []);
        const e4 = Object.keys(a3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const n4 = e4[t3], s4 = a3[n4];
          this._$relations.push({ name: n4, rel: s4 });
        }
      }
      return this;
    }
    registerBehavior() {
      const e3 = this.is, t2 = new Vt(this);
      return void 0 !== e3 && this._$ownerSpace._$registerBehavior(e3, t2), t2;
    }
    extraThisFieldsType() {
      return this;
    }
    registerComponent() {
      const e3 = this.is, t2 = new Vt(this), n3 = new Pt(t2);
      return void 0 !== e3 && this._$ownerSpace.registerComponent(e3, n3), n3;
    }
  };
  var Vt = class _Vt {
    static create(e3, t2) {
      return new Ut(e3.is, t2 || ae()).definition(e3).registerBehavior();
    }
    constructor(e3) {
      this._$unprepared = true, this.is = e3.is || "", this.ownerSpace = e3._$ownerSpace, this._$builder = e3, this._$flatAncestors = /* @__PURE__ */ new Set(), this._$chainingFilter = e3._$chainingFilter, this._$options = e3._$options, this._$traitBehaviors = void 0, this._$template = e3._$template, this._$using = /* @__PURE__ */ Object.create(null), this._$generics = void 0, this._$genericDefaults = void 0, this._$externalClasses = e3._$externalClasses, this._$staticData = void 0, this._$data = [], this._$propertyMap = /* @__PURE__ */ Object.create(null), this._$methodMap = /* @__PURE__ */ Object.create(null), this._$observers = [], this._$lifetimes = [], this._$pageLifetimes = void 0, this._$listeners = void 0, this._$relationMap = void 0, this._$init = [], this._$methodCallerInit = e3._$methodCallerInit;
    }
    general() {
      return this;
    }
    getComponentDependencies(e3) {
      const t2 = /* @__PURE__ */ new Set(), n3 = function(e4) {
        e4._$unprepared && e4.prepare();
        const s3 = Object.keys(e4._$using);
        for (let o3 = 0; o3 < s3.length; o3 += 1) {
          const i3 = s3[o3], r3 = e4._$using[i3];
          if ("string" == typeof r3) continue;
          const l3 = r3.final;
          l3 && !t2.has(l3) && (t2.add(l3), n3(l3.behavior));
        }
      };
      if (n3(this.general()), e3) {
        const s3 = Object.values(e3);
        for (let e4 = 0; e4 < s3.length; e4 += 1) {
          const o3 = s3[e4];
          "string" != typeof o3 && (t2.has(o3) || (t2.add(o3), n3(o3.behavior)));
        }
      }
      return t2;
    }
    static prepare(e3) {
      e3.prepare();
    }
    prepare() {
      var e3;
      if (!this._$unprepared) return;
      this._$unprepared = false;
      const t2 = this.is, n3 = this.ownerSpace, s3 = this._$builder, o3 = this._$flatAncestors;
      if (Array.isArray(s3._$behaviors)) for (let e4 = 0; e4 < s3._$behaviors.length; e4 += 1) {
        const i4 = s3._$behaviors[e4];
        let r4 = null;
        if (i4 instanceof _Vt) r4 = i4;
        else {
          const e5 = String(i4);
          n3 && (r4 = n3.getBehaviorByUrl(e5, t2)), r4 || L(new Error(`behavior "${e5}" is not found.`), "[prepare]", t2);
        }
        if (!r4) continue;
        r4._$unprepared && _Vt.prepare(r4);
        const l4 = r4._$traitBehaviors;
        void 0 !== l4 && (this._$traitBehaviors || (this._$traitBehaviors = []), this._$traitBehaviors.push(...l4));
        const a4 = r4._$staticData;
        a4 && (this._$staticData || (this._$staticData = {}), ke(this._$staticData, a4)), Object.assign(this._$methodMap, r4._$methodMap), Object.assign(this._$propertyMap, r4._$propertyMap), this._$data.push(...r4._$data);
        const d4 = r4._$observers;
        for (let e5 = 0; e5 < d4.length; e5 += 1) {
          const t3 = d4[e5];
          t3.once && this._$observers.indexOf(t3) >= 0 || this._$observers.push(t3);
        }
        const c4 = r4._$lifetimes;
        for (let e5 = 0; e5 < c4.length; e5 += 1) {
          const t3 = c4[e5];
          t3.once && this._$lifetimes.indexOf(t3) >= 0 || this._$lifetimes.push(t3);
        }
        const h3 = r4._$pageLifetimes;
        if (void 0 !== h3) if (this._$pageLifetimes) for (let e5 = 0; e5 < h3.length; e5 += 1) {
          const t3 = h3[e5];
          t3.once && this._$pageLifetimes.indexOf(t3) >= 0 || this._$pageLifetimes.push(t3);
        }
        else this._$pageLifetimes = h3.slice();
        const u4 = r4._$listeners;
        if (void 0 !== u4) if (this._$listeners) for (let e5 = 0; e5 < u4.length; e5 += 1) {
          const t3 = u4[e5];
          t3.once && this._$listeners.indexOf(t3) >= 0 || this._$listeners.push(t3);
        }
        else this._$listeners = u4.slice().slice();
        const p4 = r4._$relationMap;
        void 0 !== p4 && (this._$relationMap || (this._$relationMap = /* @__PURE__ */ Object.create(null)), Object.assign(this._$relationMap, p4));
        for (let e5 = 0; e5 < r4._$init.length; e5 += 1) {
          const t3 = r4._$init[e5];
          t3.once && this._$init.indexOf(t3) >= 0 || this._$init.push(t3);
        }
        r4._$flatAncestors.forEach(((e5) => {
          o3.add(e5);
        }));
      }
      const i3 = s3._$traitBehaviors;
      if (void 0 !== i3 && (this._$traitBehaviors || (this._$traitBehaviors = []), this._$traitBehaviors.push(...i3)), "object" == typeof s3._$using && null !== s3._$using) {
        const o4 = "object" == typeof s3._$placeholders && null !== s3._$placeholders, i4 = Object.keys(s3._$using);
        for (let r4 = 0; r4 < i4.length; r4 += 1) {
          const l4 = i4[r4], a4 = s3._$using[l4];
          let d4 = null;
          if (o4 && (d4 = null !== (e3 = s3._$placeholders[l4]) && void 0 !== e3 ? e3 : null), a4 instanceof Pt) this._$using[l4] = { final: a4, source: this, placeholder: d4, waiting: null };
          else if (n3) {
            const e4 = String(a4), s4 = n3.getComponentByUrlWithoutDefault(e4, t2);
            if (s4) this._$using[l4] = { final: s4, source: this, placeholder: null, waiting: null };
            else if (null !== d4) {
              const s5 = { final: null, source: this, placeholder: d4, waiting: null }, o5 = n3._$componentWaitingList(e4, t2);
              o5 && (o5.add(((e5) => {
                s5.final = e5, s5.placeholder = null, s5.waiting = null;
              })), s5.waiting = o5), this._$using[l4] = s5;
            } else {
              const t3 = n3.getGlobalUsingComponent(e4);
              this._$using[l4] = "string" == typeof t3 ? t3 : { final: t3, source: this, placeholder: null, waiting: null };
            }
          } else L(new Error(`cannot find component "${String(a4)}"`), "[prepare]", t2);
        }
      }
      if ("object" == typeof s3._$generics && null !== s3._$generics) {
        const e4 = this._$generics = [], o4 = /* @__PURE__ */ Object.create(null);
        this._$genericDefaults = o4;
        const i4 = Object.keys(s3._$generics);
        for (let r4 = 0; r4 < i4.length; r4 += 1) {
          const l4 = i4[r4], a4 = s3._$generics[l4];
          let d4 = null;
          const c4 = true === a4 || null == a4 ? void 0 : a4.default;
          if (void 0 !== c4) if (c4 instanceof Pt) d4 = c4;
          else if (n3) {
            const e5 = String(c4);
            d4 = n3.getComponentByUrlWithoutDefault(e5, t2) || n3.getGlobalUsingComponent(e5);
          } else L(new Error(`cannot define generic "${l4}" without a default implementor.`), "[prepare]", t2);
          e4.push(l4), o4[l4] = d4;
        }
      }
      const r3 = s3._$staticData;
      r3 && (this._$staticData ? ke(this._$staticData, r3) : this._$staticData = r3);
      const l3 = s3._$methods;
      for (let e4 = 0; e4 < l3.length; e4 += 1) {
        const { name: t3, func: n4 } = l3[e4];
        this._$methodMap[t3] = n4;
      }
      const a3 = s3._$properties;
      if (void 0 !== a3) {
        const e4 = [];
        for (let n4 = 0; n4 < a3.length; n4 += 1) {
          const { name: s4, def: o4 } = a3[n4], i4 = "string" === (d3 = o4) || d3 === String ? { type: "string", optionalTypes: null, defaultFn: () => "", observer: null, comparer: null, reflectIdPrefix: false } : "number" === d3 || d3 === Number ? { type: "number", optionalTypes: null, defaultFn: () => 0, observer: null, comparer: null, reflectIdPrefix: false } : "boolean" === d3 || d3 === Boolean ? { type: "boolean", optionalTypes: null, defaultFn: () => false, observer: null, comparer: null, reflectIdPrefix: false } : "object" === d3 || d3 === Object ? { type: "object", optionalTypes: null, defaultFn: () => null, observer: null, comparer: null, reflectIdPrefix: false } : "array" === d3 || d3 === Array ? { type: "array", optionalTypes: null, defaultFn: () => [], observer: null, comparer: null, reflectIdPrefix: false } : "function" === d3 || d3 === Function ? { type: "function", optionalTypes: null, defaultFn: () => function() {
          }, observer: null, comparer: null, reflectIdPrefix: false } : "any" === d3 || null == d3 ? { type: "any", optionalTypes: null, defaultFn: () => null, observer: null, comparer: null, reflectIdPrefix: false } : null;
          let r4, l4;
          if (null !== i4) r4 = i4, l4 = i4.defaultFn;
          else {
            const e5 = o4;
            let n5 = Oe(e5.type), i5 = null;
            Array.isArray(e5.optionalTypes) && (i5 = e5.optionalTypes.map(Oe), i5.length > 0 && ("invalid" !== n5 && "any" !== n5 || (n5 = i5[0]))), "invalid" === n5 && L(new Error(`the type of property "${s4}" is illegal`), "[prepare]", t2);
            const a4 = xe(n5);
            "function" == typeof e5.default && void 0 !== e5.value && R(`the initial value of property "${s4}" is not used when its default is provided.`, t2);
            const d4 = "function" == typeof e5.default ? () => {
              const n6 = h(`Property "${s4}" Default`, e5.default, null, [], t2);
              return void 0 !== n6 ? n6 : _e(a4);
            } : () => _e(a4);
            let c4, u4;
            l4 = "function" == typeof e5.default ? d4 : void 0 !== e5.value ? () => _e(e5.value) : () => _e(a4), "function" == typeof e5.observer ? c4 = e5.observer : "string" == typeof e5.observer ? (c4 = this._$methodMap[e5.observer] || null, c4 || L(new Error(`Cannot find method "${e5.observer}" for observer of property "${s4}".`), "[prepare]", t2)) : (c4 = null, void 0 !== e5.observer && L(new Error(`The observer of property "${s4}" is not a function, got "${typeof e5.observer}".`), "[prepare]", t2)), "function" == typeof e5.comparer ? u4 = e5.comparer : (u4 = null, void 0 !== e5.comparer && L(new Error(`the comparer of property "${s4}" is not a function.`), "[prepare]", t2));
            r4 = { type: n5, optionalTypes: i5, defaultFn: d4, observer: c4, comparer: u4, reflectIdPrefix: !!e5.reflectIdPrefix };
          }
          this._$propertyMap[s4] = r4, e4.push({ name: s4, func: l4 });
        }
        this._$data.push((() => {
          const t3 = {};
          for (let n4 = 0; n4 < e4.length; n4 += 1) {
            const { name: s4, func: o4 } = e4[n4];
            t3[s4] = o4();
          }
          return t3;
        }));
      }
      var d3;
      this._$data.push(...s3._$data);
      const c3 = s3._$observers;
      if (void 0 !== c3) for (let e4 = 0; e4 < c3.length; e4 += 1) {
        const { dataPaths: n4, func: s4, once: o4 } = c3[e4], i4 = "function" == typeof s4 ? s4 : this._$methodMap[s4];
        "function" == typeof i4 ? this._$observers.push({ dataPaths: n4, observer: i4, once: o4 }) : L(new Error(`the "${String(i4)}" observer is not a function.`), "[prepare]", t2);
      }
      const u3 = s3._$lifetimes;
      this._$lifetimes.push(...u3);
      const p3 = s3._$pageLifetimes;
      p3 && (this._$pageLifetimes || (this._$pageLifetimes = []), this._$pageLifetimes.push(...p3));
      const f3 = s3._$listeners;
      if (void 0 !== f3) {
        const e4 = Object.keys(f3);
        if (e4.length > 0) {
          this._$listeners || (this._$listeners = []);
          for (let n4 = 0; n4 < e4.length; n4 += 1) {
            const s4 = e4[n4], { func: o4, once: i4 } = f3[s4], r4 = "function" == typeof o4 ? o4 : this._$methodMap[o4];
            if (r4) {
              const e5 = s4.indexOf(".");
              let t3, n5;
              e5 >= 0 ? (t3 = s4.slice(0, e5), n5 = s4.slice(e5 + 1)) : (t3 = "", n5 = s4), this._$listeners.push({ id: t3, ev: n5, listener: r4, once: i4 });
            } else L(new Error(`the "${s4}" listener is not a function or a method name`), "[prepare]", t2);
          }
        }
      }
      const g3 = s3._$relations;
      if (void 0 !== g3) {
        this._$relationMap || (this._$relationMap = /* @__PURE__ */ Object.create(null));
        for (let e4 = 0; e4 < g3.length; e4 += 1) {
          const { name: s4, rel: o4 } = g3[e4];
          if (null == o4) continue;
          const i4 = st(n3, t2, s4, o4);
          i4 && (this._$relationMap[s4] = i4);
        }
      }
      this._$init.push(...s3._$init), o3.add(this);
    }
    getTemplate() {
      return this._$template;
    }
    _$updateTemplate(e3) {
      this._$template = e3;
    }
    hasBehavior(e3) {
      if (this._$unprepared && this.prepare(), e3 instanceof _Vt) return this._$flatAncestors.has(e3);
      if (this.ownerSpace) {
        const t2 = this.ownerSpace.getBehaviorByUrl(e3, this.is);
        return !!t2 && this._$flatAncestors.has(t2);
      }
      return false;
    }
    listProperties() {
      return Object.keys(this._$propertyMap);
    }
    getPropertyType(e3) {
      var t2;
      return null === (t2 = this._$propertyMap[e3]) || void 0 === t2 ? void 0 : t2.type;
    }
    getPropertyOptionalType(e3) {
      var t2;
      return null === (t2 = this._$propertyMap[e3]) || void 0 === t2 ? void 0 : t2.optionalTypes;
    }
    getMethods() {
      return this._$methodMap;
    }
    _$generateObserverTree() {
      const e3 = new Ae(this._$propertyMap), t2 = this._$observers;
      for (let n3 = 0; n3 < t2.length; n3 += 1) {
        const { dataPaths: s3, observer: o3 } = t2[n3];
        e3.addObserver(o3, s3);
      }
      return e3;
    }
    _$getAllLifetimeFuncs() {
      const e3 = /* @__PURE__ */ Object.create(null), t2 = this._$lifetimes;
      for (let n3 = 0; n3 < t2.length; n3 += 1) {
        const { name: s3, func: o3 } = t2[n3];
        if (e3[s3]) e3[s3].add(o3);
        else {
          (e3[s3] = new a("lifetime")).add(o3);
        }
      }
      return e3;
    }
    _$getAllPageLifetimeFuncs() {
      const e3 = /* @__PURE__ */ Object.create(null), t2 = this._$pageLifetimes;
      if (!t2) return e3;
      for (let n3 = 0; n3 < t2.length; n3 += 1) {
        const { name: s3, func: o3 } = t2[n3];
        if (e3[s3]) e3[s3].add(o3);
        else {
          (e3[s3] = new a("pageLifetime")).add(o3);
        }
      }
      return e3;
    }
  };
  var Ht;
  !(function(e3) {
    e3.ShadowAncestors = "shadow-ancestors", e3.ComposedAncestors = "composed-ancestors", e3.ShadowDescendantsRootFirst = "shadow-descendants-root-first", e3.ShadowDescendantsRootLast = "shadow-descendants-root-last", e3.ComposedDescendantsRootFirst = "composed-descendants-root-first", e3.ComposedDescendantsRootLast = "composed-descendants-root-last";
  })(Ht || (Ht = {}));
  var Wt = (e3, t2) => {
    const n3 = e3.getBackendContext();
    n3 && ((e4, t3) => {
      e4.render((() => {
        "function" == typeof t3 && h("render", t3, e4, [null]);
      }));
    })(n3, t2 || null);
  };
  var zt = Object.freeze({ __proto__: null });
  var Yt = qe.triggerEvent;
  var Zt = qe.triggerExternalEvent;

  // node_modules/.pnpm/glass-easel-miniprogram-adapter@1.2.0_glass-easel@1.2.0/node_modules/glass-easel-miniprogram-adapter/dist/glass_easel_miniprogram_adapter.es.js
  var i2 = class {
    constructor(e3, t2) {
      this._$env = e3, this._$ = t2;
    }
    registerStyleSheetContent(e3, t2) {
      this._$.registerStyleSheetContent(e3, t2);
    }
    createRoot(e3, t2, i3, s3) {
      if (this._$env !== t2._$env) throw new Error("The code space is not in the same environment as the backend");
      return new o2(this._$, e3, t2, i3, s3);
    }
  };
  var o2 = class {
    constructor(t2, i3, o3, s3, r3) {
      if (this._$comp = o3.getComponentSpace().createComponentByUrl(i3, s3, r3 || null, t2), o3.isMainSpace()) {
        const e3 = o3.getStyleSheet("app");
        if (void 0 !== e3) {
          const i4 = o3._$styleIsolationMap[this._$comp.is];
          "isolated" !== i4 && "apply-shared" !== i4 && "shared" !== i4 || t2.appendStyleSheetPath(e3, o3._$sharedStyleScope);
        }
      }
      const n3 = (i4) => {
        const { styleScope: o4 } = i4.getComponentOptions(), s4 = i4.behavior.ownerSpace.__wxCodeSpace, r4 = null == s4 ? void 0 : s4.getStyleSheet(i4.is);
        void 0 !== r4 && t2.appendStyleSheetPath(r4, null != o4 ? o4 : Z.globalScope());
      };
      this._$comp.getRootBehavior().getComponentDependencies().forEach(n3), n3(this._$comp.getComponentDefinition());
    }
    get() {
      return this._$comp.getMethodCaller();
    }
    getComponent() {
      return this._$comp;
    }
    attach(t2, i3) {
      tt.replaceDocumentElement(this._$comp, t2, i3);
    }
    release() {
      tt.pretendDetached(this._$comp), this._$comp.destroyBackendElement();
    }
  };
  var s2 = (e3, t2) => {
    let i3 = false, o3 = e3.length;
    const s3 = new Array(o3);
    e3.forEach(((e4, r3) => {
      e4(((e5) => {
        s3[r3] = e5, o3 -= 1, 0 === o3 && i3 && t2(s3);
      }));
    })), i3 = true, 0 === o3 && setTimeout((() => {
      t2(s3);
    }), 0);
  };
  var r2 = class {
    constructor(e3, t2, i3, o3) {
      this._$sq = e3, this._$comp = t2, this._$sel = i3, this._$single = o3;
    }
    fields(e3, t2 = (() => {
    })) {
      return this._$sq._$push(this._$sel, this._$comp, this._$single, e3, t2), this._$sq;
    }
    boundingClientRect(e3 = (() => {
    })) {
      return this._$sq._$push(this._$sel, this._$comp, this._$single, { id: true, dataset: true, rect: true, size: true }, e3), this._$sq;
    }
    scrollOffset(e3 = (() => {
    })) {
      return this._$sq._$push(this._$sel, this._$comp, this._$single, { id: true, dataset: true, scrollOffset: true }, e3), this._$sq;
    }
    context(e3 = (() => {
    })) {
      return this._$sq._$push(this._$sel, this._$comp, this._$single, { context: true }, e3), this._$sq;
    }
  };
  var n2 = class {
    constructor(e3) {
      this._$comp = e3, this._$queue = [];
    }
    in(e3) {
      return this._$comp = e3, this;
    }
    select(e3) {
      return new r2(this, this._$comp, e3, true);
    }
    selectAll(e3) {
      return new r2(this, this._$comp, e3, false);
    }
    selectViewport() {
      return new r2(this, this._$comp, null, true);
    }
    _$push(e3, t2, i3, o3, s3) {
      this._$queue.push({ component: t2, selector: e3, single: i3, fields: o3, cb: s3 });
    }
    exec(t2 = (() => {
    })) {
      const i3 = this._$queue;
      s2(i3.map(((t3) => (i4) => {
        const { component: o3, selector: r3, single: n3, fields: a3, cb: l3 } = t3;
        if (null === r3) {
          const e3 = {};
          s2([(t4) => {
            const i5 = o3._$.getBackendContext(), s3 = i5 ? i5.getWindowWidth() : 0, r4 = i5 ? i5.getWindowHeight() : 0;
            if (a3.id && (e3.id = ""), a3.dataset && (e3.dataset = {}), a3.mark && (e3.mark = {}), a3.rect && (e3.left = 0, e3.top = 0, e3.right = s3, e3.bottom = r4), a3.size && (e3.width = s3, e3.height = r4), a3.scrollOffset) {
              let i6 = o3._$.general();
              for (; i6.ownerShadowRoot; ) i6 = i6.ownerShadowRoot.getHostNode();
              i6.getBoundingClientRect((({ left: i7, top: o4, width: s4, height: r5 }) => {
                e3.scrollLeft = i7, e3.scrollTop = o4, e3.scrollWidth = s4, e3.scrollHeight = r5, t4(void 0);
              }));
            } else t4(void 0);
          }], (() => {
            l3(e3), i4(e3);
          }));
        } else {
          const t4 = (t5, i5) => {
            const o4 = {};
            a3.id && (o4.id = t5.id), a3.dataset && (o4.dataset = t5.dataset), a3.mark && (o4.mark = t5.collectMarks()), s2([(e3) => {
              a3.rect || a3.size ? t5.getBoundingClientRect(((t6) => {
                a3.rect && (o4.left = t6.left, o4.top = t6.top, o4.right = t6.left + t6.width, o4.bottom = t6.top + t6.height), a3.size && (o4.width = t6.width, o4.height = t6.height), e3(void 0);
              })) : e3(void 0);
            }, (e3) => {
              a3.scrollOffset ? t5.getScrollOffset(((t6) => {
                o4.scrollLeft = t6.scrollLeft, o4.scrollTop = t6.scrollTop, o4.scrollWidth = t6.scrollWidth, o4.scrollHeight = t6.scrollHeight, e3(void 0);
              })) : e3(void 0);
            }, (e3) => {
              a3.context ? t5.getContext(((t6) => {
                o4.context = t6, e3(void 0);
              })) : e3(void 0);
            }], (() => {
              a3.properties && Ft.isComponent(t5) && a3.properties.forEach(((i6) => {
                if (Ft.hasProperty(t5, i6)) {
                  const s3 = t5.getComponentOptions().propertyPassingDeepCopy, r4 = t5.data[i6];
                  s3 === n.None ? o4[i6] = r4 : s3 === n.Simple ? o4[i6] = ye.simpleDeepCopy(r4) : s3 === n.SimpleWithRecursion && (o4[i6] = ye.deepCopy(r4, true));
                }
              })), i5(o4);
            }));
          };
          if (n3) {
            const e3 = o3._$.getShadowRoot().querySelector(r3);
            e3 ? t4(e3, ((e4) => {
              l3(e4), i4(e4);
            })) : setTimeout((() => {
              l3(null), i4(null);
            }), 0);
          } else {
            const e3 = o3._$.getShadowRoot().querySelectorAll(r3);
            s2(e3.map(((e4) => (i5) => {
              t4(e4, ((e5) => {
                i5(e5);
              }));
            })), ((e4) => {
              l3(e4), i4(e4);
            }));
          }
        }
      })), t2);
    }
  };
  var a2 = { left: 0, top: 0, right: 0, bottom: 0 };
  var l2 = class {
    constructor(e3, t2, i3, o3) {
      this._$selector = null, this._$margins = null, this._$observers = [], this._$comp = e3, this._$thresholds = t2, this._$initialRatio = i3, this._$observeAll = o3;
    }
    relativeTo(e3, t2) {
      return this._$selector = e3, this._$margins = null != t2 ? t2 : a2, this;
    }
    relativeToViewport(e3) {
      return this._$selector = null, this._$margins = null != e3 ? e3 : a2, this;
    }
    observe(e3, t2) {
      const i3 = this._$comp._$.getShadowRoot();
      let o3, s3;
      if (i3) if (this._$observeAll) o3 = i3.querySelectorAll(e3);
      else {
        const t3 = i3.querySelector(e3);
        o3 = null === t3 ? [] : [t3];
      }
      else o3 = [];
      if (null !== this._$selector && i3) {
        const e4 = i3.querySelector(this._$selector);
        null === e4 || (s3 = e4);
      } else s3 = null;
      if (!this._$margins) throw new Error("`relativeTo` or `relativeToViewport` should be called before observe");
      const { left: r3, top: n3, right: a3, bottom: l3 } = { left: (h3 = this._$margins).left || 0, top: h3.top || 0, right: h3.right || 0, bottom: h3.bottom || 0 };
      var h3;
      const c3 = `${n3}px ${a3}px ${l3}px ${r3}px`;
      o3.forEach(((e4) => {
        let i4 = this._$initialRatio;
        const o4 = e4.createIntersectionObserver(s3, c3, this._$thresholds, ((e5) => {
          if (null !== i4) {
            let t3 = 0;
            for (; t3 < this._$thresholds.length; t3 += 1) {
              const o5 = this._$thresholds[t3];
              if (i4 !== e5.intersectionRatio && (i4 - o5) * (e5.intersectionRatio - o5) <= 0) break;
            }
            if (i4 = null, t3 < this._$thresholds.length) return;
          }
          t2(e5);
        }));
        null === o4 || this._$observers.push(o4);
      }));
    }
    disconnect() {
      const e3 = this._$observers;
      this._$observers = [], e3.forEach(((e4) => e4.disconnect()));
    }
  };
  var h2 = class {
    constructor(e3, t2) {
      this._$mode = 1, this._$observers = [], this._$comp = e3, this._$observeAll = t2;
    }
    contentBox() {
      return this._$mode = 1, this;
    }
    borderBox() {
      return this._$mode = 2, this;
    }
    observe(e3, t2) {
      const i3 = this._$comp._$.getShadowRoot();
      let o3;
      if (i3) if (this._$observeAll) o3 = i3.querySelectorAll(e3);
      else {
        const t3 = i3.querySelector(e3);
        o3 = null === t3 ? [] : [t3];
      }
      else o3 = [];
      o3.forEach(((e4) => {
        const i4 = e4.createResizeObserver(this._$mode, t2);
        null === i4 || this._$observers.push(i4);
      }));
    }
    disconnect() {
      const e3 = this._$observers;
      this._$observers = [], e3.forEach(((e4) => e4.disconnect()));
    }
  };
  var c2 = class {
    constructor(e3) {
      this._$observer = null, this._$comp = e3;
    }
    observe(e3, t2) {
      var i3, o3;
      this._$observer && this._$observer.disconnect(), this._$observer = (null === (o3 = null === (i3 = this._$comp._$.getBackendContext()) || void 0 === i3 ? void 0 : i3.createMediaQueryObserver) || void 0 === o3 ? void 0 : o3.call(i3, e3, t2)) || null;
    }
    disconnect() {
      this._$observer && this._$observer.disconnect(), this._$observer = null;
    }
  };
  var p2 = (e3, t2, i3) => {
    var o3;
    const s3 = t2.asInstanceOf(i3._$);
    if (null === s3) return;
    const r3 = s3.getRootBehavior().ownerSpace, n3 = s3.getMethodCaller(), a3 = n3 instanceof _2 ? n3 : null, l3 = e3._$.getRootBehavior().ownerSpace, h3 = r3 !== l3 ? null : a3, c3 = null === (o3 = null == a3 ? void 0 : a3._$export) || void 0 === o3 ? void 0 : o3.call(a3, r3 !== l3 ? null : e3);
    return void 0 === c3 ? h3 : c3;
  };
  var d2 = (t2, i3) => {
    var o3;
    if (Ft.isComponent(i3)) {
      const e3 = i3.getRootBehavior().ownerSpace, s3 = i3.getMethodCaller(), r3 = s3 instanceof _2 ? s3 : null, n3 = t2._$.getRootBehavior().ownerSpace, a3 = e3 !== n3 ? null : r3, l3 = null === (o3 = null == r3 ? void 0 : r3._$export) || void 0 === o3 ? void 0 : o3.call(r3, e3 !== n3 ? null : t2);
      return void 0 === l3 ? a3 : l3;
    }
  };
  var u2 = (e3, t2) => {
    if (void 0 !== t2) return t2;
    for (let t3 = e3.length - 1; t3 >= 0; t3 -= 1) {
      const i3 = e3[t3];
      if (void 0 !== i3._$export) return i3._$export;
    }
  };
  var _2 = class {
    get is() {
      return this._$.is;
    }
    set is(e3) {
      Object.defineProperty(this, "is", { value: e3, writable: true, enumerable: true, configurable: true });
    }
    get id() {
      return this._$.id;
    }
    set id(e3) {
      Object.defineProperty(this, "id", { value: e3, writable: true, enumerable: true, configurable: true });
    }
    get dataset() {
      return this._$.dataset;
    }
    set dataset(e3) {
      Object.defineProperty(this, "dataset", { value: e3, writable: true, enumerable: true, configurable: true });
    }
    get data() {
      return this._$.data;
    }
    set data(e3) {
      Object.defineProperty(this, "data", { value: e3, writable: true, enumerable: true, configurable: true });
    }
    get properties() {
      return this._$.data;
    }
    set properties(e3) {
      Object.defineProperty(this, "properties", { value: e3, writable: true, enumerable: true, configurable: true });
    }
    groupSetData(t2) {
      h("GroupSetData Callback", t2, this, [], this._$);
    }
    setData(t2, i3) {
      this._$.setData(t2), i3 && Wt(this._$, (() => {
        h("SetData Callback", i3, this, [], this._$);
      }));
    }
    updateData(e3) {
      this._$.updateData(e3);
    }
    replaceDataOnPath(e3, t2) {
      this._$.replaceDataOnPath(e3, t2);
    }
    spliceArrayDataOnPath(e3, t2, i3, o3) {
      this._$.spliceArrayDataOnPath(e3, t2, i3, o3);
    }
    applyDataUpdates() {
      this._$.applyDataUpdates();
    }
    groupUpdates(t2) {
      return this._$.groupUpdates((() => h("GroupUpdates Callback", t2, this, [], this._$)));
    }
    hasBehavior(e3) {
      return this._$.hasBehavior(e3._$);
    }
    traitBehavior(e3) {
      return this._$.traitBehavior(e3._$);
    }
    triggerEvent(e3, t2, i3) {
      return this._$.triggerEvent(e3, t2, i3);
    }
    createSelectorQuery() {
      return new n2(this);
    }
    createIntersectionObserver(e3) {
      return new l2(this, (null == e3 ? void 0 : e3.thresholds) || [0], (null == e3 ? void 0 : e3.initialRatio) || 0, (null == e3 ? void 0 : e3.observeAll) || false);
    }
    createResizeObserver(e3) {
      return new h2(this, !!(null == e3 ? void 0 : e3.observeAll));
    }
    createMediaQueryObserver() {
      return new c2(this);
    }
    selectComponent(e3, t2) {
      var i3, o3;
      const s3 = this._$.getShadowRoot().querySelector(e3);
      return null === s3 ? null : t2 ? null !== (i3 = p2(this, s3, t2)) && void 0 !== i3 ? i3 : null : null !== (o3 = d2(this, s3)) && void 0 !== o3 ? o3 : null;
    }
    selectAllComponents(e3, t2) {
      const i3 = this._$.getShadowRoot().querySelectorAll(e3), o3 = [];
      return i3.forEach(((e4) => {
        const i4 = t2 ? p2(this, e4, t2) : d2(this, e4);
        void 0 !== i4 && o3.push(i4);
      })), o3;
    }
    selectOwnerComponent(e3) {
      var t2, i3, o3;
      const s3 = null === (t2 = this._$.ownerShadowRoot) || void 0 === t2 ? void 0 : t2.getHostNode();
      return void 0 === s3 ? null : e3 ? null !== (i3 = p2(this, s3, e3)) && void 0 !== i3 ? i3 : null : null !== (o3 = d2(this, s3)) && void 0 !== o3 ? o3 : null;
    }
    getRelationNodes(e3) {
      return this._$.getRelationNodes(e3).map(((e4) => e4.getMethodCaller()));
    }
    general() {
      return this;
    }
    asInstanceOf(e3) {
      return this._$.asInstanceOf(e3._$) ? this : null;
    }
  };
  var $2 = class {
    constructor(e3, t2, i3) {
      this.proto = Object.create(_2.prototype), Object.assign(this.proto, e3), this.proto._$export = u2(t2, i3);
    }
    derive() {
      return Object.create(this.proto);
    }
  };
  var g2 = Object.freeze({ __proto__: null, ComponentCaller: _2, ComponentProto: $2, determineComponentExports: u2 });
  var v2 = class {
    constructor(e3, t2, i3, o3, s3) {
      if (this._$ = e3, this._$chainingFilter = o3, this._$export = u2(t2, s3), void 0 !== i3) {
        const e4 = t2.map(((e5) => {
          var t3;
          return null !== (t3 = e5._$boundDefinitionFilter) && void 0 !== t3 ? t3 : null;
        }));
        this._$boundDefinitionFilter = (t3) => {
          i3(t3, e4);
        };
      }
    }
  };
  var m2 = class {
    constructor(e3) {
      this._$fieldTypes = void 0, this._$ = e3;
    }
  };
  var f2 = class {
    constructor(e3) {
      this._$ = e3;
    }
  };
  var b2 = Object.freeze({ __proto__: null, Behavior: v2, ComponentType: m2, TraitBehavior: f2 });
  var y2 = class {
    constructor() {
      this._$parents = [];
    }
    implement(e3, t2) {
      return this._$.implement(e3._$, t2), this;
    }
    externalClasses(e3) {
      return this._$.externalClasses(e3), this;
    }
    export(e3) {
      return this._$export = e3, this;
    }
    behavior(e3) {
      return this._$parents.push(e3), this._$ = this._$.behavior(e3._$), e3._$chainingFilter ? e3._$chainingFilter(this) : this;
    }
    data(e3) {
      return this._$.data(e3), this;
    }
    staticData(e3) {
      return this._$.staticData(e3), this;
    }
    property(e3, t2) {
      return this._$.property(e3, t2), this;
    }
    methods(e3) {
      return this._$.methods(e3), this;
    }
    observer(e3, t2, i3 = false) {
      return this._$.observer(e3, t2, i3), this;
    }
    lifetime(e3, t2, i3 = false) {
      return this._$.lifetime(e3, t2, i3), this;
    }
    pageLifetime(e3, t2, i3 = false) {
      return this._$.pageLifetime(e3, t2, i3), this;
    }
    relation(e3, t2) {
      const i3 = t2.target instanceof v2 || t2.target instanceof m2 || t2.target instanceof f2 ? t2.target._$ : t2.target;
      return this._$.relation(e3, { target: i3, type: t2.type, linked: t2.linked, linkChanged: t2.linkChanged, unlinked: t2.unlinked, linkFailed: t2.linkFailed }), this;
    }
    init(t2) {
      return this._$.init((function({ data: i3, setData: o3, implement: s3, relation: r3, observer: n3, lifetime: a3, pageLifetime: l3, method: h3, listener: c3 }) {
        const p3 = this, d3 = t2.call(p3, { self: p3, data: i3, setData: (t3, i4) => {
          o3(t3), i4 && Wt(p3._$, (() => {
            i4();
          }));
        }, implement: (e3, t3) => {
          s3(e3._$, t3);
        }, relation: (e3) => {
          const t3 = e3.target instanceof v2 || e3.target instanceof m2 || e3.target instanceof f2 ? e3.target._$ : e3.target;
          return r3({ target: t3, type: e3.type, linked: e3.linked, linkChanged: e3.linkChanged, unlinked: e3.unlinked, linkFailed: e3.linkFailed });
        }, observer: n3, lifetime: a3, pageLifetime: l3, method: h3, listener: c3 });
        if (d3) {
          const t3 = Object.keys(d3);
          for (let i4 = 0; i4 < t3.length; i4 += 1) {
            const o4 = t3[i4], s4 = d3[o4];
            Ft.isTaggedMethod(s4) && (p3[o4] = s4);
          }
        }
        return d3;
      })), this;
    }
    definition(e3) {
      var t2;
      null === (t2 = e3.behaviors) || void 0 === t2 || t2.forEach(((t3) => {
        var i4;
        return null === (i4 = t3._$boundDefinitionFilter) || void 0 === i4 ? void 0 : i4.call(t3, e3);
      }));
      const i3 = this._$, { behaviors: o3, properties: s3, data: r3, observers: n3, methods: a3, created: l3, attached: h3, ready: c3, moved: p3, detached: d3, lifetimes: u3, pageLifetimes: _3, relations: $3, externalClasses: g3, export: b3 } = e3;
      if (null == o3 || o3.forEach(((e4) => {
        this._$parents.push(e4), i3.behavior(e4._$);
      })), void 0 !== r3 && ("function" == typeof r3 ? i3.data(r3) : i3.staticData(r3)), void 0 !== s3) {
        const e4 = Object.keys(s3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const o4 = e4[t3];
          i3.property(o4, s3[o4]);
        }
      }
      if (void 0 !== n3) if (Array.isArray(n3)) for (let e4 = 0; e4 < n3.length; e4 += 1) {
        const { fields: t3, observer: o4 } = n3[e4];
        i3.observer(t3 || "**", o4);
      }
      else {
        const e4 = Object.keys(n3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const o4 = e4[t3], s4 = n3[o4];
          i3.observer(o4, s4);
        }
      }
      if (a3 && i3.methods(a3), l3 && void 0 === (null == u3 ? void 0 : u3.created) && i3.lifetime("created", l3, true), h3 && void 0 === (null == u3 ? void 0 : u3.attached) && i3.lifetime("attached", h3, true), c3 && void 0 === (null == u3 ? void 0 : u3.ready) && i3.lifetime("ready", c3, true), p3 && void 0 === (null == u3 ? void 0 : u3.moved) && i3.lifetime("moved", p3, true), d3 && void 0 === (null == u3 ? void 0 : u3.detached) && i3.lifetime("detached", d3, true), u3) {
        const e4 = Object.keys(u3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const o4 = e4[t3], s4 = u3[o4];
          i3.lifetime(o4, s4, true);
        }
      }
      if (_3) {
        const e4 = Object.keys(_3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const o4 = e4[t3], s4 = _3[o4];
          i3.pageLifetime(o4, s4, true);
        }
      }
      if ($3) {
        const e4 = Object.keys($3);
        for (let t3 = 0; t3 < e4.length; t3 += 1) {
          const o4 = e4[t3], s4 = $3[o4], r4 = s4.target instanceof v2 || s4.target instanceof m2 || s4.target instanceof f2 ? s4.target._$ : s4.target;
          i3.relation(o4, { target: r4, type: s4.type, linked: s4.linked, linkChanged: s4.linkChanged, unlinked: s4.unlinked, linkFailed: s4.linkFailed });
        }
      }
      return g3 && i3.externalClasses(g3), b3 && (this._$export = b3), this;
    }
  };
  var S2 = class _S extends y2 {
    static create(e3) {
      const t2 = new _S();
      return t2._$codeSpace = e3, t2._$ = e3.getComponentSpace().defineWithMethodCaller(), t2;
    }
    chainingFilter(e3) {
      return this._$chainingFilter = e3, this;
    }
    behavior(e3) {
      return super.behavior(e3);
    }
    export(e3) {
      return super.export(e3);
    }
    data(e3) {
      return super.data(e3);
    }
    staticData(e3) {
      return super.staticData(e3);
    }
    property(e3, t2) {
      return super.property(e3, t2);
    }
    methods(e3) {
      return super.methods(e3);
    }
    init(e3) {
      return super.init(e3);
    }
    definition(e3) {
      return super.definition(e3), e3.definitionFilter && (this._$definitionFilter = e3.definitionFilter), this;
    }
    register() {
      return new v2(this._$.registerBehavior(), this._$parents, this._$definitionFilter, this._$chainingFilter, this._$export);
    }
    extraThisFieldsType() {
      return this;
    }
  };
  var C2 = class _C extends y2 {
    static create(e3, t2, i3) {
      const o3 = new _C(), s3 = e3._$overallBehavior;
      return o3._$codeSpace = e3, o3._$ = e3.getComponentSpace().defineWithMethodCaller(t2 || ""), o3._$is = t2 || "", o3._$alias = i3, o3._$.methodCallerInit((function() {
        const e4 = this;
        let t3 = o3._$proto;
        if (void 0 === t3) {
          const i5 = e4.getComponentDefinition().behavior.getMethods();
          t3 = o3._$proto = new $2(i5, o3._$parents, o3._$export);
        }
        const i4 = t3.derive();
        return i4._$ = e4, i4;
      })), s3 && o3._$.behavior(s3), o3;
    }
    options(e3) {
      return this._$options = e3, this;
    }
    behavior(e3) {
      return super.behavior(e3);
    }
    export(e3) {
      return super.export(e3);
    }
    data(e3) {
      return super.data(e3);
    }
    staticData(e3) {
      return super.staticData(e3);
    }
    property(e3, t2) {
      return super.property(e3, t2);
    }
    methods(e3) {
      return super.methods(e3);
    }
    init(e3) {
      return super.init(e3);
    }
    definition(e3) {
      return super.definition(e3), e3.options && this.options(e3.options), this;
    }
    pageDefinition(t2) {
      const i3 = /* @__PURE__ */ Object.create(null), o3 = { methods: {} }, s3 = Object.keys(t2);
      for (let e3 = 0; e3 < s3.length; e3 += 1) {
        const r4 = s3[e3];
        "data" === r4 ? o3.data = t2.data : "function" == typeof t2[r4] ? o3.methods[r4] = t2[r4] : "methods" === r4 ? i3.methods = t2.methods : o3[r4] = t2[r4];
      }
      this.definition(o3);
      const r3 = Object.keys(o3);
      for (let e3 = 0; e3 < r3.length; e3 += 1) {
        const t3 = r3[e3];
        "data" !== t3 && "methods" !== t3 && "behaviors" !== t3 && (i3[t3] = o3[t3]);
      }
      return this._$.init((function() {
        Object.assign(this, ye.simpleDeepCopy(i3));
      })), this;
    }
    register() {
      var e3;
      const t2 = this._$is, i3 = this._$codeSpace, [o3, s3] = i3.prepareComponentOptions(t2, this._$options);
      this._$.options(o3);
      const r3 = i3.getComponentStaticConfig(t2), n3 = null == r3 ? void 0 : r3.usingComponents, a3 = null == r3 ? void 0 : r3.componentGenerics, l3 = null == r3 ? void 0 : r3.componentPlaceholder;
      n3 && this._$.usingComponents(n3), a3 && this._$.generics(a3), l3 && this._$.placeholders(l3);
      const h3 = i3.getCompiledTemplate(t2);
      h3 && this._$.template(h3), i3._$styleIsolationMap[t2] = s3;
      const c3 = this._$.registerComponent();
      return null === (e3 = this._$alias) || void 0 === e3 || e3.forEach(((e4) => {
        this._$codeSpace.getComponentSpace().exportComponent(e4, this._$is);
      })), new m2(c3);
    }
    extraThisFieldsType() {
      return this;
    }
  };
  var w2 = Object.freeze({ __proto__: null, BehaviorBuilder: S2, ComponentBuilder: C2 });
  var O2 = () => Math.floor(4294967296 * (1 + Math.random())).toString(16).slice(1);
  var k2 = class {
    constructor(t2, i3, o3, s3) {
      this._$overallBehavior = null, this._$env = t2, this._$isMainSpace = i3, this.space = new re("", null == s3 ? void 0 : s3.space, null == s3 ? void 0 : s3.space.styleScopeManager), this.space.__wxCodeSpace = this, this.styleScopeManager = this.space.styleScopeManager, this.staticConfigMap = /* @__PURE__ */ Object.create(null), this.styleSheetMap = /* @__PURE__ */ Object.create(null), this.compiledTemplateMap = /* @__PURE__ */ Object.create(null), this.waitingAliasMap = /* @__PURE__ */ Object.create(null), Object.keys(o3).forEach(((e3) => {
        const t3 = o3[e3];
        this.waitingAliasMap[t3] ? this.waitingAliasMap[t3].push(e3) : this.waitingAliasMap[t3] = [e3];
      })), this._$sharedStyleScope = this.styleScopeManager.register(""), this.space.setSharedStyleScope(this._$sharedStyleScope), this._$styleIsolationMap = /* @__PURE__ */ Object.create(null);
    }
    isMainSpace() {
      return this._$isMainSpace;
    }
    getComponentSpace() {
      return this.space;
    }
    setOverallBehavior(e3) {
      this._$overallBehavior = e3;
    }
    importCodeSpace(e3, t2, i3 = false) {
      const o3 = this._$env.getCodeSpace(e3);
      if (!o3) throw new Error(`There is no space "${e3}" in the environment`);
      t2 && this.space.importSpace(`plugin://${t2}`, o3.space, false), i3 && this.space.importSpace(`plugin-private://${e3}`, o3.space, true);
    }
    addStyleSheet(e3, t2, i3) {
      this.styleSheetMap[e3] = { url: t2, styleScopeName: i3 };
    }
    getStyleSheet(e3) {
      var t2;
      return null === (t2 = this.styleSheetMap[e3]) || void 0 === t2 ? void 0 : t2.url;
    }
    getStyleScopeName(e3) {
      var t2;
      return null === (t2 = this.styleSheetMap[e3]) || void 0 === t2 ? void 0 : t2.styleScopeName;
    }
    addCompiledTemplate(e3, t2) {
      this.compiledTemplateMap[e3] = t2;
    }
    getCompiledTemplate(e3) {
      return this.compiledTemplateMap[e3];
    }
    addComponentStaticConfig(e3, t2) {
      this.staticConfigMap[e3] = t2;
    }
    getComponentStaticConfig(e3) {
      return this.staticConfigMap[e3];
    }
    prepareComponentOptions(e3, t2) {
      const i3 = this.staticConfigMap[e3], o3 = null == i3 ? void 0 : i3.pureDataPattern, s3 = o3 ? new RegExp(o3) : null == t2 ? void 0 : t2.pureDataPattern, r3 = null == i3 ? void 0 : i3.addGlobalClass;
      let n3, a3, l3 = null == i3 ? void 0 : i3.styleIsolation;
      void 0 === l3 && (l3 = (null == i3 ? void 0 : i3.component) ? r3 ? "apply-shared" : "isolated" : "shared"), "apply-shared" === l3 || "page-apply-shared" === l3 ? (n3 = this.styleScopeManager.register(this.getStyleScopeName(e3) || `__${O2()}`), a3 = this._$sharedStyleScope) : n3 = "shared" !== l3 && "page-shared" !== l3 || !this._$isMainSpace ? this.styleScopeManager.register(this.getStyleScopeName(e3) || `__${O2()}`) : this._$sharedStyleScope;
      return [{ idPrefixGenerator: O2, multipleSlots: null == t2 ? void 0 : t2.multipleSlots, dynamicSlots: null == t2 ? void 0 : t2.dynamicSlots, pureDataPattern: s3, virtualHost: null == t2 ? void 0 : t2.virtualHost, styleScope: n3, extraStyleScope: a3, dataDeepCopy: null == t2 ? void 0 : t2.dataDeepCopy, propertyPassingDeepCopy: null == t2 ? void 0 : t2.propertyPassingDeepCopy, propertyEarlyInit: null == t2 ? void 0 : t2.propertyEarlyInit, propertyComparer: null == t2 ? void 0 : t2.propertyComparer }, l3];
    }
    globalComponentEnv(e3, t2, i3) {
      return this.componentEnv(t2, (({ Page: t3, Component: o3, Behavior: s3 }) => {
        const r3 = e3.Page, n3 = e3.Component, a3 = e3.Behavior;
        e3.Page = t3, e3.Component = o3, e3.Behavior = s3;
        const l3 = i3();
        return e3.Page = r3, e3.Component = n3, e3.Behavior = a3, l3;
      }));
    }
    componentEnv(e3, t2) {
      const i3 = this;
      function o3(e4) {
        return void 0 !== e4 ? i3.behavior().definition(e4).register() : i3.behavior();
      }
      return o3.trait = i3.traitBehavior.bind(i3), t2({ Page: function(t3) {
        return i3.component(e3).pageDefinition(t3).register();
      }, Component: function(t3) {
        return void 0 !== t3 ? i3.component(e3).definition(t3).register() : i3.component(e3);
      }, Behavior: o3 });
    }
    component(e3) {
      return C2.create(this, e3, this.waitingAliasMap[e3]);
    }
    behavior() {
      return S2.create(this);
    }
    traitBehavior(e3) {
      return new f2(void 0 === e3 ? this.space.defineTraitBehavior() : this.space.defineTraitBehavior(e3));
    }
  };
  var x2 = class {
    constructor() {
      this.codeSpaceMap = /* @__PURE__ */ Object.create(null), this.globalCodeSpace = new k2(this, false, {});
    }
    getGlobalCodeSpace() {
      return this.globalCodeSpace;
    }
    associateBackend(t2) {
      const o3 = null != t2 ? t2 : new j();
      return new i2(this, o3);
    }
    createCodeSpace(e3, t2, i3 = /* @__PURE__ */ Object.create(null)) {
      const o3 = new k2(this, t2, i3, this.globalCodeSpace);
      return this.codeSpaceMap[e3] = o3, o3;
    }
    getCodeSpace(e3) {
      return this.codeSpaceMap[e3];
    }
  };
  var M2;
  !(function(e3) {
    e3.Isolated = "isolated", e3.ApplyShared = "apply-shared", e3.Shared = "shared", e3.PageIsolated = "page-isolated", e3.PageApplyShared = "page-apply-shared", e3.PageShared = "page-shared";
  })(M2 || (M2 = {}));
  var D2 = Object.freeze({ __proto__: null, get StyleIsolation() {
    return M2;
  }, utils: ee });

  // miniapp/client/style-values.mjs
  function quotedEnd(source, start) {
    const quote = source[start];
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === "\\") index += 2;
      else if (source[index++] === quote) return index;
    }
    return source.length;
  }
  function functionEnd(source, open) {
    let depth = 1;
    let index = open + 1;
    while (index < source.length) {
      const char = source[index];
      if (char === '"' || char === "'") index = quotedEnd(source, index);
      else if (char === "/" && source[index + 1] === "*") {
        const end = source.indexOf("*/", index + 2);
        index = end < 0 ? source.length : end + 2;
      } else if (char === "\\") index += 2;
      else {
        index++;
        if (char === "(") depth++;
        if (char === ")" && --depth === 0) return index;
      }
    }
    return source.length;
  }
  function convertStyleValues(value) {
    const source = String(value);
    let out = "";
    let index = 0;
    while (index < source.length) {
      const char = source[index];
      if (char === '"' || char === "'") {
        const end = quotedEnd(source, index);
        out += source.slice(index, end);
        index = end;
        continue;
      }
      if (char === "/" && source[index + 1] === "*") {
        const close = source.indexOf("*/", index + 2);
        const end = close < 0 ? source.length : close + 2;
        out += source.slice(index, end);
        index = end;
        continue;
      }
      const boundary = index === 0 || !/[\w.\\-]/.test(source[index - 1]);
      if (boundary) {
        const fn = /^(url|env|constant)\s*\(/i.exec(source.slice(index));
        if (fn) {
          const open = index + fn[0].length - 1;
          const end = functionEnd(source, open);
          if (fn[1].toLowerCase() === "url") out += source.slice(index, end);
          else {
            const body = source.slice(open + 1, end - 1).trim();
            const safe = /^safe-area-inset-(top|right|bottom|left)(?:\s*,[\s\S]*)?$/i.exec(body);
            out += safe && source[end - 1] === ")" ? `var(--wx-safe-area-inset-${safe[1].toLowerCase()})` : source.slice(index, end);
          }
          index = end;
          continue;
        }
        const unit = /^(-?(?:\d+\.?\d*|\.\d+))(rpx|svh|lvh|dvh|vh)\b/i.exec(source.slice(index));
        if (unit) {
          out += Number(unit[1]) === 0 ? "0" : `calc(${unit[1]} * var(--wx-${unit[2].toLowerCase() === "rpx" ? "rpx" : "vh"}))`;
          index += unit[0].length;
          continue;
        }
      }
      out += char;
      index++;
    }
    return out;
  }

  // miniapp/client/css-urls.mjs
  function quotedEnd2(source, start) {
    const quote = source[start];
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === "\\") index += 2;
      else if (source[index++] === quote) return index;
    }
    return -1;
  }
  function decodeCssString(source) {
    return source.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\r\f ])?|\r\n|[\n\r\f]|([\s\S]))/gi, (_match, hexadecimal, escaped) => {
      if (hexadecimal) {
        const code = parseInt(hexadecimal, 16);
        return code === 0 || code > 1114111 || code >= 55296 && code <= 57343 ? "\uFFFD" : String.fromCodePoint(code);
      }
      return escaped || "";
    });
  }
  function quoteCssString(source) {
    return '"' + source.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, (char) => "\\" + char.charCodeAt(0).toString(16) + " ") + '"';
  }
  function rewriteCssUrls(value, transform) {
    const source = String(value);
    let index = 0;
    let output = "";
    while (index < source.length) {
      const char = source[index];
      if (char === '"' || char === "'") {
        const end = quotedEnd2(source, index);
        if (end < 0) {
          output += source.slice(index);
          break;
        }
        output += source.slice(index, end);
        index = end;
        continue;
      }
      if (source.startsWith("/*", index)) {
        const close = source.indexOf("*/", index + 2);
        const end = close < 0 ? source.length : close + 2;
        output += source.slice(index, end);
        index = end;
        continue;
      }
      if ((index === 0 || !/[\w-]/.test(source[index - 1])) && /^url\s*\(/i.test(source.slice(index))) {
        const open = source.indexOf("(", index);
        let start = open + 1;
        while (start < source.length && /\s/.test(source[start])) start++;
        const quoted = source[start] === '"' || source[start] === "'";
        let end = quoted ? quotedEnd2(source, start) : start;
        if (!quoted) while (end < source.length && source[end] !== ")") end += source[end] === "\\" ? 2 : 1;
        if (end < 0 || end >= source.length) {
          output += source.slice(index);
          break;
        }
        let close = end;
        while (close < source.length && /\s/.test(source[close])) close++;
        if (source[close] !== ")") {
          output += source[index++];
          continue;
        }
        const raw = quoted ? source.slice(start + 1, end - 1) : source.slice(start, end).trim();
        const decoded = decodeCssString(raw);
        const result = transform(decoded);
        output += typeof result !== "string" || result === decoded ? source.slice(index, close + 1) : "url(" + quoteCssString(result) + ")";
        index = close + 1;
        continue;
      }
      output += source[index++];
    }
    return output;
  }

  // src/component-runtime.mjs
  function createRuntime(host) {
    const environment = new x2();
    const codeSpace = environment.createCodeSpace("preview", true);
    const space = codeSpace.getComponentSpace();
    const definitions = /* @__PURE__ */ new Map();
    const metadata = /* @__PURE__ */ new WeakMap();
    const callers = /* @__PURE__ */ new WeakMap();
    const domNodes = /* @__PURE__ */ new WeakMap();
    const records = /* @__PURE__ */ new WeakMap();
    const disposedNodes = /* @__PURE__ */ new WeakSet();
    const pageHandles = /* @__PURE__ */ new Set();
    let pendingPage = null;
    let pendingNative = null;
    let counter = 0;
    class PreviewBackend extends j {
      constructor() {
        super();
        this.document = {
          createElement(tag) {
            if (pendingNative) {
              const request = pendingNative;
              pendingNative = null;
              return request.existing || host.createNative(request.vnode);
            }
            return document.createElement(tag);
          },
          createTextNode: (text) => document.createTextNode(text),
          createDocumentFragment: () => document.createDocumentFragment()
        };
      }
      // sim-runtime is the sole native input source; the backend must not add a
      // second set of click/touch delegates beside that translation layer.
      onEvent() {
      }
      setListenerStats() {
      }
      render(callback) {
        setTimeout(() => callback(null), 0);
      }
    }
    const backend = environment.associateBackend(new PreviewBackend());
    function componentMetadata(component) {
      let meta = metadata.get(component);
      if (meta) return meta;
      const parent = component.ownerShadowRoot?.getHostNode();
      const page = parent ? componentMetadata(parent).page : pendingPage;
      if (!page) throw new Error("Component has no owning preview page");
      const definition = definitions.get(component.is);
      const caller = component.getMethodCaller();
      meta = { component, page, caller, definition, disposed: false, readyTimer: null, propsReady: !parent, templateInitialized: false, rendered: false };
      metadata.set(component, meta);
      callers.set(caller, meta);
      const setData = caller.setData.bind(caller);
      caller.setData = (patch, callback) => {
        if (meta.disposed || !page.alive) return;
        setData(patch, typeof callback === "function" ? () => {
          if (!meta.disposed && page.alive) callback.call(caller);
        } : void 0);
      };
      for (const name of ["updateData", "applyDataUpdates", "replaceDataOnPath", "spliceArrayDataOnPath", "groupUpdates", "groupSetData"]) {
        const implementation = caller[name]?.bind(caller);
        if (implementation) caller[name] = (...args) => {
          if (meta.disposed || !page.alive) return;
          return implementation(...args);
        };
      }
      if (page.componentPage && !parent) page.caller = caller;
      const owner = page.componentPage || parent ? caller : page.caller;
      meta.owner = owner;
      host.prepareOwner(owner, definition, component.getBackendElement(), page.caller, ++counter);
      return meta;
    }
    const lifecycle = space.define().lifetime("attached", function() {
      const meta = callers.get(this);
      if (!meta || meta.disposed) return;
      clearTimeout(meta.readyTimer);
      meta.readyTimer = setTimeout(() => {
        if (!meta.disposed && meta.page.alive && tt.isAttached(meta.component)) {
          meta.component.triggerLifetime("ready", []);
        }
      }, 0);
    }).lifetime("detached", function() {
      const meta = callers.get(this);
      if (!meta || meta.disposed) return;
      meta.disposed = true;
      clearTimeout(meta.readyTimer);
      host.disposeOwner(meta.owner, meta.page.caller);
    }).registerBehavior();
    codeSpace.setOverallBehavior(lifecycle);
    const templateEngine = {
      create(behavior) {
        const id = behavior.getTemplate().previewId;
        return {
          createInstance(component, createShadowRoot) {
            const shadowRoot = createShadowRoot(component);
            const parent = component.ownerShadowRoot?.getHostNode();
            const page = parent ? componentMetadata(parent).page : pendingPage;
            if (page) {
              page.components.add(component);
              page.nodes.add(component);
            }
            let lastData;
            function render(data) {
              lastData = data;
              const meta = componentMetadata(component);
              meta.templateInitialized = true;
              if (meta.disposed || !meta.page.alive) return;
              if (!meta.propsReady) return;
              if (meta.definition.synthetic && !meta.page.rendering) return;
              const source = meta.definition.synthetic ? meta.page.data : data;
              const before = new Set(meta.page.nodes);
              try {
                const vnodes = host.render(id, source, meta.owner);
                patchChildren(shadowRoot, vnodes, shadowRoot, meta.page);
                meta.rendered = true;
                host.afterRender(meta.page.caller);
              } catch (error) {
                releaseAllocations(meta.page, before);
                throw error;
              }
            }
            return {
              shadowRoot,
              initValues: render,
              updateValues: render,
              updateTemplate() {
                render(lastData);
              }
            };
          }
        };
      }
    };
    space.updateComponentOptions({ templateEngine, hostNodeTagName: "*", writeIdToDOM: false });
    const onError = (error, _method, component) => {
      host.reportError(error, typeof component === "object" ? metadata.get(component)?.owner : void 0);
      return false;
    };
    const onWarning = (message) => {
      host.reportWarning(message);
      return false;
    };
    A(onError);
    B(onWarning);
    function setCommon(node, vnode) {
      node.id = vnode.props?.id == null ? "" : String(vnode.props.id);
      node.dataset = { ...vnode.dataset || {} };
      node.slot = vnode.slot || "";
      node.setNodeClass(vnode.cls || "");
      const record = records.get(node);
      for (const listener of record.listeners || []) node.removeListener(listener.type, listener.fn, listener.options);
      record.listeners = (vnode.ev || []).map((handler) => {
        const options = { capture: handler.capture, final: handler.catch, mutated: handler.mut };
        const fn = (event) => {
          if (!record.page.alive) return;
          const native = event.getOriginalEvent();
          const touches = native && native.clientX !== void 0 ? [{ identifier: 0, clientX: native.clientX, clientY: native.clientY, pageX: native.pageX, pageY: native.pageY }] : [];
          return host.invoke(handler, {
            type: event.type,
            timeStamp: event.timeStamp,
            target: nodeInfo(records.get(event.target)?.vnode?.type === "slot" && event.previewOrigin ? event.previewOrigin : event.target),
            currentTarget: nodeInfo(event.currentTarget),
            detail: event.detail === void 0 ? {} : event.detail,
            touches,
            changedTouches: touches,
            mark: event.mark || {}
          });
        };
        node.addListener(handler.type, fn, options);
        return { type: handler.type, fn, options };
      });
    }
    function nodeInfo(node) {
      const element = node?.getBackendElement?.();
      return { id: node?.id || "", dataset: node?.dataset || {}, offsetLeft: element?.offsetLeft || 0, offsetTop: element?.offsetTop || 0 };
    }
    function updateComponent(node, vnode, initializing = false) {
      const meta = componentMetadata(node);
      if (initializing) meta.propsReady = true;
      const externalChanged = host.updateOwner(meta.owner, vnode, (name) => node.hasExternalClass(name));
      const record = records.get(node);
      if (!record.properties) record.properties = /* @__PURE__ */ new Map();
      const proxy = Ft.getDataProxy(node);
      let changed = false;
      for (const [name, value] of Object.entries(vnode.props)) {
        const property = name.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
        if (!Ft.hasProperty(node, property)) continue;
        const object = value !== null && typeof value === "object";
        const fingerprint = object ? JSON.stringify(value) : value;
        const previous = record.properties.get(property);
        if (previous && previous.object === object && Object.is(previous.value, fingerprint)) continue;
        record.properties.set(property, { object, value: fingerprint });
        changed = proxy.replaceProperty(property, value) || changed;
      }
      if (changed) node.applyDataUpdates();
      if (!meta.rendered && meta.templateInitialized || externalChanged && !changed && !initializing) node.applyTemplateUpdates();
      const element = node.getBackendElement();
      if (element) host.updateHost(element, vnode, node.is);
    }
    function makeNode(vnode, shadowRoot, page) {
      if (vnode.text !== void 0) {
        const node2 = shadowRoot.createTextNode(vnode.text);
        records.set(node2, { vnode, page });
        page.nodes.add(node2);
        return node2;
      }
      let node;
      if (vnode.type === "slot") {
        node = shadowRoot.createVirtualNode("slot");
        tt.setSlotName(node, vnode.slotName);
      } else if (vnode.comp) {
        ensureRegistered(vnode.comp);
        const definition = space.getComponentByUrl("/" + vnode.comp, "");
        node = shadowRoot.createComponentByDef(vnode.tag, definition, void 0, void 0, (component) => {
          records.set(component, { vnode: null, page, listeners: [], container: component });
          component.id = vnode.props.id == null ? "" : String(vnode.props.id);
          component.dataset = { ...vnode.dataset || {} };
          updateComponent(component, vnode, true);
        });
      } else {
        pendingNative = { vnode };
        try {
          node = shadowRoot.createNativeNode("wx-" + vnode.tag);
        } finally {
          pendingNative = null;
        }
      }
      const record = records.get(node) || { vnode: null, page, listeners: [], container: node };
      records.set(node, record);
      page.nodes.add(node);
      const element = node.getBackendElement();
      if (element) domNodes.set(element, node);
      if (!vnode.comp && vnode.type !== "slot") {
        const container = host.nativeContainer(element);
        if (container && container !== element) {
          pendingNative = { existing: container };
          let internal;
          try {
            internal = shadowRoot.createNativeNode(container.tagName.toLowerCase());
          } finally {
            pendingNative = null;
          }
          records.set(internal, { internal: true, page });
          page.nodes.add(internal);
          node.appendChild(internal);
          record.container = internal;
        } else if (!container) record.container = null;
      }
      updateNode(node, vnode, shadowRoot, page);
      return node;
    }
    function updateNode(node, vnode, shadowRoot, page) {
      const record = records.get(node);
      const previous = record.vnode;
      record.vnode = vnode;
      if (vnode.text !== void 0) {
        node.textContent = vnode.text;
        return;
      }
      if (vnode.type === "slot") {
        tt.setSlotName(node, vnode.slotName);
        return;
      }
      setCommon(node, vnode);
      if (vnode.comp) {
        updateComponent(node, vnode);
        patchChildren(node, vnode.children, shadowRoot, page);
      } else {
        const element = node.getBackendElement();
        host.updateNative(element, vnode, previous, page.caller);
        if (record.container) patchChildren(record.container, vnode.children, shadowRoot, page);
        host.afterNative(element, vnode, previous, page.caller);
      }
    }
    function sameNode(node, vnode) {
      const prior = records.get(node)?.vnode;
      return prior && (vnode.text !== void 0 ? prior.text !== void 0 : prior.type === vnode.type);
    }
    function disposeNode(node) {
      if (disposedNodes.has(node)) return;
      disposedNodes.add(node);
      const record = records.get(node);
      if (record) {
        for (const listener of record.listeners || []) node.removeListener(listener.type, listener.fn, listener.options);
        const element = node.getBackendElement?.();
        if (element) {
          domNodes.delete(element);
          host.disposeNative(element);
        }
      }
      if (Ft.isComponent(node)) {
        const meta = metadata.get(node);
        if (meta) {
          clearTimeout(meta.readyTimer);
          meta.disposed = true;
          host.disposeOwner(meta.owner, meta.page.caller);
          meta.page.nodes.delete(node);
          meta.page.components.delete(node);
        }
        for (const child of node.getShadowRoot()?.childNodes || []) disposeNode(child);
      }
      for (const child of node.childNodes || []) disposeNode(child);
      record?.page.nodes.delete(node);
    }
    function releaseAllocations(page, preserve = /* @__PURE__ */ new Set()) {
      for (const node of [...page.nodes]) {
        if (preserve.has(node)) continue;
        if (node.parentNode) node.parentNode.removeChild(node);
        disposeNode(node);
        node.destroyBackendElementOnSubtree?.();
      }
    }
    function patchChildren(parent, vnodes, shadowRoot, page) {
      const old = parent.childNodes.filter((node) => !records.get(node)?.internal);
      const keyed = new Map(old.filter((node) => records.get(node)?.vnode?.key !== void 0).map((node) => [records.get(node).vnode.key, node]));
      const unkeyed = old.filter((node) => records.get(node)?.vnode?.key === void 0);
      const used = /* @__PURE__ */ new Set();
      let cursor = 0;
      const next = vnodes.map((vnode) => {
        const candidate = vnode.key !== void 0 ? keyed.get(vnode.key) : unkeyed[cursor++];
        if (candidate && !used.has(candidate) && sameNode(candidate, vnode)) {
          used.add(candidate);
          updateNode(candidate, vnode, shadowRoot, page);
          return candidate;
        }
        return makeNode(vnode, shadowRoot, page);
      });
      for (const node of old) if (!used.has(node)) {
        parent.removeChild(node);
        disposeNode(node);
        node.destroyBackendElementOnSubtree?.();
      }
      next.forEach((node, index) => {
        const before = parent.childNodes.filter((child) => !records.get(child)?.internal)[index];
        if (before !== node) parent.insertBefore(node, before);
      });
    }
    function ensureRegistered(id) {
      if (!definitions.has(id)) host.loadDefinition(id);
      if (!definitions.has(id)) throw new Error('Component "' + id + '" was not registered');
    }
    function register(id, definition, synthetic = false) {
      const unit = host.units[id];
      const finalDefinition = synthetic ? {} : { ...definition, options: { ...definition.options } };
      const builder = codeSpace.component(id).definition(finalDefinition);
      const options = finalDefinition.options || {};
      let isolation = options.styleIsolation || unit.json.styleIsolation || (options.addGlobalClass || unit.json.addGlobalClass ? "apply-shared" : "isolated");
      const notices = [];
      if (!["isolated", "apply-shared", "shared"].includes(isolation)) {
        notices.push('styleIsolation "' + isolation + '" is not supported; preview uses isolated');
        isolation = "isolated";
      }
      if (options.dynamicSlots) notices.push("dynamicSlots is not supported by the preview template bridge");
      if (unit.json.componentGenerics) notices.push("componentGenerics is not supported by the preview template bridge");
      if (unit.kind === "page" && options.virtualHost) notices.push("virtualHost on a Component-declared page is ignored; page roots are explicit");
      const supportedOptions = /* @__PURE__ */ new Set(["multipleSlots", "dynamicSlots", "pureDataPattern", "virtualHost", "dataDeepCopy", "propertyPassingDeepCopy", "propertyEarlyInit", "propertyComparer", "styleIsolation", "addGlobalClass"]);
      for (const key of Object.keys(options)) if (!supportedOptions.has(key)) notices.push('Component option "' + key + '" is not supported by the preview bridge');
      definitions.set(id, { id, options, isolation, synthetic, notices });
      const { componentGenerics: _unsupportedGenerics, ...staticConfig } = unit.json;
      codeSpace.addComponentStaticConfig(id, { ...staticConfig, styleIsolation: "shared", usingComponents: Object.fromEntries(Object.entries(unit.using).map(([name, target]) => [name, "/" + target])) });
      codeSpace.addCompiledTemplate(id, { previewId: id });
      builder.options({ ...options, dynamicSlots: false, ...unit.kind === "page" ? { virtualHost: false } : {} }).register();
      return definitions.get(id);
    }
    return {
      register,
      behavior(definition) {
        return codeSpace.behavior().definition(definition).register();
      },
      createPageRoot({ id, container, caller, componentPage, query }) {
        ensureRegistered(id);
        const page = { id, caller, componentPage, alive: true, rendering: false, data: caller?.data, components: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set() };
        let root;
        pendingPage = page;
        try {
          root = backend.createRoot("wx-page-root", codeSpace, id);
        } catch (error) {
          page.alive = false;
          releaseAllocations(page);
          throw error;
        } finally {
          pendingPage = null;
        }
        const component = root.getComponent();
        const element = component.getBackendElement();
        element.style.display = "contents";
        if (componentPage) {
          const proxy = Ft.getDataProxy(component);
          for (const [name, value] of Object.entries(query || {})) proxy.replaceProperty(name, value);
          component.applyDataUpdates();
        }
        const placeholder = document.createElement("span");
        container.appendChild(placeholder);
        let attached = false;
        const handle = {
          caller: componentPage ? root.get() : caller,
          update(data) {
            if (!page.alive) return;
            page.data = data;
            page.rendering = true;
            if (!componentPage) component.applyTemplateUpdates();
            if (!attached) {
              attached = true;
              root.attach(container, placeholder);
            }
            host.afterRender(page.caller);
          },
          select(selector, all) {
            return all ? root.get().selectAllComponents(selector) : root.get().selectComponent(selector);
          },
          pageLifetime(name, args) {
            if (page.alive) component.triggerPageLifetime(name, args);
          },
          dispose() {
            if (!page.alive) return;
            page.alive = false;
            root.release();
            disposeNode(component);
            releaseAllocations(page);
            page.components.clear();
            element.remove();
            placeholder.remove();
            pageHandles.delete(handle);
          }
        };
        pageHandles.add(handle);
        return handle;
      },
      dispatch(type, element, detail, nativeEvent, options) {
        while (element && !domNodes.has(element)) element = element.parentNode;
        const node = element && domNodes.get(element);
        if (!node || !records.get(node)?.page.alive) return;
        let result;
        qe.triggerEvent(node, type, detail, {
          ...options,
          originalEvent: nativeEvent,
          extraFields: { previewOrigin: node },
          handleListenerReturn(value) {
            if (value !== void 0) result = value;
          }
        });
        return result;
      },
      dispose() {
        for (const handle of pageHandles) handle.dispose();
        T(onError);
        D(onWarning);
      }
    };
  }
  return __toCommonJS(component_runtime_exports);
})();
