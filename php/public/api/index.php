<?php
declare(strict_types=1);

$appDir = @is_dir(__DIR__ . '/../../app') ? __DIR__ . '/../../app' : __DIR__ . '/../app';
require $appDir . '/config.php';
require $appDir . '/helpers.php';
require $appDir . '/db.php';
require $appDir . '/auth.php';
require $appDir . '/providers.php';
require $appDir . '/quota.php';
require $appDir . '/broadcast.php';
require $appDir . '/announcements.php';
require $appDir . '/market.php';
require $appDir . '/docmind.php';
require $appDir . '/billing.php';
require $appDir . '/llm.php';
require $appDir . '/chat.php';
require $appDir . '/views.php';
require $appDir . '/routes.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: SAMEORIGIN');

try {
    if (PHP_SAPI === 'cli') {
        if (getenv('TEST_COOKIES_FILE') && is_file((string) getenv('TEST_COOKIES_FILE'))) {
            $c = json_decode((string) file_get_contents((string) getenv('TEST_COOKIES_FILE')), true);
            if (is_array($c)) $_COOKIE = $c;
        }
        if (getenv('TEST_PATH')) $_GET['p'] = (string) getenv('TEST_PATH');
        if (getenv('TEST_BODY_FILE') && is_file((string) getenv('TEST_BODY_FILE'))) {
            define('TEST_BODY', (string) file_get_contents((string) getenv('TEST_BODY_FILE')));
        }
    }
    guard_ip();
    ensure_device();
    // 约 1/200 的请求触发一次过期数据清理（共享主机没有 cron）
    if (random_int(1, 200) === 1) cleanup_expired();
    ensure_admin_seed();
    ensure_default_persona();

    $path = $_GET['p'] ?? '';
    if (!is_string($path) || $path === '') fail('NOT_FOUND', '接口不存在', 404);
    // 兼容把查询串塞进 p 的调用方式：/api/xxx?tag=yyy
    $qpos = strpos($path, '?');
    if ($qpos !== false) {
        parse_str(substr($path, $qpos + 1), $routeQuery);
        $_GET = array_merge($_GET, $routeQuery);
        $path = substr($path, 0, $qpos);
    }
    api_route($_SERVER['REQUEST_METHOD'] ?? 'GET', $path);
} catch (ApiError $e) {
    if (headers_sent()) {
        // SSE 已开始，只能尽力输出一个错误事件
        echo 'event: error' . "\ndata: " . json_encode([
            'code' => $e->apiCode,
            'message' => $e->getMessage(),
        ], JSON_UNESCAPED_UNICODE) . "\n\n";
        exit;
    }
    json_out([
        'ok' => false,
        'error' => ['code' => $e->apiCode, 'message' => $e->getMessage(), 'detail' => $e->extra],
    ], $e->status);
} catch (Throwable $e) {
    error_log('[php-api] ' . $e->getMessage() . "\n" . $e->getTraceAsString());
    if (headers_sent()) {
        echo 'event: error' . "\ndata: " . json_encode(['code' => 'INTERNAL', 'message' => '服务内部错误'], JSON_UNESCAPED_UNICODE) . "\n\n";
        exit;
    }
    json_out(['ok' => false, 'error' => ['code' => 'INTERNAL', 'message' => '服务内部错误', 'detail' => null]], 500);
}
