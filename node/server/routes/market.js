import { all, get, now, run, setSetting, setting } from '../db.js';
import { requireAdmin, requireUser } from '../lib/auth.js';
import { E } from '../lib/errors.js';

const BASE = 'https://jiupamiao.asia';
const KEYS = String(process.env.MARKET_API_KEYS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DAILY_LIMIT = 500;
const cache = new Map();
const TTL = 5 * 60 * 1000;

function usageToday() {
  const today = new Date().toISOString().slice(0, 10);
  let usage = {};
  try {
    usage = JSON.parse(setting('marketKeyUsage', '{}')) || {};
  } catch {
    usage = {};
  }
  for (const key of Object.keys(usage)) {
    if (usage[key]?.d !== today) delete usage[key];
  }
  return usage;
}

function pickKey(usage) {
  const n = KEYS.length;
  const cursor = (Number(setting('marketKeyCursor', '0')) || 0) % n;
  for (let i = 0; i < n; i++) {
    const key = KEYS[(cursor + i) % n];
    if (Number(usage[key]?.c || 0) < DAILY_LIMIT) return key;
  }
  return null;
}

function bumpKey(key) {
  const usage = usageToday();
  usage[key] = { d: new Date().toISOString().slice(0, 10), c: Number(usage[key]?.c || 0) + 1 };
  setSetting('marketKeyUsage', JSON.stringify(usage));
  const idx = KEYS.indexOf(key);
  if (idx >= 0) setSetting('marketKeyCursor', String((idx + 1) % KEYS.length));
}

function exhaustKey(key) {
  const usage = usageToday();
  usage[key] = { d: new Date().toISOString().slice(0, 10), c: DAILY_LIMIT };
  setSetting('marketKeyUsage', JSON.stringify(usage));
}

export function marketKeyStatus() {
  const usage = usageToday();
  return KEYS.map((key, i) => ({
    index: i + 1,
    masked: key.slice(0, 8) + '…' + key.slice(-6),
    used: Number(usage[key]?.c || 0),
    limit: DAILY_LIMIT,
  }));
}

async function marketGet(path, query = {}) {
  if (!KEYS.length) {
    throw E.badRequest('角色卡广场未配置 API Key（环境变量 MARKET_API_KEYS）');
  }
  const url = BASE + path + (Object.keys(query).length ? `?${new URLSearchParams(query)}` : '');
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.json;
  for (let attempt = 0; attempt < KEYS.length; attempt++) {
    const usage = usageToday();
    const key = pickKey(usage);
    if (!key) throw E.rateLimited('今日角色卡接口额度已用完，请明天再试');

    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-API-Key': key },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw E.providerFailed('角色卡广场暂时连不上');
    }

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      exhaustKey(key);
      continue;
    }
    if (!res.ok) throw E.providerFailed(`角色卡广场返回 ${res.status}`);

    const json = await res.json();
    bumpKey(key);
    cache.set(url, { at: Date.now(), json });
    return json;
  }
  throw E.rateLimited('角色卡广场的 Key 暂时都不可用，请稍后再试');
}

function brief(it) {
  return {
    id: Number(it.id) || 0,
    title: String(it.title || ''),
    author: String(it.author || ''),
    tags: String(it.tags || ''),
    copyCount: Number(it.copy_count) || 0,
    createdAt: String(it.created_at || ''),
  };
}

function localBrief(row) {
  return {
    id: Number(row.id),
    title: String(row.title || ''),
    author: String(row.author || ''),
    tags: String(row.tags || ''),
    copyCount: Number(row.copy_count) || 0,
    createdAt: String(row.created_at || ''),
  };
}

