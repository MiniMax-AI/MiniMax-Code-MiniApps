import * as glassEasel from 'glass-easel';
import { MiniProgramEnv } from 'glass-easel-miniprogram-adapter';
export { convertStyleValues } from '../miniapp/client/style-values.mjs';
export { rewriteCssUrls } from '../miniapp/client/css-urls.mjs';

// The DOM backend owns every template node. Native controls may own private DOM
// children (an input, image, etc.), but never update a component/template subtree.
export function createRuntime(host) {
  const environment = new MiniProgramEnv();
  const codeSpace = environment.createCodeSpace('preview', true);
  const space = codeSpace.getComponentSpace();
  const definitions = new Map();
  const metadata = new WeakMap();
  const callers = new WeakMap();
  const domNodes = new WeakMap();
  const records = new WeakMap();
  const disposedNodes = new WeakSet();
  const pageHandles = new Set();
  let pendingPage = null;
  let pendingNative = null;
  let counter = 0;

  class PreviewBackend extends glassEasel.CurrentWindowBackendContext {
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
        createDocumentFragment: () => document.createDocumentFragment(),
      };
    }

    // sim-runtime is the sole native input source; the backend must not add a
    // second set of click/touch delegates beside that translation layer.
    onEvent() {}
    setListenerStats() {}
    render(callback) { setTimeout(() => callback(null), 0); }
  }

  const backend = environment.associateBackend(new PreviewBackend());

  function componentMetadata(component) {
    let meta = metadata.get(component);
    if (meta) return meta;
    const parent = component.ownerShadowRoot?.getHostNode();
    const page = parent ? componentMetadata(parent).page : pendingPage;
    if (!page) throw new Error('Component has no owning preview page');
    const definition = definitions.get(component.is);
    const caller = component.getMethodCaller();
    meta = { component, page, caller, definition, disposed: false, readyTimer: null, propsReady: !parent, templateInitialized: false, rendered: false };
    metadata.set(component, meta);
    callers.set(caller, meta);
    const setData = caller.setData.bind(caller);
    caller.setData = (patch, callback) => {
      if (meta.disposed || !page.alive) return;
      setData(patch, typeof callback === 'function' ? () => {
        if (!meta.disposed && page.alive) callback.call(caller);
      } : undefined);
    };
    for (const name of ['updateData', 'applyDataUpdates', 'replaceDataOnPath', 'spliceArrayDataOnPath', 'groupUpdates', 'groupSetData']) {
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

  const lifecycle = space.define()
    .lifetime('attached', function () {
      const meta = callers.get(this);
      if (!meta || meta.disposed) return;
      clearTimeout(meta.readyTimer);
      meta.readyTimer = setTimeout(() => {
        if (!meta.disposed && meta.page.alive && glassEasel.Element.isAttached(meta.component)) {
          meta.component.triggerLifetime('ready', []);
        }
      }, 0);
    })
    .lifetime('detached', function () {
      const meta = callers.get(this);
      if (!meta || meta.disposed) return;
      meta.disposed = true;
      clearTimeout(meta.readyTimer);
      host.disposeOwner(meta.owner, meta.page.caller);
    })
    .registerBehavior();
  codeSpace.setOverallBehavior(lifecycle);

  const templateEngine = {
    create(behavior) {
      const id = behavior.getTemplate().previewId;
      return {
        createInstance(component, createShadowRoot) {
          const shadowRoot = createShadowRoot(component);
          const parent = component.ownerShadowRoot?.getHostNode();
          const page = parent ? componentMetadata(parent).page : pendingPage;
          if (page) { page.components.add(component); page.nodes.add(component); }
          let lastData;
          function render(data) {
            lastData = data;
            const meta = componentMetadata(component);
            meta.templateInitialized = true;
            if (meta.disposed || !meta.page.alive) return;
            // The default adapter creates template data before passing parent
            // properties. Do not diagnose that internal pre-prop snapshot as a
            // user expression error; real assigned null values still render.
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
              // New siblings may not yet belong to a parent. Dispose from the
              // allocation set, without touching a previously mounted subtree.
              releaseAllocations(meta.page, before);
              throw error;
            }
          }
          return {
            shadowRoot,
            initValues: render,
            updateValues: render,
            updateTemplate() { render(lastData); },
          };
        },
      };
    },
  };
  space.updateComponentOptions({ templateEngine, hostNodeTagName: '*', writeIdToDOM: false });

  const onError = (error, _method, component) => {
    host.reportError(error, typeof component === 'object' ? metadata.get(component)?.owner : undefined);
    return false;
  };
  const onWarning = (message) => { host.reportWarning(message); return false; };
  glassEasel.addGlobalErrorListener(onError);
  glassEasel.addGlobalWarningListener(onWarning);

  function setCommon(node, vnode) {
    node.id = vnode.props?.id == null ? '' : String(vnode.props.id);
    node.dataset = { ...(vnode.dataset || {}) };
    node.slot = vnode.slot || '';
    node.setNodeClass(vnode.cls || '');
    const record = records.get(node);
    for (const listener of record.listeners || []) node.removeListener(listener.type, listener.fn, listener.options);
    record.listeners = (vnode.ev || []).map((handler) => {
      const options = { capture: handler.capture, final: handler.catch, mutated: handler.mut };
      const fn = (event) => {
        if (!record.page.alive) return;
        const native = event.getOriginalEvent();
        const touches = native && native.clientX !== undefined
          ? [{ identifier: 0, clientX: native.clientX, clientY: native.clientY, pageX: native.pageX, pageY: native.pageY }]
          : [];
        return host.invoke(handler, {
          type: event.type,
          timeStamp: event.timeStamp,
          target: nodeInfo(records.get(event.target)?.vnode?.type === 'slot' && event.previewOrigin ? event.previewOrigin : event.target),
          currentTarget: nodeInfo(event.currentTarget),
          detail: event.detail === undefined ? {} : event.detail,
          touches,
          changedTouches: touches,
          mark: event.mark || {},
        });
      };
      node.addListener(handler.type, fn, options);
      return { type: handler.type, fn, options };
    });
  }

  function nodeInfo(node) {
    const element = node?.getBackendElement?.();
    return { id: node?.id || '', dataset: node?.dataset || {}, offsetLeft: element?.offsetLeft || 0, offsetTop: element?.offsetTop || 0 };
  }

  function updateComponent(node, vnode, initializing = false) {
    const meta = componentMetadata(node);
    if (initializing) meta.propsReady = true;
    const externalChanged = host.updateOwner(meta.owner, vnode, (name) => node.hasExternalClass(name));
    const record = records.get(node);
    if (!record.properties) record.properties = new Map();
    const proxy = glassEasel.Component.getDataProxy(node);
    let changed = false;
    for (const [name, value] of Object.entries(vnode.props)) {
      const property = name.replace(/-([a-z])/g, (_match, char) => char.toUpperCase());
      if (!glassEasel.Component.hasProperty(node, property)) continue;
      const object = value !== null && typeof value === 'object';
      const fingerprint = object ? JSON.stringify(value) : value;
      const previous = record.properties.get(property);
      if (previous && previous.object === object && Object.is(previous.value, fingerprint)) continue;
      record.properties.set(property, { object, value: fingerprint });
      changed = proxy.replaceProperty(property, value) || changed;
    }
    if (changed) node.applyDataUpdates();
    if ((!meta.rendered && meta.templateInitialized) || (externalChanged && !changed && !initializing)) node.applyTemplateUpdates();
    const element = node.getBackendElement();
    if (element) host.updateHost(element, vnode, node.is);
  }

  function makeNode(vnode, shadowRoot, page) {
    if (vnode.text !== undefined) {
      const node = shadowRoot.createTextNode(vnode.text);
      records.set(node, { vnode, page });
      page.nodes.add(node);
      return node;
    }
    let node;
    if (vnode.type === 'slot') {
      node = shadowRoot.createVirtualNode('slot');
      glassEasel.Element.setSlotName(node, vnode.slotName);
    } else if (vnode.comp) {
      ensureRegistered(vnode.comp);
      const definition = space.getComponentByUrl('/' + vnode.comp, '');
      node = shadowRoot.createComponentByDef(vnode.tag, definition, undefined, undefined, (component) => {
        records.set(component, { vnode: null, page, listeners: [], container: component });
        component.id = vnode.props.id == null ? '' : String(vnode.props.id);
        component.dataset = { ...(vnode.dataset || {}) };
        updateComponent(component, vnode, true);
      });
    } else {
      pendingNative = { vnode };
      try { node = shadowRoot.createNativeNode('wx-' + vnode.tag); } finally { pendingNative = null; }
    }
    const record = records.get(node) || { vnode: null, page, listeners: [], container: node };
    records.set(node, record);
    page.nodes.add(node);
    const element = node.getBackendElement();
    if (element) domNodes.set(element, node);
    if (!vnode.comp && vnode.type !== 'slot') {
      const container = host.nativeContainer(element);
      if (container && container !== element) {
        pendingNative = { existing: container };
        let internal;
        try { internal = shadowRoot.createNativeNode(container.tagName.toLowerCase()); } finally { pendingNative = null; }
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
    if (vnode.text !== undefined) {
      node.textContent = vnode.text;
      return;
    }
    if (vnode.type === 'slot') {
      glassEasel.Element.setSlotName(node, vnode.slotName);
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
    return prior && (vnode.text !== undefined ? prior.text !== undefined : prior.type === vnode.type);
  }

  function disposeNode(node) {
    if (disposedNodes.has(node)) return;
    disposedNodes.add(node);
    const record = records.get(node);
    if (record) {
      for (const listener of record.listeners || []) node.removeListener(listener.type, listener.fn, listener.options);
      const element = node.getBackendElement?.();
      if (element) { domNodes.delete(element); host.disposeNative(element); }
    }
    if (glassEasel.Component.isComponent(node)) {
      const meta = metadata.get(node);
      if (meta) { clearTimeout(meta.readyTimer); meta.disposed = true; host.disposeOwner(meta.owner, meta.page.caller); meta.page.nodes.delete(node); meta.page.components.delete(node); }
      for (const child of node.getShadowRoot()?.childNodes || []) disposeNode(child);
    }
    for (const child of node.childNodes || []) disposeNode(child);
    record?.page.nodes.delete(node);
  }

  function releaseAllocations(page, preserve = new Set()) {
    for (const node of [...page.nodes]) {
      if (preserve.has(node)) continue;
      if (node.parentNode) node.parentNode.removeChild(node);
      disposeNode(node);
      node.destroyBackendElementOnSubtree?.();
    }
  }

  function patchChildren(parent, vnodes, shadowRoot, page) {
    const old = parent.childNodes.filter((node) => !records.get(node)?.internal);
    const keyed = new Map(old.filter((node) => records.get(node)?.vnode?.key !== undefined).map((node) => [records.get(node).vnode.key, node]));
    const unkeyed = old.filter((node) => records.get(node)?.vnode?.key === undefined);
    const used = new Set();
    let cursor = 0;
    const next = vnodes.map((vnode) => {
      const candidate = vnode.key !== undefined ? keyed.get(vnode.key) : unkeyed[cursor++];
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
    // definition() runs Behavior definitionFilters before we read final options.
    const builder = codeSpace.component(id).definition(finalDefinition);
    const options = finalDefinition.options || {};
    let isolation = options.styleIsolation || unit.json.styleIsolation || ((options.addGlobalClass || unit.json.addGlobalClass) ? 'apply-shared' : 'isolated');
    const notices = [];
    if (!['isolated', 'apply-shared', 'shared'].includes(isolation)) {
      notices.push('styleIsolation "' + isolation + '" is not supported; preview uses isolated');
      isolation = 'isolated';
    }
    if (options.dynamicSlots) notices.push('dynamicSlots is not supported by the preview template bridge');
    if (unit.json.componentGenerics) notices.push('componentGenerics is not supported by the preview template bridge');
    if (unit.kind === 'page' && options.virtualHost) notices.push('virtualHost on a Component-declared page is ignored; page roots are explicit');
    const supportedOptions = new Set(['multipleSlots', 'dynamicSlots', 'pureDataPattern', 'virtualHost', 'dataDeepCopy', 'propertyPassingDeepCopy', 'propertyEarlyInit', 'propertyComparer', 'styleIsolation', 'addGlobalClass']);
    for (const key of Object.keys(options)) if (!supportedOptions.has(key)) notices.push('Component option "' + key + '" is not supported by the preview bridge');
    definitions.set(id, { id, options, isolation, synthetic, notices });
    // WXSS is already scoped by the preview compiler. Keep glass-easel's class
    // namespace global so that there is exactly one CSS scoper, not two.
    const { componentGenerics: _unsupportedGenerics, ...staticConfig } = unit.json;
    codeSpace.addComponentStaticConfig(id, { ...staticConfig, styleIsolation: 'shared', usingComponents: Object.fromEntries(Object.entries(unit.using).map(([name, target]) => [name, '/' + target])) });
    codeSpace.addCompiledTemplate(id, { previewId: id });
    builder.options({ ...options, dynamicSlots: false, ...(unit.kind === 'page' ? { virtualHost: false } : {}) }).register();
    return definitions.get(id);
  }

  return {
    register,
    behavior(definition) { return codeSpace.behavior().definition(definition).register(); },
    createPageRoot({ id, container, caller, componentPage, query }) {
      ensureRegistered(id);
      const page = { id, caller, componentPage, alive: true, rendering: false, data: caller?.data, components: new Set(), nodes: new Set() };
      let root;
      pendingPage = page;
      try {
        root = backend.createRoot('wx-page-root', codeSpace, id);
      } catch (error) {
        page.alive = false;
        releaseAllocations(page);
        throw error;
      } finally { pendingPage = null; }
      const component = root.getComponent();
      const element = component.getBackendElement();
      element.style.display = 'contents';
      if (componentPage) {
        const proxy = glassEasel.Component.getDataProxy(component);
        for (const [name, value] of Object.entries(query || {})) proxy.replaceProperty(name, value);
        component.applyDataUpdates();
      }
      const placeholder = document.createElement('span');
      container.appendChild(placeholder);
      let attached = false;
      const handle = {
        caller: componentPage ? root.get() : caller,
        update(data) {
          if (!page.alive) return;
          page.data = data;
          page.rendering = true;
          if (!componentPage) component.applyTemplateUpdates();
          if (!attached) { attached = true; root.attach(container, placeholder); }
          host.afterRender(page.caller);
        },
        select(selector, all) { return all ? root.get().selectAllComponents(selector) : root.get().selectComponent(selector); },
        pageLifetime(name, args) { if (page.alive) component.triggerPageLifetime(name, args); },
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
        },
      };
      pageHandles.add(handle);
      return handle;
    },
    dispatch(type, element, detail, nativeEvent, options) {
      while (element && !domNodes.has(element)) element = element.parentNode;
      const node = element && domNodes.get(element);
      if (!node || !records.get(node)?.page.alive) return;
      let result;
      glassEasel.Event.triggerEvent(node, type, detail, {
        ...options,
        originalEvent: nativeEvent,
        extraFields: { previewOrigin: node },
        handleListenerReturn(value) { if (value !== undefined) result = value; },
      });
      return result;
    },
    dispose() {
      for (const handle of pageHandles) handle.dispose();
      glassEasel.removeGlobalErrorListener(onError);
      glassEasel.removeGlobalWarningListener(onWarning);
    },
  };
}
