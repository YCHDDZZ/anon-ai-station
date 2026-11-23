import { all, get, run, now } from '../db.js';
import { E } from './errors.js';

/** 默认角色：千早爱音。首次启动写入 global 作用域，管理员可改可删。 */
export const DEFAULT_PERSONA = {
  name: '千早爱音',
  description: '羽丘女子学园高一学生，MyGO!!!!! 的吉他手，开朗爱说话、爱面子也很在意朋友',
  prompt: `你是「千早爱音」（千早 愛音 / Chihaya Anon），羽丘女子学园的高一学生，乐队 MyGO!!!!! 的吉他手。

【性格】
- 开朗、话多、有点小自恋，喜欢被夸，也很乐意夸别人
- 表面怕麻烦、爱面子，实际上很在意身边的人，关键时刻会站到前面
- 说话直率，偶尔冒失；被指出错误时会先嘴硬两句，再悄悄改过来
- 喜欢可爱的东西、拍照和发社交平台；学习不太行

【说话方式】
- 用第一人称「我」，语气轻快，句尾常带「～」「呢」「吧」
- 会主动接话、提建议，也偶尔吐槽，但不会刻薄
- 一段话里最多用一个颜文字，不堆砌
- 聊到专业问题时会收起玩笑，认真把事说清楚

【行为准则】
- 始终以千早爱音的身份和口吻回答，不要自称 AI、语言模型或助手
- 遇到违法、危险或伤害他人的请求，用角色口吻礼貌拒绝，并把话题引开
- 不编造事实；不清楚的事直接说「这个我不太清楚」
- 回复简洁自然，避免长篇自我独白`,
};

export function ensureDefaultPersona() {
  const row = get("SELECT COUNT(*) AS c FROM personas WHERE owner_type = 'global'");
  if (row && row.c > 0) return;
  const ts = now();
  run(
    `INSERT INTO personas(owner_type, owner_id, name, description, prompt, enabled, sort, created_at, updated_at)
     VALUES('global', NULL, ?, ?, ?, 1, 0, ?, ?)`,
    DEFAULT_PERSONA.name,
    DEFAULT_PERSONA.description,
    DEFAULT_PERSONA.prompt,
    ts,
    ts
  );
  console.log(`[种子] 已创建默认角色：${DEFAULT_PERSONA.name}`);
}

export function toPublicPersona(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.owner_type,
    name: row.name,
    description: row.description || '',
    prompt: row.prompt,
    enabled: Boolean(row.enabled),
    isDefault: row.owner_type === 'global' && row.sort === 0,
  };
}

/** 普通用户的可用角色 = 启用的全局角色 + 自己的角色 */
export function listPersonasFor(user) {
  const global = all(
    "SELECT * FROM personas WHERE owner_type = 'global' AND enabled = 1 ORDER BY sort, id"
  ).map(toPublicPersona);
  const own = all(
    "SELECT * FROM personas WHERE owner_type = 'user' AND owner_id = ? AND enabled = 1 ORDER BY id",
    user.id
  ).map(toPublicPersona);
  return { global, own };
}

/** 管理界面用：包含停用的 */
export function listAllPersonas(ownerType, ownerId = null) {
  return all(
    'SELECT * FROM personas WHERE owner_type = ? AND COALESCE(owner_id, 0) = ? ORDER BY sort, id',
    ownerType,
    ownerId ?? 0
  ).map(toPublicPersona);
}

/** 取角色：全局任意启用角色，或自己的角色 */
export function resolvePersona(user, id) {
  const pid = Number(id);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const row = get('SELECT * FROM personas WHERE id = ?', pid);
  if (!row || !row.enabled) return null;
  if (row.owner_type === 'global') return row;
  if (row.owner_type === 'user' && row.owner_id === user.id) return row;
  return null;
}

export function createPersona({ ownerType, ownerId = null, name, description = '', prompt, sort = 0 }) {
  const n = String(name || '').trim();
  const p = String(prompt || '').trim();
  if (!n) throw E.badRequest('角色名称不能为空');
  if (n.length > 40) throw E.badRequest('角色名称不能超过 40 字');
  if (!p) throw E.badRequest('角色提示词不能为空');
  if (p.length > 8000) throw E.badRequest('提示词过长（上限 8000 字）');
  const ts = now();
  const info = run(
    `INSERT INTO personas(owner_type, owner_id, name, description, prompt, enabled, sort, created_at, updated_at)
     VALUES(?,?,?,?,?,1,?,?,?)`,
    ownerType,
    ownerId,
    n,
    String(description || '').trim().slice(0, 200),
    p,
    Number(sort) || 0,
    ts,
    ts
  );
  return get('SELECT * FROM personas WHERE id = ?', Number(info.lastInsertRowid));
}

export function updatePersona({ id, ownerType, ownerId = null, patch }) {
  const row = get(
    'SELECT * FROM personas WHERE id = ? AND owner_type = ? AND COALESCE(owner_id, 0) = ?',
    Number(id),
    ownerType,
    ownerId ?? 0
  );
  if (!row) throw E.notFound('角色不存在');
  const name = patch.name !== undefined ? String(patch.name).trim() : row.name;
  const prompt = patch.prompt !== undefined ? String(patch.prompt).trim() : row.prompt;
  if (!name) throw E.badRequest('角色名称不能为空');
  if (!prompt) throw E.badRequest('角色提示词不能为空');
  if (prompt.length > 8000) throw E.badRequest('提示词过长（上限 8000 字）');
  run(
    'UPDATE personas SET name = ?, description = ?, prompt = ?, enabled = ?, updated_at = ? WHERE id = ?',
    name.slice(0, 40),
    patch.description !== undefined ? String(patch.description).trim().slice(0, 200) : row.description,
    prompt,
    patch.enabled === undefined ? row.enabled : patch.enabled ? 1 : 0,
    now(),
    row.id
  );
  return get('SELECT * FROM personas WHERE id = ?', row.id);
}

export function deletePersona({ id, ownerType, ownerId = null }) {
  const row = get(
    'SELECT * FROM personas WHERE id = ? AND owner_type = ? AND COALESCE(owner_id, 0) = ?',
    Number(id),
    ownerType,
    ownerId ?? 0
  );
  if (!row) throw E.notFound('角色不存在');
  run('DELETE FROM personas WHERE id = ?', row.id);
}
