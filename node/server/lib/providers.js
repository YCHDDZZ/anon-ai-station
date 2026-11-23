import { config } from '../config.js';
import { all, get, run, now } from '../db.js';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.js';
import { AppError, E } from './errors.js';
import { assertGlobalQuota, assertUserQuota, billablePages, estimatePages, recordUsage } from './quota.js';
import { authorizeFileUpload, parseCredential, parseWithDocmind } from './docmind.js';
import {
  CATEGORIES,
  DEFAULT_EXTRA,
  callBinary,
  callJson,
  callWithFile,
  normalizeSearch,
  normalizeText,
} from './http-adapter.js';

/* 宽松点路径取值（支持数组下标） */
function getPathLoose(obj, pathStr) {
  let cur = obj;
  for (const seg of String(pathStr).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = /^[0-9]+$/.test(seg) ? cur[Number(seg)] : cur[seg];
  }
  return cur;
}

/* ── 读取 ─────────────────────────────────────────────── */

function parseExtra(row) {
  try {
    return JSON.parse(row.extra_json || '{}');
  } catch {
    return {};
  }
}

export function toRuntime(row) {
  return {
    id: row.id,
    ownerType: row.owner_type,
    category: row.category,
    name: row.name || '',
    base_url: row.base_url,
    api_key: decryptSecret(row.api_key_enc),
    model: row.model || '',
    errorMessage: row.error_message || '',
    extra: { ...(DEFAULT_EXTRA[row.category] || {}), ...parseExtra(row) },
  };
}

export function listProviderKeys(providerId, { withSecret = false } = {}) {
  return all('SELECT * FROM provider_keys WHERE provider_id = ? ORDER BY id', providerId).map((k) => {
    const plain = decryptSecret(k.key_enc);
    return {
      id: k.id,
      label: k.label || '',
      masked: maskSecret(plain),
      enabled: Boolean(k.enabled),
      lastUsedAt: k.last_used_at,
      createdAt: k.created_at,
      ...(withSecret ? { key: plain } : {}),
    };
  });
}

export function toPublic(row) {
  const key = maskSecret(decryptSecret(row.api_key_enc));
  return {
    id: row.id,
    ownerType: row.owner_type,
    category: row.category,
    name: row.name || '',
    baseUrl: row.base_url,
    model: row.model || '',
    errorMessage: row.error_message || '',
    apiKeyMasked: key,
    hasApiKey: Boolean(row.api_key_enc),
    keys: listProviderKeys(row.id),
    extra: parseExtra(row),
    enabled: Boolean(row.enabled),
    sort: row.sort || 0,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastCheckedAt: row.last_checked_at,
    updatedAt: row.updated_at,
  };
}

export function listProviderRows(ownerType, ownerId, category = null) {
  if (category) {
    return all(
      'SELECT * FROM providers WHERE owner_type = ? AND COALESCE(owner_id,0) = ? AND category = ? ORDER BY sort, id',
      ownerType,
      ownerId ?? 0,
      category
    );
  }
  return all(
    'SELECT * FROM providers WHERE owner_type = ? AND COALESCE(owner_id,0) = ? ORDER BY category, sort, id',
    ownerType,
    ownerId ?? 0
  );
}

/** 兼容旧调用：返回该分类下的第一条 */
export function getProviderRow(ownerType, ownerId, category) {
  return listProviderRows(ownerType, ownerId, category)[0] || null;
}

export function getProviderRowById(id) {
  return get('SELECT * FROM providers WHERE id = ?', Number(id));
}

export function globalInventory() {
  const rows = all("SELECT DISTINCT category FROM providers WHERE owner_type = 'global' AND enabled = 1");
  const set = new Set(rows.map((r) => r.category));
  return Object.fromEntries(CATEGORIES.map((c) => [c, set.has(c)]));
}

/* ── 调度策略 ─────────────────────────────────────────── */

