import tls from 'node:tls';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { config, smtpConfigured, ROOT } from '../config.js';
import { pickMailOpener } from './mail-openers.js';

/* 极简 SMTP 客户端：支持 QQ/163 等常见邮箱的隐式 TLS(465) 与 STARTTLS(587) 登录发信 */

/* 邮件里的 logo 走 CID 内嵌（QQ/微信/Outlook 都能显示，不依赖外链） */
const LOGO_CID = 'chihaya-logo';
const LOGO_PATH = path.join(ROOT, 'web', 'logo-email.png');
let logoCache;
function logoBuffer() {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = fs.readFileSync(LOGO_PATH);
  } catch {
    logoCache = null;
  }
  return logoCache;
}
const wrap76 = (b64) => b64.match(/.{1,76}/g)?.join('\r\n') ?? '';

let lastVerify = { at: 0, ok: null, error: null };

export function mailStatus() {
  return {
    configured: smtpConfigured,
    host: config.smtp.host || null,
    port: config.smtp.port,
    user: config.smtp.user || null,
    from: config.smtp.from || null,
    fromName: config.smtp.fromName || null,
    devFallback: config.mailDevFallback,
    lastVerify,
  };
}

class Session {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.queue = [];
    this.pending = null;
    this.closed = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => {
      this.closed = true;
      this.fail(new Error('SMTP 连接已关闭'));
    });
  }

  flush() {
    if (!this.pending) return;
    const lines = this.buffer.split('\r\n');
    // 找到以 "250 " 形式结束的行
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\d{3} /.test(line)) {
        const consumed = lines.slice(0, i + 1).join('\r\n');
        this.buffer = this.buffer.slice(consumed.length + 2);
        const all = consumed.split('\r\n');
        const code = Number(all.at(-1).slice(0, 3));
        const text = all.map((l) => l.slice(4)).join('\n');
        const p = this.pending;
        this.pending = null;
        p.resolve({ code, text, raw: consumed });
        this.flush();
        return;
      }
    }
  }

  fail(err) {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      p.reject(err);
    }
  }

  read(timeout = 15000) {
    if (this.buffer && /^\d{3} /m.test(this.buffer)) this.flush();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          reject(new Error('SMTP 响应超时'));
        }
      }, timeout);
      this.pending = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.flush();
    });
  }

  async cmd(line, expect = [250]) {
    if (line !== null) this.socket.write(`${line}\r\n`);
    const res = await this.read();
    if (!expect.includes(res.code)) {
      throw new Error(`SMTP ${res.code}: ${res.text.slice(0, 200)}`);
    }
    return res;
  }

  async close() {
    try {
      await this.cmd('QUIT', [221]);
    } catch {
      /* ignore */
    }
    this.socket.end();
  }
}

function connect() {
  const { host, port, secure } = config.smtp;
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.connect({ host, port }, () => resolve(socket));
    socket.setTimeout(20000, () => {
      socket.destroy(new Error('SMTP 连接超时'));
    });
    socket.once('error', reject);
  });
}

function upgradeToTls(socket) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({ socket, servername: config.smtp.host }, () => resolve(secured));
    secured.setTimeout(20000, () => secured.destroy(new Error('SMTP 连接超时')));
    secured.once('error', reject);
  });
}

async function openSession() {
  let socket = await connect();
  let s = new Session(socket);
  await s.read(); // 220 banner
  const domain = config.smtp.user.split('@')[1] || 'localhost';
  await s.cmd(`EHLO ${domain}`);

  if (!config.smtp.secure) {
    // 587：明文问候后按 RFC 3207 升级 TLS，再重新 EHLO
    await s.cmd('STARTTLS', [220]);
    socket = await upgradeToTls(socket);
    s = new Session(socket);
    await s.cmd(`EHLO ${domain}`);
  }
  return s;
}

async function authenticate(s) {
  await s.cmd('AUTH LOGIN', [334]);
  await s.cmd(Buffer.from(config.smtp.user).toString('base64'), [334]);
  await s.cmd(Buffer.from(config.smtp.pass).toString('base64'), [235]);
}

