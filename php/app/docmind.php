<?php
declare(strict_types=1);

const DOCMIND_HOST = 'docmind-api.cn-hangzhou.aliyuncs.com';
const DOCMIND_VERSION = '2022-07-11';
const OPENAPI_HOST = 'openplatform.aliyuncs.com';
const OPENAPI_VERSION = '2019-12-19';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function docmind_credential(string $raw): array
{
    $text = trim($raw);
    if ($text === '') fail('BAD_CREDENTIAL', '未配置阿里云 AccessKey（格式：AccessKeyId:AccessKeySecret）', 400);
    if (str_starts_with($text, '{')) {
        $obj = json_decode($text, true);
        $id = $obj['accessKeyId'] ?? $obj['AccessKeyId'] ?? '';
        $secret = $obj['accessKeySecret'] ?? $obj['AccessKeySecret'] ?? '';
        if ($id && $secret) return ['id' => (string) $id, 'secret' => (string) $secret];
        fail('BAD_CREDENTIAL', 'AccessKey JSON 需包含 accessKeyId 与 accessKeySecret', 400);
    }
    $pos = strpos($text, ':');
    if ($pos === false || $pos === 0 || $pos === strlen($text) - 1) {
        fail('BAD_CREDENTIAL', '阿里云 AccessKey 需填写为 AccessKeyId:AccessKeySecret', 400);
    }
    return ['id' => trim(substr($text, 0, $pos)), 'secret' => trim(substr($text, $pos + 1))];
}

function docmind_rfc3986(string $v): string
{
    return str_replace('%7E', '~', rawurlencode($v));
}

function docmind_sign(
    array $cred,
    string $method,
    string $host,
    string $uri,
    array $query,
    array $headers,
    string $payload,
    ?string $date = null,
    ?string $nonce = null
): array {
    $payloadHash = $payload !== '' ? hash('sha256', $payload) : EMPTY_SHA256;
    $all = [
        'host' => $host,
        'x-acs-content-sha256' => $payloadHash,
        'x-acs-date' => $date ?: gmdate('Y-m-d\TH:i:s\Z'),
        'x-acs-signature-nonce' => $nonce ?: sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0x0fff) | 0x4000, random_int(0, 0x3fff) | 0x8000, random_int(0, 0xffff), random_int(0, 0xffff), random_int(0, 0xffff)),
    ];
    foreach ($headers as $k => $v) $all[strtolower($k)] = trim((string) $v);
    ksort($all);
    $names = array_keys($all);
    $canonicalHeaders = '';
    foreach ($names as $n) $canonicalHeaders .= $n . ':' . $all[$n] . "\n";
    $signedHeaders = implode(';', $names);

    $qk = array_keys($query);
    sort($qk);
    $pairs = [];
    foreach ($qk as $k) {
        if ($query[$k] === null) continue;
        $pairs[] = docmind_rfc3986((string) $k) . '=' . docmind_rfc3986((string) $query[$k]);
    }
    $canonicalQuery = implode('&', $pairs);
    $canonicalRequest = implode("\n", [$method, $uri, $canonicalQuery, $canonicalHeaders, $signedHeaders, $payloadHash]);
    $stringToSign = "ACS3-HMAC-SHA256\n" . hash('sha256', $canonicalRequest);
    $signature = hash_hmac('sha256', $stringToSign, $cred['secret']);

    return [
        'x-acs-content-sha256' => $payloadHash,
        'x-acs-date' => $all['x-acs-date'],
        'x-acs-signature-nonce' => $all['x-acs-signature-nonce'],
        'authorization' => 'ACS3-HMAC-SHA256 Credential=' . $cred['id'] . ',SignedHeaders=' . $signedHeaders . ',Signature=' . $signature,
        'canonicalRequest' => $canonicalRequest,
        'stringToSign' => $stringToSign,
        'signature' => $signature,
    ];
}

