import { setting } from '../db.js';
import { all, get, run, now } from '../db.js';
import { config } from '../config.js';
import { hashCode, randomCode, safeEqual, verifyPassword } from '../lib/crypto.js';
import {
  createSession,
  destroySession,
  publicUser,
  ensureDevice,
} from '../lib/auth.js';
import { sendLoginCode, mailStatus } from '../lib/mailer.js';
import { AppError, E } from '../lib/errors.js';
import { createCaptcha, consumeCaptcha } from '../lib/captcha.js';
import { banInfo, clientIp, logEvent } from '../lib/security.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* 密码登录失败限流，防止爆破 */
const loginFails = new Map(); // key -> { count, first }
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_LIMIT = 8;

function failKey(request, email) {
  return `${clientIp(request)}|${email}`;
}
function assertNotThrottled(key) {
  const rec = loginFails.get(key);
  if (!rec) return;
  if (now() - rec.first > FAIL_WINDOW_MS) {
    loginFails.delete(key);
    return;
  }
  if (rec.count >= FAIL_LIMIT) {
    const wait = Math.ceil((FAIL_WINDOW_MS - (now() - rec.first)) / 60000);
    throw E.rateLimited(`失败次数过多，请 ${wait} 分钟后再试`);
  }
}
function recordFail(key) {
  const rec = loginFails.get(key);
  if (!rec || now() - rec.first > FAIL_WINDOW_MS) loginFails.set(key, { count: 1, first: now() });
  else rec.count += 1;
}

const CODE_TTL_MS = 10 * 60 * 1000;
const SEND_INTERVAL_MS = 60 * 1000;
const MAX_PER_HOUR = 6;

const recentSends = new Map(); // email -> timestamp[]
const recentSendsByIp = new Map(); // ip -> timestamp[]

function checkSendRate(email, ip) {
  const ts = (recentSends.get(email) || []).filter((t) => now() - t < 3600_000);
  // 上一次验证码已成功使用（例如刚登录完又换设备），允许立即重新获取
  const last = get('SELECT consumed FROM email_codes WHERE email = ? ORDER BY id DESC LIMIT 1', email);
  const justLoggedIn = last && Number(last.consumed) === 1;
  if (!justLoggedIn && ts.length > 0 && now() - ts.at(-1) < SEND_INTERVAL_MS) {
    const wait = Math.ceil((SEND_INTERVAL_MS - (now() - ts.at(-1))) / 1000);
    throw E.rateLimited(`发送太频繁，请 ${wait} 秒后再试`);
  }
  if (ts.length >= MAX_PER_HOUR) throw E.rateLimited('该邮箱一小时内发送次数过多，请稍后再试');
  ts.push(now());
  recentSends.set(email, ts);

  const byIp = (recentSendsByIp.get(ip) || []).filter((t) => now() - t < 3600_000);
  if (byIp.length >= 20) {
    logEvent('code_send_flood', { ip, detail: `一小时内发送 ${byIp.length} 次验证码` });
    throw E.rateLimited('当前网络发送次数过多，请稍后再试');
  }
  byIp.push(now());
  recentSendsByIp.set(ip, byIp);
}

/* ── 注册门槛 ─────────────────────────────────────────── */

