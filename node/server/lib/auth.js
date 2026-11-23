import { config } from '../config.js';
import { all, get, run, now } from '../db.js';
import { randomToken, hashPassword } from './crypto.js';
import { AppError, E } from './errors.js';
import { banInfo, clientIp } from './security.js';

export const COOKIE_NAME = 'sid';
export const DEVICE_COOKIE = 'dsdid';

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastIp: row.last_ip || null,
    hasPassword: Boolean(row.password_hash),
    ban: banInfo(row),
  };
}

/** 给浏览器发一个长期设备标识；换浏览器 / 清 Cookie 即视为新设备 */
export function ensureDevice(request, reply) {
  let id = request.cookies?.[DEVICE_COOKIE];
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    id = randomToken(24);
    if (reply?.setCookie) {
      reply.setCookie(DEVICE_COOKIE, id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
        path: '/',
        maxAge: 400 * 86400,
      });
    }
  }
  request.deviceId = id;
  return id;
}

export function createSession(reply, userId, { deviceId = '', ip = '', userAgent = '', kind = 'code' } = {}) {
  const token = randomToken(32);
  const created = now();
  const expires = created + config.sessionDays * 86400_000;
  run(
    'INSERT INTO sessions(token, user_id, device_id, ip, user_agent, kind, expires_at, created_at, last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)',
    token,
    userId,
    deviceId,
    ip,
    String(userAgent).slice(0, 300),
    kind,
    expires,
    created,
    created
  );
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: config.sessionDays * 86400,
  });
  return token;
}

export function destroySession(reply, token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  reply.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * 读取当前用户（不抛错），挂到 request.user。
 * 同时校验「设备 + IP」绑定：任一变化即销毁会话，要求重新用邮箱验证码登录。
 */
export function attachUser(request, reply) {
  request.ip = clientIp(request);
  const token = request.cookies?.[COOKIE_NAME];
  request.sessionToken = token || null;
  if (!token) return;

  const row = get(
    `SELECT u.*, s.device_id AS s_device, s.ip AS s_ip, s.kind AS s_kind, s.expires_at AS s_expires
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`,
    token
  );
  if (!row) return;

  if (row.s_expires <= now()) {
    run('DELETE FROM sessions WHERE token = ?', token);
    return;
  }

  // 封禁中的账号：保留会话行用于识别身份，但不下发 request.user（接口一律 403）
  const ban = banInfo(row);
  if (ban) {
    request.bannedUser = { email: row.email, ...ban };
    return;
  }
  if (row.status !== 'active') {
    request.bannedUser = {
      email: row.email,
      permanent: true,
      until: null,
      reason: '账号已被停用',
      notice: '你的账号已被停用，请联系超级管理员。',
    };
    return;
  }

  // 设备或 IP 变化 → 旧会话作废
  const device = request.cookies?.[DEVICE_COOKIE] || '';
  const boundDevice = row.s_device || '';
  const boundIp = row.s_ip || '';
  if ((boundDevice && boundDevice !== device) || (boundIp && boundIp !== request.ip)) {
    run('DELETE FROM sessions WHERE token = ?', token);
    request.sessionIssue = boundIp && boundIp !== request.ip ? 'ip' : 'device';
    if (reply?.clearCookie) reply.clearCookie(COOKIE_NAME, { path: '/' });
    return;
  }

  request.user = row;
  request.sessionKind = row.s_kind || 'code';
  // 每分钟最多刷新一次活跃时间，避免每个请求都写库
  const last = get('SELECT last_seen_at FROM sessions WHERE token = ?', token)?.last_seen_at || 0;
  if (now() - last > 60_000) run('UPDATE sessions SET last_seen_at = ? WHERE token = ?', now(), token);
}

export async function requireUser(request) {
  if (!request.user) {
    if (request.bannedUser) {
      throw new AppError('ACCOUNT_BANNED', '账号已被限制访问', 403, request.bannedUser);
    }
    throw E.unauthorized('登录状态已失效，请重新使用邮箱验证码登录');
  }
  return request.user;
}

export async function requireAdmin(request) {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw E.forbidden('仅超级管理员可访问');
  return user;
}

export function cleanupSessions() {
  run('DELETE FROM sessions WHERE expires_at <= ?', now());
}

/** 首次启动写入超管种子账号 */
export function ensureAdminSeed() {
  const email = config.adminEmail;
  if (!email) {
    console.warn('[种子] 未配置 ADMIN_EMAIL，跳过超管创建');
    return;
  }
  const existing = get('SELECT id, role FROM users WHERE email = ?', email);
  if (existing) {
    if (existing.role !== 'admin') {
      run('UPDATE users SET role = ? WHERE id = ?', 'admin', existing.id);
      console.log(`[种子] 已将 ${email} 提升为超级管理员`);
    }
    return;
  }
  if (!config.adminPassword) {
    console.warn('[种子] 未配置 ADMIN_PASSWORD，跳过超管创建');
    return;
  }
  run(
    'INSERT INTO users(email, password_hash, role, status, created_at) VALUES(?,?,?,?,?)',
    email,
    hashPassword(config.adminPassword),
    'admin',
    'active',
    now()
  );
  console.log(`[种子] 已创建超级管理员：${email}`);
}

export function isFirstUser() {
  const row = get('SELECT COUNT(*) AS c FROM users');
  return !row || row.c === 0;
}

export function listUserSessions(userId) {
  return all(
    'SELECT token, device_id, ip, user_agent, created_at, expires_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC',
    userId
  );
}
