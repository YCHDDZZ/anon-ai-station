import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, now, getSettings, setSetting, setting } from '../db.js';
import { config, ROOT } from '../config.js';
import { requireAdmin, publicUser, listUserSessions } from '../lib/auth.js';
import {
  CATEGORIES,
  CATEGORY_META,
  DEFAULT_EXTRA,
  getProviderRowById,
  getRouting,
  listProviderRows,
  toPublic,
  toRuntime,
} from '../lib/providers.js';
import { calibrateUsage, periodKey, quotaOf, scopeUsed, unitLabel } from '../lib/quota.js';
import { checkDocmindBilling } from '../lib/aliyun-billing.js';
import {
  cancelBroadcast,
  createBroadcast,
  getBroadcastImage,
  getBroadcastJob,
  listBroadcastJobs,
  listRecipients,
  saveBroadcastImage,
  sendBroadcastPreview,
} from '../lib/broadcast.js';
import fs from 'node:fs';
import { mountProviderRoutes } from '../lib/provider-routes.js';
import { mailStatus, sendTestMail, verifyMailer } from '../lib/mailer.js';
import { AppError, E } from '../lib/errors.js';
import { listAllPersonas } from '../lib/personas.js';
import { collectModels } from '../lib/model-order.js';
import { banInfo, listBlocks, listEvents, trafficSnapshot, liftExpiredBans } from '../lib/security.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function adminUserRow(r) {
  return {
    ...publicUser(r),
    conversationCount: r.conv_count,
    providerCount: r.provider_count,
    providerPreference: r.provider_preference,
    lastIp: r.last_ip || null,
    sessionCount: r.session_count,
  };
}