export default async function marketRoutes(app) {
  app.get('/api/market/personas', async (request, reply) => {
    await requireUser(request);
    let tag = String(request.query?.tag || '').trim() || '全部';
    const cursor = Math.max(0, Number(request.query?.cursor) || 0);
    const keyword = String(request.query?.q || '').trim();

    const cached = Number(get('SELECT COUNT(*) AS c FROM market_cards')?.c || 0);
    if (cached > 0) {
      const where = ['is_nsfw = 0'];
      const args = [];
      if (tag !== '全部') {
        where.push('tags LIKE ?');
        args.push(`%${tag}%`);
      }
      if (keyword) {
        where.push('(title LIKE ? OR tags LIKE ? OR author LIKE ?)');
        args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
      }
      const ws = where.join(' AND ');
      const total = Number(get(`SELECT COUNT(*) AS c FROM market_cards WHERE ${ws}`, ...args)?.c || 0);
      const rows = all(
        `SELECT * FROM market_cards WHERE ${ws} ORDER BY copy_count DESC, id DESC LIMIT 24 OFFSET ?`,
        ...args,
        cursor
      );
      const next = cursor + 24 < total ? cursor + 24 : null;
      return reply.send({
        ok: true,
        tag,
        q: keyword,
        items: rows.map(localBrief),
        total,
        cached,
        source: 'local',
        hasMore: next !== null,
        nextCursor: next,
      });
    }

    if (tag === '全部') {
      // 本地缓存为空时，上游必须给一个真实标签
      tag = '角色扮演';
    }

    if (keyword) {
      const r = await marketGet('/api/v1/prompts/by_tag', { tag, per_page: 100 });
      const allItems = [];
      const needle = keyword.toLowerCase();
      for (const it of r.prompts || []) {
        if (it.is_nsfw) continue;
        const title = String(it.title || '');
        const tags = String(it.tags || '');
        if (title.toLowerCase().includes(needle) || tags.toLowerCase().includes(needle)) {
          allItems.push(brief(it));
        }
      }
      const items = allItems.slice(cursor, cursor + 24);
      const next = cursor + 24 < allItems.length ? cursor + 24 : null;
      return reply.send({
        ok: true,
        tag,
        q: keyword,
        items,
        total: allItems.length,
        cached: 0,
        source: 'live',
        hasMore: next !== null,
        nextCursor: next,
      });
    }

    const q = { tag, per_page: 24 };
    if (cursor > 0) q.cursor = cursor;
    const r = await marketGet('/api/v1/prompts/by_tag', q);
    const items = [];
    for (const it of r.prompts || []) {
      if (it.is_nsfw) continue;
      items.push(brief(it));
    }
    return reply.send({
      ok: true,
      tag,
      items,
      cached: 0,
      source: 'live',
      hasMore: Boolean(r.has_more),
      nextCursor: r.next_cursor ?? null,
    });
  });

  app.get('/api/market/personas/:id', async (request, reply) => {
    await requireUser(request);
    const id = Number(request.params.id);
    const row = get('SELECT * FROM market_cards WHERE id = ?', id);
    if (row) {
      if (Number(row.is_nsfw) === 1) throw E.forbidden('该角色卡不适合展示');
      return reply.send({ ok: true, card: { ...localBrief(row), content: String(row.content || '') } });
    }
    const r = await marketGet(`/api/v1/prompt/${id}`);
    const c = r.prompt;
    if (!c) throw E.notFound('角色卡不存在');
    if (c.is_nsfw) throw E.forbidden('该角色卡不适合展示');
    return reply.send({ ok: true, card: { ...brief(c), content: String(c.content || '') } });
  });

  app.post('/api/admin/market/sync', async (request, reply) => {
    await requireAdmin(request);
    const requested = Number(request.body?.start) || 0;
    let start = requested > 0 ? Math.max(1, requested) : Math.max(1, Number(setting('marketSyncNext', '1')) || 1);
    if (start > 1200) start = 1;
    const end = Math.min(1200, Math.max(start, start + 49));
    const ids = [];
    for (let i = start; i <= end; i++) ids.push(i);
    const r = await marketGet('/api/v1/prompts/batch', { ids: ids.join(',') });
    let saved = 0;
    for (const c of r.prompts || []) {
      if (c.is_nsfw) continue;
      const id = Number(c.id) || 0;
      if (!id) continue;
      const exists = get('SELECT id FROM market_cards WHERE id = ?', id);
      if (exists) {
        run(
          'UPDATE market_cards SET title=?, author=?, tags=?, copy_count=?, content=?, created_at=?, fetched_at=? WHERE id=?',
          String(c.title || ''),
          String(c.author || ''),
          String(c.tags || ''),
          Number(c.copy_count) || 0,
          String(c.content || ''),
          String(c.created_at || ''),
          now(),
          id
        );
      } else {
        run(
          'INSERT INTO market_cards(title, author, tags, copy_count, content, created_at, fetched_at, id) VALUES(?,?,?,?,?,?,?,?)',
          String(c.title || ''),
          String(c.author || ''),
          String(c.tags || ''),
          Number(c.copy_count) || 0,
          String(c.content || ''),
          String(c.created_at || ''),
          now(),
          id
        );
      }
      saved += 1;
    }
    setSetting('marketSyncNext', String(end + 1));
    const cached = Number(get('SELECT COUNT(*) AS c FROM market_cards')?.c || 0);
    return reply.send({ ok: true, next: end + 1, done: end >= 1200, saved, cached, scanned: end });
  });

  app.get('/api/admin/market/stats', async (request, reply) => {
    await requireAdmin(request);
    const cached = Number(get('SELECT COUNT(*) AS c FROM market_cards')?.c || 0);
    return reply.send({ ok: true, cached, target: 1200, next: Number(setting('marketSyncNext', '1')) || 1, keys: marketKeyStatus() });
  });
}
