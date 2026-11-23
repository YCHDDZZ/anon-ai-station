import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, get, run, now } from '../db.js';
import { E } from './errors.js';

/**
 * 站点公告：管理员发布图文公告，用户主页面以弹窗展示。
 * 同一时间只展示最新的一条；用户关闭后按「公告 id + 更新时间」记住，改了内容会再次提示。
 */

const IMAGE_DIR = path.join(config.uploadDir, 'announcements');
const IMAGE_LIMIT = 5 * 1024 * 1024;
const TONES = ['info', 'important', 'success'];

function detectImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.subarray(1, 4).toString('latin1') === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  const head = buffer.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return { ext: 'gif', mime: 'image/gif' };
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

export function saveAnnouncementImage({ buffer, name, adminId }) {
  if (!buffer?.length) throw E.badRequest('图片为空');
  if (buffer.length > IMAGE_LIMIT) throw E.badRequest('图片不能超过 5MB');
  const kind = detectImage(buffer);
  if (!kind) throw E.badRequest('只支持 PNG / JPG / GIF / WEBP 图片');

  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const stored = `${now()}-${crypto.randomBytes(5).toString('hex')}.${kind.ext}`;
  const filePath = path.join(IMAGE_DIR, stored);
  fs.writeFileSync(filePath, buffer);

  const info = run(
    'INSERT INTO announcement_images(name, mime, size, path, created_by, created_at) VALUES(?,?,?,?,?,?)',
    String(name || `announcement.${kind.ext}`).slice(0, 150),
    kind.mime,
    buffer.length,
    filePath,
    adminId,
    now()
  );
  return get('SELECT * FROM announcement_images WHERE id = ?', info.lastInsertRowid);
}

export function getAnnouncementImage(id) {
  return get('SELECT * FROM announcement_images WHERE id = ?', id);
}

function assertText(title, content) {
  const t = String(title || '').trim();
  const c = String(content || '').trim();
  if (!t) throw E.badRequest('请填写公告标题');
  if (t.length > 120) throw E.badRequest('公告标题不能超过 120 字');
  if (!c) throw E.badRequest('请填写公告内容');
  if (c.length > 5000) throw E.badRequest('公告内容不能超过 5000 字');
  return { title: t, content: c };
}

function imageUrl(id) {
  return id ? `/api/announcements/${id}/image` : null;
}

export function announcementPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tone: TONES.includes(row.tone) ? row.tone : 'info',
    imageUrl: imageUrl(row.id),
    updatedAt: row.updated_at,
  };
}

export function activeAnnouncement() {
  const ts = now();
  const row = get(
    `SELECT * FROM announcements
     WHERE enabled = 1
       AND (starts_at IS NULL OR starts_at = 0 OR starts_at <= ?)
       AND (ends_at IS NULL OR ends_at = 0 OR ends_at > ?)
     ORDER BY updated_at DESC, id DESC LIMIT 1`,
    ts,
    ts
  );
  return announcementPublic(row);
}

export function listAnnouncements() {
  return all('SELECT * FROM announcements ORDER BY updated_at DESC, id DESC').map((r) => ({
    ...r,
    enabled: Boolean(r.enabled),
    imageUrl: r.image_id ? `/api/admin/announcements/image/${r.image_id}` : null,
    publicImageUrl: r.image_id ? `/api/announcements/${r.id}/image` : null,
  }));
}

export function createAnnouncement({ title, content, tone, enabled, imageId, startsAt, endsAt }, adminId) {
  const t = assertText(title, content);
  const ts = now();
  const info = run(
    `INSERT INTO announcements(title, content, image_id, tone, enabled, starts_at, ends_at, created_by, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    t.title,
    t.content,
    imageId || null,
    TONES.includes(tone) ? tone : 'info',
    enabled === false ? 0 : 1,
    startsAt || null,
    endsAt || null,
    adminId,
    ts,
    ts
  );
  return get('SELECT * FROM announcements WHERE id = ?', info.lastInsertRowid);
}

export function updateAnnouncement(id, { title, content, tone, enabled, imageId, startsAt, endsAt }) {
  const row = get('SELECT * FROM announcements WHERE id = ?', id);
  if (!row) throw E.notFound('公告不存在');
  const t = assertText(title, content);
  run(
    `UPDATE announcements SET title = ?, content = ?, image_id = ?, tone = ?, enabled = ?, starts_at = ?, ends_at = ?, updated_at = ?
     WHERE id = ?`,
    t.title,
    t.content,
    imageId === undefined ? row.image_id : imageId || null,
    TONES.includes(tone) ? tone : row.tone || 'info',
    enabled === undefined ? row.enabled : enabled ? 1 : 0,
    startsAt === undefined ? row.starts_at : startsAt || null,
    endsAt === undefined ? row.ends_at : endsAt || null,
    now(),
    id
  );
  return get('SELECT * FROM announcements WHERE id = ?', id);
}

export function deleteAnnouncement(id) {
  const row = get('SELECT * FROM announcements WHERE id = ?', id);
  if (!row) throw E.notFound('公告不存在');
  const ts = now();
  run('DELETE FROM announcements WHERE id = ?', id);
  if (row.image_id) {
    const used = get('SELECT COUNT(*) AS c FROM announcements WHERE image_id = ?', row.image_id).c;
    if (!used) {
      const img = get('SELECT * FROM announcement_images WHERE id = ?', row.image_id);
      if (img) {
        try {
          fs.unlinkSync(img.path);
        } catch {
          /* 文件可能已不存在 */
        }
        run('DELETE FROM announcement_images WHERE id = ?', row.image_id);
      }
    }
  }
  return ts;
}

/** 清理超过 30 天且未被引用的公告配图 */
export function cleanupAnnouncementImages() {
  const cutoff = now() - 30 * 86400_000;
  const rows = all(
    `SELECT * FROM announcement_images
     WHERE created_at < ? AND id NOT IN (SELECT image_id FROM announcements WHERE image_id IS NOT NULL)`,
    cutoff
  );
  for (const row of rows) {
    try {
      fs.unlinkSync(row.path);
    } catch {
      /* ignore */
    }
    run('DELETE FROM announcement_images WHERE id = ?', row.id);
  }
}
