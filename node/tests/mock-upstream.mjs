import http from 'node:http';

const log = [];

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.url.includes('/models')) {
        log.push('models');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'Qwen3-8B' }, { id: 'Qwen3-0.6B' }, { id: 'Lingshu-32B' }, { id: 'DeepSeek-R1-Distill-Qwen-14B' }],
          })
        );
        return;
      }
      if (req.url === '/__reset') {
        log.length = 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url.startsWith('/tavily/search')) {
        log.push('tavily:search');
        let ok = false;
        try {
          const j = JSON.parse(body);
          ok = typeof j.max_results === 'number' && j.search_depth === 'basic';
        } catch {
          /* ignore */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            query: 'x',
            _typeOk: ok,
            results: [
              { title: 'Tavily 结果 A', url: 'https://example.com/ta', content: '摘要 A' },
              { title: 'Tavily 结果 B', url: 'https://example.com/tb', content: '摘要 B' },
            ],
          })
        );
        return;
      }
      if (req.url.startsWith('/tavily/extract')) {
        log.push('tavily:extract');
        let ok = false;
        try {
          const j = JSON.parse(body);
          ok = Array.isArray(j.urls) && j.urls.length === 1;
        } catch {
          /* ignore */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            _urlsOk: ok,
            results: [{ url: 'https://example.com/a', raw_content: '这是提取出来的网页正文。' }],
            failed_results: [],
          })
        );
        return;
      }
      if (req.url.startsWith('/sf/v1/chat/completions')) {
        log.push('sf:vision');
        let hasImage = false;
        let hasPrompt = false;
        try {
          const j = JSON.parse(body);
          const content = j.messages?.[0]?.content || [];
          hasImage = content.some((c) => c.type === 'image_url' && String(c.image_url?.url).startsWith('data:image/'));
          hasPrompt = content.some((c) => c.type === 'text' && c.text.length > 0);
        } catch {
          /* ignore */
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: hasImage && hasPrompt ? '图片里写着：测试文字 OCR 成功' : '没收到图片',
                },
              },
            ],
          })
        );
        return;
      }
      if (req.url.startsWith('/mimo/v1/chat/completions')) {
        log.push('mimo:tts');
        let ok = false;
        let voice = '';
        try {
          const j = JSON.parse(body);
          voice = j.audio?.voice || '';
          ok = j.messages?.[0]?.role === 'assistant' && j.audio?.format === 'wav';
        } catch {
          /* ignore */
        }
        const fakeAudio = Buffer.from('RIFFfake-wav-bytes-for-test');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            _ok: ok,
            _voice: voice,
            choices: [{ message: { role: 'assistant', audio: { data: fakeAudio.toString('base64') } } }],
          })
        );
        return;
      }
      if (req.url.startsWith('/moark/v1/audio/transcriptions')) {
        log.push('moark:asr');
        const hasMultipart = String(req.headers['content-type'] || '').includes('multipart/form-data');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: hasMultipart ? '这是模力方舟转写的文字' : '', _multipart: hasMultipart }));
        return;
      }
      if (req.url.startsWith('/v1/chat/completions')) {
        log.push('llm:' + String(req.headers.authorization || '').replace('Bearer ', '').slice(-6));
        let model = '';
        try {
          model = JSON.parse(body).model || '';
        } catch {
          /* ignore */
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const chunks = ['[m=' + model + ']', '你好', '，我是', '本地 mock 模型。'];
        let i = 0;
        const timer = setInterval(() => {
          if (i < chunks.length) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: i === 0 ? '先想一想…' : '' } }] })}\n\n`);
            i++;
          } else {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 9 } })}\n\n`);
            res.write('data: [DONE]\n\n');
            clearInterval(timer);
            res.end();
          }
        }, 70);
        return;
      }
      if (req.url.startsWith('/search')) {
        log.push('search:' + body.slice(0, 60));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            results: [
              { title: '测试结果 A', url: 'https://example.com/a', content: '这是 A 的摘要' },
              { title: '测试结果 B', url: 'https://example.com/b', content: '这是 B 的摘要' },
            ],
          })
        );
        return;
      }
      if (req.url.startsWith('/parse') || req.url.startsWith('/ocr')) {
        log.push('parse');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: '这是从文件里解析出来的正文内容。' }));
        return;
      }
      if (req.url.startsWith('/tts')) {
        log.push('tts');
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
        return;
      }
      if (req.url.startsWith('/asr')) {
        log.push('asr');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: '这是语音识别出来的文字' }));
        return;
      }
      if (req.url === '/__log') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(log));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
  })
  .listen(9001, '127.0.0.1', () => console.log('mock upstream on :9001'));
