import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { get, run, now } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { E } from '../lib/errors.js';
import { runAsr, runCrawl, runOcr, runParse, runSearch } from '../lib/providers.js';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm',
  'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'less', 'py', 'java', 'c', 'h', 'cpp', 'cs',
  'go', 'rs', 'rb', 'php', 'sh', 'bash', 'sql', 'ini', 'conf', 'toml', 'log', 'env',
]);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

const extOf = (name) => String(name || '').split('.').pop().toLowerCase();

export default async function toolsRoutes(app) {
  /* ── 上传文件（自动尝试解析 / OCR）──────────────────── */
  app.post('/api/files', async (request, reply) => {
    const user = await requireUser(request);
    const data = await request.file();
    if (!data) throw E.badRequest('没有收到文件');

    const buffer = await data.toBuffer();
    if (buffer.length === 0) throw E.badRequest('文件为空');
    if (buffer.length > config.maxFileMb * 1024 * 1024) {
      throw E.badRequest(`单个文件不能超过 ${config.maxFileMb}MB`);
    }

    const name = data.filename || 'upload.bin';
    const ext = extOf(name);
    const mime = data.mimetype || 'application/octet-stream';
    const stored = `${now()}-${crypto.randomBytes(6).toString('hex')}${ext ? `.${ext}` : ''}`;
    const filePath = path.join(config.uploadDir, stored);
    await fs.writeFile(filePath, buffer);

    let text = '';
    let parseMode = 'none';
    let parseError = null;

    if (TEXT_EXT.has(ext) || mime.startsWith('text/')) {
      text = buffer.toString('utf8');
      parseMode = 'inline';
    } else if (IMAGE_EXT.has(ext) || mime.startsWith('image/')) {
      try {
        const { text: t } = await runOcr(user, { buffer, name, mime });
        text = t;
        parseMode = 'ocr';
      } catch (err) {
        parseError = err?.code === 'INSUFFICIENT_COMPUTE' ? '未配置 OCR 能力' : err?.message;
      }
    } else {
      try {
        const { text: t } = await runParse(user, { buffer, name, mime });
        text = t;
        parseMode = 'parse';
      } catch (err) {
        parseError = err?.code === 'INSUFFICIENT_COMPUTE' ? '未配置文件解析能力' : err?.message;
      }
    }

    const info = run(
      'INSERT INTO files(user_id, name, mime, size, path, text, created_at) VALUES(?,?,?,?,?,?,?)',
      user.id,
      name,
      mime,
      buffer.length,
      filePath,
      text,
      now()
    );

    return reply.send({
      ok: true,
      file: {
        id: Number(info.lastInsertRowid),
        name,
        mime,
        size: buffer.length,
        parseMode,
        textLength: text.length,
        warning: parseError,
      },
    });
  });

  /* 重新解析已上传文件 */
  app.post('/api/files/:id/reparse', async (request, reply) => {
    const user = await requireUser(request);
    const row = get('SELECT * FROM files WHERE id = ? AND user_id = ?', Number(request.params.id), user.id);
    if (!row) throw E.notFound('文件不存在');
    const buffer = await fs.readFile(row.path);
    const ext = extOf(row.name);
    const file = { buffer, name: row.name, mime: row.mime };

    const { text } = IMAGE_EXT.has(ext) ? await runOcr(user, file) : await runParse(user, file);
    run('UPDATE files SET text = ? WHERE id = ?', text, row.id);
    return reply.send({ ok: true, textLength: text.length });
  });

  /* ── 联网搜索 ─────────────────────────────────────── */
  app.post('/api/tools/search', async (request, reply) => {
    const user = await requireUser(request);
    const query = String(request.body?.query || '').trim();
    if (!query) throw E.badRequest('搜索内容为空');
    const started = Date.now();
    const { results, provider } = await runSearch(user, { query, limit: Number(request.body?.limit) || 6 });
    return reply.send({ ok: true, results, provider, elapsedMs: Date.now() - started });
  });

  /* ── 网页爬取 ─────────────────────────────────────── */
  app.post('/api/tools/crawl', async (request, reply) => {
    const user = await requireUser(request);
    const url = String(request.body?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw E.badRequest('请输入合法的 http(s) 地址');
    const page = await runCrawl(user, { url });
    return reply.send({ ok: true, ...page });
  });

  /* ── 语音识别 ─────────────────────────────────────── */
  app.post('/api/tools/asr', async (request, reply) => {
    const user = await requireUser(request);
    const data = await request.file();
    if (!data) throw E.badRequest('没有收到音频');
    const buffer = await data.toBuffer();
    if (buffer.length > 20 * 1024 * 1024) throw E.badRequest('音频过大');
    const started = Date.now();
    const { text, provider } = await runAsr(user, {
      buffer,
      name: data.filename || 'recording.webm',
      mime: data.mimetype || 'audio/webm',
    });
    return reply.send({ ok: true, text, provider, elapsedMs: Date.now() - started });
  });
}
