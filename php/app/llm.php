<?php
declare(strict_types=1);

function provider_url(array $p, array $vars = []): string
{
    $base = rtrim($p['baseUrl'], '/');
    $path = (string) ($p['extra']['path'] ?? '');
    foreach ($vars as $k => $v) {
        $path = str_replace('{{' . $k . '}}', rawurlencode((string) $v), $path);
    }
    return $base . ($path === '' || $path[0] === '/' ? $path : '/' . $path);
}

function provider_headers(array $p): array
{
    $headers = ['Content-Type: application/json'];
    $auth = $p['extra']['auth'] ?? null;
    $key = $p['apiKey'] ?? '';
    if ($key !== '' && is_array($auth)) {
        $prefix = $auth['prefix'] ?? 'Bearer ';
        $name = $auth['name'] ?? 'Authorization';
        if (($auth['type'] ?? 'header') === 'header') $headers[] = $name . ': ' . $prefix . $key;
    } elseif ($key !== '') {
        $headers[] = 'Authorization: Bearer ' . $key;
    }
    foreach (($p['extra']['headers'] ?? []) as $k => $v) $headers[] = $k . ': ' . $v;
    return $headers;
}

/**
 * 调用 OpenAI 兼容的流式接口。
 * $onDelta / $onReasoning 为回调；返回 ['ok'=>bool,'error'=>string,'content'=>string,'reasoning'=>string]
 */
function llm_stream(array $p, array $messages, callable $onDelta, callable $onReasoning): array
{
    $url = provider_url($p);
    $payload = [
        'model' => $p['model'] ?: 'gpt-3.5-turbo',
        'messages' => $messages,
        'stream' => true,
    ];
    // 仅在后台给该模型配置了思考强度时才发送，避免不支持的供应商报错
    if (!empty($p['extra']['reasoningEffort'])) {
        $payload['reasoning_effort'] = (string) $p['extra']['reasoningEffort'];
    }
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);

    $content = '';
    $reasoning = '';
    $buffer = '';
    $httpCode = 0;
    $errorBody = '';

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => provider_headers($p),
        CURLOPT_TIMEOUT => (int) (($p['extra']['timeoutMs'] ?? 120000) / 1000),
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$httpCode) {
            if (preg_match('#^HTTP/\S+\s+(\d+)#', $line, $m)) $httpCode = (int) $m[1];
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$buffer, &$content, &$reasoning, &$errorBody, $onDelta, $onReasoning) {
            if (http_response_code() === 0) http_response_code(200);
            $buffer .= $chunk;
            while (($pos = strpos($buffer, "\n")) !== false) {
                $line = trim(substr($buffer, 0, $pos));
                $buffer = substr($buffer, $pos + 1);
                if ($line === '' || !str_starts_with($line, 'data:')) {
                    if ($line !== '' && !str_starts_with($line, 'event:')) $errorBody .= $line;
                    continue;
                }
                $data = trim(substr($line, 5));
                if ($data === '[DONE]') continue;
                $json = json_decode($data, true);
                if (!is_array($json)) continue;
                $delta = $json['choices'][0]['delta'] ?? [];
                if (isset($delta['reasoning_content']) && $delta['reasoning_content'] !== '') {
                    $reasoning .= $delta['reasoning_content'];
                    $onReasoning($delta['reasoning_content']);
                }
                if (isset($delta['content']) && $delta['content'] !== '') {
                    $content .= $delta['content'];
                    $onDelta($delta['content']);
                }
            }
            return strlen($chunk);
        },
    ]);
    curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($err !== '') return ['ok' => false, 'error' => '无法连接模型服务：' . $err, 'content' => $content, 'reasoning' => $reasoning];
    if ($httpCode >= 400 || ($content === '' && $httpCode !== 200)) {
        $msg = $errorBody !== '' ? $errorBody : '上游返回 HTTP ' . $httpCode;
        if (strlen($msg) > 500) $msg = substr($msg, 0, 500);
        return ['ok' => false, 'error' => $msg, 'content' => $content, 'reasoning' => $reasoning];
    }
    if ($content === '' && $reasoning === '') return ['ok' => false, 'error' => '模型没有返回内容', 'content' => '', 'reasoning' => ''];
    return ['ok' => true, 'error' => '', 'content' => $content, 'reasoning' => $reasoning];
}

