import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(path.join(config.dataDir, 'app.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT,
  role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status        TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  provider_preference TEXT NOT NULL DEFAULT 'own_first'
                 CHECK (provider_preference IN ('own_first','shared_first')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    TEXT,
  ip           TEXT,
  user_agent   TEXT,
  kind         TEXT,
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS email_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  code_hash  TEXT    NOT NULL,
  purpose    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  consumed   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_codes_email ON email_codes(email, purpose);

CREATE TABLE IF NOT EXISTS providers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type      TEXT    NOT NULL CHECK (owner_type IN ('global','user')),
  owner_id        INTEGER,
  category        TEXT    NOT NULL CHECK (category IN ('llm','search','crawl','parse','ocr','tts','asr')),
  name            TEXT,
  base_url        TEXT    NOT NULL,
  api_key_enc     TEXT,
  model           TEXT,
  extra_json      TEXT    NOT NULL DEFAULT '{}',
  enabled         INTEGER NOT NULL DEFAULT 1,
  sort            INTEGER NOT NULL DEFAULT 0,
  last_status     TEXT,
  last_error      TEXT,
  last_checked_at INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
/* 同一类能力允许存在多条 API（旧库的唯一索引在迁移段里删除） */
CREATE INDEX IF NOT EXISTS idx_providers_owner_cat
  ON providers(owner_type, COALESCE(owner_id, 0), category, sort);

/* 同一条 API 下可以挂多把 Key，按策略轮询 */
CREATE TABLE IF NOT EXISTS provider_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id  INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label        TEXT,
  key_enc      TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  fail_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provider_keys ON provider_keys(provider_id);

/* 每类能力的调度策略：failover 失败切换 / round_robin 轮询 */
CREATE TABLE IF NOT EXISTS routing (
  owner_type TEXT    NOT NULL,
  owner_id   INTEGER NOT NULL DEFAULT 0,
  category   TEXT    NOT NULL,
  mode       TEXT    NOT NULL DEFAULT 'failover' CHECK (mode IN ('failover','round_robin')),
  PRIMARY KEY (owner_type, owner_id, category)
);

/* 登录 / 注册行为登记，用于安全审计 */
CREATE TABLE IF NOT EXISTS login_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  email      TEXT,
  ip         TEXT,
  device_id  TEXT,
  ua         TEXT,
  kind       TEXT,
  ok         INTEGER NOT NULL DEFAULT 1,
  reason     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_events ON login_events(created_at DESC);

/* 安全事件（异常流量、爬虫触发、自动封禁等） */
CREATE TABLE IF NOT EXISTS security_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL,
  ip         TEXT,
  user_id    INTEGER,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_events ON security_events(created_at DESC);

/* 手工 / 自动封禁的 IP */
CREATE TABLE IF NOT EXISTS blocked_ips (
  ip         TEXT    PRIMARY KEY,
  reason     TEXT,
  until      INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

/* 图形验证码（哈希存储，一次性） */
CREATE TABLE IF NOT EXISTS captchas (
  id         TEXT    PRIMARY KEY,
  code_hash  TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

/* 第三方接口用量（按配额组 + 自然月累计） */
CREATE TABLE IF NOT EXISTS usage_counters (
  scope       TEXT    NOT NULL,
  period      TEXT    NOT NULL,
  calls       INTEGER NOT NULL DEFAULT 0,
  units       REAL    NOT NULL DEFAULT 0,
  cost        REAL    NOT NULL DEFAULT 0,
  notified_at INTEGER,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (scope, period)
);

/* 用量明细（保留最近 7 天，便于审计） */
CREATE TABLE IF NOT EXISTS usage_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT    NOT NULL,
  provider_id INTEGER,
  category    TEXT,
  units       REAL    NOT NULL DEFAULT 0,
  cost        REAL    NOT NULL DEFAULT 0,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_log ON usage_log(created_at DESC);

/* 按用户拆分的用量：共享额度按活跃账号数平分后逐人计数 */
CREATE TABLE IF NOT EXISTS usage_user_counters (
  scope      TEXT    NOT NULL,
  period     TEXT    NOT NULL,
  user_id    INTEGER NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0,
  units      REAL    NOT NULL DEFAULT 0,
  cost       REAL    NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, period, user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL DEFAULT '新对话',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT    NOT NULL DEFAULT '',
  reasoning       TEXT,
  meta_json       TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  mime       TEXT,
  size       INTEGER,
  path       TEXT    NOT NULL,
  text       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id);

CREATE TABLE IF NOT EXISTS personas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type  TEXT    NOT NULL CHECK (owner_type IN ('global','user')),
  owner_id    INTEGER,
  name        TEXT    NOT NULL,
  description TEXT,
  prompt      TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

/* 全体邮件：任务 / 配图 / 逐封发送日志 */
CREATE TABLE IF NOT EXISTS broadcast_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject     TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  image_id    INTEGER,
  total       INTEGER NOT NULL DEFAULT 0,
  sent        INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'queued',
  error       TEXT,
  created_by  INTEGER,
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bc_jobs_created ON broadcast_jobs(created_at);

CREATE TABLE IF NOT EXISTS broadcast_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  mime       TEXT,
  size       INTEGER,
  path       TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcast_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL,
  email      TEXT,
  ok         INTEGER,
  error      TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bc_logs_job ON broadcast_logs(job_id);

/* 站点公告：图文弹窗 + 配图 */
CREATE TABLE IF NOT EXISTS market_cards (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  author      TEXT,
  tags        TEXT,
  copy_count  INTEGER NOT NULL DEFAULT 0,
  content     TEXT,
  is_nsfw     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT,
  fetched_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_pop ON market_cards(copy_count DESC, id DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  content     TEXT,
  images_json TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, id DESC);

CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  image_id   INTEGER,
  tone       TEXT    NOT NULL DEFAULT 'info',
  enabled    INTEGER NOT NULL DEFAULT 1,
  starts_at  INTEGER,
  ends_at    INTEGER,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ann_active ON announcements(enabled, updated_at DESC);

CREATE TABLE IF NOT EXISTS announcement_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  mime       TEXT,
  size       INTEGER,
  path       TEXT NOT NULL,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
`);

/* ── 轻量迁移：给已有库补列 ───────────────────────────── */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    console.log(`[迁移] ${table} 新增列 ${column}`);
  }
}
ensureColumn('conversations', 'persona_id', 'persona_id INTEGER');
ensureColumn('conversations', 'persona_name', 'persona_name TEXT');
ensureColumn('conversations', 'persona_prompt', 'persona_prompt TEXT');
ensureColumn('providers', 'error_message', 'error_message TEXT');
ensureColumn('providers', 'sort', 'sort INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'banned_until', 'banned_until INTEGER');
ensureColumn('users', 'ban_reason', 'ban_reason TEXT');
ensureColumn('users', 'last_ip', 'last_ip TEXT');
ensureColumn('sessions', 'device_id', 'device_id TEXT');
ensureColumn('sessions', 'ip', 'ip TEXT');
ensureColumn('sessions', 'user_agent', 'user_agent TEXT');
ensureColumn('sessions', 'last_seen_at', 'last_seen_at INTEGER');
ensureColumn('sessions', 'kind', 'kind TEXT');

/* 旧库把「每类能力唯一」做成了唯一索引，多 API 需要放开 */
try {
  db.exec('DROP INDEX IF EXISTS idx_providers_owner_cat');
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_providers_owner_cat ON providers(owner_type, COALESCE(owner_id, 0), category, sort)'
  );
} catch (err) {
  console.warn('[迁移] 放开 provider 唯一索引失败：', err.message);
}

/* ── 便捷查询封装 ─────────────────────────────────────── */
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
export const all = (sql, ...p) => stmt(sql).all(...p);
export const get = (sql, ...p) => stmt(sql).get(...p);
export const run = (sql, ...p) => stmt(sql).run(...p);
export const now = () => Date.now();

/* ── settings ─────────────────────────────────────────── */
export function setting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}
export function setSetting(key, value) {
  run(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(value)
  );
}
export function getSettings() {
  const out = {};
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}

/* ── 默认配置 ─────────────────────────────────────────── */
if (setting('allowRegistration') === null) setSetting('allowRegistration', 'true');
if (setting('siteName') === null) setSetting('siteName', '千早爱音的AI站');
// 普通用户自建 API：暂时关闭，等后续版本开放（后台可切换）
if (setting('userProvidersOpen') === null) setSetting('userProvidersOpen', 'false');
if (setting('insufficientComputeMsg') === null)
  setSetting('insufficientComputeMsg', '算力暂时不足，请稍后再试或联系管理员。');
if (setting('insufficientComputeMsg') === '算力不足，请自行接入第三方工具 API。')
  setSetting('insufficientComputeMsg', '算力暂时不足，请稍后再试或联系管理员。');

/* 安卓 App 版本信息：管理员可在后台修改，App 启动时检查并强制更新 */
if (setting('appVersionCode') === null) setSetting('appVersionCode', '2');
if (setting('appVersionName') === null) setSetting('appVersionName', '1.1.0');
if (setting('appDownloadUrl') === null) setSetting('appDownloadUrl', `${config.publicUrl}/downloads/anno-ai.apk`);
if (setting('appUpdateNotes') === null) setSetting('appUpdateNotes', '应用内直接下载安装，装完就能继续聊～');
if (setting('appUpdateMandatory') === null) setSetting('appUpdateMandatory', 'true');
/* 安全相关默认值（可在「后台 → 安全管理」修改） */
// 首次启动给一个占位群号，管理员必须到「安全管理」改成自己的；留空则注册关闭
if (setting('registerGroupNumbers') === null) setSetting('registerGroupNumbers', '10001');
if (setting('securityRateLimit') === null) setSetting('securityRateLimit', '600');
if (setting('securityAutoBlock') === null) setSetting('securityAutoBlock', 'true');
if (setting('securityAutoBlockMinutes') === null) setSetting('securityAutoBlockMinutes', '30');
if (setting('banNotice') === null)
  setSetting(
    'banNotice',
    '你的账号因违反站点使用规范已被限制访问。如有疑问请联系管理员申诉。'
  );