export function getRouting(ownerType, ownerId, category) {
  const row = get(
    'SELECT mode FROM routing WHERE owner_type = ? AND owner_id = ? AND category = ?',
    ownerType,
    ownerId ?? 0,
    category
  );
  return row?.mode === 'round_robin' ? 'round_robin' : 'failover';
}

export function setRouting(ownerType, ownerId, category, mode) {
  if (!['failover', 'round_robin'].includes(mode)) throw E.badRequest('未知的调度策略');
  run(
    `INSERT INTO routing(owner_type, owner_id, category, mode) VALUES(?,?,?,?)
     ON CONFLICT(owner_type, owner_id, category) DO UPDATE SET mode = excluded.mode`,
    ownerType,
    ownerId ?? 0,
    category,
    mode
  );
  return mode;
}

/* ── 写入 ─────────────────────────────────────────────── */

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw E.badRequest('接口地址必须以 http(s):// 开头');
  return String(baseUrl).trim();
}

function nextSort(ownerType, ownerId, category) {
  const row = get(
    'SELECT MAX(sort) AS m FROM providers WHERE owner_type = ? AND COALESCE(owner_id,0) = ? AND category = ?',
    ownerType,
    ownerId ?? 0,
    category
  );
  return Number(row?.m ?? -1) + 1;
}

export function createProvider({
  ownerType,
  ownerId = null,
  category,
  name,
  baseUrl,
  apiKey,
  model,
  extra,
  enabled,
  errorMessage,
  sort,
}) {
  if (!CATEGORIES.includes(category)) throw E.badRequest('未知的能力类型');
  const url = normalizeBaseUrl(baseUrl);
  const ts = now();
  const info = run(
    `INSERT INTO providers(owner_type, owner_id, category, name, base_url, api_key_enc, model,
      extra_json, enabled, error_message, sort, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ownerType,
    ownerId,
    category,
    name ?? '',
    url,
    apiKey ? encryptSecret(apiKey) : null,
    model ?? '',
    JSON.stringify(extra ?? {}),
    enabled === false ? 0 : 1,
    errorMessage ? String(errorMessage).slice(0, 300) : null,
    Number.isFinite(Number(sort)) ? Number(sort) : nextSort(ownerType, ownerId, category),
    ts,
    ts
  );
  return getProviderRowById(Number(info.lastInsertRowid));
}

export function updateProvider(id, patch = {}) {
  const row = getProviderRowById(id);
  if (!row) throw E.notFound('接口配置不存在');

  const fields = [];
  const args = [];
  const set = (sql, value) => {
    fields.push(`${sql} = ?`);
    args.push(value);
  };

  if (patch.name !== undefined) set('name', patch.name ?? '');
  if (patch.baseUrl !== undefined) set('base_url', normalizeBaseUrl(patch.baseUrl));
  if (patch.apiKey !== undefined) set('api_key_enc', patch.apiKey === '' ? null : encryptSecret(patch.apiKey));
  if (patch.model !== undefined) set('model', patch.model ?? '');
  if (patch.extra !== undefined) set('extra_json', JSON.stringify(patch.extra ?? {}));
  if (patch.enabled !== undefined) set('enabled', patch.enabled ? 1 : 0);
  if (patch.errorMessage !== undefined) set('error_message', patch.errorMessage ? String(patch.errorMessage).slice(0, 300) : null);
  if (patch.sort !== undefined) set('sort', Number(patch.sort) || 0);
  set('updated_at', now());

  run(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`, ...args, row.id);
  return getProviderRowById(row.id);
}

/** 兼容旧接口：更新该分类下第一条，没有则创建 */
export function upsertProvider({ ownerType, ownerId = null, category, ...rest }) {
  const existing = getProviderRow(ownerType, ownerId, category);
  if (existing) return updateProvider(existing.id, rest);
  return createProvider({ ownerType, ownerId, category, ...rest });
}

export function deleteProviderById(id) {
  run('DELETE FROM providers WHERE id = ?', Number(id));
}