function http_json(string $method, string $url, array $headers, mixed $body, int $timeoutMs = 30000): array
{
    $ch = curl_init($url);
    $opts = [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => (int) ($timeoutMs / 1000),
        CURLOPT_CONNECTTIMEOUT => 15,
    ];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_UNICODE);
        $opts[CURLOPT_POST] = true;
    }
    curl_setopt_array($ch, $opts);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $err !== '') fail('PROVIDER_UNREACHABLE', '无法连接上游：' . $err, 502);
    $json = json_decode((string) $raw, true);
    if ($code >= 400) {
        $msg = is_array($json) ? ($json['error']['message'] ?? $json['message'] ?? '') : substr((string) $raw, 0, 200);
        fail('PROVIDER_HTTP_ERROR', '上游返回 ' . $code . '：' . $msg, 502);
    }
    if (!is_array($json)) fail('PROVIDER_BAD_RESPONSE', '上游返回的不是 JSON', 502);
    return $json;
}

function get_path(mixed $obj, string $path): mixed
{
    if ($path === '') return $obj;
    foreach (explode('.', $path) as $seg) {
        if ($obj === null) return null;
        if (is_array($obj) && preg_match('/^\d+$/', $seg)) $obj = $obj[(int) $seg] ?? null;
        elseif (is_array($obj)) $obj = $obj[$seg] ?? null;
        else return null;
    }
    return $obj;
}

function run_search(array $user, string $query, int $limit = 5): array
{
    $attempts = resolve_attempts($user, 'search');
    if (!$attempts) fail('INSUFFICIENT_COMPUTE', setting('insufficientComputeMsg', '算力不足，请自行接入第三方工具 API。'), 402);
    $last = null;
    foreach ($attempts as $p) {
        try {
            $units = 1;
            assert_global_quota($p, $units);
            assert_user_quota($user, $p, $units);
            $vars = ['query' => $query, 'limit' => $limit];
            $extra = $p['extra'];
            $body = $extra['body'] ?? ['query' => '{{query}}', 'max_results' => '{{limit}}'];
            // 直接按类型插值：query 里的引号、反斜杠不会被二次编码破坏 JSON
            $body = is_array($body) ? interpolate_node($body, ['query' => $query, 'limit' => $limit]) : [];
            $url = provider_url($p);
            $json = http_json('POST', $url, provider_headers($p), $body, (int) ($extra['timeoutMs'] ?? 30000));
            $list = get_path($json, $extra['resultPath'] ?? 'results');
            if (!is_array($list)) $list = [];
            $map = $extra['fieldMap'] ?? ['title' => 'title', 'url' => 'url', 'snippet' => 'content'];
            $out = [];
            foreach (array_slice($list, 0, $limit) as $item) {
                $out[] = [
                    'title' => (string) get_path($item, $map['title'] ?? 'title'),
                    'url' => (string) get_path($item, $map['url'] ?? 'url'),
                    'snippet' => (string) get_path($item, $map['snippet'] ?? 'content'),
                ];
            }
            provider_mark((int) $p['id'], true);
            record_usage($p, $units, $user, 'search: ' . mb_substr($query, 0, 60));
            return $out;
        } catch (ApiError $e) {
            if ($e->apiCode === 'QUOTA_EXCEEDED') throw $e;
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        } catch (Throwable $e) {
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        }
    }
    fail('PROVIDER_FAILED', '联网搜索失败：' . ($last ?: '未知错误'), 502);
}

/* ── 通用能力适配：OCR / TTS / ASR / 爬取 ─────────────── */

function interpolate_node(mixed $node, array $vars): mixed
{
    if (is_string($node)) {
        if (preg_match('/^\{\{(\w+)\}\}$/', $node, $m)) return $vars[$m[1]] ?? '';
        return preg_replace_callback('/\{\{(\w+)\}\}/', fn($m) => (string) ($vars[$m[1]] ?? ''), $node);
    }
    if (is_array($node)) {
        $out = [];
        foreach ($node as $k => $v) $out[$k] = interpolate_node($v, $vars);
        return $out;
    }
    return $node;
}

function provider_json_body(array $p, array $vars): array
{
    $template = $p['extra']['body'] ?? [];
    $body = interpolate_node($template, $vars);
    return is_array($body) ? $body : [];
}

function provider_call_json(array $p, array $vars, int $timeout = 0): array
{
    $url = provider_url($p, $vars);
    $method = strtoupper((string) ($p['extra']['method'] ?? 'POST'));
    $body = provider_json_body($p, $vars);
    return http_json($method, $url, provider_headers($p), $body, $timeout ?: (int) (($p['extra']['timeoutMs'] ?? 60000)));
}

