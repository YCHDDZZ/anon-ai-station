<?php
declare(strict_types=1);

/**
 * PHP + MySQL 版配置。环境变量优先，其次读取 php-version/.env。
 */
function env_load(string $file): void
{
    if (!is_file($file)) return;
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v);
        if ((str_starts_with($v, '"') && str_ends_with($v, '"')) || (str_starts_with($v, "'") && str_ends_with($v, "'"))) {
            $v = substr($v, 1, -1);
        }
        if (getenv($k) === false) putenv("$k=$v");
    }
}

// APP_BASE：项目根（本地 php-version/，主机上是站点根 /）
// APP_DIR：app/ 代码目录（主机上 /app）
define('APP_BASE', rtrim(dirname(__DIR__), '/'));
define('APP_DIR', __DIR__);
env_load(APP_BASE . '/.env');
// 生产环境推荐用 PHP 数组配置，避免 .env 被 nginx 当静态文件下载
$localConfig = APP_DIR . '/config.local.php';
if (is_file($localConfig)) {
    $cfg = require $localConfig;
    if (is_array($cfg)) {
        foreach ($cfg as $k => $v) {
            if (getenv($k) === false) putenv($k . '=' . $v);
        }
    }
}

function env(string $key, ?string $default = null): ?string
{
    $v = getenv($key);
    return ($v === false || $v === '') ? $default : $v;
}

function env_bool(string $key, bool $default = false): bool
{
    $v = env($key);
    if ($v === null) return $default;
    return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
}

date_default_timezone_set(env('TZ', 'Asia/Shanghai'));

define('APP_SECRET', (string) env('APP_SECRET', ''));
if (strlen(APP_SECRET) < 32) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => ['code' => 'CONFIG', 'message' => 'APP_SECRET 至少需要 32 位']], JSON_UNESCAPED_UNICODE);
    exit;
}

define('DB_DRIVER', strtolower((string) env('DB_DRIVER', 'mysql')));
define('DB_HOST', (string) env('DB_HOST', 'localhost'));
define('DB_PORT', (int) env('DB_PORT', '3306'));
define('DB_NAME', (string) env('DB_NAME', ''));
define('DB_USER', (string) env('DB_USER', ''));
define('DB_PASS', (string) env('DB_PASS', ''));
define('DB_SQLITE_PATH', (string) env('DB_PATH', APP_BASE . '/data/app.sqlite'));

define('PUBLIC_URL', rtrim((string) env('PUBLIC_URL', 'http://localhost:8081'), '/'));
define('SESSION_DAYS', (int) env('SESSION_DAYS', '7'));
define('ADMIN_EMAIL', strtolower(trim((string) env('ADMIN_EMAIL', ''))));
define('ADMIN_PASSWORD', (string) env('ADMIN_PASSWORD', ''));
define('CAPTCHA_DEV_ECHO', env_bool('CAPTCHA_DEV_ECHO', false));
define('MAIL_DEV_FALLBACK', env_bool('MAIL_DEV_FALLBACK', false));

define('SMTP_HOST', (string) env('SMTP_HOST', ''));
define('SMTP_PORT', (int) env('SMTP_PORT', '465'));
define('SMTP_SECURE', env_bool('SMTP_SECURE', true));
define('SMTP_USER', (string) env('SMTP_USER', ''));
define('SMTP_PASS', (string) env('SMTP_PASS', ''));
define('SMTP_FROM', (string) env('SMTP_FROM', SMTP_USER));
define('SMTP_FROM_NAME', (string) env('SMTP_FROM_NAME', '千早爱音的AI站'));

define('UPLOAD_DIR', (string) env('UPLOAD_DIR', APP_BASE . '/data/uploads'));
define('MAX_FILE_MB', (int) env('MAX_FILE_MB', '30'));
define('DATA_DIR', APP_BASE . '/data');

foreach ([DATA_DIR, UPLOAD_DIR] as $dir) {
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
}

function smtp_configured(): bool
{
    return SMTP_HOST !== '' && SMTP_USER !== '' && SMTP_PASS !== '';
}
