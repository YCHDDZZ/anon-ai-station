<?php
declare(strict_types=1);

function sse_start(): void
{
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache, no-transform');
    header('X-Accel-Buffering: no');
    while (ob_get_level() > 0) @ob_end_flush();
    @ob_implicit_flush(true);
    echo ": connected\n\n";
    @flush();
}

function sse_send(string $event, array $data): void
{
    echo 'event: ' . $event . "\ndata: " . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
    @flush();
}

function resolve_persona(array $user, int $id): ?array
{
    if ($id === 0) return ['id' => 0, 'name' => '不使用角色', 'prompt' => ''];
    $row = db_get(
        "SELECT * FROM `personas` WHERE `id` = ? AND `enabled` = 1 AND (`owner_type` = 'global' OR (`owner_type` = 'user' AND `owner_id` = ?))",
        [$id, (int) $user['id']]
    );
    return $row ? ['id' => (int) $row['id'], 'name' => $row['name'], 'prompt' => $row['prompt']] : null;
}


/**
 * 把模型内联输出的 <think>...</think> 从正文里剥出来，转成 reasoning 事件；
 * 关闭深度思考时（keep=false）这部分内容直接丢弃，避免「思考过程外泄」。
 */
class ThinkStreamFilter
{
    public bool $keep;
    private string $buf = '';
    private string $mode = 'unknown';

    public function __construct(bool $keep)
    {
        $this->keep = $keep;
    }

    /** @return array<int, array{0:string,1:string}> */
    public function feed(string $text): array
    {
        $this->buf .= $text;
        $out = [];
        while (true) {
            if ($this->mode === 'content') {
                if ($this->buf !== '') {
                    $out[] = ['content', $this->buf];
                    $this->buf = '';
                }
                break;
            }
            if ($this->mode === 'think') {
                $pos = stripos($this->buf, '</think');
                if ($pos === false) {
                    $safe = max(0, strlen($this->buf) - 8);
                    // 不要把多字节字符切断
                    while ($safe > 0 && (ord($this->buf[$safe]) & 0xC0) === 0x80) $safe--;
                    if ($safe > 0) {
                        $out[] = ['reason', substr($this->buf, 0, $safe)];
                        $this->buf = substr($this->buf, $safe);
                    }
                    break;
                }
                if ($pos > 0) $out[] = ['reason', substr($this->buf, 0, $pos)];
                $rest = preg_replace('#^</think(?:ing)?>#i', '', substr($this->buf, $pos));
                $this->buf = ltrim((string) $rest, "\r\n");
                $this->mode = 'content';
                continue;
            }
            // unknown：等够字符再判断，避免把半个标签当正文
            $t = ltrim($this->buf);
            if ($t === '') {
                $this->buf = '';
                break;
            }
            if (preg_match('#^<(think|thinking|reasoning)>#i', $t, $m)) {
                $this->buf = substr($t, strlen($m[0]));
                $this->mode = 'think';
                continue;
            }
            if (strlen($t) < 12 && preg_match('#^<[a-z]*$#i', $t)) {
                $this->buf = $t;
                break;
            }
            $this->mode = 'content';
            $this->buf = $t;
        }
        return $out;
    }

    /** @return array<int, array{0:string,1:string}> */
    public function flush(): array
    {
        if ($this->buf === '') return [];
        $out = [[$this->mode === 'think' ? 'reason' : 'content', $this->buf]];
        $this->buf = '';
        return $out;
    }
}

