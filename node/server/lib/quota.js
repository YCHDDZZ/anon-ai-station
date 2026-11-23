import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, get, run, now, setting } from '../db.js';
import { AppError } from './errors.js';
import { sendQuotaAlert } from './mailer.js';

/**
 * 第三方接口用量与额度。
 *
 * 计数口径（来自官方计费文档）：
 *  - Tavily 搜索：basic 1 credit / 次，advanced 2 credits / 次
 *  - Tavily 网页提取：每 5 个成功 URL 1 credit（basic），advanced 翻倍
 *  - 阿里云文档解析：按页计费，图片 1 张 = 1 页，文本每 2000 字 = 1 页
 *
 * 额度是「按账号」而不是「按接口」的（Tavily 的 1000 credits 由 search 与 extract 共享），
 * 所以用量按 `extra.quota.group` 分组累计，同一组的接口共享一个计数器。
 */

export const QUOTA_DEFAULTS = {
  search: { unit: 'credit', monthly: 1000, price: 0.008, currency: 'USD', warnAt: 90, track: true },
  crawl: { unit: 'credit', monthly: 1000, price: 0.008, currency: 'USD', warnAt: 90, track: true },
  parse: { unit: 'page', monthly: 3000, price: 0.02, currency: 'CNY', warnAt: 90, track: true },
  ocr: { unit: 'page', monthly: 0, price: 0, currency: 'CNY', warnAt: 90, track: false },
  llm: { unit: 'credit', monthly: 0, price: 0, currency: 'CNY', warnAt: 90, track: false },
  tts: { unit: '次', monthly: 0, price: 0, currency: 'CNY', warnAt: 90, track: false },
  asr: { unit: '次', monthly: 0, price: 0, currency: 'CNY', warnAt: 90, track: false },
};

const UNIT_LABEL = { credit: 'credits', page: '页', 次: '次', call: '次' };
const CATEGORY_LABEL = {
  search: '联网搜索',
  crawl: '网页爬取',
  parse: '文档解析',
  ocr: '图片 OCR',
  llm: '大模型',
  tts: '语音合成',
  asr: '语音识别',
};

/** 参与平分额度的账号数：所有正常状态的账号（含管理员） */
export function eligibleUserCount() {
  const row = get("SELECT COUNT(*) AS c FROM users WHERE status = 'active'");
  return Math.max(1, Number(row?.c) || 1);
}

/** 数字展示：整数不带小数点，小数保留 1 位 */
export const fmtUnits = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

export const periodKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function quotaOf(provider) {
  const defaults = QUOTA_DEFAULTS[provider.category] || QUOTA_DEFAULTS.search;
  const raw = provider.extra?.quota || {};
  const q = { ...defaults, ...raw };
  q.monthly = Math.max(0, Number(q.monthly) || 0);
  q.price = Math.max(0, Number(q.price) || 0);
  q.warnAt = Math.min(100, Math.max(1, Number(q.warnAt) || 90));
  q.unit = String(q.unit || defaults.unit);
  q.currency = q.currency === 'USD' ? 'USD' : 'CNY';
  q.scope = raw.group ? `g:${String(raw.group).slice(0, 40)}` : `p:${provider.id}`;
  return q;
}

export function unitLabel(unit) {
  return UNIT_LABEL[unit] || unit;
}

export function money(currency, amount) {
  const symbol = currency === 'USD' ? '$' : '¥';
  const fixed = Number(amount) >= 100 ? 0 : 2;
  return `${symbol}${Number(amount).toFixed(fixed)}`;
}

/* ── 计数 ─────────────────────────────────────────────── */

/** 估算文档页数：图片 1 页、PDF 取实际页数、纯文本每 2000 字 1 页 */
export function estimatePages(file) {
  const name = String(file?.name || '').toLowerCase();
  const mime = String(file?.mime || '');
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(name) || mime.startsWith('image/')) return 1;
  const buf = file?.buffer;
  if (buf && (name.endsWith('.pdf') || mime === 'application/pdf')) {
    const latin = String(buf.toString('latin1'));
    const pages = (latin.match(/\/Type\s*\/Page[^s]/g) || []).length;
    // 带对象流的 PDF 里 /Type /Page 可能被压缩，页树的 /Count 更可靠，取两者最大值
    const counts = [...latin.matchAll(/\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/g)].map((m) => Number(m[1]) || 0);
    return Math.max(1, pages, ...counts);
  }
  // docx/pptx 无法在本地数页：按体积保守估算（每 200KB 记 1 页），避免超大文档绕过份额校验
  if (buf && /\.(docx?|pptx?)$/.test(name)) {
    return Math.max(1, Math.ceil(buf.length / (200 * 1024)));
  }
  // Excel/HTML/EPUB 按字数折页，体积和页数更接近 20KB/页，估得太松会放过超大表格
  if (buf && /\.(xlsx?|xlsm|html?|epub|mobi|rtf|txt|md|markdown|csv)$/.test(name)) {
    return Math.max(1, Math.ceil(buf.length / (20 * 1024)));
  }
  if (typeof file?.text === 'string' && file.text.length > 0) {
    return Math.max(1, Math.ceil(file.text.length / 2000));
  }
  return 1;
}

