import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, get, run, now, setting } from '../db.js';
import { AppError, E } from './errors.js';
import { broadcastEmailHtml, sendBroadcastMail } from './mailer.js';

/**
 * 全体邮件通知。
 *
 * 设计要点：
 *  - 发送是「任务 + 逐封队列」，接口立即返回 jobId，前端轮询进度；
 *  - QQ 邮箱对发信频率敏感，封与封之间默认间隔 1.2 秒，串行发送；
 *  - 同一时间只允许一个进行中的任务，避免误点两次给所有人发两封；
 *  - 任务状态、收件人总数、成功/失败数都落库，服务重启会把中断任务标记为失败。
 */

const IMAGE_LIMIT = 5 * 1024 * 1024;
const SEND_INTERVAL = 1200;
const IMAGE_DIR = path.join(config.uploadDir, 'broadcast');

/** 进程内的发送状态：jobId -> { index, recipients, image, canceled } */
const running = new Map();

export function recoverInterruptedBroadcasts() {
  run(
    "UPDATE broadcast_jobs SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('queued','sending')",
    '服务重启，发送中断',
    now()
  );
}

export function listRecipients() {
  return all(
    "SELECT DISTINCT lower(email) AS email FROM users WHERE status IN ('active','disabled') AND email IS NOT NULL AND email <> '' ORDER BY email"
  ).map((r) => r.email);
}

/* ── 配图 ─────────────────────────────────────────────── */

function detectImage(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buffer.subarray(0, 4).toString('latin1') === 'GIF8') return { ext: 'gif', mime: 'image/gif' };
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