export function groupNumbers() {
  return String(setting('registerGroupNumbers', '') || '')
    .split(/[\s,，;；、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function assertGroupAllowed(groupNumber) {
  const list = groupNumbers();
  if (list.length === 0) {
    throw new AppError('GROUP_REQUIRED', '管理员尚未配置分部群号，暂无法注册新账号，请联系管理员', 403);
  }
  const input = String(groupNumber || '').trim();
  if (!input) {
    throw new AppError('GROUP_REQUIRED', '请填写你所在的分部群号后再注册', 400);
  }
  if (!list.includes(input)) {
    throw new AppError('GROUP_INVALID', '分部群号不正确，无法完成注册，请联系管理员确认', 400);
  }
}

function recordLogin({ user, email, ip, deviceId, ua, kind, ok = true, reason = '' }) {
  run(
    'INSERT INTO login_events(user_id, email, ip, device_id, ua, kind, ok, reason, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    user?.id ?? null,
    email || user?.email || '',
    ip,
    deviceId || '',
    String(ua || '').slice(0, 300),
    kind,
    ok ? 1 : 0,
    String(reason).slice(0, 200),
    now()
  );
}

function assertUsable(user) {
  if (!user) return;
  const ban = banInfo(user);
  if (ban) {
    logEvent('banned_login_attempt', { ip: null, userId: user.id, detail: user.email });
    throw new AppError('ACCOUNT_BANNED', '账号已被限制访问', 403, ban);
  }
  if (user.status !== 'active') {
    throw new AppError('ACCOUNT_BANNED', '账号已被停用', 403, {
      permanent: true,
      until: null,
      reason: '账号已被停用',
      notice: '你的账号已被停用，请联系超级管理员。',
    });
  }
}

function verifyCaptchaOrThrow(body) {
  const ok = consumeCaptcha(body?.captchaId, body?.captchaCode);
  if (!ok) {
    throw new AppError('CAPTCHA_INVALID', '图形验证码不正确或已过期，请重新输入', 400);
  }
}

/** 表单里带了图形验证码才校验（验证码登录不展示该字段） */
function verifyCaptchaIfProvided(body) {
  if (!body?.captchaId) return;
  verifyCaptchaOrThrow(body);
}

export default async function authRoutes(app) {
  /* 图形验证码：SVG 直出，前端内联展示 */
  app.get('/api/auth/captcha', async (_request, reply) => {
    const c = createCaptcha();
    reply.header('Cache-Control', 'no-store');
    return reply.send({
      ok: true,
      id: c.id,
      svg: c.svg,
      expiresIn: c.ttl,
      ...(config.captchaDevEcho ? { devCode: c.code } : {}),
    });
  });

  /* 发送邮箱验证码 */
  app.post('/api/auth/send-code', async (request, reply) => {
    const b = request.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    verifyCaptchaIfProvided(b);
    if (!EMAIL_RE.test(email)) throw E.badRequest('邮箱格式不正确');

    const ip = clientIp(request);
    const mode = ['login', 'register', 'reset'].includes(String(b.mode)) ? String(b.mode) : 'auto';
    const user = get('SELECT * FROM users WHERE email = ?', email);
    const allowRegistration = setting('allowRegistration', 'true') === 'true';

    if (mode === 'login' && !user) {
      throw new AppError('NOT_REGISTERED', '该邮箱尚未注册，请先切换到「注册」', 404);
    }
    if (mode === 'reset' && !user) {
      throw new AppError('NOT_REGISTERED', '该邮箱尚未注册，无法重设密码', 404);
    }
    if (mode === 'register') {
      if (!allowRegistration) throw E.forbidden('当前未开放注册，请联系超级管理员开通账号');
      if (user) throw new AppError('ALREADY_REGISTERED', '该邮箱已注册，请直接登录', 409);
      assertGroupAllowed(b.groupNumber);
    } else if (!user) {
      if (!allowRegistration) throw E.forbidden('当前未开放注册，请联系超级管理员开通账号');
      assertGroupAllowed(b.groupNumber);
    }
    if (user) assertUsable(user);

    checkSendRate(email, ip);

    const code = randomCode(6);
    const purpose = mode === 'reset' ? 'reset' : user ? 'login' : 'register';
    run('DELETE FROM email_codes WHERE email = ? AND consumed = 0', email);
    run(
      'INSERT INTO email_codes(email, code_hash, purpose, expires_at, created_at) VALUES(?,?,?,?,?)',
      email,
      hashCode(code),
      purpose,
      now() + CODE_TTL_MS,
      now()
    );

    let result;
    try {
      result = await sendLoginCode({
        to: email,
        code,
        purpose,
        siteName: setting('siteName', '千早爱音的AI站'),
      });
    } catch (err) {
      recordLogin({ user, email, ip, deviceId: request.deviceId, kind: 'code_send', ok: false, reason: err.message });
      throw E.providerFailed(err.message);
    }

    recordLogin({ user, email, ip, deviceId: request.deviceId, kind: 'code_send' });

    return reply.send({
      ok: true,
      isNewUser: !user,
      sent: result.sent,
      needGroup: !user,
      ...(result.devCode ? { devCode: result.devCode, devNote: result.reason } : {}),
    });
  });

  /* 校验验证码 → 登录或注册 */
  app.post('/api/auth/verify', async (request, reply) => {
    const b = request.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    const mode = ['login', 'register'].includes(String(b.mode)) ? String(b.mode) : 'auto';
    if (!EMAIL_RE.test(email)) throw E.badRequest('邮箱格式不正确');
    const existing = get('SELECT * FROM users WHERE email = ?', email);
    // 注册（含 auto 模式下的首次注册）必须过图形验证码
    if (mode === 'register' || (!existing && mode !== 'login')) verifyCaptchaOrThrow(b);
    const code = String(b.code || '').trim();
    if (!/^\d{6}$/.test(code)) throw E.badRequest('请输入 6 位数字验证码');

    const ip = clientIp(request);
    const deviceId = ensureDevice(request, reply);

    const row = get(
      'SELECT * FROM email_codes WHERE email = ? AND consumed = 0 ORDER BY id DESC LIMIT 1',
      email
    );
    if (!row) throw E.badRequest('请先获取验证码');
    if (row.expires_at < now()) throw E.badRequest('验证码已过期，请重新获取');
    if (row.attempts >= 5) throw E.rateLimited('尝试次数过多，请重新获取验证码');

    if (!safeEqual(row.code_hash, hashCode(code))) {
      run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
      recordLogin({ email, ip, deviceId, kind: 'code_verify', ok: false, reason: '验证码不正确' });
      throw E.badRequest('验证码不正确');
    }

    let user = existing;
    if (mode === 'login' && !user) {
      throw new AppError('NOT_REGISTERED', '该邮箱尚未注册，请先切换到「注册」', 404);
    }
    if (mode === 'register' && user) {
      throw new AppError('ALREADY_REGISTERED', '该邮箱已注册，请直接登录', 409);
    }
    let newPasswordHash = null;
    if (!user) {
      if (setting('allowRegistration', 'true') !== 'true') {
        throw E.forbidden('当前未开放注册，请联系超级管理员');
      }
      assertGroupAllowed(b.groupNumber);
      const password = String(b.password || '');
      if (password.length < 8) throw E.badRequest('请设置至少 8 位的登录密码');
      const { hashPassword } = await import('../lib/crypto.js');
      newPasswordHash = hashPassword(password);
    }
    assertUsable(user);

    // 所有校验通过后才消耗验证码，密码不合规时可以继续用同一码重试
    run('UPDATE email_codes SET consumed = 1 WHERE id = ?', row.id);

    if (!user) {
      run(
        "INSERT INTO users(email, password_hash, role, status, created_at, last_ip) VALUES(?,?, 'user', 'active', ?, ?)",
        email,
        newPasswordHash,
        now(),
        ip
      );
      user = get('SELECT * FROM users WHERE email = ?', email);
      logEvent('user_registered', { ip, userId: user.id, detail: `${email} · 群号 ${String(b.groupNumber || '').slice(0, 30)}` });
    }

    run('UPDATE users SET last_login_at = ?, last_ip = ? WHERE id = ?', now(), ip, user.id);
    createSession(reply, user.id, {
      deviceId,
      ip,
      userAgent: request.headers['user-agent'] || '',
      kind: 'code',
    });
    recordLogin({ user, email, ip, deviceId, ua: request.headers['user-agent'], kind: 'login' });

    return reply.send({
      ok: true,
      user: publicUser(get('SELECT * FROM users WHERE id = ?', user.id)),
      sessionDays: config.sessionDays,
    });
  });

  /* 密码登录：默认关闭，仅在安全管理里显式开启后可用（应急入口） */
  app.post('/api/auth/password-login', async (request, reply) => {
    verifyCaptchaOrThrow(request.body || {});
    const email = String(request.body?.email || '').toLowerCase().trim();
    const password = String(request.body?.password || '');
    if (!EMAIL_RE.test(email) || !password) throw E.badRequest('请输入邮箱和密码');

    const key = failKey(request, email);
    assertNotThrottled(key);

    const user = get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !user.password_hash) {
      recordFail(key);
      throw E.unauthorized('邮箱或密码不正确');
    }
    assertUsable(user);
    if (!verifyPassword(password, user.password_hash)) {
      recordFail(key);
      throw E.unauthorized('邮箱或密码不正确');
    }
    loginFails.delete(key);

    const ip = clientIp(request);
    const deviceId = ensureDevice(request, reply);
    run('UPDATE users SET last_login_at = ?, last_ip = ? WHERE id = ?', now(), ip, user.id);
    createSession(reply, user.id, { deviceId, ip, userAgent: request.headers['user-agent'] || '', kind: 'password' });
    recordLogin({ user, email, ip, deviceId, kind: 'password_login' });
    return reply.send({ ok: true, user: publicUser(user), sessionDays: config.sessionDays });
  });

  /* 登出 */
  app.post('/api/auth/logout', async (request, reply) => {
    if (request.user) {
      recordLogin({
        user: request.user,
        email: request.user.email,
        ip: clientIp(request),
        deviceId: request.deviceId,
        kind: 'logout',
      });
    }
    destroySession(reply, request.sessionToken);
    return reply.send({ ok: true });
  });

  /* 当前会话 */
  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) {
      return reply.send({
        ok: true,
        user: null,
        banned: request.bannedUser || null,
        sessionIssue: request.sessionIssue || null,
        mail: mailStatus(),
      });
    }
    const fresh = get('SELECT * FROM users WHERE id = ?', request.user.id);
    const ban = banInfo(fresh);
    return reply.send({
      ok: true,
      user: ban ? null : publicUser(fresh),
      banned: ban ? { email: fresh.email, ...ban } : null,
      sessionIssue: null,
      mail: mailStatus(),
    });
  });

  /* 公开配置，前端首屏需要 */
  app.get('/api/bootstrap', async (_request, reply) => {
    const groups = groupNumbers();
    return reply.send({
      ok: true,
      siteName: setting('siteName', '千早爱音的AI站'),
      allowRegistration: setting('allowRegistration', 'true') === 'true',
      mailConfigured: mailStatus().configured,
      mailDevFallback: mailStatus().devFallback,
      captchaEnabled: true,
      requireGroup: groups.length > 0,
      registrationLocked: groups.length === 0,
      groupCount: groups.length,
      sessionDays: config.sessionDays,
      userProvidersOpen: setting('userProvidersOpen', 'false') === 'true',
      devMode: !config.isProd,
    });
  });

  /* 已登录用户改密码（保留，用于兼容老账号） */
  app.post('/api/auth/password', async (request, reply) => {
    if (!request.user) throw E.unauthorized();
    const { newPassword = '', code = '' } = request.body || {};
    if (String(newPassword).length < 8) throw E.badRequest('新密码至少 8 位');

    // 重设密码必须再过一次发到本人邮箱的验证码（purpose=reset）
    const emailCode = String(code).trim();
    if (!/^\d{6}$/.test(emailCode)) throw E.badRequest('请输入 6 位邮箱验证码');
    const user = get('SELECT * FROM users WHERE id = ?', request.user.id);
    const row = get(
      "SELECT * FROM email_codes WHERE email = ? AND purpose = 'reset' AND consumed = 0 ORDER BY id DESC LIMIT 1",
      user.email
    );
    if (!row) throw E.badRequest('请先获取邮箱验证码');
    if (row.expires_at < now()) throw E.badRequest('邮箱验证码已过期，请重新获取');
    if (row.attempts >= 5) throw E.rateLimited('验证码尝试次数过多，请重新获取');
    if (!safeEqual(row.code_hash, hashCode(emailCode))) {
      run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
      throw E.badRequest('邮箱验证码不正确');
    }

    run('UPDATE email_codes SET consumed = 1 WHERE id = ?', row.id);
    const { hashPassword } = await import('../lib/crypto.js');
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(newPassword)), user.id);
    return reply.send({ ok: true });
  });
}
