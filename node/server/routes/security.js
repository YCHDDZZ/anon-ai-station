import { all, get, run, now, setting, setSetting } from '../db.js';
import { requireAdmin } from '../lib/auth.js';
import { AppError, E } from '../lib/errors.js';
import { disableScope, resetUsage, usageSummary } from '../lib/quota.js';
import {
  blockIp,
  listBlocks,
  listEvents,
  trafficSnapshot,
  unblockIp,
  clientIp,
  logEvent,
  liftExpiredBans,
} from '../lib/security.js';

function groupList() {
  return String(setting('registerGroupNumbers', '') || '')
    .split(/[\s,，;；、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default async function securityRoutes(app) {
  /* 安全管理总览 */
  app.get('/api/admin/security', async (request, reply) => {
    await requireAdmin(request);
    liftExpiredBans();

    const banned = all(
      `SELECT id, email, ban_reason, banned_until, last_ip, last_login_at
         FROM users
        WHERE banned_until IS NOT NULL AND (banned_until = 0 OR banned_until > ?)
        ORDER BY banned_until`,
      now()
    );

    const logins24h = get('SELECT COUNT(*) AS c FROM login_events WHERE created_at > ?', now() - 86400_000);
    const failed24h = get(
      'SELECT COUNT(*) AS c FROM login_events WHERE created_at > ? AND ok = 0',
      now() - 86400_000
    );
    const registrations24h = get(
      "SELECT COUNT(*) AS c FROM login_events WHERE created_at > ? AND kind = 'user_registered'",
      now() - 86400_000
    );
    const events24h = get('SELECT COUNT(*) AS c FROM security_events WHERE created_at > ?', now() - 86400_000);
    const sessions = get('SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?', now());

    return reply.send({
      ok: true,
      settings: {
        registerGroupNumbers: groupList(),
        rateLimit: Number(setting('securityRateLimit', '600')),
        autoBlock: setting('securityAutoBlock', 'true') === 'true',
        autoBlockMinutes: Number(setting('securityAutoBlockMinutes', '30')),
        banNotice: setting('banNotice', ''),
        userProvidersOpen: setting('userProvidersOpen', 'false') === 'true',
      },
      stats: {
        banned: banned.length,
        blockedIps: listBlocks().length,
        logins24h: logins24h.c,
        failed24h: failed24h.c,
        registrations24h: registrations24h.c,
        events24h: events24h.c,
        activeSessions: sessions.c,
      },
      bannedUsers: banned.map((u) => ({
        id: u.id,
        email: u.email,
        reason: u.ban_reason || '',
        until: Number(u.banned_until),
        lastIp: u.last_ip,
        lastLoginAt: u.last_login_at,
      })),
      blocks: listBlocks().map((b) => ({
        ip: b.ip,
        reason: b.reason,
        until: b.until,
        createdAt: b.created_at,
        permanent: false,
      })),
      events: listEvents(60).map((e) => ({
        id: e.id,
        kind: e.kind,
        ip: e.ip,
        userId: e.user_id,
        detail: e.detail,
        createdAt: e.created_at,
      })),
      traffic: trafficSnapshot(12),
      logins: all(
        `SELECT l.*, u.email AS user_email FROM login_events l
           LEFT JOIN users u ON u.id = l.user_id
          ORDER BY l.id DESC LIMIT 50`
      ).map((l) => ({
        id: l.id,
        email: l.email || l.user_email || '',
        ip: l.ip,
        device: l.device_id ? String(l.device_id).slice(0, 8) : '',
        ua: l.ua,
        kind: l.kind,
        ok: Boolean(l.ok),
        reason: l.reason,
        createdAt: l.created_at,
      })),
    });
  });

  /* 更新安全设置 */
  app.put('/api/admin/security/settings', async (request, reply) => {
    await requireAdmin(request);
    const b = request.body || {};

    if (b.registerGroupNumbers !== undefined) {
      const raw = Array.isArray(b.registerGroupNumbers)
        ? b.registerGroupNumbers.join('\n')
        : String(b.registerGroupNumbers);
      const list = raw
        .split(/[\s,，;；、]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 50) throw E.badRequest('分部群号最多 50 个');
      for (const g of list) {
        if (g.length > 32) throw E.badRequest('单个群号长度不能超过 32 个字符');
      }
      setSetting('registerGroupNumbers', list.join('\n'));
    }


    if (b.rateLimit !== undefined) {
      const n = Number(b.rateLimit);
      if (!Number.isFinite(n) || n < 30 || n > 20000) throw E.badRequest('每分钟请求阈值需在 30–20000 之间');
      setSetting('securityRateLimit', String(Math.round(n)));
    }

    if (b.autoBlock !== undefined) setSetting('securityAutoBlock', b.autoBlock ? 'true' : 'false');

    if (b.userProvidersOpen !== undefined) setSetting('userProvidersOpen', b.userProvidersOpen ? 'true' : 'false');

    if (b.autoBlockMinutes !== undefined) {
      const n = Number(b.autoBlockMinutes);
      if (!Number.isFinite(n) || n < 1 || n > 1440) throw E.badRequest('自动封禁时长需在 1–1440 分钟之间');
      setSetting('securityAutoBlockMinutes', String(Math.round(n)));
    }

    if (b.banNotice !== undefined) {
      const v = String(b.banNotice).trim();
      if (!v) throw E.badRequest('封禁通知文案不能为空');
      setSetting('banNotice', v.slice(0, 300));
    }

    logEvent('security_settings_updated', { ip: clientIp(request), userId: request.user.id });
    return reply.send({ ok: true });
  });

  /* 手动封禁 IP */
  app.post('/api/admin/security/block', async (request, reply) => {
    await requireAdmin(request);
    const ip = String(request.body?.ip || '').trim();
    if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw E.badRequest('IP 格式不正确');
    const minutes = Number(request.body?.minutes) || 60;
    if (minutes < 1 || minutes > 60 * 24 * 365) throw E.badRequest('封禁时长不合法');
    const until = blockIp(ip, minutes, String(request.body?.reason || '').slice(0, 200), 'manual');
    return reply.send({ ok: true, ip, until });
  });

  app.delete('/api/admin/security/block/:ip', async (request, reply) => {
    await requireAdmin(request);
    unblockIp(request.params.ip);
    logEvent('ip_unblock', { ip: request.params.ip, userId: request.user.id });
    return reply.send({ ok: true });
  });

  /* 登录记录（可按邮箱过滤） */
  app.get('/api/admin/security/logins', async (request, reply) => {
    await requireAdmin(request);
    const limit = Math.min(Number(request.query?.limit) || 100, 500);
    const email = String(request.query?.email || '').trim().toLowerCase();
    const rows = email
      ? all('SELECT * FROM login_events WHERE email = ? ORDER BY id DESC LIMIT ?', email, limit)
      : all('SELECT * FROM login_events ORDER BY id DESC LIMIT ?', limit);
    return reply.send({ ok: true, logins: rows });
  });

  /* 接口用量与额度 */
  app.get('/api/admin/usage', async (request, reply) => {
    await requireAdmin(request);
    return reply.send({ ok: true, ...usageSummary() });
  });

  app.post('/api/admin/usage/reset', async (request, reply) => {
    await requireAdmin(request);
    const scope = String(request.body?.scope || '').trim();
    if (!scope) throw E.badRequest('缺少配额组标识');
    resetUsage(scope);
    logEvent('quota_reset', { ip: clientIp(request), userId: request.user.id, detail: scope });
    return reply.send({ ok: true, ...usageSummary() });
  });

  app.post('/api/admin/usage/disable', async (request, reply) => {
    await requireAdmin(request);
    const scope = String(request.body?.scope || '').trim();
    if (!scope) throw E.badRequest('缺少配额组标识');
    const disabled = disableScope(scope);
    logEvent('quota_disable', { ip: clientIp(request), userId: request.user.id, detail: `${scope} · ${disabled} 个接口` });
    return reply.send({ ok: true, disabled, ...usageSummary() });
  });

  /* 清空安全事件（保留最近 7 天） */
  app.post('/api/admin/security/purge', async (request, reply) => {
    await requireAdmin(request);
    const before = now() - 7 * 86400_000;
    run('DELETE FROM security_events WHERE created_at < ?', before);
    run('DELETE FROM login_events WHERE created_at < ?', before);
    run('DELETE FROM blocked_ips WHERE until <= ?', now());
    logEvent('security_purge', { userId: request.user.id });
    return reply.send({ ok: true });
  });
}
