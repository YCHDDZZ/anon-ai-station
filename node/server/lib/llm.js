import { E } from './errors.js';
import { markProviderStatus, resolveAttempts } from './providers.js';

/** OpenAI 兼容的 /chat/completions 流式客户端，带跨 provider 降级 */

function endpoint(provider) {
  const base = String(provider.base_url || '').replace(/\/+$/, '');
  const path = provider.extra?.path || '/chat/completions';
  return base + (path.startsWith('/') ? path : `/${path}`);
}

async function* callOnce(provider, { messages, model, temperature, maxTokens, signal, reasoningEffort }) {
  const url = endpoint(provider);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...(provider.extra?.headers || {}),
  };
  const auth = provider.extra?.auth || { type: 'header', name: 'Authorization', prefix: 'Bearer ' };
  if (provider.api_key && auth.type !== 'none') {
    headers[auth.name || 'Authorization'] = `${auth.prefix ?? 'Bearer '}${provider.api_key}`;
  }

  const body = {
    model: model || provider.model || 'deepseek-chat',
    messages,
    stream: true,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    stream_options: { include_usage: true },
    ...(provider.extra?.body || {}),
  };

  const timeout = AbortSignal.timeout(Number(provider.extra?.timeoutMs) || 180000);
  const mergedSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: mergedSignal,
  }).catch((err) => {
    throw new Error(err?.name === 'TimeoutError' ? '上游模型超时' : `无法连接模型服务：${err?.message || err}`);
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`模型服务返回 ${res.status}${text ? `：${text.slice(0, 240)}` : ''}`);
  }
  if (!res.body) throw new Error('模型服务未返回可读流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let usage = null;
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) throw new Error(json.error.message || '模型返回错误');

      const delta = json.choices?.[0]?.delta || {};
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string' && reasoning) yield { type: 'reasoning', text: reasoning };
      if (typeof delta.content === 'string' && delta.content) {
        full += delta.content;
        yield { type: 'delta', text: delta.content };
      }
      if (json.usage) usage = json.usage;
    }
  }
  yield { type: 'usage', usage };
  yield { type: 'text', text: full };
}

/**
 * 依次尝试 provider 链。若已向客户端吐字，则不再切换（避免内容重复）。
 */
/** 按模型配置的上下文长度裁剪历史，粗略按 1 token ≈ 2 字符估算 */
function trimForContext(messages, contextTokens) {
  if (!contextTokens || contextTokens <= 0) return messages;
  let budget = contextTokens * 2;
  const kept = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const len = String(messages[i]?.content || '').length;
    if (len > budget && kept.length) break;
    budget -= len;
    kept.unshift(messages[i]);
  }
  return kept;
}

export async function* streamChat(user, params) {
  const chain = resolveAttempts(user, 'llm');
  if (chain.length === 0) throw E.insufficientCompute();

  const failures = [];
  for (const provider of chain) {
    let emitted = false;
    // 模型白名单：只允许 extra.models 里列出的模型，否则回落到该 provider 的默认模型
    const allowed = Array.isArray(provider.extra?.models) && provider.extra.models.length ? provider.extra.models : null;
    const chosenModel =
      params.model && (!allowed || allowed.includes(params.model))
        ? params.model
        : provider.model || params.model || '';
    try {
      const cfg = params.thinking === false ? {} : provider.extra?.modelConfig?.[chosenModel] || {};
      const messages = trimForContext(params.messages, Number(cfg.context) || 0);
      for await (const ev of callOnce(provider, {
        ...params,
        messages,
        model: chosenModel,
        reasoningEffort: cfg.effort || '',
      })) {
        if (ev.type === 'delta' || ev.type === 'reasoning') emitted = true;
        yield {
          ...ev,
          provider: {
            name: provider.name || (provider.ownerType === 'global' ? '共享算力' : '自有算力'),
            ownerType: provider.ownerType,
            model: chosenModel,
            key: provider.keyLabel || '',
          },
        };
      }
      markProviderStatus(provider.id, 'ok', null);
      return;
    } catch (err) {
      const msg = err?.message || String(err);
      markProviderStatus(provider.id, 'error', msg);
      failures.push({ owner: provider.ownerType, name: provider.name, error: msg });
      console.warn(`[LLM 失败] ${provider.ownerType}/${provider.base_url} → ${msg}`);
      if (emitted) throw new Error(`生成中断：${msg}`);
    }
  }
  const lastProvider = chain[chain.length - 1];
  const custom = String(lastProvider?.errorMessage || '').trim();
  const detail = failures.at(-1)?.error || '上游全部不可用';
  const message = custom ? `${custom}（${detail}）` : `算力不足，请自行接入第三方工具 API。（${detail}）`;
  const err = E.insufficientCompute(message);
  err.extra = { failures, custom: Boolean(custom) };
  throw err;
}
