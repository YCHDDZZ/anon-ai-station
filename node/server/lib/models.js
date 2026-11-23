import { E } from './errors.js';

/**
 * 从 OpenAI 兼容的 /models 拉取模型列表。
 * 各家的返回结构大同小异，这里做宽松解析：
 *   { data: [{id}] } / { models: [{name}] } / { result: [...] } / [...]
 */

function pickArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['data', 'models', 'result', 'items', 'list']) {
    const v = payload[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const nested = pickArray(v);
      if (nested) return nested;
    }
  }
  return null;
}

function pickName(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  return String(
    item.id ?? item.name ?? item.model ?? item.model_name ?? item.modelName ?? item.slug ?? ''
  ).trim();
}

export function normalizeModels(payload) {
  const arr = pickArray(payload) || [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const id = pickName(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label =
      typeof item === 'object' ? String(item.label ?? item.display_name ?? item.description ?? '').trim() : '';
    const context = Number(
      (typeof item === 'object' && (item.context_length ?? item.context_window ?? item.max_context_length)) || 0
    );
    out.push({ id, label: label && label !== id ? label : '', context: Number.isFinite(context) ? context : 0 });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out.slice(0, 500);
}

export async function fetchModels({ baseUrl, apiKey, extra = {} }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw E.badRequest('请先填写合法的接口地址');

  const path = String(extra.modelsPath || '/models');
  const url = base + (path.startsWith('/') ? path : `/${path}`);

  const headers = { Accept: 'application/json', ...(extra.headers || {}) };
  const auth = extra.auth || { type: 'header', name: 'Authorization', prefix: 'Bearer ' };
  if (apiKey && auth.type !== 'none' && auth.type !== 'query') {
    headers[auth.name || 'Authorization'] = `${auth.prefix ?? 'Bearer '}${apiKey}`;
  }

  const finalUrl = new URL(url);
  if (apiKey && auth.type === 'query') {
    finalUrl.searchParams.set(auth.name || 'key', `${auth.prefix ?? ''}${apiKey}`);
  }

  let res;
  try {
    res = await fetch(finalUrl, {
      headers,
      signal: AbortSignal.timeout(Number(extra.timeoutMs) || 20000),
    });
  } catch (err) {
    throw E.providerFailed(
      err?.name === 'TimeoutError' ? '获取模型列表超时' : `无法连接上游：${err?.message || err}`
    );
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw E.providerFailed(`上游返回 ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw E.providerFailed('上游返回的不是 JSON，可能该接口不提供 /models');
  }

  const models = normalizeModels(payload);
  if (models.length === 0) throw E.providerFailed('上游未返回任何模型，请检查接口地址或权限');
  return { models, count: models.length, url: finalUrl.toString() };
}
