import crypto from 'node:crypto';
import { AppError } from './errors.js';

/**
 * 阿里云文档智能（文档解析·大模型版）适配器。
 *
 * 官方文档：
 *  - 产品/计费：https://help.aliyun.com/zh/document-mind/product-overview/billing
 *  - 接入流程：https://help.aliyun.com/zh/document-mind/developer-reference/document-parsing-large-model-version
 *  - V3 签名：https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
 *
 * 接口形态是 RPC 风格 + 表单请求体 + ACS3-HMAC-SHA256 签名，本地文件需要先走
 * AuthorizeFileUpload 拿 OSS 临时直传凭证，上传后再把 OSS 地址交给 SubmitDocParserJob。
 * 整个流程没有官方 Node SDK 可用（项目零依赖），所以这里手写签名与三步调用。
 */

const DOCMIND_HOST = 'docmind-api.cn-hangzhou.aliyuncs.com';
const DOCMIND_VERSION = '2022-07-11';
const OPENAPI_HOST = 'openplatform.aliyuncs.com';
const OPENAPI_VERSION = '2019-12-19';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const sha256Hex = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const hmacHex = (secret, text) => crypto.createHmac('sha256', secret).update(text, 'utf8').digest('hex');

/** RFC3986：空格 %20、星号 %2A、波浪号保留 */
const rfc3986 = (value) =>
  encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

const isoSeconds = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** 支持「AccessKeyId:AccessKeySecret」或 {"accessKeyId":"…","accessKeySecret":"…"} */
export function parseCredential(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    throw new AppError('BAD_CREDENTIAL', '未配置阿里云 AccessKey（格式：AccessKeyId:AccessKeySecret）', 400);
  }
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      const id = obj.accessKeyId || obj.AccessKeyId || obj.id || '';
      const secret = obj.accessKeySecret || obj.AccessKeySecret || obj.secret || '';
      if (id && secret) return { accessKeyId: String(id).trim(), accessKeySecret: String(secret).trim() };
    } catch {
      /* 落到下面的冒号解析 */
    }
    throw new AppError('BAD_CREDENTIAL', 'AccessKey JSON 需包含 accessKeyId 与 accessKeySecret', 400);
  }
  const idx = text.indexOf(':');
  if (idx <= 0 || idx === text.length - 1) {
    throw new AppError('BAD_CREDENTIAL', '阿里云 AccessKey 需填写为 AccessKeyId:AccessKeySecret', 400);
  }
  return {
    accessKeyId: text.slice(0, idx).trim(),
    accessKeySecret: text.slice(idx + 1).trim(),
  };
}

/**
 * ACS3-HMAC-SHA256 签名。
 * 注意两点（官方文档的坑）：CanonicalHeaders 每条都以 \n 结尾，再拼 CanonicalRequest 时又补一个 \n，
 * 因此头部与 SignedHeaders 之间会出现连续两个换行。
 */
