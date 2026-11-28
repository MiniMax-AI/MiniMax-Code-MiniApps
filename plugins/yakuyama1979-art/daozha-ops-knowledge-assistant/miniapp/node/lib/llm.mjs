// One entry point for model work: build the prompt, pick the route, run it, and report
// exactly which route answered and whether a degradation happened.

import { chat as ollamaChat, listModels } from './ollama.mjs';
import { buildRoutePlan, pickLocalModel } from './router.mjs';

export class LlmError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.code = code;
    this.details = details || null;
  }
}

/**
 * Runs one model task.
 * @param {{ ollamaBase:string, agent?:object, logger?:object }} context
 * @param {{ task:string, mode:string, system:string, prompt:string, signal?:AbortSignal, temperature?:number, requireLarge?:boolean }} options
 */
export async function complete(context, options) {
  const { task, mode, system, prompt, signal, temperature = 0.2, requireLarge = false } = options;
  const attempts = [];

  let localModel = null;
  let localProbeError = null;
  try {
    const models = await listModels(context.ollamaBase, signal);
    localModel = pickLocalModel(models, { requireLarge });
  } catch (error) {
    localProbeError = error instanceof Error ? error.message : String(error);
  }

  const promptChars = String(system || '').length + String(prompt || '').length;
  const plan = buildRoutePlan({ mode, localModel, promptChars });

  for (const route of plan.order) {
    try {
      if (route === 'local') {
        if (!localModel) {
          throw new LlmError(
            'local_model_unavailable',
            localProbeError
              ? `本地模型不可用：${localProbeError}`
              : '本机没有可用的本地对话模型',
          );
        }
        const result = await ollamaChat({
          base: context.ollamaBase,
          model: localModel.name,
          numCtx: localModel.numCtx,
          temperature,
          signal,
          messages: [
            { role: 'system', content: String(system || '') },
            { role: 'user', content: String(prompt || '') },
          ],
        });
        attempts.push({ route: 'local', ok: true, model: localModel.name });
        return {
          text: result.text,
          route: {
            requested: mode,
            used: 'local',
            model: localModel.name,
            numCtx: localModel.numCtx,
            degraded: false,
            degradedFrom: null,
            fallbackReason: null,
            plan: plan.order,
            reason: plan.reason,
            attempts,
          },
        };
      }

      const online = await runOnline(context.agent, system, prompt, signal);
      attempts.push({ route: 'online', ok: true, model: online.model || 'online' });
      return {
        text: online.text,
        route: {
          requested: mode,
          used: 'online',
          model: online.model || 'online',
          numCtx: null,
          degraded: plan.order[0] !== 'online',
          degradedFrom: plan.order[0] !== 'online' ? plan.order[0] : null,
          fallbackReason: plan.order[0] !== 'online' ? plan.reason : null,
          plan: plan.order,
          reason: plan.reason,
          attempts,
        },
      };
    } catch (error) {
      const code = error && error.code ? error.code : 'model_call_failed';
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ route, ok: false, error: `${code}: ${message}` });
      if (!plan.degrade) break;
      context.logger?.warn('miniapp.model.route_failed', { route, code });
    }
  }

  const failure = attempts.find((attempt) => !attempt.ok);
  throw new LlmError(
    'model_unavailable',
    `模型调用失败：${failure ? failure.error : '无可用路由'}`,
    { attempts, plan },
  );
}

/**
 * The online route is the Host Agent turn. It is scoped to a single JSON reply and
 * is not allowed to touch files, tools or the network.
 */
async function runOnline(agent, system, prompt, signal) {
  if (!agent || typeof agent.run !== 'function') {
    throw new LlmError('online_agent_unavailable', '在线模型通道不可用');
  }
  const text = [
    '你是「道闸运维知识助手」的后端推理引擎。',
    '只依据下面提供的内容作答：不要调用任何工具、不要读写文件、不要联网、不要访问其他会话。',
    '严格只输出一个 JSON 对象，不要输出前言、解释文字或 Markdown 代码块。',
    '',
    '【系统要求】',
    String(system || ''),
    '',
    '【任务内容】',
    String(prompt || ''),
  ].join('\n');

  const result = await agent.run({ text }, { signal });
  if (result.status === 'error') {
    throw new LlmError(
      'online_agent_error',
      `在线模型返回错误：${(result.error && result.error.code) || 'unknown'}`,
    );
  }
  if (result.status === 'aborted') {
    throw new LlmError('online_agent_aborted', '在线模型调用被中止');
  }
  const raw = String(result.text || '').trim();
  if (!raw) throw new LlmError('online_empty_response', '在线模型没有返回内容');
  return {
    text: raw,
    model: result.model ? `${result.model.providerId}/${result.model.modelId}` : 'online',
  };
}

/**
 * Extracts the first balanced JSON object from a model reply.
 * @param {string} text
 */
export function parseJsonObject(text) {
  const source = String(text || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(source);
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try the next candidate */
    }
    const start = trimmed.indexOf('{');
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(trimmed.slice(start, index + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
          } catch {
            break;
          }
          break;
        }
      }
    }
  }
  return null;
}
