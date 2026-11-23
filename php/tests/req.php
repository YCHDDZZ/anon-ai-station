<?php
// 本地 CLI 请求模拟器（仅开发用）
$method = $argv[1] ?? 'GET';
$path = $argv[2] ?? '/api/health';
$bodyFile = $argv[3] ?? '';
$cookieFile = $argv[4] ?? '';

$_SERVER['REQUEST_METHOD'] = $method;
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['HTTP_USER_AGENT'] = 'php-cli-test';
$_SERVER['REQUEST_URI'] = $path;
if ($bodyFile && is_file($bodyFile)) {
    $_SERVER['CONTENT_TYPE'] = 'application/json';
    $_SERVER['CONTENT_LENGTH'] = (string) filesize($bodyFile);
}
if (getenv('TEST_HEADERS')) {
    $headers = json_decode((string) getenv('TEST_HEADERS'), true);
    if (is_array($headers)) {
        foreach ($headers as $k => $v) {
            $key = 'HTTP_' . strtoupper(str_replace('-', '_', (string) $k));
            $_SERVER[$key] = (string) $v;
        }
    }
}
putenv('TEST_PATH=' . $path);
putenv('TEST_BODY_FILE=' . $bodyFile);
putenv('TEST_COOKIES_FILE=' . $cookieFile);

register_shutdown_function(function () use ($cookieFile) {
    if ($cookieFile) {
        $old = is_file($cookieFile) ? json_decode((string) file_get_contents($cookieFile), true) : [];
        $all = array_merge(is_array($old) ? $old : [], $GLOBALS['__test_cookies'] ?? []);
        file_put_contents($cookieFile, json_encode($all));
    }
});

require __DIR__ . '/../public/api/index.php';
