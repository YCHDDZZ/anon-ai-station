import { run } from '../db.js';
import { requireUser, publicUser } from '../lib/auth.js';
import {
  CATEGORIES,
  CATEGORY_META,
  DEFAULT_EXTRA,
  getRouting,
  listProviderRows,
  resolveAttempts,
  toPublic,
} from '../lib/providers.js';
import { mountProviderRoutes } from '../lib/provider-routes.js';
import { setting } from '../db.js';
import { E } from '../lib/errors.js';
import { collectModels } from '../lib/model-order.js';
import { listPersonasFor } from '../lib/personas.js';
import { userQuotaSummary } from '../lib/quota.js';

/** 把某分类下所有可用条目汇总成前端可用的「类别视图」 */
function categoryView(user, c) {
  const own = listProviderRows('user', user.id, c).map(toPublic);
  const shared = listProviderRows('global', null, c).map(toPublic);
  return {
    key: c,
    ...CATEGORY_META[c],
    defaults: DEFAULT_EXTRA[c],
    entries: own,
    sharedEntries: shared,
    shared: shared[0] || null,
    sharedAvailable: shared.some((r) => r.enabled),
    own: own[0] || null,
    routing: getRouting('user', user.id, c),
    sharedRouting: getRouting('global', null, c),
  };
}

export default async function meRoutes(app) {
  /* 个人资料 + 能力总览 */
  app.get('/api/me', async (request, reply) => {
    const user = await requireUser(request);

    const ttsAttempts = resolveAttempts(user, 'tts');
    const ttsFirst = ttsAttempts[0] || null;

    return reply.send({
      ok: true,
      user: publicUser(user),
      providerPreference: user.provider_preference || 'own_first',
      personas: listPersonasFor(user),
      llmModels: collectModels(user),
      ttsVoices: {
        list: Array.isArray(ttsFirst?.extra?.voices) ? ttsFirst.extra.voices : [],
        defaultVoice: ttsFirst?.extra?.defaultVoice || '',
      },
      categories: CATEGORIES.map((c) => categoryView(user, c)),
    });
  });

  /* 能力配置：多 API / 多 Key / 模型列表 / 调度策略 */
  mountProviderRoutes(app, {
    base: '/api/me/providers',
    ownerType: 'user',
    guard: async (request) => requireUser(request),
    allowCreate: () => setting('userProvidersOpen', 'false') === 'true',
  });

  /* 我的共享额度（按账号数平分后的份额与用量） */
  app.get('/api/me/quota', async (request, reply) => {
    const user = await requireUser(request);
    return reply.send({ ok: true, ...userQuotaSummary(user) });
  });

  /* 优先策略：自有优先 / 共享优先 */
  app.patch('/api/me/preference', async (request, reply) => {
    const user = await requireUser(request);
    const pref = request.body?.providerPreference;
    if (!['own_first', 'shared_first'].includes(pref)) throw E.badRequest('无效的优先策略');
    run('UPDATE users SET provider_preference = ? WHERE id = ?', pref, user.id);
    return reply.send({ ok: true, providerPreference: pref });
  });

  /* 全站共享能力的可用性（不含任何密钥信息） */
  app.get('/api/me/shared-inventory', async (request, reply) => {
    await requireUser(request);
    const inventory = Object.fromEntries(
      CATEGORIES.map((c) => [
        c,
        listProviderRows('global', null, c).some((r) => r.enabled),
      ])
    );
    return reply.send({ ok: true, inventory });
  });
}
