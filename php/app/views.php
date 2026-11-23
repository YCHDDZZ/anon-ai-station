<?php
declare(strict_types=1);

function public_persona(?array $row): ?array
{
    if (!$row) return null;
    return [
        'id' => (int) $row['id'],
        'scope' => $row['owner_type'],
        'name' => $row['name'],
        'description' => $row['description'] ?? '',
        'prompt' => $row['prompt'],
        'enabled' => (bool) $row['enabled'],
        'isDefault' => $row['owner_type'] === 'global' && (int) $row['sort'] === 0,
    ];
}

function personas_for(array $user): array
{
    $global = db_all("SELECT * FROM `personas` WHERE `owner_type` = 'global' AND `enabled` = 1 ORDER BY `sort`,`id`");
    $own = db_all("SELECT * FROM `personas` WHERE `owner_type` = 'user' AND `owner_id` = ? AND `enabled` = 1 ORDER BY `id`", [(int) $user['id']]);
    return ['global' => array_map('public_persona', $global), 'own' => array_map('public_persona', $own)];
}

function collect_models(array $user): array
{
    $seen = [];
    $items = [];
    $default = '';
    foreach (resolve_attempts($user, 'llm') as $p) {
        if ($default === '') $default = $p['model'];
        $models = is_array($p['extra']['models'] ?? null) ? $p['extra']['models'] : [];
        if (!$models && $p['model']) $models = [$p['model']];
        foreach ($models as $m) {
            if ($m === '' || isset($seen[$m])) continue;
            $seen[$m] = true;
            $cfg = $p['extra']['modelConfig'][$m] ?? [];
            $items[] = [
                'model' => $m,
                'providerId' => (int) $p['id'],
                'providerName' => $p['name'] !== '' ? $p['name'] : ($p['ownerType'] === 'user' ? '我的线路' : '共享线路'),
                'ownerType' => $p['ownerType'],
                'label' => (string) ($cfg['label'] ?? ''),
                'labelColor' => (string) ($cfg['labelColor'] ?? ''),
                'effort' => (string) ($cfg['effort'] ?? ''),
                'context' => (int) ($cfg['context'] ?? 0),
            ];
        }
    }

    // 先按线路分组（保持接口原始优先级）
    $groups = [];
    foreach ($items as $it) {
        $pid = (int) $it['providerId'];
        if (!isset($groups[$pid])) {
            $groups[$pid] = ['providerId' => $pid, 'providerName' => $it['providerName'], 'models' => []];
        }
        $groups[$pid]['models'][] = $it;
    }
    $groups = array_values($groups);

    // 后台保存的两级顺序：providers 决定分组顺序，models 决定组内顺序
    $saved = json_decode(setting('modelGroups', '{}'), true);
    $saved = is_array($saved) ? $saved : [];
    $provOrder = array_map('intval', (array) ($saved['providers'] ?? []));
    $modelOrder = is_array($saved['models'] ?? null) ? $saved['models'] : [];

    // 兼容旧版扁平 modelOrder：只作为组内顺序的兜底
    $legacy = json_decode(setting('modelOrder', '[]'), true);
    $legacyPos = [];
    if (is_array($legacy)) {
        foreach ($legacy as $i => $n) $legacyPos[(string) $n] = $i;
    }

    if ($provOrder) {
        $pos = array_flip($provOrder);
        usort($groups, fn($a, $b) => ($pos[$a['providerId']] ?? 999) <=> ($pos[$b['providerId']] ?? 999));
    }

    foreach ($groups as &$g) {
        $names = array_map('strval', (array) ($modelOrder[$g['providerId']] ?? []));
        if ($names) {
            $pos = array_flip($names);
            usort($g['models'], fn($a, $b) => ($pos[$a['model']] ?? 999) <=> ($pos[$b['model']] ?? 999));
        } elseif ($legacyPos) {
            usort($g['models'], fn($a, $b) => ($legacyPos[$a['model']] ?? 999) <=> ($legacyPos[$b['model']] ?? 999));
        }
    }
    unset($g);

    $flat = [];
    foreach ($groups as $g) {
        foreach ($g['models'] as $it) $flat[] = $it;
    }

    return [
        'list' => array_column($flat, 'model'),
        'items' => $flat,
        'groups' => $groups,
        'defaultModel' => $default,
    ];
}

