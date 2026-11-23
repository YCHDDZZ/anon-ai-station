import { all, get, run, now, setting } from '../db.js';

/**
 * 安全基础设施：真实 IP、限流、IP 封禁、安全事件、封禁状态、响应安全头。
 * 全部零依赖；限流计数放内存（单进程），封禁与事件落库（重启不丢）。
 */

/* ── IP ───────────────────────────────────────────────── */

const normalizeIp = (v) => {
  let ip = String(v || '').replace(/^::ffff:/i, '').trim();
  if (ip === '::1' || ip === '') ip = '127.0.0.1';
  return ip;
};

export const isLoopback = (ip) => ip === '127.0.0.1' || ip === 'localhost';

/** 内网 / 本机地址：只有来自这些地址的 X-Forwarded-For 才可信（反向代理场景） */
export function isPrivate(ip) {
  const s = String(ip || '');
  if (isLoopback(s)) return true;
  if (/^10\./.test(s) || /^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  return false;
}

export function clientIp(req) {
  const peer = normalizeIp(req.socket?.remoteAddress);
  // 直连公网时忽略可伪造的 XFF，避免被用来封禁任意 IP
  if (!isPrivate(peer)) return peer;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  return normalizeIp(xff || real || peer);
}

/* ── 封禁 ─────────────────────────────────────────────── */

const blockCache = new Map(); // ip -> { record|null, checkedAt }

export function blockedInfo(ip) {
  const cached = blockCache.get(ip);
  if (cached && now() - cached.checkedAt < 5000) return cached.record;

  const row = get('SELECT * FROM blocked_ips WHERE ip = ?', ip);
  let record = null;
  if (row && Number(row.until) > now()) {
    record = { ip, until: Number(row.until), reason: row.reason || '' };
  }
  blockCache.set(ip, { record, checkedAt: now() });
  return record;
}

export function blockIp(ip, minutes, reason = '', kind = 'manual') {
  const until = now() + Math.max(1, Number(minutes) || 30) * 60_000;
  run(
    `INSERT INTO blocked_ips(ip, reason, until, created_at) VALUES(?,?,?,?)
     ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, until = excluded.until, created_at = excluded.created_at`,
    ip,
    String(reason).slice(0, 200),
    until,
    now()
  );
  blockCache.set(ip, { record: { ip, until, reason: String(reason).slice(0, 200) }, checkedAt: now() });
  logEvent(`ip_block_${kind}`, { ip, detail: reason });
  return until;
}

export function unblockIp(ip) {
  run('DELETE FROM blocked_ips WHERE ip = ?', ip);
  blockCache.delete(ip);
}

export function listBlocks() {
  run('DELETE FROM blocked_ips WHERE until <= ?', now());
  return all('SELECT * FROM blocked_ips ORDER BY until DESC');
}

/* ── 事件 ─────────────────────────────────────────────── */

export function logEvent(kind, { ip = null, userId = null, detail = '' } = {}) {
  try {
    run(
      'INSERT INTO security_events(kind, ip, user_id, detail, created_at) VALUES(?,?,?,?,?)',
      kind,
      ip,
      userId,
      String(detail).slice(0, 500),
      now()
    );
  } catch {
    /* 审计失败不影响主流程 */
  }
}

export function listEvents(limit = 80) {
  return all('SELECT * FROM security_events ORDER BY id DESC LIMIT ?', Math.min(Number(limit) || 80, 300));
}

/* ── 异常流量 ─────────────────────────────────────────── */

const hits = new Map(); // ip -> timestamps[]
const spikeLogged = new Map(); // `${ip}|${minute}` -> true
const autoBlocked = new Set();

export function noteRequest(ip) {
  const t = now();
  let arr = hits.get(ip);
  if (!arr) {
    arr = [];
    hits.set(ip, arr);
  }
  arr.push(t);
  while (arr.length && t - arr[0] > 60_000) arr.shift();
  return arr.length;
}

/**
 * 每分钟请求数超过阈值时自动封禁。
 * loopback 永不自动封禁（本地调试 / 反代同机）。
 */
export function guardTraffic(ip) {
  const count = noteRequest(ip);
  const limit = Number(setting('securityRateLimit', '600')) || 600;
  if (count <= limit) return null;

  const minuteKey = `${ip}|${Math.floor(now() / 60000)}`;
  if (spikeLogged.has(minuteKey)) return null;
  spikeLogged.set(minuteKey, true);
  if (spikeLogged.size > 5000) spikeLogged.clear();

  logEvent('traffic_spike', { ip, detail: `1 分钟内 ${count} 次请求，阈值 ${limit}` });
  if (isLoopback(ip)) return null;
  if (setting('securityAutoBlock', 'true') !== 'true') return null;

  if (autoBlocked.has(minuteKey)) return null;
  autoBlocked.add(minuteKey);
  if (autoBlocked.size > 5000) autoBlocked.clear();

  const minutes = Number(setting('securityAutoBlockMinutes', '30')) || 30;
  blockIp(ip, minutes, `请求频率异常（${count} 次/分钟）`, 'auto');
  return { until: now() + minutes * 60_000, count, limit };
}

export function trafficSnapshot(limit = 12) {
  const t = now();
  const rows = [];
  for (const [ip, arr] of hits) {
    const recent = arr.filter((x) => t - x < 60_000);
    if (!recent.length) {
      hits.delete(ip);
      continue;
    }
    rows.push({ ip, perMinute: recent.length });
  }
  rows.sort((a, b) => b.perMinute - a.perMinute);
  return rows.slice(0, limit);
}

export function cleanupTraffic() {
  const t = now();
  for (const [ip, arr] of hits) {
    if (!arr.length || t - arr.at(-1) > 120_000) hits.delete(ip);
  }
}

/* ── 账号封禁 ─────────────────────────────────────────── */

export function banInfo(user) {
  if (!user) return null;
  const raw = user.banned_until;
  if (raw === null || raw === undefined || raw === '') return null;
  const until = Number(raw);
  if (until !== 0 && until <= now()) return null;
  return {
    permanent: until === 0,
    until: until || null,
    reason: user.ban_reason || '',
    notice: setting('banNotice', ''),
  };
}

export const isBanned = (user) => Boolean(banInfo(user));

/** 到期自动解封，返回是否发生变化 */
export function liftExpiredBans() {
  const rows = all('SELECT id, banned_until FROM users WHERE banned_until IS NOT NULL');
  let lifted = 0;
  for (const r of rows) {
    const until = Number(r.banned_until);
    if (until !== 0 && until <= now()) {
      run("UPDATE users SET status='active', banned_until=NULL, ban_reason=NULL WHERE id=?", r.id);
      lifted += 1;
    }
  }
  return lifted;
}

/* ── 响应安全头 ───────────────────────────────────────── */

export function securityHeaders(isHtml = false) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate',
  };
  if (isHtml) {
    headers['Content-Security-Policy'] =
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; connect-src 'self'; font-src 'self' data:; media-src 'self' blob:; " +
      "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  }
  return headers;
}