export default async function adminRoutes(app) {
  /* 总览 */
/** 后台展示用：线上 APK 文件信息 + 最近登录过的客户端版本 */
function appVersionAdminInfo() {
  const info = {
    versionCode: Number(setting('appVersionCode', '2')) || 1,
    versionName: setting('appVersionName', '1.1.0'),
    url: setting('appDownloadUrl', `${config.publicUrl}/downloads/anno-ai.apk`),
    notes: setting('appUpdateNotes', '应用内直接下载安装，装完就能继续聊～'),
    mandatory: setting('appUpdateMandatory', 'true') !== 'false',
    publishedAt: Number(setting('appPublishedAt', '0')) || null,
  };
  const apk = path.join(ROOT, 'web/downloads/anno-ai.apk');
  try {
    const st = fs.statSync(apk);
    info.apk = {
      size: st.size,
      modifiedAt: st.mtimeMs,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),
    };
  } catch {
    info.apk = null;
  }
  const metaPath = path.join(ROOT, 'web/downloads/anno-ai.json');
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    meta = {};
  }
  info.apkVersionCode = Number.isFinite(Number(meta.versionCode)) ? Number(meta.versionCode) : null;
  info.apkVersionName = String(meta.versionName || '');
  info.publishedVersionCode = info.versionCode;
  info.publishedVersionName = info.versionName;
  info.mismatch = info.apkVersionCode !== null && info.apkVersionCode !== info.publishedVersionCode;
  const counts = new Map();
  for (const r of all("SELECT ua FROM login_events WHERE ua LIKE '%AnonApp/%' ORDER BY id DESC LIMIT 300")) {
    const m = String(r.ua || '').match(/AnonApp\/([^\s]+)/);
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  info.clients = [...counts].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count);
  return info;
}

  app.get('/api/admin/overview', async (request, reply) => {
    await requireAdmin(request);
    liftExpiredBans();
    const users = get('SELECT COUNT(*) AS c FROM users');
    const admins = get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    const banned = get(
      "SELECT COUNT(*) AS c FROM users WHERE banned_until IS NOT NULL AND (banned_until = 0 OR banned_until > ?)",
      now()
    );
    const convs = get('SELECT COUNT(*) AS c FROM conversations');
    const msgs = get('SELECT COUNT(*) AS c FROM messages');
    const files = get('SELECT COUNT(*) AS c FROM files');
    const blocks = listBlocks();
    const logins24h = get('SELECT COUNT(*) AS c FROM login_events WHERE created_at > ?', now() - 86400_000);
    const events24h = get('SELECT COUNT(*) AS c FROM security_events WHERE created_at > ?', now() - 86400_000);

    return reply.send({
      ok: true,
      stats: {
        users: users.c,
        admins: admins.c,
        banned: banned.c,
        conversations: convs.c,
        messages: msgs.c,
        files: files.c,
        blockedIps: blocks.length,
        logins24h: logins24h.c,
        events24h: events24h.c,
      },
      categories: CATEGORIES.map((c) => {
        const entries = listProviderRows('global', null, c).map(toPublic);
        return {
          key: c,
          ...CATEGORY_META[c],
          defaults: DEFAULT_EXTRA[c],
          entries,
          provider: entries[0] || null,
          routing: getRouting('global', null, c),
        };
      }),
      settings: {
        siteName: setting('siteName', '千早爱音的AI站'),
        allowRegistration: setting('allowRegistration', 'true') === 'true',
        insufficientComputeMsg: setting('insufficientComputeMsg', '算力暂时不足，请稍后再试或联系管理员。'),
        appVersionCode: Number(setting('appVersionCode', '2')) || 1,
        appVersionName: setting('appVersionName', '1.1.0'),
        appDownloadUrl: setting('appDownloadUrl', `${config.publicUrl}/downloads/anno-ai.apk`),
        appUpdateNotes: setting('appUpdateNotes', '应用内直接下载安装，装完就能继续聊～'),
        appUpdateMandatory: setting('appUpdateMandatory', 'true') !== 'false',
      },
      mail: mailStatus(),
      personas: listAllPersonas('global', null),
      appVersion: appVersionAdminInfo(),
      traffic: trafficSnapshot(6),
      events: listEvents(10),
    });
  });

  /* 共享算力：多 API / 多 Key / 模型列表 / 调度策略 */
  mountProviderRoutes(app, {
    base: '/api/admin/providers',
    ownerType: 'global',
    guard: async (request) => requireAdmin(request),
  });

  /* 用户管理 */
  /* 模型显示顺序 */
  app.get('/api/admin/models', async (request, reply) => {
    const admin = await requireAdmin(request);
    return reply.send({ ok: true, ...collectModels(admin) });
  });

  app.put('/api/admin/models/order', async (request, reply) => {
    const admin = await requireAdmin(request);
    const body = request.body || {};

    const providers = [];
    for (const pid of Array.isArray(body.providers) ? body.providers : []) {
      const id = Number(pid);
      if (id > 0 && !providers.includes(id)) providers.push(id);
    }

    const models = {};
    for (const [pid, names] of Object.entries(body.models || {})) {
      const id = Number(pid);
      if (!id || !Array.isArray(names)) continue;
      const list = [];
      for (const name of names) {
        const v = String(name || '').trim();
        if (v && !list.includes(v)) list.push(v);
      }
      if (list.length) models[id] = list;
    }

    if (!providers.length && !Object.keys(models).length && Array.isArray(body.order)) {
      const order = [];
      for (const name of body.order) {
        const v = String(name || '').trim();
        if (v && !order.includes(v)) order.push(v);
      }
      setSetting('modelOrder', JSON.stringify(order));
    } else {
      setSetting('modelGroups', JSON.stringify({ providers, models }));
    }

    return reply.send({ ok: true, ...collectModels(admin) });
  });

  app.get('/api/admin/users', async (request, reply) => {
    await requireAdmin(request);
    liftExpiredBans();
    const q = String(request.query?.q || '').trim().toLowerCase();
    const rows = all(
      `SELECT u.*,
        (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) AS conv_count,
        (SELECT COUNT(*) FROM providers p WHERE p.owner_type='user' AND p.owner_id = u.id) AS provider_count,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS session_count
       FROM users u ORDER BY u.created_at DESC`,
      now()
    );
    const list = rows
      .filter((r) => !q || String(r.email).toLowerCase().includes(q))
      .map(adminUserRow);
    return reply.send({ ok: true, users: list });
  });

  /* 新增账号 */
  app.post('/api/admin/users', async (request, reply) => {
    await requireAdmin(request);
    const b = request.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    if (!EMAIL_RE.test(email)) throw E.badRequest('邮箱格式不正确');
    if (get('SELECT id FROM users WHERE email = ?', email)) throw E.conflict('该邮箱已存在');
    const role = b.role === 'admin' ? 'admin' : 'user';
    run(
      "INSERT INTO users(email, role, status, created_at, last_ip) VALUES(?,?, 'active', ?, ?)",
      email,
      role,
      now(),
      request.ip || null
    );
    const row = get('SELECT * FROM users WHERE email = ?', email);
    return reply.send({ ok: true, user: adminUserRow({ ...row, conv_count: 0, provider_count: 0, session_count: 0 }) });
  });

  app.patch('/api/admin/users/:id', async (request, reply) => {
    const admin = await requireAdmin(request);
    const id = Number(request.params.id);
    const target = get('SELECT * FROM users WHERE id = ?', id);
    if (!target) throw E.notFound('用户不存在');
    const b = request.body || {};

    if (b.email !== undefined) {
      const email = String(b.email).toLowerCase().trim();
      if (!EMAIL_RE.test(email)) throw E.badRequest('邮箱格式不正确');
      const dup = get('SELECT id FROM users WHERE email = ? AND id <> ?', email, id);
      if (dup) throw E.conflict('该邮箱已被其他账号使用');
      run('UPDATE users SET email = ? WHERE id = ?', email, id);
    }

    if (b.role !== undefined) {
      if (!['user', 'admin'].includes(b.role)) throw E.badRequest('无效的角色');
      if (id === admin.id && b.role !== 'admin') throw E.badRequest('不能取消自己的管理员身份');
      if (target.role === 'admin' && b.role === 'user') {
        const admins = get("SELECT COUNT(*) AS c FROM users WHERE role='admin'");
        if (admins.c <= 1) throw E.badRequest('系统必须保留至少一名超级管理员');
      }
      run('UPDATE users SET role = ? WHERE id = ?', b.role, id);
    }

    /* 封禁：hours=0 表示永久 */
    if (b.ban) {
      if (id === admin.id) throw E.badRequest('不能封禁自己的账号');
      const hours = Number(b.ban.hours);
      const permanent = b.ban.permanent === true || hours === 0;
      if (!permanent && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365 * 5)) {
        throw E.badRequest('封禁时长不合法');
      }
      const until = permanent ? 0 : now() + Math.round(hours * 3600_000);
      const reason = String(b.ban.reason || '').slice(0, 200);
      run("UPDATE users SET status='disabled', banned_until=?, ban_reason=? WHERE id=?", until, reason, id);
    }

    if (b.unban) {
      run("UPDATE users SET status='active', banned_until=NULL, ban_reason=NULL WHERE id=?", id);
    }

    if (b.status !== undefined && !b.ban && !b.unban) {
      if (!['active', 'disabled'].includes(b.status)) throw E.badRequest('无效的状态');
      if (id === admin.id && b.status === 'disabled') throw E.badRequest('不能停用自己的账号');
      run('UPDATE users SET status = ? WHERE id = ?', b.status, id);
      if (b.status === 'disabled') run('DELETE FROM sessions WHERE user_id = ?', id);
    }

    return reply.send({ ok: true, user: publicUser(get('SELECT * FROM users WHERE id = ?', id)) });
  });

  app.delete('/api/admin/users/:id', async (request, reply) => {
    const admin = await requireAdmin(request);
    const id = Number(request.params.id);
    if (id === admin.id) throw E.badRequest('不能删除自己的账号');
    const target = get('SELECT * FROM users WHERE id = ?', id);
    if (!target) throw E.notFound('用户不存在');
    if (target.role === 'admin') {
      const admins = get("SELECT COUNT(*) AS c FROM users WHERE role='admin'");
      if (admins.c <= 1) throw E.badRequest('系统必须保留至少一名超级管理员');
    }
    run('DELETE FROM users WHERE id = ?', id);
    return reply.send({ ok: true });
  });

  /* 单个用户的登录设备 / IP 记录 */
  app.get('/api/admin/users/:id/detail', async (request, reply) => {
    await requireAdmin(request);
    const id = Number(request.params.id);
    const user = get('SELECT * FROM users WHERE id = ?', id);
    if (!user) throw E.notFound('用户不存在');
    return reply.send({
      ok: true,
      user: { ...publicUser(user), ban: banInfo(user) },
      sessions: listUserSessions(id).map((s) => ({
        deviceId: s.device_id ? String(s.device_id).slice(0, 8) : '',
        ip: s.ip,
        ua: s.user_agent,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        lastSeenAt: s.last_seen_at,
      })),
      logins: all(
        'SELECT ip, device_id, ua, kind, ok, reason, created_at FROM login_events WHERE user_id = ? ORDER BY id DESC LIMIT 40',
        id
      ),
    });
  });

  /* 管理员查看指定用户的聊天记录 */
  app.get('/api/admin/users/:id/conversations', async (request, reply) => {
    await requireAdmin(request);
    const id = Number(request.params.id);
    const user = get('SELECT id, email, role, status FROM users WHERE id = ?', id);
    if (!user) throw E.notFound('用户不存在');
    const rows = all(
      `SELECT c.id, c.title, c.persona_name, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count
       FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 300`,
      id
    );
    return reply.send({
      ok: true,
      user: { id: user.id, email: user.email, role: user.role, status: user.status },
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        personaName: r.persona_name || null,
        messageCount: r.msg_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  app.get('/api/admin/users/:id/conversations/:cid', async (request, reply) => {
    await requireAdmin(request);
    const id = Number(request.params.id);
    const cid = Number(request.params.cid);
    const user = get('SELECT id, email FROM users WHERE id = ?', id);
    if (!user) throw E.notFound('用户不存在');
    const conv = get('SELECT * FROM conversations WHERE id = ? AND user_id = ?', cid, id);
    if (!conv) throw E.notFound('对话不存在');
    const msgs = all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 500', cid).reverse();
    return reply.send({
      ok: true,
      user: { id: user.id, email: user.email },
      conversation: {
        id: conv.id,
        title: conv.title,
        personaName: conv.persona_name || null,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        truncated: msgs.length >= 500,
        messages: msgs.map((m) => {
          let meta = {};
          try {
            meta = JSON.parse(m.meta_json || '{}') || {};
          } catch {
            meta = {};
          }
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            reasoning: m.reasoning || '',
            meta,
            createdAt: m.created_at,
          };
        }),
      },
    });
  });

  app.delete('/api/admin/users/:id/sessions', async (request, reply) => {
    await requireAdmin(request);
    run('DELETE FROM sessions WHERE user_id = ?', Number(request.params.id));
    return reply.send({ ok: true });
  });

  /* 站点设置 */
  app.put('/api/admin/settings', async (request, reply) => {
    await requireAdmin(request);
    const b = request.body || {};
    if (b.siteName !== undefined) {
      const v = String(b.siteName).trim();
      if (!v || v.length > 40) throw E.badRequest('站点名称需为 1–40 字');
      setSetting('siteName', v);
    }
    if (b.allowRegistration !== undefined) setSetting('allowRegistration', b.allowRegistration ? 'true' : 'false');
    if (b.insufficientComputeMsg !== undefined) {
      const v = String(b.insufficientComputeMsg).trim();
      if (!v) throw E.badRequest('提示文案不能为空');
      setSetting('insufficientComputeMsg', v.slice(0, 200));
    }
    if (b.appVersionCode !== undefined) {
      const code = Number(b.appVersionCode);
      if (!Number.isInteger(code) || code < 1 || code > 1_000_000) throw E.badRequest('版本号需为正整数');
      setSetting('appVersionCode', code);
      setSetting('appPublishedAt', Date.now());
    }
    if (b.appVersionName !== undefined) {
      const v = String(b.appVersionName).trim().slice(0, 30);
      if (!v) throw E.badRequest('版本名称不能为空');
      setSetting('appVersionName', v);
    }
    if (b.appDownloadUrl !== undefined) {
      const v = String(b.appDownloadUrl).trim();
      if (!/^https?:\/\//i.test(v)) throw E.badRequest('下载地址必须是 http(s) 链接');
      setSetting('appDownloadUrl', v.slice(0, 500));
    }
    if (b.appUpdateNotes !== undefined) setSetting('appUpdateNotes', String(b.appUpdateNotes).trim().slice(0, 500));
    if (b.appUpdateMandatory !== undefined) setSetting('appUpdateMandatory', b.appUpdateMandatory ? 'true' : 'false');
    return reply.send({ ok: true, settings: getSettings() });
  });

  /* 阿里云文档智能：云端账单核对 + 用量校准 */
  app.get('/api/admin/providers/parse/:id/cloud', async (request, reply) => {
    await requireAdmin(request);
    const row = getProviderRowById(request.params.id);
    if (!row || row.category !== 'parse' || row.owner_type !== 'global') throw E.notFound('接口配置不存在');
    const rt = toRuntime(row);
    if (rt.extra?.mode !== 'docmind') throw E.badRequest('该接口不是阿里云文档智能');
    const q = quotaOf(rt);
    const period = periodKey();
    const used = scopeUsed(q.scope, period);
    const cloud = await checkDocmindBilling(rt, period);
    return reply.send({
      ok: true,
      period,
      scope: q.scope,
      used,
      monthly: q.monthly,
      unit: q.unit,
      unitLabel: unitLabel(q.unit),
      remaining: Math.max(0, q.monthly - used),
      cloud,
      consoleUrl: 'https://docmind.console.aliyun.com/service-manager',
    });
  });

  app.post('/api/admin/providers/parse/:id/calibrate', async (request, reply) => {
    await requireAdmin(request);
    const row = getProviderRowById(request.params.id);
    if (!row || row.category !== 'parse' || row.owner_type !== 'global') throw E.notFound('接口配置不存在');
    const rt = toRuntime(row);
    if (rt.extra?.mode !== 'docmind') throw E.badRequest('该接口不是阿里云文档智能');
    const units = Number(request.body?.units);
    if (!Number.isFinite(units) || units < 0 || units > 1e9) throw E.badRequest('已用页数不正确');
    const q = quotaOf(rt);
    const period = periodKey();
    const result = calibrateUsage(q.scope, units, period);
    return reply.send({
      ok: true,
      ...result,
      monthly: q.monthly,
      unitLabel: unitLabel(q.unit),
      remaining: Math.max(0, q.monthly - result.units),
    });
  });

  /* ── 全体邮件通知 ─────────────────────────────────── */
  app.get('/api/admin/broadcast', async (request, reply) => {
    await requireAdmin(request);
    const recipients = listRecipients();
    return reply.send({ ok: true, recipientCount: recipients.length, jobs: listBroadcastJobs(20) });
  });

  app.post('/api/admin/broadcast/image', async (request, reply) => {
    const user = await requireAdmin(request);
    const data = await request.file();
    if (!data) throw E.badRequest('没有收到图片');
    const buffer = await data.toBuffer();
    const image = saveBroadcastImage({
      buffer,
      name: data.filename,
      mime: data.mimetype,
      adminId: user.id,
    });
    return reply.send({
      ok: true,
      image: {
        id: image.id,
        name: image.name,
        size: image.size,
        mime: image.mime,
        url: `/api/admin/broadcast/image/${image.id}`,
      },
    });
  });

  app.get('/api/admin/broadcast/image/:id', async (request, reply) => {
    await requireAdmin(request);
    const row = getBroadcastImage(request.params.id);
    if (!row) throw E.notFound('图片不存在');
    let buffer;
    try {
      buffer = fs.readFileSync(row.path);
    } catch {
      throw E.notFound('图片文件已丢失');
    }
    return reply.type(row.mime || 'image/png').header('Cache-Control', 'private, max-age=600').send(buffer);
  });

  app.post('/api/admin/broadcast', async (request, reply) => {
    const user = await requireAdmin(request);
    const b = request.body || {};
    const job = createBroadcast({
      subject: b.subject,
      content: b.content,
      imageId: b.imageId || null,
      adminId: user.id,
    });
    return reply.send({ ok: true, job });
  });

  app.post('/api/admin/broadcast/preview', async (request, reply) => {
    const user = await requireAdmin(request);
    const b = request.body || {};
    await sendBroadcastPreview({
      to: user.email,
      subject: b.subject,
      content: b.content,
      imageId: b.imageId || null,
    });
    return reply.send({ ok: true, to: user.email });
  });

  app.get('/api/admin/broadcast/:id', async (request, reply) => {
    await requireAdmin(request);
    return reply.send({ ok: true, job: getBroadcastJob(request.params.id) });
  });

  app.post('/api/admin/broadcast/:id/cancel', async (request, reply) => {
    await requireAdmin(request);
    cancelBroadcast(request.params.id);
    return reply.send({ ok: true });
  });

  /* 邮件通道 */
  app.post('/api/admin/mail/verify', async (request, reply) => {
    await requireAdmin(request);
    const result = await verifyMailer();
    return reply.send({ ok: true, result });
  });

  app.post('/api/admin/mail/test', async (request, reply) => {
    await requireAdmin(request);
    const to = String(request.body?.to || '').trim();
    if (!EMAIL_RE.test(to)) throw E.badRequest('收件邮箱格式不正确');
    try {
      await sendTestMail(to, setting('siteName', '千早爱音的AI站'));
      return reply.send({ ok: true });
    } catch (err) {
      throw new AppError('PROVIDER_FAILED', `测试邮件发送失败：${err?.message || err}`, 502);
    }
  });
}
