import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './lib/errors.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AppError('TOO_LARGE', '请求体超过大小限制', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function matchRoute(route, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== route.segs.length) return null;
  const params = {};
  for (let i = 0; i < route.segs.length; i++) {
    const seg = route.segs[i];
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]);
    else if (seg !== parts[i]) return null;
  }
  return params;
}

export function createApp({ bodyLimit = 2 * 1024 * 1024, fileLimit = 64 * 1024 * 1024 } = {}) {
  const routes = [];
  const hooks = [];
  let errorHandler = null;
  let notFoundHandler = null;
  let staticRoot = null;

  function addRoute(method, pattern, handler, opts = {}) {
    const segs = pattern.split('/').filter(Boolean);
    routes.push({ method, pattern, segs, handler, opts });
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    const request = req;
    request.raw = req;
    request.query = Object.fromEntries(url.searchParams);
    request.params = {};
    request.cookies = parseCookies(req.headers.cookie);
    request.user = null;
    request.body = undefined;

    const reply = {
      raw: res,
      statusCode: 200,
      headers: {},
      sent: false,
      hijacked: false,
      code(n) {
        this.statusCode = n;
        return this;
      },
      status(n) {
        return this.code(n);
      },
      header(k, v) {
        this.headers[k] = v;
        return this;
      },
      type(t) {
        this.headers['Content-Type'] = t;
        return this;
      },
      setCookie(name, value, opts) {
        const list = this.headers['Set-Cookie'] || [];
        list.push(serializeCookie(name, value, opts));
        this.headers['Set-Cookie'] = list;
        return this;
      },
      clearCookie(name, opts = {}) {
        return this.setCookie(name, '', { ...opts, maxAge: 0 });
      },
      hijack() {
        this.hijacked = true;
        this.sent = true;
      },
      send(payload) {
        if (this.sent) return this;
        this.sent = true;
        for (const [k, v] of Object.entries(this.headers)) res.setHeader(k, v);
        if (Buffer.isBuffer(payload)) {
          if (!this.headers['Content-Type']) res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Length', payload.length);
          res.writeHead(this.statusCode);
          res.end(payload);
          return this;
        }
        let body;
        if (typeof payload === 'string') {
          body = payload;
          if (!this.headers['Content-Type']) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        } else {
          body = JSON.stringify(payload);
          if (!this.headers['Content-Type']) res.setHeader('Content-Type', 'application/json; charset=utf-8');
        }
        res.setHeader('Content-Length', Buffer.byteLength(body));
        res.writeHead(this.statusCode);
        res.end(body);
        return this;
      },
    };

    try {
      for (const hook of hooks) await hook(request, reply);
      if (reply.sent) return;

      let matched = null;
      let allowed = false;
      for (const route of routes) {
        const params = matchRoute(route, pathname);
        if (!params) continue;
        if (route.method === req.method) {
          matched = { route, params };
          break;
        }
        allowed = true;
      }

      if (!matched) {
        const isApiPath = pathname === '/api' || pathname.startsWith('/api/');
        // 只有前端路由才做 SPA 回退；/api/* 未命中必须返回 JSON 404，不能回 index.html
        if (!isApiPath && staticRoot && (req.method === 'GET' || req.method === 'HEAD')) {
          const served = await serveStatic(staticRoot, pathname, res);
          if (served) return;
        }
        if (notFoundHandler && !isApiPath) {
          await notFoundHandler(request, reply);
          return;
        }
        throw new AppError('NOT_FOUND', allowed ? '请求方法不被支持' : '接口不存在', allowed ? 405 : 404);
      }

      request.params = matched.params;

      const method = req.method;
      const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
      if (hasBody) {
        const isJson = (req.headers['content-type'] || '').includes('application/json');
        const limit = isJson ? matched.route.opts?.bodyLimit || bodyLimit : fileLimit;
        const buf = await readBody(req, limit);
        if (isJson) {
          try {
            request.body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
          } catch {
            throw new AppError('BAD_JSON', '请求体不是合法 JSON', 400);
          }
        } else {
          request.body = buf;
        }
      }

      request.file = async () => {
        const buf = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        return {
          filename: (() => {
            const raw = req.headers['x-file-name'] || 'upload.bin';
            try {
              return decodeURIComponent(raw);
            } catch {
              return raw;
            }
          })(),
          mimetype: req.headers['x-file-type'] || 'application/octet-stream',
          buffer: buf,
          toBuffer: async () => buf,
        };
      };

      await matched.route.handler(request, reply);
      if (!reply.sent) reply.send({ ok: true });
    } catch (err) {
      if (res.headersSent || reply.sent) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
        return;
      }
      const handler = errorHandler || defaultErrorHandler;
      await handler(err, request, reply);
    }
  }

  return {
    addHook(name, fn) {
      if (name === 'onRequest') hooks.push(fn);
    },
    get: (p, h, o) => addRoute('GET', p, h, o),
    post: (p, h, o) => addRoute('POST', p, h, o),
    put: (p, h, o) => addRoute('PUT', p, h, o),
    patch: (p, h, o) => addRoute('PATCH', p, h, o),
    delete: (p, h, o) => addRoute('DELETE', p, h, o),
    setErrorHandler(fn) {
      errorHandler = fn;
    },
    setNotFoundHandler(fn) {
      notFoundHandler = fn;
    },
    serveStatic(dir) {
      staticRoot = dir;
    },
    listen({ port, host = '0.0.0.0' }) {
      return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
          handle(req, res).catch((err) => {
            console.error(err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL', message: '服务内部错误' } }));
            } else {
              res.end();
            }
          });
        });
        server.on('error', reject);
        server.listen(port, host, () => resolve(server));
      });
    },
  };
}

