<?php
declare(strict_types=1);

const CATEGORIES = ['llm', 'search', 'crawl', 'parse', 'ocr', 'tts', 'asr'];

const CATEGORY_META = [
    'llm' => ['label' => '大模型', 'hint' => 'OpenAI 兼容的 chat/completions 接口', 'needsModel' => true, 'modelHint' => '对话使用的模型'],
    'search' => ['label' => '联网搜索', 'hint' => '返回 { results: [{ title, url, snippet }] }'],
    'crawl' => ['label' => '网页爬取', 'hint' => '输入 url，返回网页正文'],
    'parse' => ['label' => '文件解析', 'hint' => '上传文件，返回提取出的文本', 'needsModel' => true, 'modelHint' => '解析模型名（可选）'],
    'ocr' => ['label' => '图片 OCR', 'hint' => '上传图片，返回识别文字', 'needsModel' => true, 'modelHint' => '视觉模型名'],
    'tts' => ['label' => '语音合成 TTS', 'hint' => '输入文本，返回音频流', 'needsModel' => true, 'modelHint' => '语音合成模型名'],
    'asr' => ['label' => '语音识别 ASR', 'hint' => '上传音频，返回转写文本', 'needsModel' => true, 'modelHint' => '语音识别模型名'],
];

const DEFAULT_EXTRA = [
    'llm' => ['path' => '/chat/completions', 'method' => 'POST', 'auth' => ['type' => 'header', 'name' => 'Authorization', 'prefix' => 'Bearer '], 'timeoutMs' => 120000],
    'search' => ['path' => '/search', 'method' => 'POST', 'auth' => ['type' => 'header', 'name' => 'Authorization', 'prefix' => 'Bearer '], 'headers' => ['Content-Type' => 'application/json'], 'body' => ['query' => '{{query}}', 'max_results' => '{{limit}}'], 'resultPath' => 'results', 'fieldMap' => ['title' => 'title', 'url' => 'url', 'snippet' => 'content'], 'timeoutMs' => 30000],
    'crawl' => ['path' => '/crawl', 'method' => 'POST', 'auth' => ['type' => 'header', 'name' => 'Authorization', 'prefix' => 'Bearer '], 'headers' => ['Content-Type' => 'application/json'], 'body' => ['url' => '{{url}}'], 'textPath' => 'text', 'titlePath' => 'title', 'timeoutMs' => 60000],
    'parse' => ['path' => '/parse', 'method' => 'POST', 'auth' => ['type' => 'header', 'name' => 'Authorization', 'prefix' => 'Bearer '], 'fileField' => 'file', 'textPath' => 'text', 'timeoutMs' => 120000, 'mode' => 'http'],
    'ocr' => ['path' => '/ocr', 'method' => 'POST', 'auth' => ['type' => 'header', 'name' => 'Authorization', 'prefix' => 'Bearer '], 'fileField' => 'file', 'textPath' => 'text', 'timeoutMs' => 120000],
    'tts' => ['path' => '/tts', 'method' => 'POST', 'auth' => ['type' => 'header', 'name' => 'Authorization', 'prefix' => 'Bearer '], 'headers' => ['Content-Type' => 'application/json'], 'body' => ['text' => '{{text}}', 'voice' => '{{voice}}'], 'binary' => true, 'timeoutMs' => 60000],
    'asr' => ['path' => '/asr', 'method' => 'POST', 'auth' => ['type' => 'header', 'name' => 'Authorization', 'prefix' => 'Bearer '], 'fileField' => 'file', 'textPath' => 'text', 'timeoutMs' => 120000],
];

function provider_extra(array $row): array
{
    $extra = json_decode($row['extra_json'] ?: '{}', true);
    return array_replace_recursive(DEFAULT_EXTRA[$row['category']] ?? [], is_array($extra) ? $extra : []);
}

function provider_runtime(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'ownerType' => $row['owner_type'],
        'category' => $row['category'],
        'name' => $row['name'] ?: '',
        'baseUrl' => $row['base_url'],
        'apiKey' => decrypt_secret($row['api_key_enc'] ?? ''),
        'model' => $row['model'] ?: '',
        'errorMessage' => $row['error_message'] ?? '',
        'extra' => provider_extra($row),
    ];
}

function provider_keys(int $providerId): array
{
    return db_all('SELECT * FROM `provider_keys` WHERE `provider_id` = ? ORDER BY id', [$providerId]);
}

function provider_key_list(int $providerId, bool $withSecret = false): array
{
    $out = [];
    foreach (provider_keys($providerId) as $k) {
        $plain = decrypt_secret($k['key_enc']);
        $out[] = [
            'id' => (int) $k['id'],
            'label' => $k['label'] ?: '',
            'masked' => mask_key($plain),
            'enabled' => (bool) $k['enabled'],
            'lastUsedAt' => $k['last_used_at'] !== null ? (int) $k['last_used_at'] : null,
            'createdAt' => (int) $k['created_at'],
            ...($withSecret ? ['key' => $plain] : []),
        ];
    }
    return $out;
}

