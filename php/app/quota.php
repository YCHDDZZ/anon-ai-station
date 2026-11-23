<?php
declare(strict_types=1);

const QUOTA_DEFAULTS = [
    'search' => ['unit' => 'credit', 'monthly' => 1000, 'price' => 0.008, 'currency' => 'USD', 'warnAt' => 90, 'track' => true],
    'crawl' => ['unit' => 'credit', 'monthly' => 1000, 'price' => 0.008, 'currency' => 'USD', 'warnAt' => 90, 'track' => true],
    'parse' => ['unit' => 'page', 'monthly' => 3000, 'price' => 0.02, 'currency' => 'CNY', 'warnAt' => 90, 'track' => true],
    'ocr' => ['unit' => 'page', 'monthly' => 0, 'price' => 0, 'currency' => 'CNY', 'warnAt' => 90, 'track' => false],
    'llm' => ['unit' => 'credit', 'monthly' => 0, 'price' => 0, 'currency' => 'CNY', 'warnAt' => 90, 'track' => false],
    'tts' => ['unit' => '次', 'monthly' => 0, 'price' => 0, 'currency' => 'CNY', 'warnAt' => 90, 'track' => false],
    'asr' => ['unit' => '次', 'monthly' => 0, 'price' => 0, 'currency' => 'CNY', 'warnAt' => 90, 'track' => false],
];

function period_key(): string
{
    return date('Y-m');
}

function eligible_user_count(): int
{
    $row = db_get("SELECT COUNT(*) c FROM `users` WHERE `status` = 'active'");
    return max(1, (int) ($row['c'] ?? 1));
}

function quota_of(array $provider): array
{
    $defaults = QUOTA_DEFAULTS[$provider['category']] ?? QUOTA_DEFAULTS['search'];
    $extra = $provider['extra'] ?? [];
    $raw = is_array($extra['quota'] ?? null) ? $extra['quota'] : [];
    $q = array_merge($defaults, $raw);
    $q['monthly'] = max(0, (float) $q['monthly']);
    $q['price'] = max(0, (float) $q['price']);
    $q['warnAt'] = min(100, max(1, (int) $q['warnAt']));
    $q['unit'] = (string) $q['unit'];
    $q['currency'] = ($q['currency'] ?? 'CNY') === 'USD' ? 'USD' : 'CNY';
    $q['scope'] = !empty($raw['group']) ? 'g:' . substr((string) $raw['group'], 0, 40) : 'p:' . $provider['id'];
    return $q;
}

function scope_of_row(array $row): string
{
    $extra = json_decode($row['extra_json'] ?: '{}', true) ?: [];
    $group = $extra['quota']['group'] ?? '';
    return $group !== '' ? 'g:' . substr((string) $group, 0, 40) : 'p:' . $row['id'];
}

function scope_used(string $scope, ?string $period = null): float
{
    $row = db_get('SELECT `units` FROM `usage_counters` WHERE `scope` = ? AND `period` = ?', [$scope, $period ?? period_key()]);
    return (float) ($row['units'] ?? 0);
}

function assert_global_quota(array $p, float $units): void
{
    $q = quota_of($p);
    if (!($q['track'] ?? true) || $q['monthly'] <= 0) return;
    $used = scope_used($q['scope']);
    if ($used + $units <= $q['monthly'] + 1e-9) return;
    fail(
        'QUOTA_EXCEEDED',
        '本月' . category_label($p['category']) . '的 ' . $q['monthly'] . ' ' . unit_label($q['unit'])
        . '额度已用完（已用 ' . $used . '），为避免产生后付费已暂停该接口。',
        402,
        ['scope' => $q['scope'], 'used' => $used, 'monthly' => $q['monthly'], 'unit' => unit_label($q['unit']), 'hardCap' => true]
    );
}

function user_used(string $scope, int $userId, ?string $period = null): array
{
    $row = db_get(
        'SELECT `units`,`calls` FROM `usage_user_counters` WHERE `scope` = ? AND `period` = ? AND `user_id` = ?',
        [$scope, $period ?? period_key(), $userId]
    );
    return ['units' => (float) ($row['units'] ?? 0), 'calls' => (int) ($row['calls'] ?? 0)];
}

function assert_user_quota(array $user, array $p, float $units): void
{
    $q = quota_of($p);
    if (!($q['track'] ?? true) || $q['monthly'] <= 0) return;
    $total = eligible_user_count();
    $share = $q['monthly'] / $total;
    $used = user_used($q['scope'], (int) $user['id'])['units'];
    if ($used + $units <= $share + 1e-9) return;
    fail(
        'QUOTA_EXCEEDED',
        '你本月的' . category_label($p['category']) . '额度已用完（' . $used . ' / ' . floor($share) . ' ' . unit_label($q['unit']) . '）。'
        . '共享额度由 ' . $total . ' 个账号平均分配，用完不能占用他人份额；可以联系管理员调整共享额度。',
        402,
        ['scope' => $q['scope'], 'used' => $used, 'share' => $share, 'total' => $total, 'unit' => unit_label($q['unit'])]
    );
}