function docmind_rpc(array $cred, string $host, string $action, string $version, array $params = [], string $method = 'POST', int $timeoutMs = 30000): array
{
    $useGet = strtoupper($method) === 'GET';
    $payload = $useGet || !$params ? '' : http_build_query($params);
    $query = $useGet ? $params : [];
    $headers = ['x-acs-action' => $action, 'x-acs-version' => $version];
    if ($payload !== '') $headers['content-type'] = 'application/x-www-form-urlencoded';
    $signed = docmind_sign($cred, strtoupper($method), $host, '/', $query, $headers, $payload);
    $qs = $query ? '?' . implode('&', array_map(fn($k) => docmind_rfc3986((string) $k) . '=' . docmind_rfc3986((string) $query[$k]), array_keys($query))) : '';
    $url = 'https://' . $host . '/' . $qs;

    $ch = curl_init($url);
    $httpHeaders = [
        'Host: ' . $host,
        'x-acs-action: ' . $action,
        'x-acs-version: ' . $version,
        'x-acs-content-sha256: ' . $signed['x-acs-content-sha256'],
        'x-acs-date: ' . $signed['x-acs-date'],
        'x-acs-signature-nonce: ' . $signed['x-acs-signature-nonce'],
        'Authorization: ' . $signed['authorization'],
    ];
    if ($payload !== '') $httpHeaders[] = 'Content-Type: application/x-www-form-urlencoded';
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $httpHeaders,
        CURLOPT_TIMEOUT => (int) ($timeoutMs / 1000),
        CURLOPT_CONNECTTIMEOUT => 15,
    ]);
    if ($payload !== '') curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $err !== '') fail('PROVIDER_UNREACHABLE', '无法连接阿里云文档智能：' . $err, 502);
    $data = json_decode((string) $raw, true);
    if (!is_array($data)) fail('PROVIDER_BAD_RESPONSE', '阿里云返回的不是 JSON', 502);
    $biz = $data['Code'] ?? $data['code'] ?? null;
    if ($code >= 400 || ($biz !== null && (string) $biz !== '200' && (string) $biz !== 'Success')) {
        $msg = $data['Message'] ?? $data['message'] ?? ('HTTP ' . $code);
        fail('PROVIDER_HTTP_ERROR', '阿里云文档智能返回 ' . $code . ($biz ? '/' . $biz : '') . '：' . $msg, 502);
    }
    return $data;
}

function docmind_authorize(array $cred): array
{
    $data = docmind_rpc($cred, OPENAPI_HOST, 'AuthorizeFileUpload', OPENAPI_VERSION, ['Product' => 'docmind-api', 'RegionId' => 'cn-hangzhou'], 'GET');
    $get = fn($k) => $data[$k] ?? $data[strtolower($k)] ?? null;
    $t = [
        'bucket' => $get('Bucket'),
        'endpoint' => $get('Endpoint'),
        'accessKeyId' => $get('AccessKeyId'),
        'policy' => $get('EncodedPolicy') ?: $get('Policy'),
        'signature' => $get('Signature'),
        'objectKey' => $get('ObjectKey'),
    ];
    foreach ($t as $v) if (!$v) fail('PROVIDER_HTTP_ERROR', '阿里云未返回完整的上传凭证，请检查 AccessKey 权限', 502);
    return $t;
}

