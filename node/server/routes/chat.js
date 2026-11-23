import { all, get, run, now, setting } from '../db.js';
import { requireUser } from '../lib/auth.js';
import { AppError, E } from '../lib/errors.js';
import { streamChat } from '../lib/llm.js';
import { createThinkFilter } from '../lib/think-filter.js';
import { runSearch } from '../lib/providers.js';
import { resolvePersona } from '../lib/personas.js';

const HISTORY_LIMIT = 20;
const FILE_CONTEXT_LIMIT = 24000;

function sseInit(reply) {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write(': connected\n\n');
  let closed = false;
  raw.on('close', () => {
    closed = true;
  });
  return {
    send(event, data) {
      if (closed || raw.writableEnded) return;
      raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (closed || raw.writableEnded) return;
      raw.end();
    },
    get closed() {
      return closed;
    },
  };
}

function buildFileContext(user, fileIds) {
  if (!Array.isArray(fileIds) || fileIds.length === 0) return { text: '', files: [] };
  const picked = [];
  for (const id of fileIds.slice(0, 8)) {
    const row = get('SELECT * FROM files WHERE id = ? AND user_id = ?', Number(id), user.id);
    if (row) picked.push(row);
  }
  if (picked.length === 0) return { text: '', files: [] };

  let budget = FILE_CONTEXT_LIMIT;
  const chunks = [];
  for (const f of picked) {
    const body = (f.text || '').trim();
    if (!body) {
      chunks.push(`--- 文件：${f.name}（未能提取到文字，可能是扫描件或旧版格式）---`);
      continue;
    }
    const slice = body.slice(0, budget);
    budget -= slice.length;
    chunks.push(`--- 文件：${f.name} ---\n${slice}`);
    if (budget <= 0) break;
  }
  return {
    text: `【用户上传的附件】\n以下是从附件中提取的正文：\n\n${chunks.join('\n\n')}\n\n【回答要求】当用户问「里面讲了什么」「总结一下」这类问题时，必须优先依据上面的附件原文回答，并点明来自哪个文件；不要用无关的联网结果或臆测替代。`,
    files: picked.map((f) => ({ id: f.id, name: f.name, size: f.size, textLength: (f.text || '').trim().length })),
  };
}