function record_usage(array $p, float $units, ?array $user = null, string $detail = ''): void
{
    if (($p['ownerType'] ?? 'global') !== 'global') return;
    $q = quota_of($p);
    if (!($q['track'] ?? true) || $units <= 0) return;
    $period = period_key();
    $cost = round($units * $q['price'], 4);
    $row = db_get('SELECT * FROM `usage_counters` WHERE `scope` = ? AND `period` = ?', [$q['scope'], $period]);
    if ($row) {
        db_run('UPDATE `usage_counters` SET `calls` = `calls` + 1, `units` = `units` + ?, `cost` = `cost` + ?, `updated_at` = ? WHERE `scope` = ? AND `period` = ?', [$units, $cost, now_ms(), $q['scope'], $period]);
    } else {
        db_run('INSERT INTO `usage_counters`(`scope`,`period`,`calls`,`units`,`cost`,`updated_at`) VALUES(?,?,1,?,?,?)', [$q['scope'], $period, $units, $cost, now_ms()]);
    }
    db_run(
        'INSERT INTO `usage_log`(`scope`,`provider_id`,`category`,`units`,`cost`,`detail`,`created_at`) VALUES(?,?,?,?,?,?,?)',
        [$q['scope'], (int) $p['id'], $p['category'], $units, $cost, substr($detail, 0, 200), now_ms()]
    );
    // 并发请求可能同时通过校验；记账后越线立即停用该组接口，确保不会产生后付费
    if ($q['monthly'] > 0 && scope_used($q['scope'], $period) > $q['monthly'] + 1e-9) {
        $disabled = disable_scope($q['scope']);
        if ($disabled > 0) log_event('quota_auto_disable', $q['scope'] . ' 已用 ' . scope_used($q['scope'], $period) . ' / ' . $q['monthly']);
    }

    if ($user && !empty($user['id'])) {
        $urow = db_get('SELECT * FROM `usage_user_counters` WHERE `scope` = ? AND `period` = ? AND `user_id` = ?', [$q['scope'], $period, (int) $user['id']]);
        if ($urow) {
            db_run('UPDATE `usage_user_counters` SET `calls` = `calls` + 1, `units` = `units` + ?, `cost` = `cost` + ?, `updated_at` = ? WHERE `scope` = ? AND `period` = ? AND `user_id` = ?', [$units, $cost, now_ms(), $q['scope'], $period, (int) $user['id']]);
        } else {
            db_run('INSERT INTO `usage_user_counters`(`scope`,`period`,`user_id`,`calls`,`units`,`cost`,`updated_at`) VALUES(?,?,?,1,?,?,?)', [$q['scope'], $period, (int) $user['id'], $units, $cost, now_ms()]);
        }
    }
}

function user_quota_summary(array $user): array
{
    $period = period_key();
    $total = eligible_user_count();
    $seen = [];
    $items = [];
    foreach (db_all("SELECT * FROM `providers` WHERE `owner_type` = 'global' AND `enabled` = 1") as $row) {
        $extra = json_decode($row['extra_json'] ?: '{}', true) ?: [];
        $q = quota_of(['id' => (int) $row['id'], 'category' => $row['category'], 'extra' => $extra]);
        if (isset($seen[$q['scope']])) continue;
        $seen[$q['scope']] = true;
        if (!($q['track'] ?? true) || $q['monthly'] <= 0) continue;
        $share = $q['monthly'] / $total;
        $used = user_used($q['scope'], (int) $user['id'], $period);
        $items[] = [
            'scope' => $q['scope'],
            'label' => ($extra['quota']['group'] ?? '') ?: category_label($row['category']),
            'unit' => $q['unit'],
            'unitLabel' => unit_label($q['unit']),
            'currency' => $q['currency'],
            'monthly' => $q['monthly'],
            'users' => $total,
            'share' => $share,
            'shareDisplay' => (int) floor($share),
            'shareText' => (string) (int) floor($share),
            'used' => $used['units'],
            'calls' => $used['calls'],
            'percent' => $share > 0 ? min(999, (int) round($used['units'] / $share * 100)) : 0,
            'cost' => round($used['units'] * $q['price'], 4),
        ];
    }
    return ['period' => $period, 'users' => $total, 'items' => $items];
}