const STATIC_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate',
};

const HTML_CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; font-src 'self' data:; media-src 'self' blob:; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

/** 把 HTML 里的 __V_APP__ / __V_CSS__ 换成文件 mtime，强制刷新缓存 */
function injectAssetVersion(buf, root) {
  const v = (name) => {
    try {
      return Math.round(fs.statSync(path.join(root, name)).mtimeMs).toString(36);
    } catch {
      return '0';
    }
  };
  return Buffer.from(
    String(buf)
      .replace(/__V_APP__/g, v('app.js'))
      .replace(/__V_CSS__/g, v('styles.css')),
    'utf8'
  );
}

async function serveStatic(root, pathname, res) {
  const safePath = pathname.replace(/\.\.+/g, '').replace(/\/+$/, '') || '/index.html';
  let file = path.join(root, safePath);
  if (pathname === '/' || pathname === '') file = path.join(root, 'index.html');
  try {
    const stat = await fsp.stat(file);
    if (stat.isDirectory()) file = path.join(file, 'index.html');
    let data = await fsp.readFile(file);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html') data = injectAssetVersion(data, root);
    res.writeHead(200, {
      ...STATIC_SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ...(ext === '.html' ? { 'Content-Security-Policy': HTML_CSP } : {}),
      // JS/CSS 走协商缓存；HTML 不缓存，避免升级后仍加载旧入口
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
    });
    res.end(data);
    return true;
  } catch {
    // SPA 回退
    const indexPath = path.join(root, 'index.html');
    if (fs.existsSync(indexPath)) {
      const data = injectAssetVersion(await fsp.readFile(indexPath), root);
      res.writeHead(200, {
        ...STATIC_SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': HTML_CSP,
        'Cache-Control': 'no-store',
      });
      res.end(data);
      return true;
    }
    return false;
  }
}

function defaultErrorHandler(err, _request, reply) {
  if (err instanceof AppError) {
    return reply.code(err.status).send({
      ok: false,
      error: { code: err.code, message: err.message, detail: err.extra ?? null },
    });
  }
  console.error(err);
  return reply.code(500).send({ ok: false, error: { code: 'INTERNAL', message: err?.message || '服务内部错误' } });
}
