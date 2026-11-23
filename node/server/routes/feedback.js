import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { all, get, run, now } from '../db.js';
import { requireAdmin, requireUser } from '../lib/auth.js';
import { E } from '../lib/errors.js';

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMAGE = 5 * 1024 * 1024;

function brief(row) {
  let images = [];
  try {
    images = JSON.parse(row.images_json || '[]');
  } catch {
    images = [];
  }
  return {
    id: row.id,
    content: row.content || '',
    images: Array.isArray(images) ? images : [],
    status: row.status || 'open',
    createdAt: row.created_at,
  };
}

export default async function feedbackRoutes(app) {
  app.post('/api/feedback/images', async (request, reply) => {
    const user = await requireUser(request);
    const buf = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    if (!buf.length) throw E.badRequest('图片为空');
    if (buf.length > MAX_IMAGE) throw E.badRequest('单张图片不能超过 5MB');
    const mime = String(request.headers['x-file-type'] || request.headers['content-type'] || 'image/png')
      .split(';')[0]
      .toLowerCase();
    const ext = IMAGE_TYPES[mime];
    if (!ext) throw E.badRequest('只支持 PNG / JPG / WebP / GIF 图片');

    const dir = path.join(config.uploadDir, 'feedback');
    await fs.mkdir(dir, { recursive: true });
    const name = `${user.id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    await fs.writeFile(path.join(dir, name), buf);
    return reply.send({ ok: true, name, url: `/api/feedback/images/${name}` });
  });

  app.get('/api/feedback/images/:name', async (request, reply) => {
    const user = await requireUser(request);
    const name = path.basename(request.params.name);
    if (user.role !== 'admin' && !name.startsWith(`${user.id}-`)) throw E.forbidden('无权查看该图片');
    const file = path.join(config.uploadDir, 'feedback', name);
    let data;
    try {
      data = await fs.readFile(file);
    } catch {
      throw E.notFound('图片不存在');
    }
    const ext = path.extname(name).slice(1).toLowerCase();
    const mimes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    return reply.type(mimes[ext] || 'application/octet-stream').header('Cache-Control', 'private, max-age=3600').send(data);
  });

  app.post('/api/feedback', async (request, reply) => {
    const user = await requireUser(request);
    const body = request.body || {};
    const content = String(body.content || '').trim().slice(0, 4000);
    const prefix = new RegExp(`^${user.id}-[a-f0-9]{16}\\.(png|jpg|webp|gif)$`);
    const images = [];
    for (const raw of Array.isArray(body.images) ? body.images : []) {
      const name = String(raw || '');
      if (prefix.test(name) && !images.includes(name)) images.push(name);
      if (images.length >= 3) break;
    }
    if (!content && !images.length) throw E.badRequest('请填写反馈内容或上传截图');

    const id = Number(
      run(
        'INSERT INTO feedback(user_id, content, images_json, status, created_at, updated_at) VALUES(?,?,?,?,?,?)',
        user.id,
        content,
        JSON.stringify(images),
        'open',
        now(),
        now()
      ).lastInsertRowid
    );
    return reply.send({ ok: true, id });
  });

  app.get('/api/admin/feedback', async (request, reply) => {
    await requireAdmin(request);
    const rows = all(
      'SELECT f.*, u.email FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.id DESC LIMIT 500'
    );
    const groups = new Map();
    for (const row of rows) {
      let g = groups.get(row.user_id);
      if (!g) {
        g = {
          userId: row.user_id,
          email: row.email || '已注销用户',
          count: 0,
          lastAt: row.created_at,
          items: [],
        };
        groups.set(row.user_id, g);
      }
      g.count += 1;
      g.items.push(brief(row));
    }
    return reply.send({ ok: true, groups: [...groups.values()], total: rows.length });
  });

  app.patch('/api/admin/feedback/:id', async (request, reply) => {
    await requireAdmin(request);
    const status = request.body?.status === 'resolved' ? 'resolved' : 'open';
    run('UPDATE feedback SET status = ?, updated_at = ? WHERE id = ?', status, now(), Number(request.params.id));
    return reply.send({ ok: true });
  });

  app.delete('/api/admin/feedback/:id', async (request, reply) => {
    await requireAdmin(request);
    const row = get('SELECT images_json FROM feedback WHERE id = ?', Number(request.params.id));
    run('DELETE FROM feedback WHERE id = ?', Number(request.params.id));
    let images = [];
    try {
      images = JSON.parse(row?.images_json || '[]');
    } catch {
      images = [];
    }
    for (const name of images) {
      try {
        await fs.unlink(path.join(config.uploadDir, 'feedback', path.basename(String(name))));
      } catch {
        /* 文件可能已不存在 */
      }
    }
    return reply.send({ ok: true });
  });
}