export function deleteProvider(ownerType, ownerId, category) {
  run(
    'DELETE FROM providers WHERE owner_type = ? AND COALESCE(owner_id,0) = ? AND category = ?',
    ownerType,
    ownerId ?? 0,
    category
  );
}

export function addProviderKey(providerId, key, label = '') {
  const row = getProviderRowById(providerId);
  if (!row) throw E.notFound('接口配置不存在');
  if (!key) throw E.badRequest('Key 不能为空');
  const info = run(
    'INSERT INTO provider_keys(provider_id, label, key_enc, enabled, created_at) VALUES(?,?,?,?,?)',
    row.id,
    String(label || '').slice(0, 40),
    encryptSecret(key),
    1,
    now()
  );
  return Number(info.lastInsertRowid);
}

export function deleteProviderKey(providerId, keyId) {
  run('DELETE FROM provider_keys WHERE id = ? AND provider_id = ?', Number(keyId), Number(providerId));
}

export function markProviderStatus(id, status, error) {
  run(
    'UPDATE providers SET last_status = ?, last_error = ?, last_checked_at = ? WHERE id = ?',
    status,
    error ? String(error).slice(0, 500) : null,
    now(),
    id
  );
}

/* ── 调度链：自有 → 共享（或反之）──────────────────────── */

/** 单条 provider 展开成「每个 Key 一个可尝试项」 */
function expandRow(row) {
  const rt = toRuntime(row);
  const keys = listProviderKeys(row.id, { withSecret: true }).filter((k) => k.enabled && k.key);
  const list = [];
  if (rt.api_key) list.push({ ...rt, keyId: null, keyLabel: '主 Key' });
  for (const k of keys) {
    list.push({ ...rt, api_key: k.key, keyId: k.id, keyLabel: k.label || `Key #${k.id}` });
  }
  if (list.length === 0) list.push({ ...rt, keyId: null, keyLabel: '未配置 Key' });
  return list;
}

const cursors = new Map();

function rotate(list, key) {
  if (list.length <= 1) return list;
  const n = (cursors.get(key) || 0) % list.length;
  cursors.set(key, n + 1);
  return list.slice(n).concat(list.slice(0, n));
}

function sourceAttempts(ownerType, ownerId, category) {
  const rows = listProviderRows(ownerType, ownerId, category).filter((r) => r.enabled);
  let list = [];
  for (const row of rows) list.push(...expandRow(row));
  if (list.length === 0) return list;
  if (getRouting(ownerType, ownerId, category) === 'round_robin') {
    list = rotate(list, `${ownerType}:${ownerId ?? 0}:${category}`);
  }
  return list;
}

/** 返回按优先级排列的可尝试项（同一 provider 可能有多个 Key） */
export function resolveAttempts(user, category) {
  const own = sourceAttempts('user', user.id, category);
  const shared = sourceAttempts('global', null, category);
  const preferOwn = (user.provider_preference || 'own_first') === 'own_first';
  return preferOwn ? [...own, ...shared] : [...shared, ...own];
}