function provider_call_multipart(array $p, array $file, array $vars = [], int $timeout = 0): array
{
    $url = provider_url($p, $vars);
    $headers = provider_headers($p);
    $headers = array_values(array_filter($headers, fn($h) => !str_starts_with(strtolower($h), 'content-type:')));
    $field = $p['extra']['fileField'] ?? 'file';
    $fields = [$field => new CURLFile($file['path'], $file['mime'] ?: 'application/octet-stream', $file['name'] ?: 'upload.bin')];
    foreach (($p['extra']['fields'] ?? []) as $k => $v) $fields[$k] = (string) $v;
    if (!empty($p['model'])) $fields['model'] = $p['model'];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $fields,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout ?: (int) (($p['extra']['timeoutMs'] ?? 120000) / 1000),
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($raw === false || $err !== '') fail('PROVIDER_UNREACHABLE', '无法连接上游：' . $err, 502);
    $json = json_decode((string) $raw, true);
    if ($code >= 400) fail('PROVIDER_HTTP_ERROR', '上游返回 ' . $code, 502);
    if (!is_array($json)) fail('PROVIDER_BAD_RESPONSE', '上游返回的不是 JSON', 502);
    return $json;
}

function run_ocr(array $user, array $file): array
{
    $attempts = resolve_attempts($user, 'ocr');
    if (!$attempts) fail('INSUFFICIENT_COMPUTE', setting('insufficientComputeMsg'), 402);
    $last = '';
    foreach ($attempts as $p) {
        try {
            if (($p['extra']['mode'] ?? '') === 'vision') {
                $b64 = base64_encode(file_get_contents($file['path']));
                $mime = $file['mime'] ?: 'image/png';
                $prompt = $p['extra']['prompt'] ?? '请提取图片中的全部文字，保持原有顺序与换行，不要添加解释。';
                $body = [
                    'model' => $p['model'],
                    'messages' => [[
                        'role' => 'user',
                        'content' => [
                            ['type' => 'text', 'text' => $prompt],
                            ['type' => 'image_url', 'image_url' => ['url' => 'data:' . $mime . ';base64,' . $b64]],
                        ],
                    ]],
                ];
                $json = http_json('POST', provider_url($p), provider_headers($p), $body);
                $text = (string) (get_path($json, 'choices.0.message.content') ?? '');
            } else {
                $json = provider_call_multipart($p, $file);
                $text = (string) get_path($json, $p['extra']['textPath'] ?? 'text');
            }
            if ($text === '') throw new RuntimeException('上游没有返回文字');
            provider_mark((int) $p['id'], true);
            return ['text' => $text, 'provider' => $p['name'] ?: 'ocr'];
        } catch (ApiError $e) {
            if ($e->apiCode === 'QUOTA_EXCEEDED') throw $e;
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        } catch (Throwable $e) {
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        }
    }
    fail('PROVIDER_FAILED', '图片 OCR 失败：' . $last, 502);
}

function run_tts(array $user, string $text, string $voice = ''): array
{
    $attempts = resolve_attempts($user, 'tts');
    if (!$attempts) fail('INSUFFICIENT_COMPUTE', setting('insufficientComputeMsg'), 402);
    $last = '';
    foreach ($attempts as $p) {
        try {
            $chosen = $voice !== '' ? $voice : ($p['extra']['defaultVoice'] ?? '');
            if (($p['extra']['mode'] ?? '') === 'chat-audio') {
                $body = ['model' => $p['model'], 'messages' => [['role' => 'assistant', 'content' => $text]]];
                if ($chosen !== '') $body['audio'] = ['voice' => $chosen];
                $json = http_json('POST', provider_url($p), provider_headers($p), $body, (int) ($p['extra']['timeoutMs'] ?? 60000));
                $data = get_path($json, $p['extra']['audioPath'] ?? 'choices.0.message.audio.data');
                if (!is_string($data) || $data === '') throw new RuntimeException('上游未返回音频数据');
                provider_mark((int) $p['id'], true);
                return ['data' => base64_decode($data), 'mime' => $p['extra']['audioMime'] ?? 'audio/wav'];
            }
            $body = provider_json_body($p, ['text' => $text, 'voice' => $chosen]);
            $ch = curl_init(provider_url($p, ['text' => $text]));
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => json_encode($body, JSON_UNESCAPED_UNICODE),
                CURLOPT_HTTPHEADER => provider_headers($p),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => (int) (($p['extra']['timeoutMs'] ?? 60000) / 1000),
            ]);
            $raw = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($raw === false || $code >= 400 || $raw === '') throw new RuntimeException('上游未返回音频');
            provider_mark((int) $p['id'], true);
            return ['data' => $raw, 'mime' => $p['extra']['audioMime'] ?? 'audio/mpeg'];
        } catch (ApiError $e) {
            if ($e->apiCode === 'QUOTA_EXCEEDED') throw $e;
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        } catch (Throwable $e) {
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        }
    }
    fail('PROVIDER_FAILED', '语音合成失败：' . $last, 502);
}

