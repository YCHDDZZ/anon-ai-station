import fs from 'node:fs';
import path from 'node:path';

import { config, ROOT, smtpConfigured } from './config.js';
import { createApp } from './mini.js';
import { AppError } from './lib/errors.js';
import { attachUser, cleanupSessions, ensureAdminSeed, ensureDevice } from './lib/auth.js';
import { ensureDefaultPersona } from './lib/personas.js';
import { cleanupCaptchas } from './lib/captcha.js';
import { cleanupUsageLog } from './lib/quota.js';
import { cleanupBroadcastLogs, recoverInterruptedBroadcasts } from './lib/broadcast.js';
import { cleanupAnnouncementImages } from './lib/announcements.js';
import {
  ROBOTS_TXT,
  blockedInfo,
  cleanupTraffic,
  clientIp,
  guardTraffic,
  isLoopback,
  logEvent,
  securityHeaders,
} from './lib/security.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import adminRoutes from './routes/admin.js';
import securityRoutes from './routes/security.js';
import conversationRoutes from './routes/conversations.js';
import chatRoutes from './routes/chat.js';
import toolsRoutes from './routes/tools.js';
import personaRoutes from './routes/personas.js';
import marketRoutes from './routes/market.js';
import quotaRoutes from './routes/quota.js';
import announcementRoutes from './routes/announcements.js';
import feedbackRoutes from './routes/feedback.js';

const app = createApp({
  bodyLimit: 2 * 1024 * 1024,
  fileLimit: config.maxFileMb * 1024 * 1024 + 1024 * 1024,
});

/* 每个响应都带安全头（含反爬声明） */
app.addHook('onRequest', (request, reply) => {
  request.ip = clientIp(request);
  for (const [k, v] of Object.entries(securityHeaders(true))) reply.header(k, v);
  ensureDevice(request, reply);

  // 已封禁 IP：直接拒绝，不再进入业务
  const blocked = blockedInfo(request.ip);
  if (blocked) {
    return reply.code(403).send({
      ok: false,
      error: {
        code: 'IP_BLOCKED',
        message: '当前网络访问受限，请稍后再试或联系管理员',
        detail: { until: blocked.until },
      },
    });
  }

  // 异常流量检测（超过阈值自动封禁非本机 IP）
  const spike = guardTraffic(request.ip);
  if (spike) {
    return reply.code(429).send({
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: '请求过于频繁，当前网络已被临时限制',
        detail: { until: spike.until },
      },
    });
  }
});

app.addHook('onRequest', attachUser);

app.setErrorHandler((err, _request, reply) => {
  if (err instanceof AppError) {
    return reply.code(err.status).send({
      ok: false,
      error: { code: err.code, message: err.message, detail: err.extra ?? null },
    });
  }
  if (err?.code === 'TOO_LARGE') {
    return reply.code(413).send({
      ok: false,
      error: { code: 'TOO_LARGE', message: `请求体过大（单文件上限 ${config.maxFileMb}MB）` },
    });
  }
  console.error('[未捕获错误]', err);
  return reply.code(500).send({
    ok: false,
    error: { code: 'INTERNAL', message: err?.message || '服务内部错误' },
  });
});

/* 反爬协议：不在界面展示，但爬虫会先读它 */
app.get('/robots.txt', async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; charset=utf-8');
  reply.header('Cache-Control', 'public, max-age=86400');
  return reply.send(ROBOTS_TXT);
});

/* 蜜罐：正常用户看不到这个链接，只有解析 HTML 的爬虫会跟进 */
app.get('/__trap', async (request, reply) => {
  if (!isLoopback(request.ip)) {
    logEvent('crawler_trap', { ip: request.ip, detail: String(request.headers['user-agent'] || '').slice(0, 200) });
    const { blockIp } = await import('./lib/security.js');
    blockIp(request.ip, 60 * 24, '触发反爬蜜罐', 'trap');
  }
  return reply.code(404).send('Not Found');
});

app.get('/api/health', async (_request, reply) =>
  reply.send({
    ok: true,
    env: config.env,
    mail: smtpConfigured ? 'configured' : 'missing',
    time: Date.now(),
  })
);

await authRoutes(app);
await meRoutes(app);
await adminRoutes(app);
await securityRoutes(app);
await conversationRoutes(app);
await chatRoutes(app);
await toolsRoutes(app);
await personaRoutes(app);
await feedbackRoutes(app);
await marketRoutes(app);
await quotaRoutes(app);
await announcementRoutes(app);

/* 前端静态资源（web/ 目录，无需构建） */
const webRoot = path.join(ROOT, 'web');
if (fs.existsSync(path.join(webRoot, 'index.html'))) {
  app.serveStatic(webRoot);
}

ensureAdminSeed();
ensureDefaultPersona();
cleanupSessions();
cleanupCaptchas();
recoverInterruptedBroadcasts();
cleanupBroadcastLogs();
cleanupAnnouncementImages();
setInterval(() => {
  cleanupSessions();
  cleanupCaptchas();
  cleanupTraffic();
  cleanupUsageLog();
  cleanupBroadcastLogs();
  cleanupAnnouncementImages();
}, 6 * 3600_000).unref?.();

await app.listen({ port: config.port, host: config.host });

console.log('');
console.log(`  ✔ 服务已启动   http://localhost:${config.port}`);
console.log(`  ✔ 环境         ${config.env}`);
console.log(`  ✔ 邮件通道     ${smtpConfigured ? '已配置' : '未配置（验证码会回显到页面）'}`);
console.log(`  ✔ 登录方式     邮箱验证码（会话 ${config.sessionDays} 天，绑定设备 + IP）`);
console.log(`  ✔ 超管账号     ${config.adminEmail || '(未配置)'}`);
console.log('');