function docmind_upload(array $ticket, string $data, string $filename): string
{
    $url = 'https://' . $ticket['bucket'] . '.' . $ticket['endpoint'];
    $tmp = tempnam(sys_get_temp_dir(), 'dm');
    file_put_contents($tmp, $data);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => [
            'OSSAccessKeyId' => $ticket['accessKeyId'],
            'policy' => $ticket['policy'],
            'Signature' => $ticket['signature'],
            'key' => $ticket['objectKey'],
            'success_action_status' => '201',
            'file' => new CURLFile($tmp, 'application/octet-stream', $filename),
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 120,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    @unlink($tmp);
    if ($raw === false || $err !== '' || $code >= 400) {
        fail('PROVIDER_HTTP_ERROR', '上传文件到阿里云 OSS 失败（HTTP ' . $code . '）' . ($err ?: ''), 502);
    }
    return $url . '/' . $ticket['objectKey'];
}

function docmind_submit(array $cred, string $data, string $name, string $mime): string
{
    $ticket = docmind_authorize($cred);
    $url = docmind_upload($ticket, $data, $name ?: 'upload.bin');
    $ext = strtolower(pathinfo($name ?: 'upload.bin', PATHINFO_EXTENSION));
    $params = ['FileUrl' => $url];
    if ($ext && $ext !== 'bin') $params['FileName'] = $name;
    else $params['FileNameExtension'] = ['application/pdf' => 'pdf', 'application/msword' => 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx'][$mime] ?? 'pdf';
    $res = docmind_rpc($cred, DOCMIND_HOST, 'SubmitDocParserJob', DOCMIND_VERSION, $params, 'POST', 120000);
    $id = $res['Data']['Id'] ?? null;
    if (!$id) fail('PROVIDER_HTTP_ERROR', '阿里云未返回解析任务 Id', 502);
    return (string) $id;
}

function docmind_status(array $cred, string $id): array
{
    $res = docmind_rpc($cred, DOCMIND_HOST, 'QueryDocParserStatus', DOCMIND_VERSION, ['Id' => $id]);
    $d = $res['Data'] ?? [];
    return ['status' => strtolower((string) ($d['Status'] ?? '')), 'pageCount' => (int) ($d['PageCountEstimate'] ?? 0)];
}

function docmind_fetch(array $cred, string $id, int $step = 100): array
{
    $layouts = [];
    $seen = [];
    for ($offset = 0; $offset < 6000; $offset += $step) {
        $res = docmind_rpc($cred, DOCMIND_HOST, 'GetDocParserResult', DOCMIND_VERSION, ['Id' => $id, 'LayoutNum' => (string) $offset, 'LayoutStepSize' => (string) $step], 'POST', 60000);
        $list = $res['Data']['layouts'] ?? $res['Data']['Layouts'] ?? [];
        if (!is_array($list) || !$list) break;
        foreach ($list as $item) {
            $key = $item['uniqueId'] ?? (($item['pageNum'] ?? 0) . '-' . ($item['index'] ?? 0));
            if (isset($seen[$key])) continue;
            $seen[$key] = true;
            $layouts[] = $item;
        }
        if (count($list) < $step) break;
    }
    usort($layouts, fn($a, $b) => [(int) ($a['pageNum'] ?? 0), (int) ($a['index'] ?? 0)] <=> [(int) ($b['pageNum'] ?? 0), (int) ($b['index'] ?? 0)]);
    $pages = 0;
    foreach ($layouts as $l) $pages = max($pages, (int) ($l['pageNum'] ?? 0) + 1);
    return ['layouts' => $layouts, 'pages' => $pages];
}

function docmind_layouts_text(array $layouts): string
{
    $parts = [];
    foreach ($layouts as $l) {
        $t = trim((string) ($l['markdownContent'] ?? ''));
        if ($t === '') $t = trim((string) ($l['text'] ?? ''));
        if ($t !== '') $parts[] = $t;
    }
    return trim(preg_replace("/\n{3,}/", "\n\n", implode("\n\n", $parts)));
}

function docmind_parse(array $p, array $file): array
{
    @set_time_limit(300);
    $cred = docmind_credential($p['apiKey'] ?? '');
    $id = docmind_submit($cred, file_get_contents($file['path']), $file['name'] ?? 'upload.bin', $file['mime'] ?? 'application/pdf');
    $timeout = (int) ($p['extra']['pollTimeoutMs'] ?? 180000);
    $started = microtime(true);
    $status = null;
    while ((microtime(true) - $started) * 1000 < $timeout) {
        $status = docmind_status($cred, $id);
        if ($status['status'] === 'success') break;
        if (in_array($status['status'], ['fail', 'failed'], true)) fail('PROVIDER_HTTP_ERROR', '阿里云文档解析失败，请换一份文件或稍后重试', 502);
        sleep(2);
    }
    if (!$status || $status['status'] !== 'success') fail('PROVIDER_TIMEOUT', '阿里云文档解析超时（超过 3 分钟）', 504);
    $fetched = docmind_fetch($cred, $id, max(10, min(1000, (int) ($p['extra']['layoutStepSize'] ?? 100))));
    $text = docmind_layouts_text($fetched['layouts']);
    if ($text === '') fail('PROVIDER_HTTP_ERROR', '阿里云没有解析出任何文本内容', 502);
    return ['text' => $text, 'pages' => max(1, $fetched['pages'], $status['pageCount'])];
}

function docmind_test(array $p): array
{
    $cred = docmind_credential($p['apiKey'] ?? '');
    docmind_authorize($cred);
    return ['ok' => true, 'ms' => 0, 'sample' => 'AccessKey 签名与上传通道正常（未消耗页数）'];
}