function usage_summary(): array
{
    $period = period_key();
    $users = eligible_user_count();
    $map = [];
    foreach (db_all("SELECT * FROM `providers` WHERE `owner_type` = 'global' ORDER BY `category`,`sort`,`id`") as $row) {
        $extra = json_decode($row['extra_json'] ?: '{}', true) ?: [];
        $q = quota_of(['id' => (int) $row['id'], 'category' => $row['category'], 'extra' => $extra]);
        if (!isset($map[$q['scope']])) {
            $map[$q['scope']] = [
                'scope' => $q['scope'],
                'group' => $extra['quota']['group'] ?? '',
                'unit' => $q['unit'],
                'unitLabel' => unit_label($q['unit']),
                'monthly' => $q['monthly'],
                'price' => $q['price'],
                'currency' => $q['currency'],
                'warnAt' => $q['warnAt'],
                'tracked' => ($q['track'] ?? true) !== false,
                'providers' => [],
                'used' => 0,
                'calls' => 0,
                'cost' => 0,
            ];
        }
        $map[$q['scope']]['providers'][] = ['id' => (int) $row['id'], 'name' => $row['name'] ?: $row['category'], 'category' => $row['category'], 'enabled' => (bool) $row['enabled']];
    }
    foreach ($map as &$item) {
        $u = db_get('SELECT * FROM `usage_counters` WHERE `scope` = ? AND `period` = ?', [$item['scope'], $period]);
        if ($u) {
            $item['used'] = (float) $u['units'];
            $item['calls'] = (int) $u['calls'];
            $item['cost'] = (float) $u['cost'];
        }
        $item['users'] = $users;
        $item['share'] = $users > 0 ? $item['monthly'] / $users : $item['monthly'];
        $item['shareDisplay'] = (int) floor($item['share']);
        $item['shareText'] = (string) $item['shareDisplay'];
        $item['percent'] = $item['monthly'] > 0 ? min(999, (int) round($item['used'] / $item['monthly'] * 100)) : 0;
        $item['status'] = !$item['tracked'] ? 'off' : ($item['monthly'] <= 0 ? 'unset' : ($item['percent'] >= 100 ? 'over' : ($item['percent'] >= $item['warnAt'] ? 'warn' : 'ok')));
        $item['costText'] = ($item['currency'] === 'USD' ? '$' : '¥') . number_format($item['cost'], 2);
        $item['topUsers'] = db_all(
            'SELECT c.`user_id`,c.`units`,c.`calls`,u.`email` FROM `usage_user_counters` c LEFT JOIN `users` u ON u.`id` = c.`user_id` WHERE c.`scope` = ? AND c.`period` = ? ORDER BY c.`units` DESC LIMIT 6',
            [$item['scope'], $period]
        );
    }
    unset($item);
    $items = array_values(array_filter($map, fn($i) => $i['tracked'] || $i['monthly'] > 0 || $i['used'] > 0));
    usort($items, fn($a, $b) => $b['percent'] <=> $a['percent']);
    return ['period' => $period, 'users' => $users, 'items' => $items, 'alerts' => []];
}

function reset_usage(string $scope): void
{
    $period = period_key();
    db_run('DELETE FROM `usage_counters` WHERE `scope` = ? AND `period` = ?', [$scope, $period]);
    db_run('DELETE FROM `usage_user_counters` WHERE `scope` = ? AND `period` = ?', [$scope, $period]);
}

function disable_scope(string $scope): int
{
    $rows = array_values(array_filter(db_all("SELECT * FROM `providers` WHERE `owner_type` = 'global'"), fn($r) => scope_of_row($r) === $scope));
    foreach ($rows as $row) db_run('UPDATE `providers` SET `enabled` = 0 WHERE `id` = ?', [(int) $row['id']]);
    return count($rows);
}

function calibrate_usage(string $scope, float $units): void
{
    $period = period_key();
    $price = 0.0;
    foreach (db_all("SELECT * FROM `providers` WHERE `owner_type` = 'global'") as $row) {
        if (scope_of_row($row) === $scope) {
            $price = quota_of(['id' => (int) $row['id'], 'category' => $row['category'], 'extra' => json_decode($row['extra_json'] ?: '{}', true) ?: []])['price'];
            break;
        }
    }
    db_upsert('usage_counters', [
        'scope' => $scope,
        'period' => $period,
        'units' => $units,
        'cost' => round($units * $price, 4),
        'updated_at' => now_ms(),
    ], ['scope', 'period']);
}

/** 文档计费页数 */
function billable_pages(array $file, int $pages, string $text): int
{
    $name = strtolower($file['name'] ?? '');
    $ext = pathinfo($name, PATHINFO_EXTENSION);
    if (in_array($ext, ['xls', 'xlsx', 'xlsm', 'html', 'htm', 'epub', 'mobi', 'rtf', 'txt', 'md', 'markdown', 'csv'], true)) {
        $cjk = preg_match_all('/[\x{3400}-\x{4dbf}\x{4e00}-\x{9fff}]/u', $text);
        $words = preg_match_all('/[A-Za-z0-9]+/', preg_replace('/[\x{3400}-\x{4dbf}\x{4e00}-\x{9fff}]/u', ' ', $text));
        return max(1, (int) ceil(($cjk + $words) / 2000));
    }
    if (in_array($ext, ['pdf', 'doc', 'docx', 'ppt', 'pptx'], true)) return max(1, $pages);
    return max(1, $pages);
}