/** 读取图片原始尺寸，邮件里按原尺寸展示，避免把小图拉大导致模糊 */
export function imageSize(buffer) {
  try {
    if (buffer.length > 24 && buffer.subarray(1, 4).toString('latin1') === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length > 10 && buffer.subarray(0, 3).toString('latin1') === 'GIF') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (buffer.length > 30 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let i = 2;
      while (i < buffer.length - 9) {
        if (buffer[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = buffer[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
        }
        i += 2 + buffer.readUInt16BE(i + 2);
      }
    }
    if (buffer.length > 30 && buffer.subarray(0, 4).toString('latin1') === 'RIFF') {
      const chunk = buffer.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8X') {
        const w = 1 + buffer.readUIntLE(24, 3);
        const h = 1 + buffer.readUIntLE(27, 3);
        return { width: w, height: h };
      }
      if (chunk === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const b = buffer;
        return {
          width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
          height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
        };
      }
    }
  } catch {
    /* 尺寸读不出就按默认宽度渲染 */
  }
  return null;
}

export function saveBroadcastImage({ buffer, name, mime, adminId }) {
  if (!buffer?.length) throw E.badRequest('图片为空');
  if (buffer.length > IMAGE_LIMIT) throw E.badRequest('图片不能超过 5MB');
  const kind = detectImage(buffer);
  if (!kind) throw E.badRequest('只支持 PNG / JPG / GIF / WEBP 图片');

  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const stored = `${now()}-${crypto.randomBytes(5).toString('hex')}.${kind.ext}`;
  const filePath = path.join(IMAGE_DIR, stored);
  fs.writeFileSync(filePath, buffer);

  const info = run(
    'INSERT INTO broadcast_images(name, mime, size, path, created_by, created_at) VALUES(?,?,?,?,?,?)',
    String(name || `notice.${kind.ext}`).slice(0, 120),
    kind.mime,
    buffer.length,
    filePath,
    adminId || null,
    now()
  );
  return getBroadcastImage(Number(info.lastInsertRowid));
}

export function getBroadcastImage(id) {
  return get('SELECT * FROM broadcast_images WHERE id = ?', Number(id));
}

/* ── 任务 ─────────────────────────────────────────────── */

function fullSubject(subject, siteName) {
  const s = String(subject || '').trim();
  return s.startsWith('【') ? s : `【${siteName}】${s}`;
}

export function createBroadcast({ subject, content, imageId = null, adminId }) {
  const title = String(subject || '').trim();
  const text = String(content || '').trim();
  if (!title) throw E.badRequest('请填写邮件主题');
  if (title.length > 120) throw E.badRequest('主题不能超过 120 字');
  if (!text) throw E.badRequest('请填写邮件正文');
  if (text.length > 8000) throw E.badRequest('正文不能超过 8000 字');

  const active = get("SELECT id FROM broadcast_jobs WHERE status IN ('queued','sending') LIMIT 1");
  if (active) throw new AppError('BROADCAST_BUSY', '已有正在发送的全体邮件，请等它完成或取消后再发', 409);

  let image = null;
  if (imageId) {
    const row = getBroadcastImage(imageId);
    if (!row) throw E.badRequest('配图不存在，请重新上传');
    image = row;
  }

  const recipients = listRecipients();
  if (!recipients.length) throw E.badRequest('还没有已注册的账号');

  const info = run(
    `INSERT INTO broadcast_jobs(subject, content, image_id, total, sent, failed, status, created_by, created_at)
     VALUES(?,?,?,?,0,0,'queued',?,?)`,
    title,
    text,
    image?.id || null,
    recipients.length,
    adminId || null,
    now()
  );
  const id = Number(info.lastInsertRowid);

  // 正文与配图只准备一次，后面每封复用（避免重复读盘 / 反复渲染）
  const siteName = setting('siteName', '千早爱音的AI站');
  let imagePayload = null;
  if (image) {
    try {
      const buffer = fs.readFileSync(image.path);
      imagePayload = { buffer, mime: image.mime, filename: image.name || 'notice.png', ...(imageSize(buffer) || {}) };
    } catch {
      imagePayload = null;
    }
  }
  running.set(id, {
    index: 0,
    recipients,
    image: imagePayload,
    canceled: false,
    siteName,
    mailSubject: fullSubject(title, siteName),
    text,
  });
  setTimeout(() => tick(id).catch((err) => failJob(id, err)), 50);
  return get('SELECT * FROM broadcast_jobs WHERE id = ?', id);
}

async function tick(id) {
  const job = get('SELECT * FROM broadcast_jobs WHERE id = ?', id);
  const st = running.get(id);
  if (!job || !st) return;

  if (job.status === 'canceled') {
    running.delete(id);
    return;
  }
  if (st.canceled) {
    run("UPDATE broadcast_jobs SET status = 'canceled', finished_at = ? WHERE id = ?", now(), id);
    running.delete(id);
    return;
  }
  if (st.index >= st.recipients.length) {
    run(
      "UPDATE broadcast_jobs SET status = 'done', finished_at = ? WHERE id = ?",
      now(),
      id
    );
    running.delete(id);
    return;
  }

  if (job.status === 'queued') {
    run("UPDATE broadcast_jobs SET status = 'sending', started_at = ? WHERE id = ?", now(), id);
  }

  const email = st.recipients[st.index];
  st.index += 1;

  try {
    // 每封单独渲染：开场白会随机换成不同队友，收件人之间不会完全一样
    const html = broadcastEmailHtml({
      siteName: st.siteName,
      subject: job.subject,
      content: job.content,
      hasImage: Boolean(st.image),
      imageWidth: st.image?.width,
      imageHeight: st.image?.height,
      siteUrl: config.publicUrl,
    });
    await sendBroadcastMail({
      to: email,
      subject: st.mailSubject,
      html,
      text: st.text,
      image: st.image,
    });
    run('UPDATE broadcast_jobs SET sent = sent + 1 WHERE id = ?', id);
    run('INSERT INTO broadcast_logs(job_id, email, ok, error, created_at) VALUES(?,?,1,NULL,?)', id, email, now());
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 300);
    run('UPDATE broadcast_jobs SET failed = failed + 1 WHERE id = ?', id);
    run('INSERT INTO broadcast_logs(job_id, email, ok, error, created_at) VALUES(?,?,0,?,?)', id, email, msg, now());
    console.warn(`[全体邮件] ${email} 发送失败：${msg}`);
  }

  // 最后一封不用再等发送间隔，直接收尾
  const delay = st.index < st.recipients.length ? SEND_INTERVAL : 0;
  setTimeout(() => tick(id).catch((err) => failJob(id, err)), delay);
}