/**
 * 阿里云文档智能的真实计费页数（官方口径）：
 *  - PDF / Word / PPT：按实际页数
 *  - 图片：1 张 = 1 页
 *  - Excel / HTML / EPUB / MOBI / RTF / 纯文本：中文每 2000 字符、英文每 2000 词 = 1 页
 * 解析完成后用这个函数回写用量，避免「按页数估算」与账单口径不一致。
 */
const TEXT_PAGED_EXT = new Set(['xls', 'xlsx', 'xlsm', 'html', 'htm', 'epub', 'mobi', 'rtf', 'txt', 'md', 'markdown', 'csv']);

function textPageCount(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const words = (s.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.ceil(cjk / 2000 + words / 2000));
}

export function billablePages(file, { pages = 0, text = '' } = {}) {
  const name = String(file?.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  if (TEXT_PAGED_EXT.has(ext)) return textPageCount(text);
  if (/\.(pdf|docx?|pptx?)$/.test(name)) return Math.max(1, Number(pages) || 1);
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(name)) return 1;
  return Math.max(1, Number(pages) || 1);
}

/** 某个配额组本月已用总量 */
export function scopeUsed(scope, period = periodKey()) {
  const row = get('SELECT units FROM usage_counters WHERE scope = ? AND period = ?', scope, period);
  return Number(row?.units) || 0;
}

/**
 * 账号级硬上限：所有用户加起来不能超过该接口本月的免费/购买额度。
 * 免费额度用完后再调用会产生后付费，这里直接挡住。
 */
export function assertGlobalQuota(provider, units) {
  if (provider.ownerType !== 'global') return;
  const q = quotaOf(provider);
  if (q.track === false || !q.monthly) return;
  const used = scopeUsed(q.scope);
  const need = Number(units) || 0;
  if (used + need <= q.monthly + 1e-9) return;
  const label = CATEGORY_LABEL[provider.category] || provider.category;
  throw new AppError(
    'QUOTA_EXCEEDED',
    `本月${label}的 ${q.monthly} ${unitLabel(q.unit)}额度已用完（已用 ${fmtUnits(used)}），为避免产生后付费已暂停该接口。` +
      '管理员可在后台校准用量或等下一个计费周期。',
    402,
    { scope: q.scope, used, monthly: q.monthly, unit: unitLabel(q.unit), hardCap: true }
  );
}

/** 管理员校准：把某配额组本月已用总量改成控制台显示的值 */
export function calibrateUsage(scope, units, period = periodKey()) {
  const amount = Math.max(0, Number(units) || 0);
  const providers = providersInScope(scope);
  const price = providers.length ? quotaOf({ id: providers[0].id, category: providers[0].category, extra: parseExtraOf(providers[0]) }).price : 0;
  const row = get('SELECT calls FROM usage_counters WHERE scope = ? AND period = ?', scope, period);
  const calls = Number(row?.calls) || 0;
  run(
    `INSERT INTO usage_counters(scope, period, calls, units, cost, updated_at) VALUES(?,?,?,?,?,?)
     ON CONFLICT(scope, period) DO UPDATE SET units = excluded.units, cost = excluded.cost, updated_at = excluded.updated_at`,
    scope,
    period,
    calls,
    amount,
    Number((amount * price).toFixed(4)),
    now()
  );
  run(
    'INSERT INTO usage_log(scope, provider_id, category, units, cost, detail, created_at) VALUES(?,?,?,?,?,?,?)',
    scope,
    providers[0]?.id || 0,
    'calibrate',
    0,
    0,
    `按控制台校准本月已用：${amount}`,
    now()
  );
  return { scope, period, units: amount, calls };
}

