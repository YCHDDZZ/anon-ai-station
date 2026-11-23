<?php
declare(strict_types=1);

final class ApiError extends RuntimeException
{
    public function __construct(
        public string $apiCode,
        string $message,
        public int $status = 400,
        public mixed $extra = null
    ) {
        parent::__construct($message);
    }
}

function fail(string $code, string $message, int $status = 400, mixed $extra = null): never
{
    throw new ApiError($code, $message, $status, $extra);
}

function json_out(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function raw_body(): string
{
    if (defined('TEST_BODY')) return (string) TEST_BODY;
    return (string) (file_get_contents('php://input') ?: '');
}

function body_json(): array
{
    $raw = raw_body();
    if ($raw === '' || $raw === false) return [];
    $data = json_decode($raw, true);
    if (!is_array($data)) fail('BAD_JSON', '请求体不是合法 JSON', 400);
    return $data;
}

function now_ms(): int
{
    return (int) floor(microtime(true) * 1000);
}

function client_ip(): string
{
    $peer = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if (!is_private_ip($peer)) return $peer;
    $xff = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '')[0] ?? '');
    $real = trim($_SERVER['HTTP_X_REAL_IP'] ?? '');
    return $xff !== '' ? $xff : ($real !== '' ? $real : $peer);
}

function is_private_ip(string $ip): bool
{
    if ($ip === '::1') return true;
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        return !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
        return str_starts_with($ip, 'fc') || str_starts_with($ip, 'fd') || str_starts_with($ip, 'fe80');
    }
    return true;
}

function random_token(int $bytes = 24): string
{
    return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
}

function hash_code(string $code): string
{
    return hash_hmac('sha256', $code, APP_SECRET);
}

function encrypt_secret(string $plain): string
{
    if ($plain === '') return '';
    $key = hash('sha256', APP_SECRET, true);
    $iv = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $cipher);
}

function decrypt_secret(?string $enc): string
{
    if (!$enc) return '';
    $raw = base64_decode($enc, true);
    if ($raw === false || strlen($raw) < 29) return '';
    $key = hash('sha256', APP_SECRET, true);
    $iv = substr($raw, 0, 12);
    $tag = substr($raw, 12, 16);
    $cipher = substr($raw, 28);
    $plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
    return $plain === false ? '' : $plain;
}

function mask_key(string $key): string
{
    if ($key === '') return '';
    if (strlen($key) <= 8) return '••••';
    return substr($key, 0, 4) . '••••' . substr($key, -4);
}

