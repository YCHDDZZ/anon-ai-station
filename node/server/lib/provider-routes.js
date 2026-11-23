import {
  CATEGORIES,
  addProviderKey,
  createProvider,
  deleteProvider,
  deleteProviderById,
  deleteProviderKey,
  getProviderRowById,
  getRouting,
  listProviderKeys,
  listProviderRows,
  setRouting,
  testProvider,
  toPublic,
  toRuntime,
  updateProvider,
  upsertProvider,
} from './providers.js';
import { decryptSecret } from './crypto.js';
import { fetchModels } from './models.js';
import { E } from './errors.js';

/**
 * 个人 / 全局共用的「能力配置」路由。
 * 每个分类下允许多条 API，每条 API 允许多把 Key。
 */
export function mountProviderRoutes(app, { base, ownerType, guard, allowCreate = true }) {
  const ownerIdOf = (user) => (ownerType === 'global' ? null : user.id);
  const ensureCreateAllowed = () => {
    const open = typeof allowCreate === 'function' ? allowCreate() : allowCreate;
    if (!open) {
      throw E.forbidden('用户自建 API 功能将在后续版本开放，当前请使用管理员共享的算力');
    }
  };

  const entries = (user, category) =>
    listProviderRows(ownerType, ownerIdOf(user), category).map(toPublic);

  /* 拉取上游模型列表（支持未保存的地址 / Key） */
  app.post(`${base}/:category/models`, async (request, reply) => {
    await guard(request);
    const { category } = request.params;
    if (!CATEGORIES.includes(category)) throw E.badRequest('未知的能力类型');
    const b = request.body || {};

    let baseUrl = String(b.baseUrl || '').trim();
    let apiKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
    let extra = b.extra || null;

    if (b.providerId) {
      const row = getProviderRowById(b.providerId);
      if (!row || row.category !== category) throw E.notFound('接口配置不存在');
      if (row.owner_type !== ownerType || (ownerType === 'user' && row.owner_id !== request.user.id)) {
        throw E.forbidden('无权访问该配置');
      }
      baseUrl = baseUrl || row.base_url;
      if (!apiKey) apiKey = decryptSecret(row.api_key_enc);
      if (!extra) {
        try {
          extra = JSON.parse(row.extra_json || '{}');
        } catch {
          extra = {};
        }
      }
    }

    const out = await fetchModels({ baseUrl, apiKey, extra: extra || {} });
    return reply.send({ ok: true, ...out, category });
  });

  /* 调度策略 */
  app.patch(`${base}/:category/routing`, async (request, reply) => {
    const user = await guard(request);
    const { category } = request.params;
    if (!CATEGORIES.includes(category)) throw E.badRequest('未知的能力类型');
    const mode = setRouting(ownerType, ownerIdOf(user), category, request.body?.mode);
    return reply.send({ ok: true, routing: mode });
  });

  /* 给某条 API 追加 / 删除 Key */
  app.post(`${base}/:category/:id/keys`, async (request, reply) => {
    const user = await guard(request);
    const row = getProviderRowById(request.params.id);
    if (!row || row.category !== request.params.category) throw E.notFound('接口配置不存在');
    if (row.owner_type !== ownerType || (ownerType === 'user' && row.owner_id !== user.id)) {
      throw E.forbidden('无权修改该配置');
    }
    const b = request.body || {};
    addProviderKey(row.id, String(b.key || '').trim(), b.label);
    return reply.send({ ok: true, provider: toPublic(getProviderRowById(row.id)) });
  });

  app.delete(`${base}/:category/:id/keys/:keyId`, async (request, reply) => {
    const user = await guard(request);
    const row = getProviderRowById(request.params.id);
    if (!row || row.category !== request.params.category) throw E.notFound('接口配置不存在');
    if (row.owner_type !== ownerType || (ownerType === 'user' && row.owner_id !== user.id)) {
      throw E.forbidden('无权修改该配置');
    }
    deleteProviderKey(row.id, request.params.keyId);
    return reply.send({ ok: true, provider: toPublic(getProviderRowById(row.id)) });
  });

  /* 连通测试 */
  app.post(`${base}/:category/:id/test`, async (request, reply) => {
    const user = await guard(request);
    const row = getProviderRowById(request.params.id);
    if (!row || row.category !== request.params.category) throw E.notFound('接口配置不存在');
    if (row.owner_type !== ownerType || (ownerType === 'user' && row.owner_id !== user.id)) {
      throw E.forbidden('无权访问该配置');
    }
    const result = await testProvider(toRuntime(row), row.category);
    return reply.send({ ok: true, result });
  });

  /* 单条更新 / 删除 */
  app.put(`${base}/:category/:id`, async (request, reply) => {
    const user = await guard(request);
    const row = getProviderRowById(request.params.id);
    if (!row || row.category !== request.params.category) throw E.notFound('接口配置不存在');
    if (row.owner_type !== ownerType || (ownerType === 'user' && row.owner_id !== user.id)) {
      throw E.forbidden('无权修改该配置');
    }
    const b = request.body || {};
    const updated = updateProvider(row.id, {
      name: b.name,
      baseUrl: b.baseUrl,
      apiKey: b.apiKey,
      model: b.model,
      extra: b.extra,
      enabled: b.enabled,
      errorMessage: b.errorMessage,
    });
    return reply.send({ ok: true, provider: toPublic(updated) });
  });

  app.delete(`${base}/:category/:id`, async (request, reply) => {
    const user = await guard(request);
    const row = getProviderRowById(request.params.id);
    if (!row || row.category !== request.params.category) throw E.notFound('接口配置不存在');
    if (row.owner_type !== ownerType || (ownerType === 'user' && row.owner_id !== user.id)) {
      throw E.forbidden('无权修改该配置');
    }
    deleteProviderById(row.id);
    return reply.send({ ok: true });
  });

  /* 新建 */
  app.post(`${base}/:category`, async (request, reply) => {
    const user = await guard(request);
    ensureCreateAllowed();
    const { category } = request.params;
    if (!CATEGORIES.includes(category)) throw E.badRequest('未知的能力类型');
    const b = request.body || {};
    if (!b.baseUrl) throw E.badRequest('请填写接口地址');
    const row = createProvider({
      ownerType,
      ownerId: ownerIdOf(user),
      category,
      name: b.name,
      baseUrl: b.baseUrl,
      apiKey: b.apiKey,
      model: b.model,
      extra: b.extra,
      enabled: b.enabled,
      errorMessage: b.errorMessage,
    });
    return reply.send({ ok: true, provider: toPublic(row) });
  });

  /* 兼容旧接口：整体替换第一条（没有则新建） */
  app.put(`${base}/:category`, async (request, reply) => {
    const user = await guard(request);
    ensureCreateAllowed();
    const { category } = request.params;
    if (!CATEGORIES.includes(category)) throw E.badRequest('未知的能力类型');
    const b = request.body || {};
    const row = upsertProvider({
      ownerType,
      ownerId: ownerIdOf(user),
      category,
      name: b.name,
      baseUrl: b.baseUrl,
      apiKey: b.apiKey,
      model: b.model,
      extra: b.extra,
      enabled: b.enabled,
      errorMessage: b.errorMessage,
    });
    return reply.send({ ok: true, provider: toPublic(row) });
  });

  /* 兼容旧接口：整类清空 */
  app.delete(`${base}/:category`, async (request, reply) => {
    const user = await guard(request);
    deleteProvider(ownerType, ownerIdOf(user), request.params.category);
    return reply.send({ ok: true });
  });

  /* 列表（含全部条目与调度策略） */
  app.get(`${base}/:category`, async (request, reply) => {
    const user = await guard(request);
    const { category } = request.params;
    if (!CATEGORIES.includes(category)) throw E.badRequest('未知的能力类型');
    return reply.send({
      ok: true,
      category,
      routing: getRouting(ownerType, ownerIdOf(user), category),
      entries: entries(user, category),
    });
  });
}

export { listProviderKeys };