function run_asr(array $user, array $file): array
{
    $attempts = resolve_attempts($user, 'asr');
    if (!$attempts) fail('INSUFFICIENT_COMPUTE', setting('insufficientComputeMsg'), 402);
    $last = '';
    foreach ($attempts as $p) {
        try {
            $json = provider_call_multipart($p, $file, ['model' => $p['model'], 'language' => 'zh']);
            $text = (string) get_path($json, $p['extra']['textPath'] ?? 'text');
            if ($text === '') throw new RuntimeException('上游没有返回转写文本');
            provider_mark((int) $p['id'], true);
            return ['text' => $text, 'provider' => $p['name'] ?: 'asr'];
        } catch (ApiError $e) {
            if ($e->apiCode === 'QUOTA_EXCEEDED') throw $e;
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        } catch (Throwable $e) {
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        }
    }
    fail('PROVIDER_FAILED', '语音识别失败：' . $last, 502);
}

function run_crawl(array $user, string $url): array
{
    $attempts = resolve_attempts($user, 'crawl');
    if (!$attempts) fail('INSUFFICIENT_COMPUTE', setting('insufficientComputeMsg'), 402);
    $last = '';
    foreach ($attempts as $p) {
        try {
            $units = 1;
            assert_global_quota($p, $units);
            assert_user_quota($user, $p, $units);
            $json = provider_call_json($p, ['url' => $url], (int) ($p['extra']['timeoutMs'] ?? 60000));
            $text = (string) get_path($json, $p['extra']['textPath'] ?? 'text');
            if ($text === '') throw new RuntimeException('上游没有返回正文');
            provider_mark((int) $p['id'], true);
            record_usage($p, $units, $user, 'crawl: ' . mb_substr($url, 0, 80));
            return ['text' => $text, 'title' => (string) get_path($json, $p['extra']['titlePath'] ?? 'title'), 'provider' => $p['name'] ?: 'crawl'];
        } catch (ApiError $e) {
            if ($e->apiCode === 'QUOTA_EXCEEDED') throw $e;
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        } catch (Throwable $e) {
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        }
    }
    fail('PROVIDER_FAILED', '网页爬取失败：' . $last, 502);
}

function run_parse_http(array $user, array $file): array
{
    $attempts = resolve_attempts($user, 'parse');
    if (!$attempts) fail('INSUFFICIENT_COMPUTE', '未配置文件解析能力', 402);
    $last = '';
    foreach ($attempts as $p) {
        try {
            assert_global_quota($p, 1);
            assert_user_quota($user, $p, 1);
            $isDocmind = ($p['extra']['mode'] ?? 'http') === 'docmind';
            if ($isDocmind) {
                $r = docmind_parse($p, $file);
                $text = $r['text'];
                $pages = (int) $r['pages'];
            } else {
                $json = provider_call_multipart($p, $file);
                $text = (string) get_path($json, $p['extra']['textPath'] ?? 'text');
                $pages = 1;
            }
            if ($text === '') throw new RuntimeException('上游没有返回文本');
            $billed = billable_pages($file, $pages, $text);
            record_usage($p, $billed, $user, 'parse: ' . ($file['name'] ?? ''));
            provider_mark((int) $p['id'], true);
            return ['text' => $text, 'provider' => $p['name'] ?: 'parse', 'pages' => $billed];
        } catch (ApiError $e) {
            if ($e->apiCode === 'QUOTA_EXCEEDED') throw $e;
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        } catch (Throwable $e) {
            $last = $e->getMessage();
            provider_mark((int) $p['id'], false, $last);
        }
    }
    fail('PROVIDER_FAILED', '文件解析失败：' . $last, 502);
}