export function signV3({
  credential,
  method = 'POST',
  host,
  uri = '/',
  query = {},
  headers = {},
  payload = '',
  date,
  nonce,
}) {
  const payloadHash = payload ? sha256Hex(payload) : EMPTY_SHA256;
  const all = {
    host,
    'x-acs-content-sha256': payloadHash,
    'x-acs-date': date || isoSeconds(),
    'x-acs-signature-nonce': nonce || crypto.randomUUID(),
    ...headers,
  };
  const names = Object.keys(all)
    .map((k) => k.toLowerCase())
    .sort();
  const lowered = {};
  for (const [k, v] of Object.entries(all)) lowered[k.toLowerCase()] = String(v).trim();

  const canonicalHeaders = names.map((n) => `${n}:${lowered[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const queryKeys = Object.keys(query)
    .filter((k) => query[k] !== undefined && query[k] !== null)
    .sort();
  const canonicalQuery = queryKeys.map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`).join('&');

  const canonicalRequest = [
    method,
    uri,
    canonicalQuery,
    canonicalHeaders, // 自带结尾换行
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`;
  const signature = hmacHex(credential.accessKeySecret, stringToSign);
  if (process.env.DOCMIND_DEBUG) {
    console.error('[docmind] canonicalRequest >>>\n' + canonicalRequest.replace(/\n/g, '\\n\n'));
    console.error('[docmind] stringToSign >>>\n' + stringToSign);
  }

  return {
    canonicalRequest,
    stringToSign,
    signature,
    headers: {
      'x-acs-content-sha256': payloadHash,
      'x-acs-date': lowered['x-acs-date'],
      'x-acs-signature-nonce': lowered['x-acs-signature-nonce'],
      authorization: `ACS3-HMAC-SHA256 Credential=${credential.accessKeyId},SignedHeaders=${signedHeaders},Signature=${signature}`,
    },
  };
}

function pick(obj, name) {
  if (!obj) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

/** 调用一个 RPC 风格接口（默认 POST 表单，GET 时业务参数进 query） */
async function rpc({ credential, host, action, version, method = 'POST', params = {}, query = {}, timeoutMs = 30000 }) {
  const useGet = method === 'GET';
  const payload = useGet || Object.keys(params).length === 0 ? '' : new URLSearchParams(params).toString();
  const queryParams = useGet ? { ...query, ...params } : query;

  const signed = signV3({
    credential,
    method,
    host,
    query: queryParams,
    headers: {
      'x-acs-action': action,
      'x-acs-version': version,
      ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    payload,
  });

  const qs = Object.keys(queryParams).length
    ? '?' +
      Object.keys(queryParams)
        .map((k) => `${rfc3986(k)}=${rfc3986(queryParams[k])}`)
        .join('&')
    : '';
  let res;
  try {
    res = await fetch(`https://${host}${qs}`, {
      method,
      headers: {
        host,
        'x-acs-action': action,
        'x-acs-version': version,
        'x-acs-content-sha256': signed.headers['x-acs-content-sha256'],
        'x-acs-date': signed.headers['x-acs-date'],
        'x-acs-signature-nonce': signed.headers['x-acs-signature-nonce'],
        authorization: signed.headers.authorization,
        ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: payload || undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AppError('PROVIDER_UNREACHABLE', `无法连接阿里云文档智能：${err?.message || err}`, 502);
  }

  const data = await readJson(res);
  const code = res.status;
  const bizCode = pick(data, 'Code') ?? pick(data, 'code');
  if (!res.ok || (bizCode && String(bizCode) !== '200' && String(bizCode) !== 'Success')) {
    const message = pick(data, 'Message') || pick(data, 'message') || `HTTP ${code}`;
    const requestId = pick(data, 'RequestId') || pick(data, 'requestId') || '';
    throw new AppError(
      'PROVIDER_HTTP_ERROR',
      `阿里云文档智能返回 ${code}${bizCode ? `/${bizCode}` : ''}：${message}${requestId ? `（RequestId ${requestId}）` : ''}`,
      502,
      { upstreamStatus: code, code: bizCode, requestId }
    );
  }
  return data;
}

/** 申请 OSS 临时直传凭证（不计费，可当作连通性测试） */
export async function authorizeFileUpload(credential) {
  const data = await rpc({
    credential,
    host: OPENAPI_HOST,
    action: 'AuthorizeFileUpload',
    version: OPENAPI_VERSION,
    method: 'GET',
    params: { Product: 'docmind-api', RegionId: 'cn-hangzhou' },
  });
  const bucket = pick(data, 'Bucket');
  const endpoint = pick(data, 'Endpoint');
  const accessKeyId = pick(data, 'AccessKeyId');
  const policy = pick(data, 'EncodedPolicy') || pick(data, 'Policy');
  const signature = pick(data, 'Signature');
  const objectKey = pick(data, 'ObjectKey');
  if (!bucket || !endpoint || !accessKeyId || !policy || !signature || !objectKey) {
    throw new AppError('PROVIDER_HTTP_ERROR', '阿里云未返回完整的上传凭证，请检查 AccessKey 权限', 502, { data });
  }
  return { bucket, endpoint, accessKeyId, policy, signature, objectKey };
}

async function uploadToOss(ticket, buffer, filename, timeoutMs) {
  const form = new FormData();
  form.append('OSSAccessKeyId', ticket.accessKeyId);
  form.append('policy', ticket.policy);
  form.append('Signature', ticket.signature);
  form.append('key', ticket.objectKey);
  form.append('success_action_status', '201');
  form.append('file', new Blob([buffer], { type: 'application/octet-stream' }), filename);

  const url = `https://${ticket.bucket}.${ticket.endpoint}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new AppError('PROVIDER_UNREACHABLE', `上传文件到阿里云 OSS 失败：${err?.message || err}`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AppError('PROVIDER_HTTP_ERROR', `上传文件到阿里云 OSS 失败（HTTP ${res.status}）${text.slice(0, 200)}`, 502);
  }
  return `${url}/${ticket.objectKey}`;
}

const MIME_EXT = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
};

/** 提交解析任务，返回业务单号 Id */
export async function submitJob(credential, { buffer, name, mime, llmEnhancement = false, pageIndex = '' }, timeoutMs = 120000) {
  const ticket = await authorizeFileUpload(credential);
  const fileUrl = await uploadToOss(ticket, buffer, name || 'upload.bin', timeoutMs);

  const rawName = name || 'upload.bin';
  const rawExt = String(rawName).split('.').pop().toLowerCase();
  const usable = rawExt && rawExt !== rawName && rawExt !== 'bin';
  // FileName 与 FileNameExtension 官方要求二选一：能拿到带后缀的文件名就传 FileName
  const params = { FileUrl: fileUrl };
  if (usable) params.FileName = rawName;
  else params.FileNameExtension = MIME_EXT[mime] || 'pdf';
  if (llmEnhancement) params.LlmEnhancement = 'true';
  if (pageIndex) params.PageIndex = pageIndex;

  const data = await rpc({
    credential,
    host: DOCMIND_HOST,
    action: 'SubmitDocParserJob',
    version: DOCMIND_VERSION,
    params,
    timeoutMs,
  });
  const id = pick(pick(data, 'Data') || {}, 'Id');
  if (!id) throw new AppError('PROVIDER_HTTP_ERROR', '阿里云未返回解析任务 Id', 502, { data });
  return String(id);
}

/** 查询任务状态 */
export async function queryStatus(credential, id, timeoutMs = 30000) {
  const data = await rpc({
    credential,
    host: DOCMIND_HOST,
    action: 'QueryDocParserStatus',
    version: DOCMIND_VERSION,
    params: { Id: id },
    timeoutMs,
  });
  const body = pick(data, 'Data') || {};
  return {
    status: String(pick(body, 'Status') || '').toLowerCase(),
    pageCount: Number(pick(body, 'PageCountEstimate')) || 0,
    progress: Number(pick(body, 'Processing')) || 0,
    raw: body,
  };
}

/** 分页拉取解析结果，返回 { layouts, pages } */
export async function fetchResult(credential, id, { stepSize = 100, maxBlocks = 6000 } = {}) {
  const layouts = [];
  const seen = new Set();
  for (let offset = 0; offset < maxBlocks; offset += stepSize) {
    const data = await rpc({
      credential,
      host: DOCMIND_HOST,
      action: 'GetDocParserResult',
      version: DOCMIND_VERSION,
      params: { Id: id, LayoutNum: String(offset), LayoutStepSize: String(stepSize) },
      timeoutMs: 60000,
    });
    const body = pick(data, 'Data') || {};
    const list = pick(body, 'layouts') || pick(body, 'Layouts') || [];
    if (!Array.isArray(list) || list.length === 0) break;
    for (const item of list) {
      const key = item.uniqueId || `${item.pageNum}-${item.index}-${layouts.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      layouts.push(item);
    }
    if (list.length < stepSize) break;
  }
  layouts.sort((a, b) => {
    const pa = Number(a.pageNum) || 0;
    const pb = Number(b.pageNum) || 0;
    if (pa !== pb) return pa - pb;
    return (Number(a.index) || 0) - (Number(b.index) || 0);
  });
  const pages = layouts.reduce((max, l) => Math.max(max, (Number(l.pageNum) || 0) + 1), 0);
  return { layouts, pages };
}