function failJob(id, err) {
  run(
    "UPDATE broadcast_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
    String(err?.message || err).slice(0, 300),
    now(),
    id
  );
  running.delete(id);
}

export function cancelBroadcast(id) {
  const job = get('SELECT * FROM broadcast_jobs WHERE id = ?', Number(id));
  if (!job) throw E.notFound('任务不存在');
  if (!['queued', 'sending'].includes(job.status)) throw E.badRequest('该任务已经结束');
  const st = running.get(Number(id));
  if (st) st.canceled = true;
  else run("UPDATE broadcast_jobs SET status = 'canceled', finished_at = ? WHERE id = ?", now(), Number(id));
  return { ok: true };
}

export function getBroadcastJob(id) {
  const job = get('SELECT * FROM broadcast_jobs WHERE id = ?', Number(id));
  if (!job) throw E.notFound('任务不存在');
  const failures = all(
    'SELECT email, error, created_at FROM broadcast_logs WHERE job_id = ? AND ok = 0 ORDER BY id DESC LIMIT 10',
    job.id
  );
  return { ...job, failures };
}

export function listBroadcastJobs(limit = 20) {
  const rows = all(
    `SELECT id, subject, total, sent, failed, status, error, created_at, finished_at
     FROM broadcast_jobs ORDER BY id DESC LIMIT ?`,
    Math.min(50, Math.max(1, Number(limit) || 20))
  );
  return rows;
}

/** 只发给管理员自己：用于正式群发前预览效果 */
export async function sendBroadcastPreview({ to, subject, content, imageId }) {
  const title = String(subject || '').trim();
  const text = String(content || '').trim();
  if (!title || !text) throw E.badRequest('请填写主题和正文');
  if (title.length > 120) throw E.badRequest('主题不能超过 120 字');
  if (text.length > 8000) throw E.badRequest('正文不能超过 8000 字');
  const siteName = setting('siteName', '千早爱音的AI站');
  let image = null;
  if (imageId) {
    const row = getBroadcastImage(imageId);
    if (!row) throw E.badRequest('配图不存在，请重新上传');
    try {
      const buffer = fs.readFileSync(row.path);
      image = { buffer, mime: row.mime, filename: row.name || 'notice.png', ...(imageSize(buffer) || {}) };
    } catch {
      image = null;
    }
  }
  const html = broadcastEmailHtml({
    siteName,
    subject: title,
    content: text,
    hasImage: Boolean(image),
    imageWidth: image?.width,
    imageHeight: image?.height,
    siteUrl: config.publicUrl,
  });
  await sendBroadcastMail({ to, subject: fullSubject(`[预览] ${title}`, siteName), html, text, image });
  return true;
}

export function cleanupBroadcastLogs() {
  run('DELETE FROM broadcast_logs WHERE created_at < ?', now() - 90 * 86400_000);

  // 清理没有被任何任务引用、且超过 30 天的配图（上传后没用上的孤儿文件）
  const cutoff = now() - 30 * 86400_000;
  const orphans = all(
    'SELECT id, path FROM broadcast_images WHERE created_at < ? AND id NOT IN (SELECT image_id FROM broadcast_jobs WHERE image_id IS NOT NULL)',
    cutoff
  );
  for (const row of orphans) {
    try {
      fs.unlinkSync(row.path);
    } catch {
      /* 文件可能已经不存在 */
    }
  }
  run(
    'DELETE FROM broadcast_images WHERE created_at < ? AND id NOT IN (SELECT image_id FROM broadcast_jobs WHERE image_id IS NOT NULL)',
    cutoff
  );
}
