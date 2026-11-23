<?php
declare(strict_types=1);

function bss_call(array $cred, string $action, array $params): array
{
    $host = 'business.aliyuncs.com';
    $version = '2017-12-14';
    $payload = http_build_query($params);
    $signed = docmind_sign($cred, 'POST', $host, '/', [], [
        'x-acs-action' => $action,
        'x-acs-version' => $version,
        'content-type' => 'application/x-www-form-urlencoded',
    ], $payload);
    $ch = curl_init('https://' . $host . '/');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            'Host: ' . $host,
            'x-acs-action: ' . $action,
            'x-acs-version: ' . $version,
            'x-acs-content-sha256: ' . $signed['x-acs-content-sha256'],
            'x-acs-date: ' . $signed['x-acs-date'],
            'x-acs-signature-nonce: ' . $signed['x-acs-signature-nonce'],
            'Authorization: ' . $signed['authorization'],
            'Content-Type: application/x-www-form-urlencoded',
        ],
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $err !== '') return ['supported' => false, 'error' => '无法连接阿里云费用中心：' . $err];
    $json = json_decode((string) $raw, true);
    if (!is_array($json) || $code >= 400 || ($json['Success'] ?? true) === false) {
        return ['supported' => false, 'error' => '费用中心返回 ' . $code . '：' . ($json['Message'] ?? '')];
    }
    return ['supported' => true, 'data' => $json];
}

function is_docmind_bill_item(array $item): bool
{
    $hay = ($item['ProductName'] ?? '') . ' ' . ($item['ProductCode'] ?? '') . ' ' . ($item['PipCode'] ?? '') . ' ' . ($item['BizType'] ?? '');
    return (bool) preg_match('/文档|docmind|doc\s*mind|document\s*mind/i', $hay);
}

/** 本月账单明细（分页，最多 20 页） */
function query_account_bill(array $cred, string $period): array
{
    $items = [];
    $page = 1;
    $total = 1;
    while (count($items) < $total && $page <= 20) {
        $res = bss_call($cred, 'QueryAccountBill', [
            'BillingCycle' => $period,
            'PageNum' => (string) $page,
            'PageSize' => '300',
            'IsGroupByProduct' => 'false',
        ]);
        if (!$res['supported']) return ['supported' => false, 'error' => $res['error'], 'items' => []];
        $d = $res['data']['Data'] ?? [];
        $total = (int) ($d['TotalCount'] ?? 0);
        $list = $d['Items']['Item'] ?? [];
        if (!is_array($list) || !$list) break;
        $items = array_merge($items, $list);
        $page++;
    }
    return ['supported' => true, 'items' => $items, 'total' => $total];
}

function query_resource_packages(array $cred): array
{
    $res = bss_call($cred, 'QueryResourcePackageInstances', ['PageNum' => '1', 'PageSize' => '50']);
    if (!$res['supported']) return [];
    $list = $res['data']['Data']['Instances']['Instance'] ?? [];
    return is_array($list) ? $list : [];
}

function check_docmind_billing(array $p, string $period): array
{
    try {
        $cred = docmind_credential($p['apiKey'] ?? '');
    } catch (Throwable $e) {
        return ['supported' => false, 'checkedAt' => now_ms(), 'period' => $period, 'error' => $e->getMessage()];
    }

    $bill = query_account_bill($cred, $period);
    if (!$bill['supported']) {
        return ['supported' => false, 'checkedAt' => now_ms(), 'period' => $period, 'error' => $bill['error']];
    }
    $packages = query_resource_packages($cred);

    $matched = array_values(array_filter($bill['items'], 'is_docmind_bill_item'));
    $amount = 0.0;
    foreach ($matched as $it) $amount += (float) ($it['PretaxAmount'] ?? 0);
    $docPackages = array_values(array_filter($packages, 'is_docmind_bill_item'));

    return [
        'supported' => true,
        'checkedAt' => now_ms(),
        'period' => $period,
        'currency' => $matched[0]['Currency'] ?? 'CNY',
        'charged' => $amount > 0.0001,
        'amount' => round($amount, 2),
        'items' => array_map(fn($it) => [
            'productName' => $it['ProductName'] ?? '',
            'productCode' => $it['ProductCode'] ?? '',
            'amount' => (float) ($it['PretaxAmount'] ?? 0),
            'currency' => $it['Currency'] ?? 'CNY',
        ], array_slice($matched, 0, 10)),
        'packages' => array_map(fn($pk) => [
            'name' => $pk['PackageName'] ?? $pk['ProductName'] ?? $pk['InstanceId'] ?? '资源包',
            'total' => $pk['TotalAmount'] ?? $pk['Capacity'] ?? null,
            'remaining' => $pk['RemainingAmount'] ?? $pk['Remaining'] ?? null,
            'unit' => $pk['AmountUnit'] ?? $pk['Unit'] ?? '',
            'expiry' => $pk['ExpiryTime'] ?? null,
        ], array_slice($docPackages, 0, 10)),
        'note' => $amount > 0.0001
            ? '云端已出现文档智能的后付费扣费，说明本月免费额度已用完；建议立即停用该接口。'
            : '本月账单里没有文档智能的扣费记录，说明仍在免费额度内（账单数据约有 24 小时延迟）。',
    ];
}
