import { setting } from '../db.js';
import { resolveAttempts } from './providers.js';

/** 汇总所有可用 LLM 模型，先按线路分组排序，再按组内顺序排序 */
export function collectModels(user) {
  const seen = new Set();
  const items = [];
  let defaultModel = '';

  for (const a of resolveAttempts(user, 'llm')) {
    if (!defaultModel) defaultModel = a.model || '';
    const extraModels = Array.isArray(a.extra?.models) ? a.extra.models : [];
    const candidates = extraModels.length ? extraModels : a.model ? [a.model] : [];
    for (const m of candidates) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      const cfg = a.extra?.modelConfig?.[m] || {};
      items.push({
        model: m,
        providerId: a.id,
        providerName: a.name || (a.ownerType === 'user' ? '我的线路' : '共享线路'),
        ownerType: a.ownerType,
        label: String(cfg.label || ''),
        labelColor: String(cfg.labelColor || ''),
        effort: String(cfg.effort || ''),
        context: Number(cfg.context) || 0,
      });
    }
  }

  const groups = [];
  const byId = new Map();
  for (const it of items) {
    let g = byId.get(it.providerId);
    if (!g) {
      g = { providerId: it.providerId, providerName: it.providerName, models: [] };
      byId.set(it.providerId, g);
      groups.push(g);
    }
    g.models.push(it);
  }

  let saved = {};
  try {
    saved = JSON.parse(setting('modelGroups', '{}'));
  } catch {
    saved = {};
  }
  const provOrder = Array.isArray(saved.providers) ? saved.providers.map(Number) : [];
  const modelOrder = saved.models && typeof saved.models === 'object' ? saved.models : {};

  let legacy = [];
  try {
    legacy = JSON.parse(setting('modelOrder', '[]'));
  } catch {
    legacy = [];
  }
  const legacyPos = new Map();
  if (Array.isArray(legacy)) legacy.forEach((n, i) => legacyPos.set(String(n), i));

  if (provOrder.length) {
    const pos = new Map(provOrder.map((id, i) => [id, i]));
    groups.sort((a, b) => (pos.get(a.providerId) ?? 999) - (pos.get(b.providerId) ?? 999));
  }

  for (const g of groups) {
    const names = Array.isArray(modelOrder[g.providerId]) ? modelOrder[g.providerId] : [];
    if (names.length) {
      const pos = new Map(names.map((n, i) => [String(n), i]));
      g.models.sort((a, b) => (pos.get(a.model) ?? 999) - (pos.get(b.model) ?? 999));
    } else if (legacyPos.size) {
      g.models.sort((a, b) => (legacyPos.get(a.model) ?? 999) - (legacyPos.get(b.model) ?? 999));
    }
  }

  const flat = groups.flatMap((g) => g.models);
  return { list: flat.map((i) => i.model), items: flat, groups, defaultModel };
}