function parseExtraOf(row) {
  try {
    return JSON.parse(row.extra_json || '{}');
  } catch {
    return {};
  }
}

export function recordUsage(provider, { units = 1, detail = '', user = null } = {}) {  try {
    if (provider.ownerType !== 'global') return; // 只统计管理员的共享接口
    const q = quotaOf(provider);
    if (q.track === false) return;
    const amount = Math.max(0, Number(units) || 0);
    if (!amount) return;

    const period = periodKey();
    const cost = Number((amount * q.price).toFixed(4));
    run(
      `INSERT INTO usage_counters(scope, period, calls, units, cost, updated_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(scope, period) DO UPDATE SET
         calls = calls + excluded.calls,
         units = units + excluded.units,
         cost = cost + excluded.cost,
         updated_at = excluded.updated_at`,
      q.scope,
      period,
      1,
      amount,
      cost,
      now()
    );
    run(
      'INSERT INTO usage_log(scope, provider_id, category, units, cost, detail, created_at) VALUES(?,?,?,?,?,?,?)',
      q.scope,
      provider.id,
      provider.category,
      amount,
      cost,
      String(detail).slice(0, 200),
      now()
    );
    // 按用户累计，用于「平分额度」的配额判断
    if (user?.id) {
      run(
        `INSERT INTO usage_user_counters(scope, period, user_id, calls, units, cost, updated_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(scope, period, user_id) DO UPDATE SET
           calls = calls + excluded.calls,
           units = units + excluded.units,
           cost = cost + excluded.cost,
           updated_at = excluded.updated_at`,
        q.scope,
        period,
        user.id,
        1,
        amount,
        cost,
        now()
      );
    }
    // 兜底：一旦总量越过免费额度（例如超大 Excel 的页数预估偏低），立刻停用该组接口，避免继续产生后付费
    if (q.monthly) {
      const total = get('SELECT units FROM usage_counters WHERE scope = ? AND period = ?', q.scope, period);
      if (Number(total?.units) > q.monthly + 1e-9) {
        const rows = providersInScope(q.scope);
        for (const row of rows) {
          run('UPDATE providers SET enabled = 0, updated_at = ? WHERE id = ?', now(), row.id);
        }
        run(
          'INSERT INTO usage_log(scope, provider_id, category, units, cost, detail, created_at) VALUES(?,?,?,?,?,?,?)',
          q.scope,
          provider.id,
          'quota_guard',
          0,
          0,
          `用量 ${total.units} 超过额度 ${q.monthly}，已自动停用 ${rows.length} 条接口`,
          now()
        );
        console.warn(`[额度保护] ${q.scope} 本月已用 ${total.units}/${q.monthly}，相关接口已自动停用`);
      }
    }
    maybeAlert(q, provider, period);
  } catch (err) {
    console.warn('[用量统计失败]', err?.message || err);
  }
}

function scopeOfRow(row) {
  try {
    const extra = JSON.parse(row.extra_json || '{}');
    const group = extra.quota && extra.quota.group;
    return group ? 'g:' + String(group).slice(0, 40) : 'p:' + row.id;
  } catch {
    return 'p:' + row.id;
  }
}

function providersInScope(scope) {
  return all("SELECT * FROM providers WHERE owner_type = 'global'").filter(
    (row) => scopeOfRow(row) === scope
  );
}

function maybeAlert(q, provider, period) {
  if (!q.monthly) return;
  const row = get('SELECT * FROM usage_counters WHERE scope = ? AND period = ?', q.scope, period);
  if (!row || row.notified_at) return;
  const percent = (row.units / q.monthly) * 100;
  if (percent < q.warnAt) return;

  // 先占位，避免并发下重复发信
  run('UPDATE usage_counters SET notified_at = ? WHERE scope = ? AND period = ?', now(), q.scope, period);

  const rows = providersInScope(q.scope);
  const names = rows.map((r) => r.name || r.category).join(' / ') || provider.name || q.scope;
  const groupName = q.group || names;
  const createdAt = Date.now();
  const exp = createdAt + 7 * 86400_000;
  const disable = actionUrl(q.scope, period, 'disable', exp);
  const keep = actionUrl(q.scope, period, 'keep', exp);

  sendQuotaAlert({
    to: config.adminEmail,
    siteName: setting('siteName', '千早爱音的AI站'),
    groupName,
    unit: unitLabel(q.unit),
    used: row.units,
    monthly: q.monthly,
    percent: Math.round(percent),
    cost: row.cost,
    currency: q.currency,
    period,
    disableUrl: disable,
    keepUrl: keep,
    adminUrl: `${config.publicUrl}/#/admin`,
  })
    .then((r) => {
      run(
        'INSERT INTO usage_log(scope, provider_id, category, units, cost, detail, created_at) VALUES(?,?,?,?,?,?,?)',
        q.scope,
        provider.id,
        'quota_alert',
        0,
        0,
        `额度告警 ${Math.round(percent)}%${r?.sent ? ' 已发信' : ' 发信失败'}`,
        now()
      );
    })
    .catch((err) => console.warn('[额度告警失败]', err?.message || err));
}

