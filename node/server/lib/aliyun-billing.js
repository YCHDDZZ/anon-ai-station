import { signV3, parseCredential } from './docmind.js';
import { AppError } from './errors.js';

/**
 * 阿里云费用中心（BSS OpenAPI）对账。
 *
 * 文档智能（docmind-api）**没有公开的「免费额度已用页数」接口**（SDK/OpenAPI 里只有提交、查询、取结果），
 * 控制台的「监控统计」也不是 OpenAPI。能通过 AccessKey 拿到的最可靠云端信号是账单：
 *   - 免费额度内：本月不会出现文档智能的后付费账单条目；
 *   - 超出免费额度：账单单据里会出现文档智能的按量付费金额（账单延迟约 24 小时）。
 * 因此这里用「账单是否出现扣费」作为云端兜底，页数仍以本地按官方口径的计量为准。
 */

const HOST = 'business.aliyuncs.com';
const VERSION = '2017-12-14';

async function callBss(credential, action, params, timeoutMs = 30000) {
  const payload = new URLSearchParams(params).toString();
  const signed = signV3({
    credential,
    host: HOST,
    headers: {
      'x-acs-action': action,
      'x-acs-version': VERSION,
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload,
  });

  let res;
  try {
    res = await fetch(`https://${HOST}/`, {
      method: 'POST',
      headers: {
        host: HOST,
        'x-acs-action': action,
        'x-acs-version': VERSION,
        'x-acs-content-sha256': signed.headers['x-acs-content-sha256'],
        'x-acs-date': signed.headers['x-acs-date'],
        'x-acs-signature-nonce': signed.headers['x-acs-signature-nonce'],
        authorization: signed.headers.authorization,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AppError('PROVIDER_UNREACHABLE', `无法连接阿里云费用中心：${err?.message || err}`, 502);
  }

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok || data.Success === false) {
    const message = data.Message || data.message || `HTTP ${res.status}`;
    throw new AppError('PROVIDER_HTTP_ERROR', `阿里云费用中心返回 ${res.status}：${message}`, 502, {
      upstreamStatus: res.status,
      code: data.Code,
    });
  }
  return data;
}

/** 账单里筛出文档智能（产品名/产品代码没有固定值，按关键词兜底） */
export function isDocmindBillItem(item) {
  const hay = `${item.ProductName || ''} ${item.ProductCode || ''} ${item.PipCode || ''} ${item.BizType || ''}`;
  return /文档|docmind|doc\s*mind|document\s*mind/i.test(hay);
}

export async function queryAccountBill(credential, period) {
  const items = [];
  let page = 1;
  let total = 1;
  while (items.length < total && page <= 20) {
    const data = await callBss(credential, 'QueryAccountBill', {
      BillingCycle: period,
      PageNum: String(page),
      PageSize: '300',
      IsGroupByProduct: 'false',
    });
    const d = data.Data || {};
    total = Number(d.TotalCount) || 0;
    const list = d.Items?.Item;
    if (!Array.isArray(list) || list.length === 0) break;
    items.push(...list);
    page += 1;
  }
  return { items, total };
}

export async function queryResourcePackages(credential) {
  const data = await callBss(credential, 'QueryResourcePackageInstances', {
    PageNum: '1',
    PageSize: '50',
  });
  const list = data.Data?.Instances?.Instance;
  return Array.isArray(list) ? list : [];
}

/**
 * 云端核对：本月文档智能是否已经产生后付费。
 * 失败不抛给前端页面（返回 supported:false + error），避免一个权限问题把整个面板打挂。
 */
export async function checkDocmindBilling(provider, period) {
  const checkedAt = Date.now();
  let credential;
  try {
    credential = parseCredential(provider.api_key);
  } catch (err) {
    return { supported: false, checkedAt, period, error: err.message };
  }

  try {
    const [{ items }, packages] = await Promise.all([
      queryAccountBill(credential, period),
      queryResourcePackages(credential).catch(() => []),
    ]);
    const matched = items.filter(isDocmindBillItem);
    const amount = matched.reduce((sum, it) => sum + (Number(it.PretaxAmount) || 0), 0);
    const docPackages = packages.filter(isDocmindBillItem);

    return {
      supported: true,
      checkedAt,
      period,
      currency: matched[0]?.Currency || 'CNY',
      charged: amount > 0.0001,
      amount: Number(amount.toFixed(2)),
      items: matched.slice(0, 10).map((it) => ({
        productName: it.ProductName || '',
        productCode: it.ProductCode || '',
        amount: Number(it.PretaxAmount) || 0,
        currency: it.Currency || 'CNY',
      })),
      packages: docPackages.slice(0, 10).map((p) => ({
        name: p.PackageName || p.ProductName || p.InstanceId || '资源包',
        total: p.TotalAmount ?? p.Capacity ?? null,
        remaining: p.RemainingAmount ?? p.Remaining ?? null,
        unit: p.AmountUnit || p.Unit || '',
        expiry: p.ExpiryTime || null,
      })),
      note: amount > 0.0001
        ? '云端已出现文档智能的后付费扣费，说明本月免费额度已用完；建议立即停用该接口。'
        : '本月账单里没有文档智能的扣费记录，说明仍在免费额度内（账单数据约有 24 小时延迟）。',
    };
  } catch (err) {
    return { supported: false, checkedAt, period, error: err?.message || String(err) };
  }
}