function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    return strtolower($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function set_auth_cookie(string $name, string $value, int $days, bool $httpOnly = true): void
{
    if (PHP_SAPI === 'cli') {
        $GLOBALS['__test_cookies'][$name] = $value;
        $_COOKIE[$name] = $value;
        return;
    }
    setcookie($name, $value, [
        'expires' => time() + $days * 86400,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => $httpOnly,
        'samesite' => 'Lax',
    ]);
}

function clear_auth_cookie(string $name): void
{
    if (PHP_SAPI === 'cli') {
        unset($GLOBALS['__test_cookies'][$name], $_COOKIE[$name]);
        return;
    }
    setcookie($name, '', ['expires' => time() - 3600, 'path' => '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
}

function log_event(string $kind, ?string $detail = null, ?string $ip = null, ?int $userId = null): void
{
    db_run(
        'INSERT INTO `security_events`(`kind`,`ip`,`user_id`,`detail`,`created_at`) VALUES(?,?,?,?,?)',
        [$kind, $ip ?? client_ip(), $userId, $detail, now_ms()]
    );
}

function log_login(?int $userId, string $email, string $kind, bool $ok, ?string $reason = null): void
{
    db_run(
        'INSERT INTO `login_events`(`user_id`,`email`,`ip`,`device_id`,`ua`,`kind`,`ok`,`reason`,`created_at`)
         VALUES(?,?,?,?,?,?,?,?,?)',
        [
            $userId,
            strtolower($email),
            client_ip(),
            $_COOKIE['dsdid'] ?? null,
            substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300),
            $kind,
            $ok ? 1 : 0,
            $reason,
            now_ms(),
        ]
    );
}

/** 定期清理过期数据；由入口按概率调用，避免共享主机没有 cron */
function cleanup_expired(): void
{
    $now = now_ms();
    try {
        db_run('DELETE FROM `captchas` WHERE `expires_at` < ?', [$now - 3600_000]);
        db_run('DELETE FROM `email_codes` WHERE `expires_at` < ?', [$now - 86400_000]);
        db_run('DELETE FROM `sessions` WHERE `expires_at` < ?', [$now]);
        db_run('DELETE FROM `blocked_ips` WHERE `until` <> 0 AND `until` < ?', [$now]);
        db_run('DELETE FROM `login_events` WHERE `created_at` < ?', [$now - 90 * 86400_000]);
        db_run('DELETE FROM `security_events` WHERE `created_at` < ?', [$now - 90 * 86400_000]);
        db_run('DELETE FROM `usage_log` WHERE `created_at` < ?', [$now - 180 * 86400_000]);
        db_run('DELETE FROM `broadcast_logs` WHERE `created_at` < ?', [$now - 90 * 86400_000]);

        // 清理没有被任何任务引用、且超过 30 天的群发配图
        $cutoff = $now - 30 * 86400_000;
        $orphans = db_all(
            'SELECT `id`,`path` FROM `broadcast_images`
             WHERE `created_at` < ? AND `id` NOT IN (SELECT `image_id` FROM `broadcast_jobs` WHERE `image_id` IS NOT NULL)',
            [$cutoff]
        );
        foreach ($orphans as $img) {
            if (!empty($img['path']) && is_file($img['path'])) @unlink($img['path']);
            db_run('DELETE FROM `broadcast_images` WHERE `id` = ?', [(int) $img['id']]);
        }

        $annImages = db_all(
            'SELECT `id`,`path` FROM `announcement_images`
             WHERE `created_at` < ? AND `id` NOT IN (SELECT `image_id` FROM `announcements` WHERE `image_id` IS NOT NULL)',
            [$cutoff]
        );
        foreach ($annImages as $img) {
            if (!empty($img['path']) && is_file($img['path'])) @unlink($img['path']);
            db_run('DELETE FROM `announcement_images` WHERE `id` = ?', [(int) $img['id']]);
        }
    } catch (Throwable $e) {
        error_log('[cleanup] ' . $e->getMessage());
    }
}

/** 把 /api/... 转成站点实际的单入口地址 */
function api_url(string $path): string
{
    return '/api/index.php?p=' . rawurlencode($path);
}

function category_label(string $cat): string
{
    return [
        'llm' => '大模型',
        'search' => '联网搜索',
        'crawl' => '网页爬取',
        'parse' => '文件解析',
        'ocr' => '图片 OCR',
        'tts' => '语音合成',
        'asr' => '语音识别',
    ][$cat] ?? $cat;
}

function unit_label(string $unit): string
{
    return ['credit' => 'credits', 'page' => '页', 'call' => '次', 'second' => '秒'][$unit] ?? $unit;
}

/**
 * 删除会话后清理不再被任何消息引用的附件（含磁盘文件），避免隐私数据长期留在库里。
 */
function cleanup_orphan_files(array $fileIds, int $userId): void
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $fileIds))));
    if (!$ids) return;

    $still = [];
    foreach (db_all('SELECT `meta_json` FROM `messages` WHERE `meta_json` LIKE ?', ['%fileIds%']) as $row) {
        $meta = json_decode((string) ($row['meta_json'] ?? '{}'), true);
        foreach ((array) ($meta['fileIds'] ?? []) as $fid) {
            $still[(int) $fid] = true;
        }
    }

    foreach ($ids as $fid) {
        if (isset($still[$fid])) continue;
        $f = db_get('SELECT `path` FROM `files` WHERE `id` = ? AND `user_id` = ?', [$fid, $userId]);
        if (!$f) continue;
        db_run('DELETE FROM `files` WHERE `id` = ?', [$fid]);
        if (!empty($f['path']) && is_file($f['path'])) @unlink($f['path']);
    }
}
