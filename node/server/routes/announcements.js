import fs from 'node:fs';
import { config } from '../config.js';
import { setting } from '../db.js';
import { requireAdmin, requireUser } from '../lib/auth.js';
import { E } from '../lib/errors.js';
import {
  activeAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  getAnnouncementImage,
  listAnnouncements,
  saveAnnouncementImage,
  updateAnnouncement,
} from '../lib/announcements.js';
import { get as dbGet } from '../db.js';

/** 公告（用户侧）+ 公告管理（管理员）+ 安卓版本信息 */
export default async function announcementRoutes(app) {
  app.get('/api/announcements/active', async (request, reply) => {
    await requireUser(request);
    return reply.send({ ok: true, announcement: activeAnnouncement() });
  });

  app.get('/api/announcements/:id/image', async (request, reply) => {
    const user = await requireUser(request);
    const row = dbGet('SELECT * FROM announcements WHERE id = ?', request.params.id);
    if (!row || !row.image_id) throw E.notFound('公告图片不存在');
    if (!row.enabled && user.role !== 'admin') throw E.notFound('公告图片不存在');
    const img = getAnnouncementImage(row.image_id);
    if (!img) throw E.notFound('公告图片不存在');
    let buffer;
    try {
      buffer = fs.readFileSync(img.path);
    } catch {
      throw E.notFound('公告图片文件已丢失');
    }
    return reply.type(img.mime || 'image/png').header('Cache-Control', 'private, max-age=600').send(buffer);
  });

  app.get('/api/app/version', async (request, reply) => {
    const versionCode = Number(setting('appVersionCode', '2')) || 1;
    const versionName = setting('appVersionName', '1.1.0');
    const downloadUrl = setting('appDownloadUrl', `${config.publicUrl}/downloads/anno-ai.apk`);
    return reply.send({
      ok: true,
      latest: {
        versionCode,
        versionName,
        url: downloadUrl,
        notes: setting('appUpdateNotes', '应用内直接下载安装，装完就能继续聊～'),
        mandatory: setting('appUpdateMandatory', 'true') !== 'false',
        publishedAt: Number(setting('appPublishedAt', '0')) || null,
      },
    });
  });

  /* ── 管理端 ─────────────────────────────────────────── */
  app.get('/api/admin/announcements', async (request, reply) => {
    await requireAdmin(request);
    return reply.send({ ok: true, items: listAnnouncements() });
  });

  app.post('/api/admin/announcements/image', async (request, reply) => {
    const user = await requireAdmin(request);
    const data = await request.file();
    if (!data) throw E.badRequest('没有收到图片');
    const buffer = await data.toBuffer();
    const image = saveAnnouncementImage({ buffer, name: data.filename, adminId: user.id });
    return reply.send({
      ok: true,
      image: {
        id: image.id,
        name: image.name,
        size: image.size,
        mime: image.mime,
        url: `/api/admin/announcements/image/${image.id}`,
      },
    });
  });

  app.get('/api/admin/announcements/image/:id', async (request, reply) => {
    await requireAdmin(request);
    const img = getAnnouncementImage(request.params.id);
    if (!img) throw E.notFound('图片不存在');
    let buffer;
    try {
      buffer = fs.readFileSync(img.path);
    } catch {
      throw E.notFound('图片文件已丢失');
    }
    return reply.type(img.mime || 'image/png').header('Cache-Control', 'private, max-age=600').send(buffer);
  });

  app.post('/api/admin/announcements', async (request, reply) => {
    const user = await requireAdmin(request);
    const b = request.body || {};
    const row = createAnnouncement(
      {
        title: b.title,
        content: b.content,
        tone: b.tone,
        enabled: b.enabled !== false,
        imageId: b.imageId || null,
        startsAt: b.startsAt || null,
        endsAt: b.endsAt || null,
      },
      user.id
    );
    return reply.send({ ok: true, item: listAnnouncements().find((x) => x.id === row.id) });
  });

  app.put('/api/admin/announcements/:id', async (request, reply) => {
    await requireAdmin(request);
    const b = request.body || {};
    const row = updateAnnouncement(request.params.id, {
      title: b.title,
      content: b.content,
      tone: b.tone,
      enabled: b.enabled,
      imageId: b.imageId,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
    });
    return reply.send({ ok: true, item: listAnnouncements().find((x) => x.id === row.id) });
  });

  app.delete('/api/admin/announcements/:id', async (request, reply) => {
    await requireAdmin(request);
    deleteAnnouncement(request.params.id);
    return reply.send({ ok: true });
  });
}