/** 兼容：只取 provider 维度（去重），用于展示当前可用模型 */
export function resolveChain(user, category) {
  const seen = new Set();
  const out = [];
  for (const a of resolveAttempts(user, category)) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

export function describeChain(user, category) {
  const own = listProviderRows('user', user.id, category);
  const shared = listProviderRows('global', null, category);
  return {
    own: own.filter((r) => r.enabled).map((r) => ({ name: r.name, masked: maskSecret(decryptSecret(r.api_key_enc)) })),
    shared: shared.filter((r) => r.enabled).map((r) => ({ name: r.name, masked: maskSecret(decryptSecret(r.api_key_enc)) })),
    preferOwn: (user.provider_preference || 'own_first') === 'own_first',
  };
}

/** 统一兜底：链为空或全部失败 → INSUFFICIENT_COMPUTE */
async function runChain(user, category, fn) {
  const chain = resolveAttempts(user, category);
  if (chain.length === 0) throw E.insufficientCompute();

  const failures = [];
  for (const provider of chain) {
    try {
      const result = await fn(provider);
      markProviderStatus(provider.id, 'ok', null);
      return { result, provider };
    } catch (err) {
      const msg = err?.message || String(err);
      if (err?.code === 'QUOTA_EXCEEDED') {
        // 用户份额用完，不是接口故障：保留接口状态，继续尝试其它线路（例如用户自带 API）
        failures.push({
          provider: provider.name || provider.base_url,
          owner: provider.ownerType,
          error: msg,
          quota: true,
        });
        continue;
      }
      markProviderStatus(provider.id, 'error', msg);
      failures.push({
        provider: provider.name || provider.base_url,
        owner: provider.ownerType,
        error: msg,
      });
      console.warn(`[适配器失败] ${category} / ${provider.ownerType} / ${provider.base_url} → ${msg}`);
    }
  }
  // 全部线路都只是「份额用完」时，直接返回额度提示，不要盖成泛泛的算力不足
  if (failures.length > 0 && failures.every((f) => f.quota)) {
    throw new AppError('QUOTA_EXCEEDED', failures[0].error, 402, { failures });
  }
  // 优先用该接口配置的自定义报错提示，没配才用站点默认文案
  const lastProvider = chain[chain.length - 1];
  const custom = String(lastProvider?.errorMessage || '').trim();
  const detail = failures.at(-1)?.error || '';
  const message = custom
    ? config.isProd
      ? custom
      : `${custom}（${detail}）`
    : config.isProd
      ? '算力不足，请自行接入第三方工具 API。'
      : `算力不足，请自行接入第三方工具 API。（${detail}）`;
  throw new AppError('INSUFFICIENT_COMPUTE', message, 402, { failures, custom: Boolean(custom) });
}

/* ── 各类能力的对外调用 ───────────────────────────────── */

export async function runSearch(user, { query, limit = 6 }) {
  if (!query) return { results: [], provider: null };
  return runChain(user, 'search', async (p) => {
    // Tavily 口径：basic 1 credit / 次，advanced 2 credits / 次
    const units = p.extra?.body?.search_depth === 'advanced' ? 2 : 1;
    assertGlobalQuota(p, units);
    assertUserQuota(user, p, units);
    const raw = await callJson(p, { query, limit });
    const out = normalizeSearch(p, raw);
    recordUsage(p, { units, detail: `search depth=${p.extra?.body?.search_depth || 'basic'}`, user });
    return out;
  }).then(({ result, provider }) => ({ results: result, provider: provider.name || 'search' }));
}

export async function runCrawl(user, { url }) {
  return runChain(user, 'crawl', async (p) => {
    // Tavily 口径：每 5 个成功 URL 1 credit（向上取整），advanced 翻倍
    const urls = Math.max(1, Array.isArray(p.extra?.body?.urls) ? p.extra.body.urls.length : 1);
    const per = p.extra?.body?.extract_depth === 'advanced' ? 2 : 1;
    const units = Math.ceil(urls / 5) * per;
    assertGlobalQuota(p, units);
    assertUserQuota(user, p, units);
    const raw = await callJson(p, { url });
    const titlePath = p.extra?.titlePath;
    const title = (titlePath ? getPathLoose(raw, titlePath) : raw?.title) || url;
    recordUsage(p, { units, detail: `extract ${urls} url`, user });
    return { text: normalizeText(p, raw), title, url };
  }).then(({ result, provider }) => ({ ...result, provider: provider.name || 'crawl' }));
}

export async function runParse(user, file) {
  return runChain(user, 'parse', async (p) => {
    // 阿里云文档解析按页计费：图片 1 页、PDF 实际页数、文本每 2000 字 1 页
    const pages = estimatePages(file);
    assertGlobalQuota(p, pages);
    assertUserQuota(user, p, pages);
    if (p.extra?.mode === 'docmind') {
      const out = await parseWithDocmind(p, file);
      // 按官方计费口径回写：PDF/Word/PPT 实际页数，Excel/HTML 等按字数折算
      const billed = billablePages(file, { pages: out.pages, text: out.text });
      recordUsage(p, { units: billed, detail: `${file?.name || 'parse'}（${billed} 页）`, user });
      return out.text;
    }
    const raw = await callWithFile(p, {}, file);
    const text = normalizeText(p, raw);
    const billed = billablePages(file, { pages, text });
    recordUsage(p, { units: billed, detail: `${file?.name || 'parse'}（${billed} 页）`, user });
    return text;
  }).then(({ result, provider }) => ({ text: result, provider: provider.name || 'parse' }));
}

export async function runOcr(user, file) {
  return runChain(user, 'ocr', async (p) => {
    // mode=vision：图片转 base64 data URL，走 OpenAI 兼容的 chat/completions
    if (p.extra?.mode === 'vision') {
      const mime = file.mime || 'image/png';
      const b64 = file.buffer.toString('base64');
      const raw = await callJson(p, {
        imageUrl: 'data:' + mime + ';base64,' + b64,
        imageBase64: b64,
        model: p.model || '',
        mime,
        filename: file.name || 'image',
        prompt: p.extra?.prompt || '请提取图片中的全部文字，保持原有顺序与换行，不要添加解释。',
      });
      return normalizeText(p, raw);
    }
    const raw = await callWithFile(p, {}, file);
    return normalizeText(p, raw);
  }).then(({ result, provider }) => ({ text: result, provider: provider.name || 'ocr' }));
}

export async function runTts(user, { text, voice = '' }) {
  return runChain(user, 'tts', async (p) => {
    const chosenVoice = voice || p.extra?.defaultVoice || '';
    if (p.extra?.mode === 'chat-audio') {
      // 小米 MiMo：走 chat/completions，音频以 base64 放在 choices[0].message.audio.data
      const raw = await callJson(p, { text, voice: chosenVoice, model: p.model || '' });
      const dataPath = p.extra?.audioPath || 'choices.0.message.audio.data';
      const data = getPathLoose(raw, dataPath);
      if (typeof data !== 'string' || !data) throw new Error('上游未返回音频数据');
      return { buffer: Buffer.from(data, 'base64'), mime: p.extra?.audioMime || 'audio/wav' };
    }
    return callBinary(p, { text, voice: chosenVoice, model: p.model || '' });
  }).then(({ result, provider }) => ({
    ...result,
    provider: provider.name || 'tts',
  }));
}

export async function runAsr(user, file) {
  return runChain(user, 'asr', async (p) => {
    const raw = await callWithFile(p, { model: p.model || '', language: 'zh' }, file);
    return normalizeText(p, raw);
  }).then(({ result, provider }) => ({ text: result, provider: provider.name || 'asr' }));
}

/** 连通性探测，供后台「测试」按钮使用 */
export async function testProvider(provider, category) {
  const started = Date.now();
  try {
    if (category === 'search') {
      const raw = await callJson(provider, { query: 'ping', limit: 1 });
      const list = normalizeSearch(provider, raw);
      return { ok: true, ms: Date.now() - started, sample: `${list.length} 条结果` };
    }
    if (category === 'llm') {
      const raw = await callJson(provider, {});
      return { ok: true, ms: Date.now() - started, sample: JSON.stringify(raw).slice(0, 120) };
    }
    if (category === 'parse' && provider.extra?.mode === 'docmind') {
      // 只申请一次 OSS 直传凭证：能验通 AccessKey 与签名，又不会真的解析文档、不消耗页数
      await authorizeFileUpload(parseCredential(provider.api_key));
      return { ok: true, ms: Date.now() - started, sample: 'AccessKey 签名与上传通道正常（未消耗页数）' };
    }
    return { ok: true, ms: Date.now() - started, sample: '已跳过（该能力需真实文件/文本）' };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: err?.message || String(err) };
  }
}

/* 转出能力元信息，供路由层直接引用 */
export { CATEGORIES, CATEGORY_META, DEFAULT_EXTRA } from './http-adapter.js';