/** 把 layouts 拼成 Markdown 文本 */
export function layoutsToText(layouts) {
  const parts = [];
  for (const item of layouts) {
    const md = typeof item.markdownContent === 'string' ? item.markdownContent.trim() : '';
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    const piece = md || text;
    if (piece) parts.push(piece);
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function waitForJob(credential, id, { timeoutMs = 180000, intervalMs = 2000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const st = await queryStatus(credential, id);
    if (st.status === 'success') return st;
    if (st.status === 'fail' || st.status === 'failed') {
      throw new AppError('PROVIDER_HTTP_ERROR', '阿里云文档解析失败，请换一份文件或稍后重试', 502, { status: st.raw });
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new AppError('PROVIDER_TIMEOUT', '阿里云文档解析超时（超过 3 分钟），可稍后在后台重试', 504);
}

/** 一站式：提交 → 轮询 → 拉结果 → 拼 Markdown */
export async function parseWithDocmind(provider, file, options = {}) {
  const credential = parseCredential(provider.api_key);
  const extra = provider.extra || {};
  const id = await submitJob(credential, {
    buffer: file.buffer,
    name: file.name,
    mime: file.mime,
    llmEnhancement: Boolean(extra.llmEnhancement),
    pageIndex: extra.pageIndex || '',
  });
  const status = await waitForJob(credential, id, {
    timeoutMs: Number(extra.pollTimeoutMs) || 180000,
  });
  const { layouts, pages } = await fetchResult(credential, id, {
    stepSize: Math.min(1000, Math.max(10, Number(extra.layoutStepSize) || 100)),
  });
  const text = layoutsToText(layouts);
  if (!text) throw new AppError('PROVIDER_HTTP_ERROR', '阿里云没有解析出任何文本内容', 502);
  // 计费页数以服务端返回的页数为准，layout 覆盖不全时用任务状态兜底
  const billed = Math.max(1, pages || 0, Number(status.pageCount) || 0);
  return { id, text, pages: billed };
}
