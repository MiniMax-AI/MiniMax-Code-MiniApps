// Local Ollama client. The embedding model is fixed by the product rules.

import { requestJson } from './http.mjs';

export const DEFAULT_OLLAMA_BASE = 'http://127.0.0.1:11434';
export const EMBEDDING_MODEL = 'bge-m3';
export const PREFERRED_CHAT_MODEL = 'qwen3:14b';
/** Fixed context policy: 14B models run with an 8K window, smaller models with 16K. */
export const LARGE_MODEL_CTX = 8192;
export const SMALL_MODEL_CTX = 16384;
export const LARGE_MODEL_PARAM_B = 13;

export function normalizeBase(base) {
  const value = String(base || DEFAULT_OLLAMA_BASE).trim();
  return value.replace(/\/+$/, '') || DEFAULT_OLLAMA_BASE;
}

/**
 * @param {string} base
 * @param {AbortSignal} [signal]
 * @returns {Promise<Array<{name:string, capabilities?:string[], details?:{parameter_size?:string}}>>}
 */
export async function listModels(base, signal) {
  const response = await requestJson(`${normalizeBase(base)}/api/tags`, { signal, timeoutMs: 8000 });
  const models = response.body && response.body.models;
  if (!Array.isArray(models)) throw new Error('ollama_tags_invalid');
  return models;
}

/**
 * @param {string} base
 * @param {AbortSignal} [signal]
 */
export async function ollamaVersion(base, signal) {
  const response = await requestJson(`${normalizeBase(base)}/api/version`, { signal, timeoutMs: 5000 });
  return response.body && response.body.version ? String(response.body.version) : 'unknown';
}

/**
 * @param {{ base:string, model:string, messages:Array<{role:string,content:string}>, numCtx:number, temperature?:number, timeoutMs?:number, signal?:AbortSignal }} options
 */
export async function chat(options) {
  const { base, model, messages, numCtx, temperature = 0.2, timeoutMs = 240000, signal } = options;
  const response = await requestJson(`${normalizeBase(base)}/api/chat`, {
    method: 'POST',
    body: {
      model,
      messages,
      stream: false,
      think: false,
      options: { num_ctx: numCtx, temperature },
    },
    timeoutMs,
    signal,
  });
  const payload = response.body || {};
  const message = payload.message || {};
  const text = stripThinking(String(message.content ?? payload.response ?? ''));
  if (!text) throw new Error('ollama_empty_response');
  return { text, model, numCtx, raw: payload };
}

/**
 * @param {{ base:string, model?:string, inputs:string[], timeoutMs?:number, signal?:AbortSignal }} options
 * @returns {Promise<number[][]>}
 */
export async function embed(options) {
  const { base, model = EMBEDDING_MODEL, inputs, timeoutMs = 180000, signal } = options;
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('embed_input_required');
  const response = await requestJson(`${normalizeBase(base)}/api/embed`, {
    method: 'POST',
    body: { model, input: inputs },
    timeoutMs,
    signal,
  });
  const vectors = response.body && response.body.embeddings;
  if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
    throw new Error('ollama_embed_response_invalid');
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('ollama_embed_vector_invalid');
  }
  return vectors;
}

/** Removes reasoning blocks some chat templates still inline into the answer. */
export function stripThinking(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^<think>[\s\S]*$/i, '')
    .trim();
}
