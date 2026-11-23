<?php
declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;

    if (DB_DRIVER === 'sqlite') {
        $dir = dirname(DB_SQLITE_PATH);
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $pdo = new PDO('sqlite:' . DB_SQLITE_PATH, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA foreign_keys = ON');
    } else {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', DB_HOST, DB_PORT, DB_NAME);
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }
    db_migrate($pdo);
    return $pdo;
}

function db_bind(PDOStatement $st, array $params): void
{
    foreach (array_values($params) as $i => $v) {
        if (is_int($v)) {
            $st->bindValue($i + 1, $v, PDO::PARAM_INT);
        } elseif (is_bool($v)) {
            $st->bindValue($i + 1, (int) $v, PDO::PARAM_INT);
        } elseif ($v === null) {
            $st->bindValue($i + 1, null, PDO::PARAM_NULL);
        } else {
            $st->bindValue($i + 1, (string) $v, PDO::PARAM_STR);
        }
    }
}

function db_all(string $sql, array $params = []): array
{
    $st = db()->prepare($sql);
    db_bind($st, $params);
    $st->execute();
    return $st->fetchAll();
}

function db_get(string $sql, array $params = []): ?array
{
    $st = db()->prepare($sql);
    db_bind($st, $params);
    $st->execute();
    $row = $st->fetch();
    return $row === false ? null : $row;
}

function db_run(string $sql, array $params = []): PDOStatement
{
    $st = db()->prepare($sql);
    db_bind($st, $params);
    $st->execute();
    return $st;
}

function db_last_id(): int
{
    return (int) db()->lastInsertId();
}

/** 跨 SQLite / MySQL 的 upsert */
function db_upsert(string $table, array $data, array $uniqueCols, ?array $updateCols = null): void
{
    $cols = array_keys($data);
    $place = implode(', ', array_fill(0, count($cols), '?'));
    $colSql = implode(', ', array_map(fn($c) => "`$c`", $cols));
    $params = array_values($data);

    if (DB_DRIVER === 'sqlite') {
        $conflict = implode(', ', array_map(fn($c) => "`$c`", $uniqueCols));
        $updateCols ??= array_values(array_diff($cols, $uniqueCols));
        $set = implode(', ', array_map(fn($c) => "`$c` = excluded.`$c`", $updateCols));
        db_run("INSERT INTO `$table` ($colSql) VALUES ($place) ON CONFLICT($conflict) DO UPDATE SET $set", $params);
        return;
    }

    $updateCols ??= array_values(array_diff($cols, $uniqueCols));
    $set = implode(', ', array_map(fn($c) => "`$c` = VALUES(`$c`)", $updateCols));
    db_run("INSERT INTO `$table` ($colSql) VALUES ($place) ON DUPLICATE KEY UPDATE $set", $params);
}

const SCHEMA_VERSION = '6';

