import { setting } from '../db.js';
import { disableScope, verifyAction } from '../lib/quota.js';
import { logEvent } from '../lib/security.js';

function page(title, message, { ok = true, form = '' } = {}) {
  const site = setting('siteName', '千早爱音的AI站');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${title} · ${site}</title></head>
  <body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <div style="max-width:470px;padding:34px 30px;background:#fff;border-radius:18px;box-shadow:0 18px 48px rgba(16,20,30,.12);text-align:center">
      <div style="width:48px;height:48px;margin:0 auto 16px;border-radius:14px;display:grid;place-items:center;background:${ok ? '#e8f5ee' : '#fdecec'};color:${ok ? '#2f7a55' : '#c0392b'};font-size:22px">${ok ? '✓' : '!'}</div>
      <h1 style="margin:0 0 10px;font-size:19px;color:#0f1115">${title}</h1>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.75;color:#5b6168">${message}</p>
      ${form}
      <p style="margin:18px 0 0;font-size:12px;color:#9aa0a6">
        <a href="/#/admin" style="color:#c8507d;text-decoration:none">打开管理后台</a>
      </p>
    </div>
  </body></html>`;
}

/** 邮件里的链接先落到确认页，避免邮箱/安全网关预取链接时误执行 */
function confirmForm(query) {
  const hidden = ['scope', 'period', 'act', 'exp', 'sig']
    .map(
      (k) =>
        `<input type="hidden" name="${k}" value="${String(query[k] || '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')}" />`
    )
    .join('');
  return `<form method="post" action="/api/quota/action" style="margin:0 0 4px">
    ${hidden}
    <button type="submit" style="padding:10px 22px;border:0;border-radius:10px;background:${query.act === 'disable' ? '#c0392b' : '#2b7a55'};color:#fff;font-size:14px;font-weight:600;cursor:pointer">
      ${query.act === 'disable' ? '确认关闭该接口' : '确认保持开启'}
    </button>
  </form>`;
}

function readParams(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (Buffer.isBuffer(request.body)) {
    const params = Object.fromEntries(new URLSearchParams(request.body.toString('utf8')));
    if (Object.keys(params).length) return params;
  }
  return request.query || {};
}

export default async function quotaRoutes(app) {
  /* 第一步：确认页（GET，不产生副作用） */
  app.get('/api/quota/action', async (request, reply) => {
    const q = request.query || {};
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Cache-Control', 'no-store');

    if (!verifyAction(q)) {
      return reply
        .code(400)
        .send(page('链接无效或已过期', '这个操作链接已经失效。请到管理后台的「用量与额度」里手动调整。', { ok: false }));
    }

    const isDisable = q.act === 'disable';
    return reply.send(
      page(
        isDisable ? '确认关闭该接口？' : '确认保持开启？',
        isDisable
          ? `关闭后，配额组「${String(q.scope).replace(/^[gp]:/, '')}」下的共享接口将立即停用，用户会看到算力不足提示。随时可以在后台重新启用。`
          : '接口继续可用，用量仍会累计。额度用尽后会按官方价格产生额外费用，请留意账单。',
        { form: confirmForm(q) }
      )
    );
  });

  /* 第二步：真正执行（POST） */
  app.post('/api/quota/action', async (request, reply) => {
    const q = readParams(request);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Cache-Control', 'no-store');

    if (!verifyAction(q)) {
      return reply
        .code(400)
        .send(page('链接无效或已过期', '这个操作链接已经失效。请到管理后台的「用量与额度」里手动调整。', { ok: false }));
    }

    if (q.act === 'disable') {
      const count = disableScope(q.scope);
      logEvent('quota_disable', { ip: request.ip, detail: `${q.scope} · 关闭 ${count} 个接口` });
      return reply.send(
        page(
          '接口已关闭',
          `已关闭「${String(q.scope).replace(/^[gp]:/, '')}」下的 ${count} 个接口，超出额度的调用不会再发生。随时可以在后台重新启用。`
        )
      );
    }

    logEvent('quota_keep', { ip: request.ip, detail: q.scope });
    return reply.send(
      page('已保持开启', '接口继续可用，用量仍在累计。额度用尽后会按官方价格产生费用，请留意账单。')
    );
  });
}