function build_file_context(array $user, array $fileIds): array
{
    $ids = array_values(array_filter(array_map('intval', $fileIds)));
    if (!$ids) return ['text' => '', 'files' => []];
    $in = implode(',', array_fill(0, count($ids), '?'));
    $rows = db_all(
        "SELECT `id`,`name`,`size`,`text` FROM `files` WHERE `id` IN ($in) AND `user_id` = ? ORDER BY id",
        [...$ids, (int) $user['id']]
    );
    $chunks = [];
    $files = [];
    $budget = 24000;
    foreach ($rows as $f) {
        $text = trim((string) ($f['text'] ?? ''));
        $files[] = ['id' => (int) $f['id'], 'name' => $f['name'], 'size' => (int) $f['size'], 'textLength' => mb_strlen($text)];
        if ($text === '') {
            $chunks[] = "--- 文件：{$f['name']}（未能提取到文字，可能是扫描件或旧版格式）---";
            continue;
        }
        $piece = "--- 文件：{$f['name']} ---\n" . $text;
        if (mb_strlen($piece) > $budget) $piece = mb_substr($piece, 0, $budget);
        $budget -= mb_strlen($piece);
        $chunks[] = $piece;
        if ($budget <= 0) break;
    }
    return [
        'text' => $chunks
            ? "【用户上传的附件】\n以下是从附件中提取的正文：\n\n" . implode("\n\n", $chunks)
                . "\n\n【回答要求】当用户问「里面讲了什么」「总结一下」这类问题时，必须优先依据上面的附件原文回答，并点明来自哪个文件；不要用无关的联网结果或臆测替代。"
            : '',
        'files' => $files,
    ];
}

/** 按模型的上下文长度裁剪历史，粗略按 1 token ≈ 2 字符估算 */
function trim_history_for_context(array $messages, int $contextTokens): array
{
    if ($contextTokens <= 0) return $messages;
    $budget = $contextTokens * 2;
    $kept = [];
    for ($i = count($messages) - 1; $i >= 0; $i--) {
        $len = mb_strlen((string) ($messages[$i]['content'] ?? ''));
        if ($len > $budget && $kept) break;
        $budget -= $len;
        array_unshift($kept, $messages[$i]);
    }
    return $kept;
}

function chat_search_context(array $results): string
{
    if (!$results) return '';
    $lines = [];
    foreach ($results as $i => $r) {
        $lines[] = '[' . ($i + 1) . '] ' . $r['title'] . "\n" . $r['url'] . "\n" . ($r['snippet'] ?? '');
    }
    return "以下是刚刚联网检索到的资料，请优先依据它们回答，并在引用处标注 [序号]：\n\n" . implode("\n\n", $lines);
}