function db_migrate(PDO $pdo): void
{
    static $done = false;
    if ($done) return;
    $done = true;

    // 版本标记：迁移只在首次请求或升级后执行，避免每个请求都跑 20+ 条 DDL
    try {
        $st = $pdo->prepare("SELECT `value` FROM `settings` WHERE `key` = 'schemaVersion'");
        $st->execute();
        if ($st->fetchColumn() === SCHEMA_VERSION) return;
    } catch (Throwable $e) {
        // settings 还不存在，继续建表
    }

    $pk = DB_DRIVER === 'sqlite'
        ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
        : 'BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY';

    $tables = [
        "CREATE TABLE IF NOT EXISTS `users` (
            `id` $pk,
            `email` VARCHAR(190) NOT NULL UNIQUE,
            `password_hash` VARCHAR(255) NULL,
            `role` VARCHAR(16) NOT NULL DEFAULT 'user',
            `status` VARCHAR(16) NOT NULL DEFAULT 'active',
            `provider_preference` VARCHAR(24) NOT NULL DEFAULT 'own_first',
            `banned_until` BIGINT NULL,
            `ban_reason` TEXT NULL,
            `last_ip` VARCHAR(64) NULL,
            `created_at` BIGINT NOT NULL,
            `last_login_at` BIGINT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `sessions` (
            `token` VARCHAR(128) NOT NULL PRIMARY KEY,
            `user_id` BIGINT NOT NULL,
            `device_id` VARCHAR(128) NULL,
            `ip` VARCHAR(64) NULL,
            `user_agent` TEXT NULL,
            `kind` VARCHAR(16) NULL,
            `expires_at` BIGINT NOT NULL,
            `created_at` BIGINT NOT NULL,
            `last_seen_at` BIGINT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `email_codes` (
            `id` $pk,
            `email` VARCHAR(190) NOT NULL,
            `code_hash` VARCHAR(128) NOT NULL,
            `purpose` VARCHAR(16) NOT NULL,
            `expires_at` BIGINT NOT NULL,
            `attempts` INTEGER NOT NULL DEFAULT 0,
            `consumed` INTEGER NOT NULL DEFAULT 0,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `providers` (
            `id` $pk,
            `owner_type` VARCHAR(16) NOT NULL,
            `owner_id` BIGINT NULL,
            `category` VARCHAR(16) NOT NULL,
            `name` VARCHAR(120) NULL,
            `base_url` VARCHAR(255) NOT NULL,
            `api_key_enc` TEXT NULL,
            `model` VARCHAR(120) NULL,
            `extra_json` TEXT NULL,
            `enabled` INTEGER NOT NULL DEFAULT 1,
            `sort` INTEGER NOT NULL DEFAULT 0,
            `error_message` TEXT NULL,
            `last_status` VARCHAR(32) NULL,
            `last_error` TEXT NULL,
            `last_checked_at` BIGINT NULL,
            `created_at` BIGINT NOT NULL,
            `updated_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `provider_keys` (
            `id` $pk,
            `provider_id` BIGINT NOT NULL,
            `label` VARCHAR(120) NULL,
            `key_enc` TEXT NOT NULL,
            `enabled` INTEGER NOT NULL DEFAULT 1,
            `fail_count` INTEGER NOT NULL DEFAULT 0,
            `last_used_at` BIGINT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `routing` (
            `owner_type` VARCHAR(16) NOT NULL,
            `owner_id` BIGINT NOT NULL DEFAULT 0,
            `category` VARCHAR(16) NOT NULL,
            `mode` VARCHAR(24) NOT NULL DEFAULT 'failover',
            PRIMARY KEY (`owner_type`, `owner_id`, `category`)
        )",
        "CREATE TABLE IF NOT EXISTS `login_events` (
            `id` $pk,
            `user_id` BIGINT NULL,
            `email` VARCHAR(190) NULL,
            `ip` VARCHAR(64) NULL,
            `device_id` VARCHAR(128) NULL,
            `ua` TEXT NULL,
            `kind` VARCHAR(32) NULL,
            `ok` INTEGER NOT NULL DEFAULT 1,
            `reason` TEXT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `security_events` (
            `id` $pk,
            `kind` VARCHAR(64) NOT NULL,
            `ip` VARCHAR(64) NULL,
            `user_id` BIGINT NULL,
            `detail` TEXT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `blocked_ips` (
            `ip` VARCHAR(64) NOT NULL PRIMARY KEY,
            `reason` TEXT NULL,
            `until` BIGINT NOT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `captchas` (
            `id` VARCHAR(64) NOT NULL PRIMARY KEY,
            `code_hash` VARCHAR(128) NOT NULL,
            `expires_at` BIGINT NOT NULL,
            `used` INTEGER NOT NULL DEFAULT 0,
            `attempts` INTEGER NOT NULL DEFAULT 0,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `usage_counters` (
            `scope` VARCHAR(128) NOT NULL,
            `period` VARCHAR(16) NOT NULL,
            `calls` INTEGER NOT NULL DEFAULT 0,
            `units` REAL NOT NULL DEFAULT 0,
            `cost` REAL NOT NULL DEFAULT 0,
            `notified_at` BIGINT NULL,
            `updated_at` BIGINT NOT NULL,
            PRIMARY KEY (`scope`, `period`)
        )",
        "CREATE TABLE IF NOT EXISTS `usage_log` (
            `id` $pk,
            `scope` VARCHAR(128) NOT NULL,
            `provider_id` BIGINT NULL,
            `category` VARCHAR(32) NULL,
            `units` REAL NOT NULL DEFAULT 0,
            `cost` REAL NOT NULL DEFAULT 0,
            `detail` TEXT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `usage_user_counters` (
            `scope` VARCHAR(128) NOT NULL,
            `period` VARCHAR(16) NOT NULL,
            `user_id` BIGINT NOT NULL,
            `calls` INTEGER NOT NULL DEFAULT 0,
            `units` REAL NOT NULL DEFAULT 0,
            `cost` REAL NOT NULL DEFAULT 0,
            `updated_at` BIGINT NOT NULL,
            PRIMARY KEY (`scope`, `period`, `user_id`)
        )",
        "CREATE TABLE IF NOT EXISTS `conversations` (
            `id` $pk,
            `user_id` BIGINT NOT NULL,
            `title` VARCHAR(255) NOT NULL DEFAULT '新对话',
            `persona_id` BIGINT NULL,
            `persona_name` VARCHAR(120) NULL,
            `persona_prompt` TEXT NULL,
            `created_at` BIGINT NOT NULL,
            `updated_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `messages` (
            `id` $pk,
            `conversation_id` BIGINT NOT NULL,
            `role` VARCHAR(16) NOT NULL,
            `content` MEDIUMTEXT NULL,
            `reasoning` MEDIUMTEXT NULL,
            `meta_json` TEXT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `files` (
            `id` $pk,
            `user_id` BIGINT NOT NULL,
            `name` VARCHAR(255) NOT NULL,
            `mime` VARCHAR(120) NULL,
            `size` BIGINT NULL,
            `path` VARCHAR(500) NOT NULL,
            `text` MEDIUMTEXT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `personas` (
            `id` $pk,
            `owner_type` VARCHAR(16) NOT NULL,
            `owner_id` BIGINT NULL,
            `name` VARCHAR(120) NOT NULL,
            `description` TEXT NULL,
            `prompt` MEDIUMTEXT NOT NULL,
            `enabled` INTEGER NOT NULL DEFAULT 1,
            `sort` INTEGER NOT NULL DEFAULT 0,
            `error_message` TEXT NULL,
            `created_at` BIGINT NOT NULL,
            `updated_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `settings` (
            `key` VARCHAR(100) NOT NULL PRIMARY KEY,
            `value` TEXT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `broadcast_jobs` (
            `id` $pk,
            `subject` VARCHAR(255) NOT NULL,
            `content` MEDIUMTEXT NOT NULL,
            `image_id` BIGINT NULL,
            `total` INTEGER NOT NULL DEFAULT 0,
            `sent` INTEGER NOT NULL DEFAULT 0,
            `failed` INTEGER NOT NULL DEFAULT 0,
            `status` VARCHAR(16) NOT NULL DEFAULT 'queued',
            `error` TEXT NULL,
            `created_by` BIGINT NULL,
            `created_at` BIGINT NOT NULL,
            `started_at` BIGINT NULL,
            `finished_at` BIGINT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `broadcast_images` (
            `id` $pk,
            `name` VARCHAR(190) NULL,
            `mime` VARCHAR(80) NULL,
            `size` BIGINT NULL,
            `path` VARCHAR(500) NOT NULL,
            `created_by` BIGINT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `broadcast_logs` (
            `id` $pk,
            `job_id` BIGINT NOT NULL,
            `email` VARCHAR(190) NULL,
            `ok` INTEGER NULL,
            `error` TEXT NULL,
            `created_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `market_cards` (
            `id` BIGINT NOT NULL PRIMARY KEY,
            `title` VARCHAR(255) NOT NULL,
            `author` VARCHAR(190) NULL,
            `tags` TEXT NULL,
            `copy_count` INTEGER NOT NULL DEFAULT 0,
            `content` MEDIUMTEXT NULL,
            `is_nsfw` INTEGER NOT NULL DEFAULT 0,
            `created_at` VARCHAR(40) NULL,
            `fetched_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `feedback` (
            `id` $pk,
            `user_id` BIGINT NOT NULL,
            `content` TEXT NULL,
            `images_json` TEXT NULL,
            `status` VARCHAR(16) NOT NULL DEFAULT 'open',
            `created_at` BIGINT NOT NULL,
            `updated_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `announcements` (
            `id` $pk,
            `title` VARCHAR(190) NOT NULL,
            `content` MEDIUMTEXT NOT NULL,
            `image_id` BIGINT NULL,
            `tone` VARCHAR(20) NOT NULL DEFAULT 'info',
            `enabled` INTEGER NOT NULL DEFAULT 1,
            `starts_at` BIGINT NULL,
            `ends_at` BIGINT NULL,
            `created_by` BIGINT NULL,
            `created_at` BIGINT NOT NULL,
            `updated_at` BIGINT NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS `announcement_images` (
            `id` $pk,
            `name` VARCHAR(190) NULL,
            `mime` VARCHAR(80) NULL,
            `size` BIGINT NULL,
            `path` VARCHAR(500) NOT NULL,
            `created_by` BIGINT NULL,
            `created_at` BIGINT NOT NULL
        )",
    ];

    foreach ($tables as $sql) {
        $pdo->exec($sql);
    }

    $indexes = [
        'idx_sessions_user' => 'CREATE INDEX idx_sessions_user ON sessions(user_id)',
        'idx_codes_email' => 'CREATE INDEX idx_codes_email ON email_codes(email, purpose)',
        'idx_providers_owner_cat' => 'CREATE INDEX idx_providers_owner_cat ON providers(owner_type, owner_id, category, sort)',
        'idx_provider_keys' => 'CREATE INDEX idx_provider_keys ON provider_keys(provider_id)',
        'idx_login_events' => 'CREATE INDEX idx_login_events ON login_events(created_at)',
        'idx_security_events' => 'CREATE INDEX idx_security_events ON security_events(created_at)',
        'idx_usage_log' => 'CREATE INDEX idx_usage_log ON usage_log(created_at)',
        'idx_conv_user' => 'CREATE INDEX idx_conv_user ON conversations(user_id, updated_at)',
        'idx_msg_conv' => 'CREATE INDEX idx_msg_conv ON messages(conversation_id, id)',
        'idx_files_user' => 'CREATE INDEX idx_files_user ON files(user_id)',
        'idx_bc_logs_job' => 'CREATE INDEX idx_bc_logs_job ON broadcast_logs(job_id)',
        'idx_ann_active' => 'CREATE INDEX idx_ann_active ON announcements(enabled, updated_at)',
    ];
    foreach ($indexes as $sql) {
        try {
            $pdo->exec($sql);
        } catch (Throwable $e) {
            // 已存在
        }
    }

    // 轻量迁移：给旧库补列
    $alters = [
        ['providers', 'error_message', 'TEXT NULL'],
        ['captchas', 'attempts', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    foreach ($alters as [$table, $col, $ddl]) {
        try {
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$col` $ddl");
        } catch (Throwable $e) {
            // 已存在
        }
    }

    // 默认设置
    $defaults = [
        'siteName' => '千早爱音的AI站',
        'allowRegistration' => 'true',
        'insufficientComputeMsg' => '算力暂时不足，请稍后再试或联系管理员。',
        'appVersionCode' => '2',
        'appVersionName' => '1.1.0',
        'appDownloadUrl' => PUBLIC_URL . '/downloads/anno-ai.apk',
        'appUpdateNotes' => '应用内直接下载安装，装完就能继续聊～',
        'appUpdateMandatory' => 'true',
        'registerGroupNumbers' => '10001',
        'securityRateLimit' => '600',
        'securityAutoBlock' => 'true',
        'securityAutoBlockMinutes' => '30',
        'banNotice' => '你已被管理员暂时封禁，请稍后再试或联系管理员。',
        'userProvidersOpen' => 'false',
    ];
    foreach ($defaults as $k => $v) {
        if (setting($k) === null) set_setting($k, $v);
    }

    // 写入迁移版本（迁移完成后不再执行 DDL）
    $pdo->prepare("DELETE FROM `settings` WHERE `key` = 'schemaVersion'")->execute();
    $pdo->prepare("INSERT INTO `settings`(`key`,`value`) VALUES('schemaVersion',?)")->execute([SCHEMA_VERSION]);
}

function setting(string $key, ?string $default = null): ?string
{
    if (!isset($GLOBALS['__settings_cache'])) $GLOBALS['__settings_cache'] = [];
    if (array_key_exists($key, $GLOBALS['__settings_cache'])) {
        $v = $GLOBALS['__settings_cache'][$key];
        return $v === null ? $default : (string) $v;
    }
    $row = db_get('SELECT `value` FROM `settings` WHERE `key` = ?', [$key]);
    $GLOBALS['__settings_cache'][$key] = $row === null ? null : (string) $row['value'];
    return $row === null ? $default : (string) $row['value'];
}

function set_setting(string $key, string $value): void
{
    db_upsert('settings', ['key' => $key, 'value' => $value], ['key']);
    if (!isset($GLOBALS['__settings_cache'])) $GLOBALS['__settings_cache'] = [];
    $GLOBALS['__settings_cache'][$key] = $value;
}
