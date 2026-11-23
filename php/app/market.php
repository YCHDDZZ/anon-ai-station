<?php
declare(strict_types=1);

/**
 * 角色卡广场（玖帕喵 Prompt Market）服务端代理。
 * Key 只保存在服务端，前端永远拿不到。
 * 每个 Key 每天 500 次限额，这里做轮询复用。
 */
const MARKET_BASE = 'https://jiupamiao.asia';
const MARKET_DAILY_LIMIT = 500;

function market_keys(): array
{
    // 支持多 Key 轮询：设置 marketApiKeys 或环境变量 MARKET_API_KEYS（逗号/空格分隔）
    $raw = trim((string) setting('marketApiKeys', ''));
    if ($raw === '') $raw = trim((string) env('MARKET_API_KEYS', ''));
    $keys = preg_split('/[\s,]+/', $raw) ?: [];
    return array_values(array_unique(array_filter(array_map('trim', $keys))));
}

/** 只保留今天的用量，跨天自动清零 */
function market_usage_today(): array
{
    $today = date('Y-m-d');
    $usage = json_decode((string) setting('marketKeyUsage', '{}'), true);
    if (!is_array($usage)) $usage = [];
    foreach ($usage as $k => $v) {
        if (($v['d'] ?? '') !== $today) unset($usage[$k]);
    }
    return $usage;
}

function market_usage_save(array $usage): void
{
    set_setting('marketKeyUsage', json_encode($usage));
}

/** 从游标位置开始找还有额度的 Key */
function market_pick_key(array $usage): ?string
{
    $keys = market_keys();
    $n = count($keys);
    if ($n === 0) return null;
    $cursor = (int) setting('marketKeyCursor', '0') % $n;
    for ($i = 0; $i < $n; $i++) {
        $key = $keys[($cursor + $i) % $n];
        if ((int) ($usage[$key]['c'] ?? 0) < MARKET_DAILY_LIMIT) return $key;
    }
    return null;
}

function market_bump_key(string $key): void
{
    $usage = market_usage_today();
    $usage[$key] = ['d' => date('Y-m-d'), 'c' => (int) ($usage[$key]['c'] ?? 0) + 1];
    market_usage_save($usage);
    $keys = market_keys();
    $idx = array_search($key, $keys, true);
    if ($idx !== false && count($keys) > 0) {
        set_setting('marketKeyCursor', (string) (($idx + 1) % count($keys)));
    }
}

function market_exhaust_key(string $key): void
{
    $usage = market_usage_today();
    $usage[$key] = ['d' => date('Y-m-d'), 'c' => MARKET_DAILY_LIMIT];
    market_usage_save($usage);
}

/** 管理端展示：Key 脱敏 + 今日用量 */
function market_key_status(): array
{
    $usage = market_usage_today();
    $out = [];
    foreach (market_keys() as $i => $key) {
        $out[] = [
            'index' => $i + 1,
            'masked' => substr($key, 0, 8) . '…' . substr($key, -6),
            'used' => (int) ($usage[$key]['c'] ?? 0),
            'limit' => MARKET_DAILY_LIMIT,
        ];
    }
    return $out;
}

function market_request(string $path, array $query = []): array
{
    $url = MARKET_BASE . $path . ($query ? '?' . http_build_query($query) : '');

    if (!market_keys()) {
        fail('MARKET_NOT_CONFIGURED', '角色卡广场未配置 API Key，请设置环境变量 MARKET_API_KEYS', 503);
    }

    $cacheDir = DATA_DIR . '/cache';
    if (!is_dir($cacheDir)) @mkdir($cacheDir, 0775, true);
    $cacheFile = $cacheDir . '/market-' . sha1($url) . '.json';
    if (is_file($cacheFile) && time() - (int) filemtime($cacheFile) < 300) {
        $cached = json_decode((string) file_get_contents($cacheFile), true);
        if (is_array($cached)) return $cached;
    }

    $keys = market_keys();
    $tries = max(1, count($keys));
    for ($attempt = 0; $attempt < $tries; $attempt++) {
        $usage = market_usage_today();
        $key = market_pick_key($usage);
        if ($key === null) {
            fail('MARKET_LIMIT', '今日角色卡接口额度已用完（' . count($keys) . ' 个 Key 各 500 次），请明天再试', 429);
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'X-API-Key: ' . $key],
        ]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $err !== '') fail('MARKET_UNREACHABLE', '角色卡广场暂时连不上：' . $err, 502);

        // 某个 Key 失效或超限：标记用完，换下一个
        if ($code === 401 || $code === 403 || $code === 429) {
            market_exhaust_key($key);
            continue;
        }
        if ($code >= 400) fail('MARKET_ERROR', '角色卡广场返回 ' . $code, 502);

        $json = json_decode((string) $raw, true);
        if (!is_array($json)) fail('MARKET_ERROR', '角色卡广场返回格式异常', 502);

        market_bump_key($key);
        @file_put_contents($cacheFile, (string) $raw);
        return $json;
    }

    fail('MARKET_LIMIT', '角色卡广场的 Key 暂时都不可用，请稍后再试', 429);
}

function market_card_brief(array $it): array
{
    return [
        'id' => (int) ($it['id'] ?? 0),
        'title' => (string) ($it['title'] ?? ''),
        'author' => (string) ($it['author'] ?? ''),
        'tags' => (string) ($it['tags'] ?? ''),
        'copyCount' => (int) ($it['copy_count'] ?? 0),
        'createdAt' => (string) ($it['created_at'] ?? ''),
    ];
}
