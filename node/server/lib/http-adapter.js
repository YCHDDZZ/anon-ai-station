import { AppError } from './errors.js';

/** 通用 HTTP 适配器：把「任意厂商的接口」压缩成 4 个动作（json / json+file / binary） */

export const CATEGORIES = ['llm', 'search', 'crawl', 'parse', 'ocr', 'tts', 'asr'];

export const CATEGORY_META = {
  llm: {
    label: '大模型',
    hint: 'OpenAI 兼容的 chat/completions 接口',
    needsModel: true,
    modelHint: '对话使用的模型，可从上游模型列表中勾选启用',
  },
  search: { label: '联网搜索', hint: '返回 { results: [{ title, url, snippet }] }' },
  crawl: { label: '网页爬取', hint: '输入 url，返回网页正文' },
  parse: {
    label: '文件解析',
    hint: '上传文件，返回提取出的文本',
    needsModel: true,
    modelHint: '若该服务按模型区分解析能力，可填写模型名',
  },
  ocr: {
    label: '图片 OCR',
    hint: '上传图片，返回识别文字',
    needsModel: true,
    modelHint: '视觉模型名，例如 deepseek-ai/DeepSeek-OCR',
  },
  tts: {
    label: '语音合成 TTS',
    hint: '输入文本，返回音频流',
    needsModel: true,
    modelHint: '语音合成模型名，例如 mimo-v2.5-tts',
  },
  asr: {
    label: '语音识别 ASR',
    hint: '上传音频，返回转写文本',
    needsModel: true,
    modelHint: '语音识别模型名，例如 SenseVoiceSmall',
  },
};

export const DEFAULT_EXTRA = {
  llm: {
    path: '/chat/completions',
    method: 'POST',
    auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    timeoutMs: 120000,
  },
  search: {
    path: '/search',
    method: 'POST',
    auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    headers: { 'Content-Type': 'application/json' },
    body: { query: '{{query}}', max_results: '{{limit}}' },
    resultPath: 'results',
    fieldMap: { title: 'title', url: 'url', snippet: 'content' },
    timeoutMs: 30000,
  },
  crawl: {
    path: '/crawl',
    method: 'POST',
    auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    headers: { 'Content-Type': 'application/json' },
    body: { url: '{{url}}' },
    textPath: 'text',
    titlePath: 'title',
    timeoutMs: 60000,
  },
  parse: {
    path: '/parse',
    method: 'POST',
    auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    fileField: 'file',
    textPath: 'text',
    timeoutMs: 120000,
  },
  ocr: {
    path: '/ocr',
    method: 'POST',
    auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    fileField: 'file',
    textPath: 'text',
    timeoutMs: 120000,
  },
  tts: {
    path: '/tts',
    method: 'POST',
    auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    headers: { 'Content-Type': 'application/json' },
    body: { text: '{{text}}', voice: '{{voice}}' },
    binary: true,
    timeoutMs: 60000,
  },
  asr: {
    path: '/asr',
    method: 'POST',
    auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
    fileField: 'file',
    textPath: 'text',
    timeoutMs: 120000,
  },
};

/** {{var}} 递归替换 */
function interpolate(node, vars) {
  if (typeof node === 'string') {
    // 整个字符串就是一个占位符时保留原类型（数字、数组、布尔），避免上游校验失败
    const exact = node.match(/^\{\{(\w+)\}\}$/);
    if (exact) {
      const v = vars[exact[1]];
      return v === undefined || v === null ? '' : v;
    }
    return node.replace(/\{\{(\w+)\}\}/g, (m, key) =>
      vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ''
    );
  }
  if (Array.isArray(node)) return node.map((n) => interpolate(n, vars));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = interpolate(v, vars);
    return out;
  }
  return node;
}

/** 简单点路径取值：a.b.0.c */
export function getPath(obj, pathStr) {
  if (!pathStr) return obj;
  let cur = obj;
  for (const seg of String(pathStr).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(seg)) cur = cur[Number(seg)];
    else cur = cur[seg];
  }
  return cur;
}

