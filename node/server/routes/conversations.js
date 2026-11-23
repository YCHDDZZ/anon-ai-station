import fs from 'node:fs';
import { all, get, run, now } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { E } from '../lib/errors.js';

function safeJson(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

/** 删会话后清理没人再引用的附件，数据库和磁盘一起删 */
function cleanupOrphanFiles(fileIds, userId) {
  const ids = [...new Set(fileIds.map(Number).filter(Boolean))];
  if (!ids.length) return;
  const still = new Set();
  for (const row of all("SELECT meta_json FROM messages WHERE meta_json LIKE '%fileIds%'")) {
    const meta = safeJson(row.meta_json);
    for (const fid of meta.fileIds || []) still.add(Number(fid));
  }
  for (const fid of ids) {
    if (still.has(fid)) continue;
    const row = get('SELECT path FROM files WHERE id = ? AND user_id = ?', fid, userId);
    if (!row) continue;
    run('DELETE FROM files WHERE id = ?', fid);
    try {
      if (row.path) fs.unlinkSync(row.path);
    } catch {
      /* 文件可能已经不在了 */
    }
  }
}

function toExportItem(c) {
  return {
    title: c.title,
    personaName: c.persona_name || null,
    personaPrompt: c.persona_prompt || null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    messages: all(
      'SELECT role, content, reasoning, meta_json, created_at FROM messages WHERE conversation_id = ? ORDER BY id',
      c.id
    ).map((m) => ({
      role: m.role,
      content: m.content,
      reasoning: m.reasoning || '',
      meta: safeJson(m.meta_json),
      createdAt: m.created_at,
    })),
  };
}

export default async function conversationRoutes(app) {
  app.get('/api/conversations', async (request, reply) => {
    const user = await requireUser(request);
    const rows = all(
      `SELECT c.id, c.title, c.created_at, c.updated_at, c.persona_name,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count,
              (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last
       FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 200`,
      user.id
    );
    return reply.send({
      ok: true,
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        personaName: r.persona_name || null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: r.msg_count,
        preview: (r.last || '').slice(0, 80),
      })),
    });
  });

  app.post('/api/conversations', async (request, reply) => {
    const user = await requireUser(request);
    const title = String(request.body?.title || '新对话').slice(0, 120);
    const ts = now();
    const info = run(
      'INSERT INTO conversations(user_id, title, created_at, updated_at) VALUES(?,?,?,?)',
      user.id,
      title,
      ts,
      ts
    );
    return reply.send({
      ok: true,
      conversation: { id: Number(info.lastInsertRowid), title, createdAt: ts, updatedAt: ts, messageCount: 0 },
    });
  });

  /* ── 导出全部对话 ───────────────────────────────────── */
  app.get('/api/conversations/export', async (request, reply) => {
    const user = await requireUser(request);
    const convs = all('SELECT * FROM conversations WHERE user_id = ? ORDER BY id', user.id);
    const payload = {
      app: 'anon-ai-station',
      version: 1,
      exportedAt: now(),
      conversations: convs.map(toExportItem),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header('Content-Disposition', `attachment; filename="conversations-${stamp}.json"`);
    return reply.send(payload);
  });

  /* ── 导入对话 ───────────────────────────────────────── */
  app.post(
    '/api/conversations/import',
    async (request, reply) => {
      const user = await requireUser(request);
      const body = request.body || {};
      const list = Array.isArray(body)
        ? body
        : Array.isArray(body.conversations)
          ? body.conversations
          : null;
      if (!list) throw E.badRequest('文件格式不正确：需要是导出文件，或包含 conversations 数组');
      if (list.length === 0) throw E.badRequest('文件里没有可导入的对话');
      if (list.length > 300) throw E.badRequest('一次最多导入 300 个对话');

      let imported = 0;
      let totalMessages = 0;
      run('BEGIN');
      try {
        for (const item of list) {
          const msgs = Array.isArray(item?.messages) ? item.messages : [];
          if (msgs.length === 0) continue;
          if (msgs.length > 500) throw E.badRequest('单个对话超过 500 条消息，无法导入');
          totalMessages += msgs.length;
          if (totalMessages > 5000) throw E.badRequest('一次最多导入 5000 条消息');

          const ts = now();
          const title = String(item.title || '导入的对话').slice(0, 120) || '导入的对话';
          const createdAt = Number.isFinite(item.createdAt) ? item.createdAt : ts;
          const updatedAt = Number.isFinite(item.updatedAt) ? item.updatedAt : ts;
          const personaName = item.personaName ? String(item.personaName).slice(0, 40) : null;
          const personaPrompt = item.personaPrompt ? String(item.personaPrompt).slice(0, 8000) : null;

          const info = run(
            'INSERT INTO conversations(user_id, title, persona_name, persona_prompt, created_at, updated_at) VALUES(?,?,?,?,?,?)',
            user.id,
            title,
            personaName,
            personaPrompt,
            createdAt,
            updatedAt
          );
          const cid = Number(info.lastInsertRowid);

          for (const m of msgs) {
            const role = ['user', 'assistant', 'system'].includes(m?.role) ? m.role : 'user';
            const content = typeof m?.content === 'string' ? m.content.slice(0, 200000) : '';
            const reasoning = typeof m?.reasoning === 'string' ? m.reasoning.slice(0, 200000) : null;
            const meta = m?.meta && typeof m.meta === 'object' ? JSON.stringify(m.meta).slice(0, 20000) : null;
            run(
              'INSERT INTO messages(conversation_id, role, content, reasoning, meta_json, created_at) VALUES(?,?,?,?,?,?)',
              cid,
              role,
              content,
              reasoning,
              meta,
              Number.isFinite(m?.createdAt) ? m.createdAt : ts
            );
          }
          imported += 1;
        }
        run('COMMIT');
      } catch (err) {
        run('ROLLBACK');
        throw err;
      }

      return reply.send({ ok: true, imported, messages: totalMessages });
    },
    { bodyLimit: 16 * 1024 * 1024 }
  );

  /* ── 清空全部对话 ───────────────────────────────────── */
  app.delete('/api/conversations', async (request, reply) => {
    const user = await requireUser(request);
    run('DELETE FROM conversations WHERE user_id = ?', user.id);
    return reply.send({ ok: true });
  });

  /* ── 导出单个对话 ───────────────────────────────────── */
  app.get('/api/conversations/:id/export', async (request, reply) => {
    const user = await requireUser(request);
    const conv = get('SELECT * FROM conversations WHERE id = ? AND user_id = ?', Number(request.params.id), user.id);
    if (!conv) throw E.notFound('对话不存在');
    reply.header('Content-Disposition', `attachment; filename="conversation-${conv.id}.json"`);
    return reply.send({
      app: 'anon-ai-station',
      version: 1,
      exportedAt: now(),
      conversations: [toExportItem(conv)],
    });
  });

  app.get('/api/conversations/:id', async (request, reply) => {
    const user = await requireUser(request);
    const conv = get('SELECT * FROM conversations WHERE id = ? AND user_id = ?', Number(request.params.id), user.id);
    if (!conv) throw E.notFound('对话不存在');
    const messages = all(
      'SELECT id, role, content, reasoning, meta_json, created_at FROM messages WHERE conversation_id = ? ORDER BY id',
      conv.id
    );
    return reply.send({
      ok: true,
      conversation: {
        id: conv.id,
        title: conv.title,
        personaName: conv.persona_name || null,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
      },
      messages: messages.map((m) => {
        // 旧消息里可能残留 <think> 标签，读出来时拆到 reasoning
        let content = m.content || '';
        let reasoning = m.reasoning || '';
        const mt = content.match(/^\s*<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
        if (mt) {
          content = content.slice(mt[0].length).replace(/^\s+/, '');
          if (!reasoning) reasoning = mt[1].trim();
        }
        return {
          id: m.id,
          role: m.role,
          content,
          reasoning,
          meta: (() => {
            try {
              return JSON.parse(m.meta_json || '{}');
            } catch {
              return {};
            }
          })(),
          createdAt: m.created_at,
        };
      }),
    });
  });

  app.patch('/api/conversations/:id', async (request, reply) => {
    const user = await requireUser(request);
    const id = Number(request.params.id);
    const title = String(request.body?.title ?? '').trim();
    if (!title) throw E.badRequest('标题不能为空');
    run(
      'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      title.slice(0, 120),
      now(),
      id,
      user.id
    );
    return reply.send({ ok: true });
  });

  app.delete('/api/conversations/:id', async (request, reply) => {
    const user = await requireUser(request);
    const id = Number(request.params.id);
    const conv = get('SELECT id FROM conversations WHERE id = ? AND user_id = ?', id, user.id);
    if (!conv) throw E.notFound('对话不存在');
    const fileIds = [];
    for (const row of all('SELECT meta_json FROM messages WHERE conversation_id = ?', id)) {
      for (const fid of safeJson(row.meta_json).fileIds || []) fileIds.push(Number(fid));
    }
    run('DELETE FROM messages WHERE conversation_id = ?', id);
    run('DELETE FROM conversations WHERE id = ? AND user_id = ?', id, user.id);
    cleanupOrphanFiles(fileIds, user.id);
    return reply.send({ ok: true });
  });
}
