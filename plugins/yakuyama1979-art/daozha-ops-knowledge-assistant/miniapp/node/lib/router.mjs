// Hybrid routing: local Ollama models and the online model, with explicit degradation.

import {
  LARGE_MODEL_CTX,
  LARGE_MODEL_PARAM_B,
  PREFERRED_CHAT_MODEL,
  SMALL_MODEL_CTX,
} from './ollama.mjs';

export const ROUTING_MODES = [
  {
    id: 'auto',
    label: '自动',
    hint: '按内容体量与本地模型能力自动选择，本地不可用或在线失败时双向降级',
  },
  {
    id: 'local_first',
    label: '本地优先',
    hint: '始终先调用本地模型，本地失败降级到在线模型',
  },
  {
    id: 'local_only',
    label: '仅本地',
    hint: '只调用本地 Ollama，不做任何在线降级',
  },
  {
    id: 'online_only',
    label: '仅在线',
    hint: '只调用在线模型，不做任何本地降级',
  },
];

export const ROUTING_MODE_IDS = ROUTING_MODES.map((mode) => mode.id);

export function isRoutingMode(value) {
  return ROUTING_MODE_IDS.includes(value);
}

export function parameterSizeB(model) {
  const raw = String((model && model.details && model.details.parameter_size) || '');
  const matched = /([\d.]+)/.exec(raw);
  return matched ? Number.parseFloat(matched[1]) : 0;
}

export function isLargeModel(model) {
  return parameterSizeB(model) >= LARGE_MODEL_PARAM_B;
}

/** Fixed context policy from the product rules: 14B → 8K, smaller models → 16K. */
export function numCtxFor(model) {
  return isLargeModel(model) ? LARGE_MODEL_CTX : SMALL_MODEL_CTX;
}

export function chatModels(models) {
  return models.filter(
    (model) => Array.isArray(model.capabilities) && model.capabilities.includes('completion'),
  );
}

/**
 * Picks the local chat model for a task.
 * @param {Array<object>} models
 * @param {{ requireLarge?: boolean }} [options]
 */
export function pickLocalModel(models, options = {}) {
  const chats = chatModels(models);
  if (!chats.length) return null;
  const preferred = chats.find((model) =>
    String(model.name).toLowerCase().startsWith(PREFERRED_CHAT_MODEL),
  );
  if (preferred) {
    return {
      name: preferred.name,
      numCtx: numCtxFor(preferred),
      kind: 'preferred',
      parameterSizeB: parameterSizeB(preferred),
    };
  }
  if (options.requireLarge) {
    const large = chats.find(isLargeModel);
    if (!large) return null;
    return {
      name: large.name,
      numCtx: numCtxFor(large),
      kind: 'large',
      parameterSizeB: parameterSizeB(large),
    };
  }
  const large = chats.find(isLargeModel);
  const chosen = large || chats[0];
  return {
    name: chosen.name,
    numCtx: numCtxFor(chosen),
    kind: large ? 'large' : 'fallback',
    parameterSizeB: parameterSizeB(chosen),
  };
}

/**
 * Decides which routes to try, in order.
 * @param {{ mode:string, localModel:object|null, promptChars:number }} input
 */
export function buildRoutePlan(input) {
  const { mode, localModel, promptChars } = input;
  if (mode === 'online_only') {
    return { order: ['online'], degrade: false, reason: '仅在线模式：不调用本地模型' };
  }
  if (mode === 'local_only') {
    return { order: ['local'], degrade: false, reason: '仅本地模式：不调用在线模型' };
  }
  if (mode === 'local_first') {
    return localModel
      ? {
          order: ['local', 'online'],
          degrade: true,
          reason: `本地优先：先调用 ${localModel.name}，失败降级到在线模型`,
        }
      : { order: ['online'], degrade: true, reason: '本地优先：本机无可用本地模型，直接调用在线模型' };
  }
  // auto
  if (!localModel) {
    return {
      order: ['online'],
      degrade: true,
      reason: '自动：本机未发现可用的本地对话模型',
    };
  }
  const capacityChars = Math.round(localModel.numCtx * 1.4);
  if (promptChars > capacityChars) {
    return {
      order: ['online', 'local'],
      degrade: true,
      reason: `自动：内容约 ${promptChars} 字符，超过本地 ${localModel.numCtx} token 窗口，先走在线模型`,
    };
  }
  return {
    order: ['local', 'online'],
    degrade: true,
    reason: `自动：内容约 ${promptChars} 字符，可放入本地 ${localModel.numCtx} token 窗口，先走本地模型`,
  };
}