function b64Lines(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

function encodeHeader(text) {
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

export function buildMessage({ to, subject, html, text, inlineImages = [] }) {
  const fromName = config.smtp.fromName || config.smtp.from;
  const domain = String(config.smtp.from).split('@')[1] || 'localhost';
  const body = html || `<pre>${text || ''}</pre>`;
  const headers = [
    `From: ${encodeHeader(fromName)} <${config.smtp.from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2, 10)}@${domain}>`,
    'MIME-Version: 1.0',
    'Date: ' + new Date().toUTCString(),
  ];

  const images = [];
  const logo = logoBuffer();
  if (logo) images.push({ cid: LOGO_CID, buffer: logo, mime: 'image/png', filename: 'logo.png' });
  for (const img of inlineImages) {
    if (img?.buffer?.length) images.push(img);
  }

  if (!images.length) {
    return [
      ...headers,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64Lines(body),
      '',
    ].join('\r\n');
  }

  const boundary = `=_chihaya_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(body),
    '',
  ];
  for (const img of images) {
    // 文件名只保留安全字符，避免头部注入 / 非 ASCII 乱码
    const safeName = String(img.filename || 'image.png').replace(/[^\w.\-]/g, '_').slice(-60) || 'image.png';
    parts.push(
      `--${boundary}`,
      `Content-Type: ${img.mime || 'image/png'}; name="${safeName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${safeName}"`,
      '',
      wrap76(img.buffer.toString('base64')),
      ''
    );
  }
  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

async function deliver({ to, subject, html, text, inlineImages = [] }) {
  if (!smtpConfigured) throw new Error('邮件服务未配置');
  const s = await openSession();
  try {
    await authenticate(s);
    await s.cmd(`MAIL FROM:<${config.smtp.from}>`);
    await s.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await s.cmd('DATA', [354]);
    const message = buildMessage({ to, subject, html, text, inlineImages });
    s.socket.write(`${message.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`);
    const res = await s.read();
    if (res.code !== 250) throw new Error(`SMTP 投递失败（${res.code}）：${res.text.slice(0, 160)}`);
  } finally {
    await s.close();
  }
}

export async function verifyMailer() {
  if (!smtpConfigured) {
    lastVerify = { at: Date.now(), ok: false, error: 'SMTP 未配置' };
    return lastVerify;
  }
  try {
    const s = await openSession();
    try {
      await authenticate(s);
    } finally {
      await s.close();
    }
    lastVerify = { at: Date.now(), ok: true, error: null };
  } catch (err) {
    lastVerify = { at: Date.now(), ok: false, error: err?.message || String(err) };
  }
  return lastVerify;
}

/**
 * 统一邮件外壳：玫瑰粉配色 + 圆角卡片 + CID logo，尽量只用 table/inline style，
 * 保证 QQ 邮箱、微信内置邮箱、Outlook 都能正常渲染。
 */
function emailShell({ siteName, title, subtitle, body, footer = '', preheader = '' }) {
  const year = new Date().getFullYear();
  const brand = escapeHtml(siteName);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#fdf1f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fdf1f6;">
    <tr>
      <td align="center" style="padding:30px 12px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
          style="width:100%;max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 14px 38px rgba(200,80,125,0.14);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
          <tr><td height="6" style="height:6px;background:#e79ab8;background:linear-gradient(90deg,#f9c9dc 0%,#c8507d 55%,#8d3a5d 100%);font-size:0;line-height:0">&nbsp;</td></tr>
          <tr>
            <td style="padding:26px 30px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="54" valign="middle">
                    <img src="cid:${LOGO_CID}" width="52" height="52" alt="${brand}"
                      style="display:block;width:52px;height:52px;border-radius:15px;border:2px solid #fbe3ec;object-fit:cover;" />
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <div style="font-size:15px;font-weight:700;color:#2b1620;letter-spacing:.02em">${brand}</div>
                    <div style="font-size:12px;color:#b06a88;margin-top:3px">和爱音一起，把想法弹成歌 ♪</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 30px 0;">
              <h1 style="margin:0;font-size:22px;line-height:1.35;color:#2b1620;font-weight:700">${title}</h1>
              <p style="margin:10px 0 0;font-size:14px;line-height:1.75;color:#5c4a52">${subtitle}</p>
            </td>
          </tr>
          <tr><td style="padding:20px 30px 0;">${body}</td></tr>
          <tr>
            <td style="padding:26px 30px 30px;">
              <div style="height:1px;background:#f7e3ea;font-size:0;line-height:0;margin-bottom:16px">&nbsp;</div>
              <div style="font-size:12px;line-height:1.8;color:#a08490">${footer}</div>
              <div style="font-size:11px;line-height:1.6;color:#c9b2bc;margin-top:10px">© ${year} ${brand} · 本邮件由系统自动发送，请勿直接回复</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

export function codeEmailHtml({ siteName, code, minutes, purpose }) {
  const isRegister = purpose === 'register';
  const title = isRegister ? '注册验证码来啦' : '登录验证码来啦';
  const opener = pickMailOpener();
  const subtitle = isRegister
    ? `${opener} 欢迎加入我的 AI 站，把这串数字填进注册页，我们就正式见面啦。`
    : `${opener} 这是你本次的登录验证码，填进页面就能回来继续聊天。`;
  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:#fdf1f6;border:1px dashed #f0bfd2;border-radius:16px;">
      <tr>
        <td align="center" style="padding:22px 16px 20px;">
          <div style="font-size:11px;letter-spacing:.22em;color:#b06a88;margin-bottom:10px">YOUR CODE</div>
          <div style="font-size:38px;line-height:1.1;font-weight:800;letter-spacing:.3em;color:#c8507d;font-family:Menlo,Consolas,'Courier New',monospace">${code}</div>
          <div style="font-size:12px;color:#a08490;margin-top:12px">${minutes} 分钟内有效 · 仅可使用一次</div>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0;font-size:13px;line-height:1.8;color:#7b5a68">
      如果不是你本人操作，忽略这封邮件就好。任何人索要验证码都是诈骗，爱音也不会问你要哦。
    </p>`;
  return emailShell({
    siteName,
    title,
    subtitle,
    body,
    preheader: `你的${isRegister ? '注册' : '登录'}验证码是 ${code}，${minutes} 分钟内有效`,
    footer: '这封邮件由登录/注册流程自动触发。若你正在使用公共设备，验证完成后记得退出登录。',
  });
}

export async function sendLoginCode({ to, code, purpose, siteName }) {
  const minutes = 10;
  if (!smtpConfigured) {
    if (config.mailDevFallback) {
      console.log(`\n[邮件未配置] 验证码 ${code} → ${to}（${purpose}）\n`);
      return { sent: false, devCode: code, reason: 'SMTP 未配置' };
    }
    throw new Error('邮件服务未配置，请联系管理员');
  }
  try {
    await deliver({
      to,
      subject: `【${siteName}】${code} 是你的验证码`,
      html: codeEmailHtml({ siteName, code, minutes, purpose }),
      text: `你的验证码是 ${code}，${minutes} 分钟内有效。`,
    });
    return { sent: true };
  } catch (err) {
    console.error('[发信失败]', err?.message || err);
    if (config.mailDevFallback) {
      console.log(`\n[发信失败，回退] 验证码 ${code} → ${to}\n`);
      return { sent: false, devCode: code, reason: err?.message || '发送失败' };
    }
    throw new Error(`验证码发送失败：${err?.message || 'SMTP 异常'}`);
  }
}

export async function sendTestMail(to, siteName = '千早爱音的AI站') {
  const html = emailShell({
    siteName,
    title: '邮件通道正常',
    subtitle: `${pickMailOpener()} 这封测试邮件能顺利到你手上，说明验证码和额度告警都不会缺席。`,
    body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:#fdf1f6;border:1px dashed #f0bfd2;border-radius:16px;">
      <tr><td align="center" style="padding:22px 18px;font-size:14px;line-height:1.8;color:#7b5a68">
        发件账号：<b style="color:#2b1620">${escapeHtml(config.smtp.from)}</b><br />
        邮件服务：<b style="color:#2b1620">${escapeHtml(config.smtp.host)}:${config.smtp.port}</b>
      </td></tr>
    </table>`,
    preheader: '测试邮件：邮件通道正常',
    footer: '这封邮件由后台「邮件通道 → 发送测试」触发，用于确认 SMTP 配置可用。',
  });
  await deliver({
    to,
    subject: `【${siteName}】测试邮件 · 通道正常`,
    html,
    text: '这是一封测试邮件，说明 SMTP 配置可用。',
  });
  return true;
}

/* ── 额度告警邮件 ─────────────────────────────────────── */

export function quotaEmailHtml({
  siteName,
  groupName,
  unit,
  used,
  monthly,
  percent,
  cost,
  currency,
  period,
  disableUrl,
  keepUrl,
  adminUrl,
}) {
  const symbol = currency === 'USD' ? '$' : '¥';
  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const barColor = pct >= 100 ? '#c0392b' : pct >= 90 ? '#d97706' : '#c8507d';
  const title = pct >= 100 ? '额度已经用完啦' : '额度快见底啦';
  const opener = pickMailOpener();
  const subtitle =
    pct >= 100
      ? `${opener} 顺便提醒你：${escapeHtml(groupName)} 在 ${period} 的额度已经用完。继续调用会产生后付费，建议先把接口关掉。`
      : `${opener} 顺便提醒你：${escapeHtml(groupName)} 在 ${period} 的额度已经用了 ${pct}%。再往前一步就要产生后付费了，要现在关掉它吗？`;

  const body = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:#fdf1f6;border-radius:16px;">
      <tr>
        <td style="padding:20px 20px 18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-size:12px;color:#b06a88;padding-bottom:10px">本月已用</td>
              <td align="right" style="font-size:12px;color:#b06a88;padding-bottom:10px">
                <b style="font-size:16px;color:#2b1620">${used}</b>
                <span style="color:#a08490"> / ${monthly} ${unit}</span>
              </td>
            </tr>
            <tr>
              <td colspan="2" style="padding:0 0 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4dbe5;border-radius:999px;">
                  <tr>
                    <td width="${pct}%" height="9" style="height:9px;background:${barColor};border-radius:999px;font-size:0;line-height:0">&nbsp;</td>
                    <td height="9" style="height:9px;font-size:0;line-height:0">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="font-size:13px;color:#7b5a68">预估费用</td>
              <td align="right" style="font-size:13px;color:#7b5a68">
                <b style="font-size:15px;color:#2b1620">${symbol}${Number(cost).toFixed(2)}</b>
                <span style="color:#b9a0aa">（按官方计费口径）</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
      <tr>
        <td style="padding-right:10px;">
          <a href="${disableUrl}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#c8507d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">关闭该接口</a>
        </td>
        <td>
          <a href="${keepUrl}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#fbeaf1;color:#8d3a5d;text-decoration:none;font-size:14px;font-weight:700;">保持开启</a>
        </td>
      </tr>
    </table>

    <p style="margin:18px 0 0;font-size:12px;line-height:1.8;color:#a08490">
      两个按钮都是签名链接，7 天内有效，点一下即生效，不需要登录。关闭后仍然可以在后台重新启用。
    </p>`;

  return emailShell({
    siteName,
    title,
    subtitle,
    body,
    preheader: `${groupName} 本月已用 ${pct}%，预估费用 ${symbol}${Number(cost).toFixed(2)}`,
    footer: `额度按自然月统计（${period}），达到阈值时自动提醒。${
      adminUrl ? `也可以<a href="${adminUrl}" style="color:#c8507d;text-decoration:none">打开后台</a>调整额度或停用接口。` : ''
    }`,
  });
}

export async function sendQuotaAlert(payload) {
  const {
    to, siteName, groupName, unit, used, monthly, percent, cost, currency, period, disableUrl, keepUrl,
  } = payload;
  if (!to) return { sent: false, reason: '未配置管理员邮箱' };

  const subject = `【${siteName}】${groupName} 额度已用 ${percent}%`;
  const text = [
    `${groupName} 在 ${period} 的用量：${used}/${monthly} ${unit}（${percent}%）`,
    `预估费用：${currency === 'USD' ? '$' : '¥'}${Number(cost).toFixed(2)}`,
    '',
    `关闭该接口：${disableUrl}`,
    `保持开启：${keepUrl}`,
    '',
    '链接 7 天内有效。',
  ].join('\n');

  try {
    await deliver({ to, subject, html: quotaEmailHtml({ ...payload, disableUrl, keepUrl }), text });
    return { sent: true };
  } catch (err) {
    const reason = err?.message || String(err);
    console.warn(`[额度告警发信失败] ${to} → ${reason}`);
    if (config.mailDevFallback) {
      console.log(`\n[额度告警·本地] ${subject}\n关闭：${disableUrl}\n保持：${keepUrl}\n`);
      return { sent: false, dev: true, reason };
    }
    return { sent: false, reason };
  }
}

/* ── 全体邮件通知 ─────────────────────────────────────── */

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 纯文本 → 安全的 HTML 段落（保留换行，自动识别 http(s) 链接） */
function renderNoticeBody(content) {
  const safe = escapeHtml(content).replace(
    /(https?:\/\/[^\s<]+)/g,
    (u) => `<a href="${u}" style="color:#c8507d;text-decoration:underline">${u}</a>`
  );
  return safe
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-size:14px;line-height:1.85;color:#3f2b34">${p.replace(/\n/g, '<br />')}</p>`
    )
    .join('');
}

export function broadcastEmailHtml({
  siteName,
  subject,
  content,
  hasImage = false,
  imageWidth = 0,
  imageHeight = 0,
  siteUrl = '',
}) {
  // 小图按原尺寸展示、大图缩到 500px：避免把 128px 的图硬拉到 500px 导致模糊
  const natW = Number(imageWidth) || 0;
  const natH = Number(imageHeight) || 0;
  const displayW = natW ? Math.min(500, natW) : 500;
  const displayH = natW && natH ? Math.round((displayW * natH) / natW) : 0;
  const body = `
    ${renderNoticeBody(content)}
    ${
      hasImage
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
            <tr><td align="center" style="padding:4px 0 8px;">
              <img src="cid:broadcast-image" width="${displayW}"${
                displayH ? ` height="${displayH}"` : ''
              } alt="通知配图"
                style="display:block;width:100%;max-width:${displayW}px;height:auto;border-radius:14px;border:1px solid #f7e3ea;" />
            </td></tr>
          </table>`
        : ''
    }
    ${
      siteUrl
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
            <tr><td>
              <a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#c8507d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">打开 ${escapeHtml(siteName)}</a>
            </td></tr>
          </table>`
        : ''
    }`;
  return emailShell({
    siteName,
    title: escapeHtml(subject),
    subtitle: `${pickMailOpener()} 这封是站点通知，记得看完哦。`,
    body,
    preheader: String(content || '').slice(0, 80),
    footer: `你收到这封邮件，是因为你注册了 ${escapeHtml(siteName)}。如果不想再收到通知，可以联系管理员注销账号。`,
  });
}

/** 发送一封全体通知（图片以 CID 内嵌） */
export async function sendBroadcastMail({ to, subject, html, text, image = null }) {
  const inlineImages = image?.buffer?.length
    ? [{ cid: 'broadcast-image', buffer: image.buffer, mime: image.mime || 'image/png', filename: image.filename || 'notice.png' }]
    : [];
  await deliver({ to, subject, html, text, inlineImages });
}