function handle_chat(): never
{
    // 长回答可能超过 PHP 默认 30 秒；客户端断开后也要把已生成内容落库
    @set_time_limit(300);
    ignore_user_abort(true);
    $user = require_user();
    $b = body_json();
    $content = trim((string) ($b['content'] ?? ''));
    if (strlen($content) > 200000) fail('BAD_REQUEST', '单条消息不能超过 200000 字符', 400);
    $fileIds = is_array($b['fileIds'] ?? null) ? $b['fileIds'] : [];
    if (count($fileIds) > 20) fail('BAD_REQUEST', '一次最多附带 20 个文件', 400);
    if ($content === '' && !$fileIds) fail('BAD_REQUEST', '请输入消息或上传文件', 400);

    $convId = isset($b['conversationId']) ? (int) $b['conversationId'] : null;
    $conv = null;
    if ($convId) {
        $conv = db_get('SELECT * FROM `conversations` WHERE `id` = ? AND `user_id` = ?', [$convId, (int) $user['id']]);
        if (!$conv) fail('NOT_FOUND', '对话不存在', 404);
    }

    $msgCount = $conv ? (int) db_get('SELECT COUNT(*) AS c FROM `messages` WHERE `conversation_id` = ?', [(int) $conv['id']])['c'] : 0;
    $isFirst = $msgCount === 0;
    $persona = null;
    if ($isFirst) {
        if (!array_key_exists('personaId', $b) || $b['personaId'] === null) {
            fail('PERSONA_REQUIRED', '请先选择一个角色再发送消息', 400);
        }
        $persona = resolve_persona($user, (int) $b['personaId']);
        if (!$persona) fail('PERSONA_INVALID', '该角色已不可用，请重新选择', 400);
    }
    $personaPrompt = $isFirst ? $persona['prompt'] : ($conv['persona_prompt'] ?? '');
    $personaName = $isFirst ? $persona['name'] : ($conv['persona_name'] ?? null);

    if (!$conv) {
        $title = mb_substr($content !== '' ? $content : '文件对话', 0, 40);
        db_run(
            'INSERT INTO `conversations`(`user_id`,`title`,`persona_id`,`persona_name`,`persona_prompt`,`created_at`,`updated_at`) VALUES(?,?,?,?,?,?,?)',
            [(int) $user['id'], $title, $persona['id'], $persona['name'], $persona['prompt'], now_ms(), now_ms()]
        );
        $convId = db_last_id();
        $conv = db_get('SELECT * FROM `conversations` WHERE `id` = ?', [$convId]);
    }

    $thinking = !array_key_exists('thinking', $b) || (bool) $b['thinking'];

    $fileCtx = build_file_context($user, $fileIds);
    db_run(
        'INSERT INTO `messages`(`conversation_id`,`role`,`content`,`meta_json`,`created_at`) VALUES(?,?,?,?,?)',
        [(int) $convId, 'user', $content, json_encode(['fileIds' => $fileIds, 'files' => $fileCtx['files']], JSON_UNESCAPED_UNICODE), now_ms()]
    );
    $userMsgId = db_last_id();

    sse_start();
    $started = now_ms();
    $answer = '';
    $reasoning = '';
    $providerInfo = null;
    $searchPayload = null;

    try {
        sse_send('meta', ['conversationId' => (int) $convId, 'userMessageId' => $userMsgId]);

        if (!empty($b['search'])) {
            try {
                $results = run_search($user, $content !== '' ? $content : '文件内容', 6);
                $searchPayload = ['query' => $content, 'results' => $results];
                sse_send('search', $searchPayload);
            } catch (Throwable $e) {
                sse_send('search_error', ['message' => $e->getMessage()]);
            }
        }

        $history = db_all(
            'SELECT `role`,`content` FROM `messages` WHERE `conversation_id` = ? ORDER BY `id` DESC LIMIT 20',
            [(int) $convId]
        );
        $history = array_reverse($history);

        $systemParts = [];
        if ($personaPrompt) $systemParts[] = $personaPrompt;
        if ($searchPayload) $systemParts[] = chat_search_context($searchPayload['results']);
        // 附件放在最后，离用户问题最近，模型更不容易忽略
        if ($fileCtx['text']) $systemParts[] = $fileCtx['text'];
        if (!$thinking) $systemParts[] = '本次不需要展示思考过程：请直接给出最终回答，不要输出 <think> 标签、推理步骤或自我分析。';
        if (!$systemParts) $systemParts[] = '你是一个乐于助人的中文助手，回答简洁、准确。';

        $systemText = implode("\n\n", $systemParts);
        $historyMsgs = [];
        foreach ($history as $m) {
            if (($m['content'] ?? '') === '') continue;
            $historyMsgs[] = ['role' => $m['role'], 'content' => $m['content']];
        }

        // 用户在对话页选中的模型；不在该线路白名单内时回落到线路默认模型
        $requestedModel = trim((string) ($b['model'] ?? ''));

        $attempts = resolve_attempts($user, 'llm');
        if (!$attempts) {
            fail('INSUFFICIENT_COMPUTE', setting('insufficientComputeMsg', '算力暂时不足，请稍后再试或联系管理员。'), 402);
        }

        $failures = [];
        $succeeded = false;
        foreach ($attempts as $p) {
            $allowed = is_array($p['extra']['models'] ?? null) ? $p['extra']['models'] : [];
            if ($requestedModel !== '' && (!$allowed || in_array($requestedModel, $allowed, true))) {
                $p['model'] = $requestedModel;
            }
            $cfg = $p['extra']['modelConfig'][$p['model']] ?? [];
            if ($thinking && !empty($cfg['effort'])) $p['extra']['reasoningEffort'] = (string) $cfg['effort'];
            $messages = array_merge(
                [['role' => 'system', 'content' => $systemText]],
                trim_history_for_context($historyMsgs, (int) ($cfg['context'] ?? 0))
            );

            $providerInfo = [
                'name' => $p['name'] ?: ($p['ownerType'] === 'global' ? '共享算力' : '自有算力'),
                'ownerType' => $p['ownerType'],
                'model' => $p['model'],
                'key' => '',
            ];
            sse_send('provider', $providerInfo);
            $emitted = false;
            $tf = new ThinkStreamFilter($thinking);
            $res = llm_stream(
                $p,
                $messages,
                function ($text) use (&$answer, &$reasoning, &$emitted, $tf) {
                    foreach ($tf->feed($text) as [$kind, $piece]) {
                        if ($piece === '') continue;
                        $emitted = true;
                        if ($kind === 'content') {
                            $answer .= $piece;
                            sse_send('delta', ['text' => $piece]);
                        } elseif ($tf->keep) {
                            $reasoning .= $piece;
                            sse_send('reasoning', ['text' => $piece]);
                        }
                    }
                },
                function ($text) use (&$reasoning, &$emitted, $tf) {
                    $emitted = true;
                    if (!$tf->keep) return;
                    $reasoning .= $text;
                    sse_send('reasoning', ['text' => $text]);
                }
            );
            foreach ($tf->flush() as [$kind, $piece]) {
                if ($piece === '') continue;
                if ($kind === 'content') {
                    $answer .= $piece;
                    sse_send('delta', ['text' => $piece]);
                } elseif ($tf->keep) {
                    $reasoning .= $piece;
                    sse_send('reasoning', ['text' => $piece]);
                }
            }
            if ($res['ok']) {
                provider_mark((int) $p['id'], true);
                $succeeded = true;
                break;
            }
            provider_mark((int) $p['id'], false, $res['error']);
            $failures[] = ['owner' => $p['ownerType'], 'name' => $p['name'], 'error' => $res['error']];
            if ($emitted) {
                fail('CHAT_FAILED', '生成中断：' . $res['error'], 502);
            }
        }
        if (!$succeeded) {
            $custom = trim((string) ($attempts[0]['errorMessage'] ?? ''));
            $detail = $failures ? end($failures)['error'] : '上游全部不可用';
            fail('INSUFFICIENT_COMPUTE', $custom ? $custom . '（' . $detail . '）' : setting('insufficientComputeMsg', '算力暂时不足，请稍后再试或联系管理员。') . '（' . $detail . '）', 402);
        }

        if ($answer === '' && $reasoning === '') fail('CHAT_FAILED', '模型没有返回内容', 502);

        db_run(
            'INSERT INTO `messages`(`conversation_id`,`role`,`content`,`reasoning`,`meta_json`,`created_at`) VALUES(?,?,?,?,?,?)',
            [
                (int) $convId,
                'assistant',
                $answer,
                $reasoning ?: null,
                json_encode(['provider' => $providerInfo, 'personaName' => $personaName, 'search' => $searchPayload, 'think' => $thinking, 'elapsedMs' => now_ms() - $started], JSON_UNESCAPED_UNICODE),
                now_ms(),
            ]
        );
        $assistantId = db_last_id();
        db_run('UPDATE `conversations` SET `updated_at` = ? WHERE `id` = ?', [now_ms(), (int) $convId]);

        sse_send('done', [
            'conversationId' => (int) $convId,
            'assistantMessageId' => $assistantId,
            'usage' => null,
            'provider' => $providerInfo,
            'elapsedMs' => now_ms() - $started,
        ]);
    } catch (Throwable $e) {
        $message = $e instanceof ApiError ? $e->getMessage() : ($e->getMessage() ?: '生成失败');
        if ($answer !== '' || $reasoning !== '') {
            db_run(
                'INSERT INTO `messages`(`conversation_id`,`role`,`content`,`reasoning`,`meta_json`,`created_at`) VALUES(?,?,?,?,?,?)',
                [(int) $convId, 'assistant', $answer, $reasoning ?: null, json_encode(['partial' => true], JSON_UNESCAPED_UNICODE), now_ms()]
            );
            db_run('UPDATE `conversations` SET `updated_at` = ? WHERE `id` = ?', [now_ms(), (int) $convId]);
        }
        sse_send('error', [
            'code' => $e instanceof ApiError ? $e->apiCode : 'CHAT_FAILED',
            'message' => $message,
            'partial' => $answer !== '' || $reasoning !== '',
            'conversationId' => (int) $convId,
        ]);
    }

    exit;
}