/** robots.txt：明确拒绝所有抓取，但不在界面展示 */
export const ROBOTS_TXT = [
  'User-agent: *',
  'Disallow: /',
  '',
  'User-agent: GPTBot',
  'Disallow: /',
  '',
  'User-agent: ClaudeBot',
  'Disallow: /',
  '',
  'User-agent: Claude-Web',
  'Disallow: /',
  '',
  'User-agent: CCBot',
  'Disallow: /',
  '',
  'User-agent: Google-Extended',
  'Disallow: /',
  '',
  'User-agent: Bytespider',
  'Disallow: /',
  '',
  'User-agent: Amazonbot',
  'Disallow: /',
  '',
  'User-agent: Applebot-Extended',
  'Disallow: /',
  '',
  'User-agent: FacebookBot',
  'Disallow: /',
  '',
  'User-agent: PerplexityBot',
  'Disallow: /',
  '',
  'User-agent: MJ12bot',
  'Disallow: /',
  '',
  'User-agent: AhrefsBot',
  'Disallow: /',
  '',
  'User-agent: SemrushBot',
  'Disallow: /',
  '',
  'User-agent: DotBot',
  'Disallow: /',
  '',
  'User-agent: PetalBot',
  'Disallow: /',
  '',
  'Crawl-delay: 86400',
  '',
].join('\n');

/** robots.txt 之外的补充：不常见的 UA 只在安全页里作为线索展示，不做拦截 */
export function looksLikeCrawler(req) {
  const ua = String(req.headers['user-agent'] || '');
  return !ua || /(bot|crawler|spider|scraper|headlesschrome|phantomjs|scrapy)/i.test(ua);
}