function tts_voices(?array $user): array
{
    if (!$user) return ['list' => [], 'defaultVoice' => ''];
    foreach (resolve_attempts($user, 'tts') as $p) {
        $list = is_array($p['extra']['voices'] ?? null) ? $p['extra']['voices'] : [];
        if ($list) return ['list' => array_values($list), 'defaultVoice' => (string) ($p['extra']['defaultVoice'] ?? '')];
    }
    return ['list' => [], 'defaultVoice' => ''];
}

function category_view(?array $user, string $cat): array
{
    $own = $user ? array_map('provider_public', provider_rows('user', (int) $user['id'], $cat)) : [];
    $shared = array_map('provider_public', provider_rows('global', null, $cat));
    return [
        'key' => $cat,
        'label' => CATEGORY_META[$cat]['label'],
        'hint' => CATEGORY_META[$cat]['hint'],
        'needsModel' => CATEGORY_META[$cat]['needsModel'] ?? false,
        'modelHint' => CATEGORY_META[$cat]['modelHint'] ?? '',
        'defaults' => DEFAULT_EXTRA[$cat],
        'entries' => $own,
        'sharedEntries' => $shared,
        'shared' => $shared[0] ?? null,
        'sharedAvailable' => (bool) array_filter($shared, fn($p) => $p['enabled']),
        'own' => $own[0] ?? null,
        'routing' => $user ? routing_get('user', (int) $user['id'], $cat) : 'failover',
        'sharedRouting' => routing_get('global', null, $cat),
    ];
}

function fetch_models_openai(array $p): array
{
    $base = rtrim($p['baseUrl'], '/');
    $path = (string) ($p['extra']['modelsPath'] ?? '/models');
    $url = $base . (str_starts_with($path, '/') ? $path : '/' . $path);
    $ch = curl_init($url);
    $headers = ['Accept: application/json'];
    $auth = $p['extra']['auth'] ?? ['type' => 'header', 'name' => 'Authorization', 'prefix' => 'Bearer '];
    if ($p['apiKey'] !== '' && ($auth['type'] ?? 'header') === 'header') {
        $headers[] = ($auth['name'] ?? 'Authorization') . ': ' . ($auth['prefix'] ?? 'Bearer ') . $p['apiKey'];
    }
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 30]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $err !== '') fail('PROVIDER_UNREACHABLE', '无法连接上游：' . $err, 502);
    if ($code >= 400) fail('PROVIDER_HTTP_ERROR', '上游返回 ' . $code, 502);
    $json = json_decode((string) $raw, true);
    $arr = null;
    foreach (['data', 'models', 'result', 'items', 'list'] as $k) {
        if (is_array($json[$k] ?? null)) {
            $arr = $json[$k];
            break;
        }
    }
    if (!is_array($arr) && is_array($json)) $arr = $json;
    $out = [];
    foreach ($arr ?: [] as $item) {
        $id = is_string($item) ? $item : (string) ($item['id'] ?? $item['name'] ?? $item['model'] ?? '');
        if ($id !== '') {
            $ctx = (int) ($item['context_length'] ?? $item['context_window'] ?? $item['max_context_length'] ?? 0);
            $out[$id] = ['id' => $id, 'label' => (string) ($item['label'] ?? $item['display_name'] ?? ''), 'context' => $ctx];
        }
    }
    ksort($out);
    return array_values($out);
}