function buildUrl(provider, extra, vars) {
  const base = String(provider.base_url || '').replace(/\/+$/, '');
  const pathPart = interpolate(extra.path || '', vars);
  const url = new URL(base + (pathPart.startsWith('/') || !pathPart ? pathPart : `/${pathPart}`));
  if (extra.query) {
    for (const [k, v] of Object.entries(interpolate(extra.query, vars))) {
      if (v !== '' && v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url;
}

function buildHeaders(provider, extra, vars, hasBodyJson) {
  const headers = { ...(interpolate(extra.headers || {}, vars) || {}) };
  if (hasBodyJson && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const auth = extra.auth || { type: 'header', name: 'Authorization', prefix: 'Bearer ' };
  const key = provider.api_key;
  if (key && auth.type !== 'none') {
    if (auth.type === 'query') {
      // 由 buildUrl 处理，这里跳过
    } else {
      headers[auth.name || 'Authorization'] = `${auth.prefix ?? 'Bearer '}${key}`;
    }
  }
  return headers;
}

function applyQueryAuth(url, provider, extra) {
  const auth = extra.auth || {};
  if (auth.type === 'query' && provider.api_key) {
    url.searchParams.set(auth.name || 'key', `${auth.prefix ?? ''}${provider.api_key}`);
  }
}

async function doFetch(url, init, timeoutMs) {
  const signal = AbortSignal.timeout(Math.min(Number(timeoutMs) || 60000, 180000));
  let res;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? '上游接口超时' : `无法连接上游：${err?.message || err}`;
    throw new AppError('PROVIDER_UNREACHABLE', msg, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AppError(
      'PROVIDER_HTTP_ERROR',
      `上游返回 ${res.status}${text ? `：${text.slice(0, 300)}` : ''}`,
      res.status === 401 || res.status === 403 ? 502 : 502,
      { upstreamStatus: res.status }
    );
  }
  return res;
}

/* ── 三种调用形态 ─────────────────────────────────────── */

export async function callJson(provider, vars = {}) {
  const extra = provider.extra || {};
  const url = buildUrl(provider, extra, vars);
  applyQueryAuth(url, provider, extra);
  const bodyJson = extra.body ? interpolate(extra.body, vars) : undefined;
  const headers = buildHeaders(provider, extra, vars, Boolean(bodyJson));
  const res = await doFetch(
    url,
    {
      method: extra.method || 'POST',
      headers,
      body:
        bodyJson === undefined
          ? undefined
          : extra.bodyMode === 'form'
            ? new URLSearchParams(bodyJson).toString()
            : JSON.stringify(bodyJson),
    },
    extra.timeoutMs
  );
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function callWithFile(provider, vars, file) {
  const extra = provider.extra || {};
  const url = buildUrl(provider, extra, vars);
  applyQueryAuth(url, provider, extra);
  const form = new FormData();
  const field = extra.fileField || 'file';
  form.append(field, new Blob([file.buffer], { type: file.mime || 'application/octet-stream' }), file.name || 'upload.bin');
  if (extra.fields) {
    for (const [k, v] of Object.entries(interpolate(extra.fields, vars))) {
      if (v !== '' && v !== undefined && v !== null) form.append(k, String(v));
    }
  }
  const headers = buildHeaders(provider, extra, vars, false);
  delete headers['Content-Type']; // 交给 undici 生成 boundary
  const res = await doFetch(url, { method: extra.method || 'POST', headers, body: form }, extra.timeoutMs);
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function callBinary(provider, vars = {}) {
  const extra = provider.extra || {};
  const url = buildUrl(provider, extra, vars);
  applyQueryAuth(url, provider, extra);
  const bodyJson = extra.body ? interpolate(extra.body, vars) : undefined;
  const headers = buildHeaders(provider, extra, vars, Boolean(bodyJson));
  const res = await doFetch(
    url,
    { method: extra.method || 'POST', headers, body: bodyJson ? JSON.stringify(bodyJson) : undefined },
    extra.timeoutMs
  );
  const buf = Buffer.from(await res.arrayBuffer());
  return { buffer: buf, mime: res.headers.get('content-type') || 'audio/mpeg' };
}

/* ── 归一化 ───────────────────────────────────────────── */

export function normalizeSearch(provider, raw) {
  const extra = provider.extra || {};
  const list = getPath(raw, extra.resultPath || 'results');
  const arr = Array.isArray(list) ? list : Array.isArray(raw) ? raw : [];
  const map = extra.fieldMap || { title: 'title', url: 'url', snippet: 'snippet' };
  return arr
    .map((item) => ({
      title: String(getPath(item, map.title || 'title') ?? '未命名'),
      url: String(getPath(item, map.url || 'url') ?? ''),
      snippet: String(getPath(item, map.snippet || 'snippet') ?? ''),
    }))
    .filter((r) => r.url);
}

export function normalizeText(provider, raw) {
  const extra = provider.extra || {};
  const v = getPath(raw, extra.textPath || 'text') ?? raw?.text ?? '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}