function provider_public(array $row): array
{
    return [
        'id' => (int) $row['id'],
        'ownerType' => $row['owner_type'],
        'category' => $row['category'],
        'name' => $row['name'] ?: '',
        'baseUrl' => $row['base_url'],
        'model' => $row['model'] ?: '',
        'errorMessage' => $row['error_message'] ?? '',
        'apiKeyMasked' => mask_key(decrypt_secret($row['api_key_enc'] ?? '')),
        'hasApiKey' => !empty($row['api_key_enc']),
        'keys' => provider_key_list((int) $row['id']),
        'extra' => json_decode($row['extra_json'] ?: '{}', true) ?: new stdClass(),
        'enabled' => (bool) $row['enabled'],
        'sort' => (int) $row['sort'],
        'lastStatus' => $row['last_status'],
        'lastError' => $row['last_error'],
        'lastCheckedAt' => $row['last_checked_at'] !== null ? (int) $row['last_checked_at'] : null,
        'updatedAt' => (int) $row['updated_at'],
    ];
}

function provider_rows(string $ownerType, ?int $ownerId, ?string $category = null): array
{
    $params = [$ownerType, $ownerId ?? 0];
    $sql = 'SELECT * FROM `providers` WHERE `owner_type` = ? AND COALESCE(`owner_id`,0) = ?';
    if ($category !== null) {
        $sql .= ' AND `category` = ?';
        $params[] = $category;
    }
    $sql .= ' ORDER BY `category`, `sort`, `id`';
    return db_all($sql, $params);
}

function provider_row(int $id): ?array
{
    return db_get('SELECT * FROM `providers` WHERE `id` = ?', [$id]);
}

function routing_get(string $ownerType, ?int $ownerId, string $category): string
{
    $row = db_get(
        'SELECT `mode` FROM `routing` WHERE `owner_type` = ? AND `owner_id` = ? AND `category` = ?',
        [$ownerType, $ownerId ?? 0, $category]
    );
    return $row['mode'] ?? 'failover';
}

function routing_set(string $ownerType, ?int $ownerId, string $category, string $mode): string
{
    if (!in_array($mode, ['failover', 'round_robin'], true)) fail('BAD_REQUEST', '无效的调度策略');
    db_upsert('routing', [
        'owner_type' => $ownerType,
        'owner_id' => $ownerId ?? 0,
        'category' => $category,
        'mode' => $mode,
    ], ['owner_type', 'owner_id', 'category']);
    return $mode;
}

/** 生成可用尝试列表：自有/共享顺序 + 多 Key */
function resolve_attempts(array $user, string $category): array
{
    $own = provider_rows('user', (int) $user['id'], $category);
    $shared = provider_rows('global', null, $category);
    $rows = ($user['provider_preference'] ?? 'own_first') === 'shared_first'
        ? array_merge($shared, $own)
        : array_merge($own, $shared);

    $out = [];
    $seen = [];
    foreach ($rows as $row) {
        if (!(int) $row['enabled']) continue;
        $rt = provider_runtime($row);
        $keys = [];
        if ($rt['apiKey'] !== '') $keys[] = $rt['apiKey'];
        foreach (provider_keys((int) $row['id']) as $k) {
            if (!(int) $k['enabled']) continue;
            $plain = decrypt_secret($k['key_enc']);
            if ($plain !== '' && !in_array($plain, $keys, true)) $keys[] = $plain;
        }
        if (!$keys) $keys = [''];
        foreach ($keys as $key) {
            $sig = $rt['id'] . '|' . $key;
            if (isset($seen[$sig])) continue;
            $seen[$sig] = true;
            $rt['apiKey'] = $key;
            $out[] = $rt;
        }
    }
    return $out;
}

function provider_save(array $data, ?int $id = null): array
{
    $now = now_ms();
    $fields = [
        'owner_type' => $data['owner_type'],
        'owner_id' => $data['owner_id'] ?? null,
        'category' => $data['category'],
        'name' => $data['name'] ?? '',
        'base_url' => $data['base_url'],
        'model' => $data['model'] ?? '',
        'extra_json' => json_encode($data['extra'] ?? new stdClass(), JSON_UNESCAPED_UNICODE),
        'enabled' => !empty($data['enabled']) ? 1 : 0,
        'sort' => (int) ($data['sort'] ?? 0),
        'error_message' => $data['error_message'] ?? '',
        'updated_at' => $now,
    ];
    if (array_key_exists('api_key', $data) && $data['api_key'] !== null) {
        $fields['api_key_enc'] = encrypt_secret((string) $data['api_key']);
    }
    if ($id === null) {
        $fields['created_at'] = $now;
        $cols = array_keys($fields);
        $sql = 'INSERT INTO `providers`(`' . implode('`,`', $cols) . '`) VALUES(' . implode(',', array_fill(0, count($cols), '?')) . ')';
        db_run($sql, array_values($fields));
        return provider_row(db_last_id());
    }
    $sets = implode(', ', array_map(fn($c) => "`$c` = ?", array_keys($fields)));
    $params = array_values($fields);
    $params[] = $id;
    db_run("UPDATE `providers` SET $sets WHERE `id` = ?", $params);
    return provider_row($id);
}

function provider_delete(int $id): void
{
    db_run('DELETE FROM `provider_keys` WHERE `provider_id` = ?', [$id]);
    db_run('DELETE FROM `providers` WHERE `id` = ?', [$id]);
}

function provider_mark(int $id, bool $ok, string $error = ''): void
{
    db_run(
        'UPDATE `providers` SET `last_status` = ?, `last_error` = ?, `last_checked_at` = ? WHERE `id` = ?',
        [$ok ? 'ok' : 'error', $ok ? null : substr($error, 0, 300), now_ms(), $id]
    );
}