function searchContext(search) {
  if (!search?.results?.length) return '';
  const lines = search.results.map(
    (r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet || ''}`
  );
  return `以下是刚刚联网检索到的资料，请优先依据它们回答，并在引用处标注 [序号]：\n\n${lines.join('\n\n')}`;
}

export default async function chatRoutes(app) {
  app.post('/api/chat', async (request, reply) => {
    const user = await requireUser(request);
    const b = request.body || {};
    const content = String(b.content || '').trim();
    const fileIds = Array.isArray(b.fileIds) ? b.fileIds : [];
    if (!content && fileIds.length === 0) throw E.badRequest('请输入消息或上传文件');

    /* 1. 会话 */
    let convId = b.conversationId ? Number(b.conversationId) : null;
    let conv = convId ? get('SELECT * FROM conversations WHERE id = ? AND user_id = ?', convId, user.id) : null;
    if (convId && !conv) throw E.notFound('对话不存在');

    /* 1.1 角色扮演：新会话第一条消息必须做出选择；personaId = 0 表示「不使用角色」 */
    const msgCount = conv
      ? get('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?', conv.id).c
      : 0;
    const isFirstMessage = msgCount === 0;
    let persona = null;
    if (isFirstMessage) {
      if (b.personaId === undefined || b.personaId === null) {
        throw new AppError('PERSONA_REQUIRED', '请先选择一个角色再发送消息', 400);
      }
      if (Number(b.personaId) === 0) {
        persona = { id: 0, name: '不使用角色', prompt: '' };
      } else {
        persona = resolvePersona(user, b.personaId);
        if (!persona) {
          throw new AppError('PERSONA_INVALID', '该角色已不可用，请重新选择', 400);
        }
      }
    }
    const personaPrompt = isFirstMessage ? persona.prompt : conv?.persona_prompt || null;
    const personaName = isFirstMessage ? persona.name : conv?.persona_name || null;

    if (!conv) {
      const title = (content || '文件对话').slice(0, 40);
      const info = run(
        'INSERT INTO conversations(user_id, title, created_at, updated_at) VALUES(?,?,?,?)',
        user.id,
        title,
        now(),
        now()
      );
      convId = Number(info.lastInsertRowid);
      run(
        'UPDATE conversations SET persona_id = ?, persona_name = ?, persona_prompt = ? WHERE id = ?',
        persona.id,
        persona.name,
        persona.prompt,
        convId
      );
      conv = get('SELECT * FROM conversations WHERE id = ?', convId);
    }

    const fileCtx = buildFileContext(user, fileIds);

    /* 2. 落库用户消息 */
    const userMsgId = Number(
      run(
        'INSERT INTO messages(conversation_id, role, content, meta_json, created_at) VALUES(?,?,?,?,?)',
        convId,
        'user',
        content,
        JSON.stringify({ fileIds, files: fileCtx.files }),
        now()
      ).lastInsertRowid
    );

    const sse = sseInit(reply);
    const controller = new AbortController();
    request.raw.on('aborted', () => controller.abort());
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    const startedAt = Date.now();
    let answer = '';
    let reasoning = '';
    let usage = null;
    let providerInfo = null;

    try {
      sse.send('meta', { conversationId: convId, userMessageId: userMsgId });

      /* 3. 联网搜索（可选） */
      let searchPayload = null;
      if (b.search) {
        try {
          const { results } = await runSearch(user, { query: content || '文件内容', limit: 6 });
          searchPayload = { query: content, results };
          sse.send('search', searchPayload);
        } catch (err) {
          sse.send('search_error', { message: err?.message || '联网搜索不可用' });
        }
      }

      /* 4. 组装 messages */
      const history = all(
        'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?',
        convId,
        HISTORY_LIMIT
      ).reverse();

      const systemParts = [];
      if (personaPrompt) {
        systemParts.push(personaPrompt);
      } else {
        systemParts.push(`你是「${setting('siteName', '千早爱音的AI站')}」里的 AI 助手。`);
      }
      systemParts.push('请使用简体中文回答，条理清晰，代码使用 Markdown 代码块。');
      systemParts.push('不确定的内容要明确说明，不要编造。');
      const sc = searchContext(searchPayload);
      if (sc) systemParts.push(sc);
      if (fileCtx.text) systemParts.push(fileCtx.text);
      const thinking = b.thinking !== false;
      if (!thinking) {
        systemParts.push('本次不需要展示思考过程：请直接给出最终回答，不要输出 <think> 标签、推理步骤或自我分析。');
      }

      const messages = [{ role: 'system', content: systemParts.join('\n\n') }];
      for (const m of history) {
        if (!m.content) continue;
        messages.push({ role: m.role, content: m.content });
      }

      /* 5. 流式生成 */
      const requestedModel = typeof b.model === 'string' ? b.model.slice(0, 80) : '';
      const tf = createThinkFilter(thinking);
      const pushOut = (out) => {
        if (out.type === 'content') {
          answer += out.text;
          sse.send('delta', { text: out.text });
        } else {
          reasoning += out.text;
          sse.send('reasoning', { text: out.text });
        }
      };
      for await (const ev of streamChat(user, {
        messages,
        model: requestedModel,
        thinking,
        temperature: thinking ? 0.6 : 0.7,
        signal: controller.signal,
      })) {
        if (ev.provider && !providerInfo) {
          providerInfo = ev.provider;
          sse.send('provider', providerInfo);
        }
        if (ev.type === 'reasoning') {
          if (!thinking) continue;
          reasoning += ev.text;
          sse.send('reasoning', { text: ev.text });
        } else if (ev.type === 'delta') {
          for (const out of tf.feed(ev.text)) pushOut(out);
        } else if (ev.type === 'usage') {
          usage = ev.usage;
        }
      }
      for (const out of tf.flush()) pushOut(out);

      /* 6. 落库助手消息 */
      const assistantId = Number(
        run(
          'INSERT INTO messages(conversation_id, role, content, reasoning, meta_json, created_at) VALUES(?,?,?,?,?,?)',
          convId,
          'assistant',
          answer,
          reasoning || null,
          JSON.stringify({
            usage,
            provider: providerInfo,
            personaName,
            search: searchPayload ? { query: searchPayload.query, results: searchPayload.results } : null,
            think: thinking,
            elapsedMs: Date.now() - startedAt,
          }),
          now()
        ).lastInsertRowid
      );
      run('UPDATE conversations SET updated_at = ? WHERE id = ?', now(), convId);

      sse.send('done', {
        conversationId: convId,
        assistantMessageId: assistantId,
        usage,
        provider: providerInfo,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (err) {
      const message =
        err?.code === 'INSUFFICIENT_COMPUTE'
          ? err?.extra?.custom
            ? err.message
            : setting('insufficientComputeMsg', '算力不足，请自行接入第三方工具 API。')
          : err?.message || '生成失败';

      if (answer || reasoning) {
        run(
          'INSERT INTO messages(conversation_id, role, content, reasoning, meta_json, created_at) VALUES(?,?,?,?,?,?)',
          convId,
          'assistant',
          answer,
          reasoning || null,
          JSON.stringify({ error: message, provider: providerInfo, partial: true }),
          now()
        );
        run('UPDATE conversations SET updated_at = ? WHERE id = ?', now(), convId);
      }
      sse.send('error', {
        code: err?.code || 'CHAT_FAILED',
        message,
        partial: Boolean(answer || reasoning),
        conversationId: convId,
      });
    } finally {
      sse.end();
    }
  });

  /* 朗读：TTS 独立接口，避免阻塞对话流 */
  app.post('/api/chat/tts', async (request, reply) => {
    const user = await requireUser(request);
    const text = String(request.body?.text || '').trim();
    if (!text) throw E.badRequest('朗读内容为空');
    const { runTts } = await import('../lib/providers.js');
    const audio = await runTts(user, { text: text.slice(0, 4000), voice: request.body?.voice || '' });
    reply.header('Content-Type', audio.mime || 'audio/mpeg');
    reply.header('Cache-Control', 'no-store');
    return reply.send(audio.buffer);
  });
}