function handle_provider_route(string $method, string $scope, string $ownerType, array $user, string $cat, ?int $id, string $action, ?string $subId): never
{
    if ($cat === '' || !in_array($cat, CATEGORIES, true)) fail('BAD_REQUEST', '未知的能力类型', 400);
    $ownerId = $ownerType === 'global' ? null : (int) $user['id'];
    $base = '/api/' . $scope . '/providers/' . $cat;

    $owned = function (?array $row) use ($ownerType, $ownerId): bool {
        if (!$row) return false;
        if ($row['owner_type'] !== $ownerType) return false;
        return $ownerType === 'global' || (int) $row['owner_id'] === (int) $ownerId;
    };

    if ($action === 'routing' && $method === 'PATCH') {
        $mode = body_json()['mode'] ?? '';
        json_out(['ok' => true, 'routing' => routing_set($ownerType, $ownerId, $cat, (string) $mode)]);
    }

    if ($ownerType === 'user' && in_array($action, ['models', 'test'], true)
        && setting('userProvidersOpen', 'false') !== 'true') {
        fail('FORBIDDEN', '用户自建 API 功能将在后续版本开放，当前请使用管理员共享的算力', 403);
    }

    if ($action === 'models' && $method === 'POST') {
        $b = body_json();
        $baseUrl = trim((string) ($b['baseUrl'] ?? ''));
        $apiKey = (string) ($b['apiKey'] ?? '');
        $extra = is_array($b['extra'] ?? null) ? $b['extra'] : [];
        if (!empty($b['providerId'])) {
            $row = provider_row((int) $b['providerId']);
            if (!$owned($row)) fail('NOT_FOUND', '接口配置不存在', 404);
            $baseUrl = $baseUrl ?: $row['base_url'];
            if ($apiKey === '') $apiKey = decrypt_secret($row['api_key_enc']);
            if (!$extra) $extra = json_decode($row['extra_json'] ?: '{}', true) ?: [];
        }
        if ($baseUrl === '' || !preg_match('#^https?://#i', $baseUrl)) fail('BAD_REQUEST', '请填写合法的接口地址', 400);
        $p = ['baseUrl' => $baseUrl, 'apiKey' => $apiKey, 'extra' => array_replace_recursive(DEFAULT_EXTRA[$cat], $extra)];
        $models = fetch_models_openai($p);
        json_out(['ok' => true, 'models' => $models, 'count' => count($models), 'category' => $cat]);
    }

    if ($id === null && $method === 'GET') {
        json_out(['ok' => true, 'category' => $cat, 'routing' => routing_get($ownerType, $ownerId, $cat), 'entries' => array_map('provider_public', provider_rows($ownerType, $ownerId, $cat))]);
    }

    if ($id === null && $method === 'POST') {
        if ($ownerType === 'user' && setting('userProvidersOpen', 'false') !== 'true') {
            fail('FORBIDDEN', '用户自建 API 功能将在后续版本开放，当前请使用管理员共享的算力', 403);
        }
        $b = body_json();
        $baseUrl = trim((string) ($b['baseUrl'] ?? ''));
        if ($baseUrl === '' || !preg_match('#^https?://#i', $baseUrl)) fail('BAD_REQUEST', '请填写合法的接口地址', 400);
        $row = provider_save([
            'owner_type' => $ownerType,
            'owner_id' => $ownerId,
            'category' => $cat,
            'name' => (string) ($b['name'] ?? ''),
            'base_url' => $baseUrl,
            'api_key' => array_key_exists('apiKey', $b) ? (string) $b['apiKey'] : null,
            'model' => (string) ($b['model'] ?? ''),
            'extra' => $b['extra'] ?? new stdClass(),
            'enabled' => $b['enabled'] ?? true,
            'error_message' => (string) ($b['errorMessage'] ?? ''),
        ]);
        json_out(['ok' => true, 'provider' => provider_public($row)]);
    }

    if ($id === null && $method === 'PUT') {
        if ($ownerType === 'user' && setting('userProvidersOpen', 'false') !== 'true') {
            fail('FORBIDDEN', '用户自建 API 功能将在后续版本开放，当前请使用管理员共享的算力', 403);
        }
        $b = body_json();
        $existing = provider_rows($ownerType, $ownerId, $cat)[0] ?? null;
        $row = provider_save([
            'owner_type' => $ownerType,
            'owner_id' => $ownerId,
            'category' => $cat,
            'name' => (string) ($b['name'] ?? ''),
            'base_url' => trim((string) ($b['baseUrl'] ?? '')),
            'api_key' => array_key_exists('apiKey', $b) ? (string) $b['apiKey'] : null,
            'model' => (string) ($b['model'] ?? ''),
            'extra' => $b['extra'] ?? new stdClass(),
            'enabled' => $b['enabled'] ?? true,
            'error_message' => (string) ($b['errorMessage'] ?? ''),
        ], $existing ? (int) $existing['id'] : null);
        json_out(['ok' => true, 'provider' => provider_public($row)]);
    }

    if ($id !== null) {
        $row = provider_row($id);
        if (!$owned($row) || $row['category'] !== $cat) fail('NOT_FOUND', '接口配置不存在', 404);

        if ($action === 'keys' && $method === 'POST') {
            $key = trim((string) (body_json()['key'] ?? ''));
            if ($key === '') fail('BAD_REQUEST', 'Key 不能为空', 400);
            db_run('INSERT INTO `provider_keys`(`provider_id`,`label`,`key_enc`,`enabled`,`fail_count`,`created_at`) VALUES(?,?,?,1,0,?)', [(int) $row['id'], (string) (body_json()['label'] ?? ''), encrypt_secret($key), now_ms()]);
            json_out(['ok' => true, 'provider' => provider_public(provider_row((int) $row['id']))]);
        }

        if ($action === 'keys' && $method === 'DELETE' && $subId !== null) {
            db_run('DELETE FROM `provider_keys` WHERE `id` = ? AND `provider_id` = ?', [(int) $subId, (int) $row['id']]);
            json_out(['ok' => true, 'provider' => provider_public(provider_row((int) $row['id']))]);
        }

        if ($action === 'test' && $method === 'POST') {
            $rt = provider_runtime($row);
            try {
                if ($cat === 'llm') {
                    $models = fetch_models_openai($rt);
                    $sample = count($models) . ' 个模型';
                } elseif ($cat === 'parse' && ($rt['extra']['mode'] ?? '') === 'docmind') {
                    $sample = docmind_test($rt)['sample'];
                } else {
                    $sample = '配置已保存（PHP 版只对 LLM 做深度探测）';
                }
                provider_mark((int) $row['id'], true);
                json_out(['ok' => true, 'result' => ['ok' => true, 'ms' => 0, 'sample' => $sample]]);
            } catch (Throwable $e) {
                provider_mark((int) $row['id'], false, $e->getMessage());
                json_out(['ok' => true, 'result' => ['ok' => false, 'error' => $e->getMessage()]]);
            }
        }

        if ($method === 'PUT') {
            $b = body_json();
            $row = provider_save([
                'owner_type' => $ownerType,
                'owner_id' => $ownerId,
                'category' => $cat,
                'name' => $b['name'] ?? $row['name'],
                'base_url' => $b['baseUrl'] ?? $row['base_url'],
                'api_key' => array_key_exists('apiKey', $b) ? (string) $b['apiKey'] : null,
                'model' => $b['model'] ?? $row['model'],
                'extra' => $b['extra'] ?? (json_decode($row['extra_json'] ?: '{}', true) ?: new stdClass()),
                'enabled' => $b['enabled'] ?? (bool) $row['enabled'],
                'error_message' => $b['errorMessage'] ?? $row['error_message'],
            ], (int) $row['id']);
            json_out(['ok' => true, 'provider' => provider_public($row)]);
        }

        if ($method === 'DELETE') {
            provider_delete((int) $row['id']);
            json_out(['ok' => true]);
        }
    }

    if ($id === null && $method === 'DELETE') {
        foreach (provider_rows($ownerType, $ownerId, $cat) as $row) provider_delete((int) $row['id']);
        json_out(['ok' => true]);
    }

    fail('NOT_FOUND', '接口不存在', 404);
}