/* ── 签名链接 ─────────────────────────────────────────── */

function sign(scope, period, act, exp) {
  return crypto
    .createHmac('sha256', config.appSecret)
    .update(`${scope}|${period}|${act}|${exp}`)
    .digest('base64url');
}

export function actionUrl(scope, period, act, exp) {
  const sig = sign(scope, period, act, exp);
  const qs = new URLSearchParams({ scope, period, act, exp: String(exp), sig });
  return `${config.publicUrl}/api/quota/action?${qs.toString()}`;
}

export function verifyAction({ scope, period, act, exp, sig }) {
  if (!["disable", "keep"].includes(act)) return false;
  if (!Number(exp) || Number(exp) < now()) return false;
  const expect = sign(scope, period, act, exp);
  const a = Buffer.from(String(sig || ''));
  const b = Buffer.from(expect);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 关闭某个配额组下的全部接口 */
export function disableScope(scope) {
  const rows = providersInScope(scope);
  for (const r of rows) run('UPDATE providers SET enabled = 0, updated_at = ? WHERE id = ?', now(), r.id);
  return rows.length;
}

/* ── 管理端汇总 ───────────────────────────────────────── */

export function usageSummary() {
  const period = periodKey();
  const users = eligibleUserCount();
  const rows = all("SELECT * FROM providers WHERE owner_type = 'global' ORDER BY category, sort, id");
  const map = new Map();

  for (const row of rows) {
    let q;
    try {
      const extra = JSON.parse(row.extra_json || '{}');
      q = quotaOf({
        id: row.id,
        category: row.category,
        extra: { ...extra, quota: { ...(QUOTA_DEFAULTS[row.category] || {}), ...(extra.quota || {}) } },
      });
    } catch {
      continue;
    }
    if (!map.has(q.scope)) {
      map.set(q.scope, {
        scope: q.scope,
        group: q.group || '',
        unit: q.unit,
        unitLabel: unitLabel(q.unit),
        monthly: q.monthly,
        price: q.price,
        currency: q.currency,
        warnAt: q.warnAt,
        tracked: q.track !== false,
        providers: [],
        used: 0,
        calls: 0,
        cost: 0,
        notifiedAt: null,
      });
    }
    const item = map.get(q.scope);
    item.providers.push({
      id: row.id,
      name: row.name || row.category,
      category: row.category,
      enabled: Boolean(row.enabled),
    });
    // 同一配额组内参数可能不同，以第一个为准
  }

  for (const item of map.values()) {
    const u = get('SELECT * FROM usage_counters WHERE scope = ? AND period = ?', item.scope, period);
    if (u) {
      item.used = u.units;
      item.calls = u.calls;
      item.cost = u.cost;
      item.notifiedAt = u.notified_at || null;
    }
    item.users = users;
    item.share = users > 0 ? item.monthly / users : item.monthly;
    // 额度单位都是整数，展示时向下取整，避免「剩余 0.3 却用不了」
    item.shareDisplay = Math.floor(item.share);
    item.shareText = String(item.shareDisplay);
    item.topUsers = all(
      `SELECT c.user_id, c.units, c.calls, u.email
         FROM usage_user_counters c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.scope = ? AND c.period = ?
        ORDER BY c.units DESC LIMIT 6`,
      item.scope,
      period
    ).map((u) => ({ userId: u.user_id, email: u.email || `#${u.user_id}`, units: u.units, calls: u.calls }));
    item.percent = item.monthly > 0 ? Math.min(999, Math.round((item.used / item.monthly) * 100)) : 0;
    item.status = !item.tracked
      ? 'off'
      : item.monthly <= 0
        ? 'unset'
        : item.percent >= 100
          ? 'over'
          : item.percent >= item.warnAt
            ? 'warn'
            : 'ok';
    item.costText = money(item.currency, item.cost);
    // 供后台「立即关闭」与测试使用，1 天有效
    item.disableUrl = actionUrl(item.scope, period, 'disable', now() + 86400_000);
  }

  return {
    period,
    users,
    // 只展示需要计量的（或已经产生用量 / 配了额度的）
    items: Array.from(map.values())
      .filter((i) => i.tracked || i.monthly > 0 || i.used > 0)
      .sort((a, b) => b.percent - a.percent),
    alerts: all(
      "SELECT scope, detail, created_at FROM usage_log WHERE category = 'quota_alert' ORDER BY id DESC LIMIT 10"
    ),
  };
}

export function resetUsage(scope) {
  const period = periodKey();
  run('DELETE FROM usage_counters WHERE scope = ? AND period = ?', scope, period);
  // 个人份额也要一起清零，否则用户仍然被卡在「额度用完」
  run('DELETE FROM usage_user_counters WHERE scope = ? AND period = ?', scope, period);
  run(
    'INSERT INTO usage_log(scope, category, units, cost, detail, created_at) VALUES(?,?,?,?,?,?)',
    scope,
    'quota_reset',
    0,
    0,
    '手动重置本月用量',
    now()
  );
}

export function cleanupUsageLog() {
  run('DELETE FROM usage_log WHERE created_at < ?', now() - 7 * 86400_000);
  // 只保留最近 12 个月的按用户计数
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  run('DELETE FROM usage_user_counters WHERE period < ?', periodKey(d));
}


/* ── 按用户平分额度 ───────────────────────────────────── */

export function userUsed(scope, userId, period = periodKey()) {
  const row = get(
    'SELECT units, calls FROM usage_user_counters WHERE scope = ? AND period = ? AND user_id = ?',
    scope,
    period,
    userId
  );
  return { units: Number(row?.units) || 0, calls: Number(row?.calls) || 0 };
}

/**
 * 调用共享接口前校验「本人份额」。
 * 额度按当前正常账号数平分：1 个账号拿全部，2 个账号各一半，用完不能占用别人的份额。
 */
export function assertUserQuota(user, provider, units) {
  if (!user || provider.ownerType !== 'global') return;
  const q = quotaOf(provider);
  if (q.track === false || !q.monthly) return;

  const total = eligibleUserCount();
  const share = q.monthly / total;
  const used = userUsed(q.scope, user.id).units;
  const need = Number(units) || 0;
  if (used + need <= share + 1e-9) return;

  const label = CATEGORY_LABEL[provider.category] || provider.category;
  const msg =
    `你本月的${label}额度已用完（${fmtUnits(used)} / ${fmtUnits(share)} ${unitLabel(q.unit)}）。` +
    `共享额度由 ${total} 个账号平均分配，用完不能占用他人份额；` +
    `可以联系管理员调整共享额度，或等待后续版本开放自建 API。`;
  throw new AppError('QUOTA_EXCEEDED', msg, 402, {
    scope: q.scope,
    used,
    share,
    total,
    unit: unitLabel(q.unit),
  });
}

/** 普通用户在设置页看到的「我的共享额度」 */
export function userQuotaSummary(user) {
  const period = periodKey();
  const total = eligibleUserCount();
  const seen = new Set();
  const items = [];

  for (const row of all("SELECT * FROM providers WHERE owner_type = 'global' AND enabled = 1")) {
    let q;
    let scope;
    try {
      const extra = JSON.parse(row.extra_json || '{}');
      scope = scopeOfRow(row);
      q = quotaOf({ id: row.id, category: row.category, extra });
    } catch {
      continue;
    }
    if (seen.has(scope)) continue;
    seen.add(scope);
    if (q.track === false || !q.monthly) continue;

    const share = q.monthly / total;
    const used = userUsed(scope, user.id, period).units;
    items.push({
      scope,
      label: q.group || CATEGORY_LABEL[row.category] || row.category,
      unit: q.unit,
      unitLabel: unitLabel(q.unit),
      currency: q.currency,
      monthly: q.monthly,
      users: total,
      share,
      shareDisplay: Math.floor(share),
      shareText: String(Math.floor(share)),
      used,
      calls: userUsed(scope, user.id, period).calls,
      percent: share > 0 ? Math.min(999, Math.round((used / share) * 100)) : 0,
      cost: Number((used * q.price).toFixed(4)),
    });
  }

  return { period, users: total, items };
}
