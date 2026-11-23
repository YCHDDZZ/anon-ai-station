<?php
declare(strict_types=1);

function api_route(string $method, string $path): void
{
    $m = strtoupper($method);
    $p = '/' . ltrim(parse_url($path, PHP_URL_PATH) ?: '/', '/');

    /* ── 公共 ─────────────────────────────────────────── */
    if ($m === 'GET' && $p === '/api/health') {
        json_out(['ok' => true, 'env' => getenv('APP_ENV') ?: 'production', 'mail' => smtp_configured() ? 'configured' : 'missing', 'time' => now_ms()]);
    }

    if ($m === 'GET' && $p === '/api/bootstrap') {
        $groups = array_values(array_filter(preg_split('/[\s,，;；、]+/', setting('registerGroupNumbers', '')) ?: []));
        json_out([
            'ok' => true,
            'siteName' => setting('siteName', '千早爱音的AI站'),
            'allowRegistration' => setting('allowRegistration', 'true') === 'true',
            'mailConfigured' => smtp_configured(),
            'mailDevFallback' => MAIL_DEV_FALLBACK,
            'captchaEnabled' => true,
            'requireGroup' => count($groups) > 0,
            'registrationLocked' => count($groups) === 0,
            'groupCount' => count($groups),
            'sessionDays' => SESSION_DAYS,
            'userProvidersOpen' => setting('userProvidersOpen', 'false') === 'true',
            'devMode' => CAPTCHA_DEV_ECHO,
        ]);
    }

    if ($m === 'GET' && $p === '/api/auth/captcha') {
        json_out(['ok' => true] + make_captcha());
    }

    if ($m === 'POST' && $p === '/api/auth/send-code') {
        $b = body_json();
        $email = strtolower(trim((string) ($b['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('BAD_REQUEST', '邮箱格式不正确', 400);
        verify_captcha_if_provided((string) ($b['captchaId'] ?? ''), (string) ($b['captchaCode'] ?? ''));

        $recent = db_get("SELECT COUNT(*) c FROM `login_events` WHERE `ip` = ? AND `kind` = 'code_send' AND `created_at` > ?", [client_ip(), now_ms() - 3600_000]);
        if ((int) ($recent['c'] ?? 0) >= 20) fail('RATE_LIMITED', '验证码请求过于频繁，请稍后再试', 429);
        $existing = db_get('SELECT * FROM `users` WHERE `email` = ?', [$email]);
        $modeRaw = (string) ($b['mode'] ?? '');
        $mode = in_array($modeRaw, ['login', 'register', 'reset'], true) ? $modeRaw : 'login';
        $allowRegistration = setting('allowRegistration', 'true') === 'true';
        if ($mode === 'register') {
            if (!$allowRegistration) fail('REGISTRATION_CLOSED', '当前未开放注册，请联系超级管理员开通账号', 403);
            if ($existing) fail('ALREADY_REGISTERED', '该邮箱已注册，请直接登录', 409);
            $groups = array_values(array_filter(preg_split('/[\s,，;；、]+/', setting('registerGroupNumbers', '')) ?: []));
            if ($groups) {
                $group = trim((string) ($b['groupNumber'] ?? ''));
                if ($group === '') fail('GROUP_REQUIRED', '请填写分部群号', 400);
                if (!in_array($group, $groups, true)) fail('GROUP_INVALID', '分部群号不正确', 400);
            }
        } elseif (!$existing) {
            fail('NOT_REGISTERED', '该邮箱还没有注册', 404);
        }
        if ($existing && $existing['status'] !== 'active') fail('ACCOUNT_DISABLED', '账号已被停用', 403);
        if ($existing && ban_info($existing)) fail('ACCOUNT_BANNED', '账号已被封禁', 403, ['ban' => ban_info($existing)]);

        // 同一邮箱 10 分钟内最多 3 封，避免邮件轰炸
        $recentEmail = db_get(
            "SELECT COUNT(*) c FROM `login_events` WHERE `email` = ? AND `kind` = 'code_send' AND `created_at` > ?",
            [$email, now_ms() - 600_000]
        );
        if ((int) ($recentEmail['c'] ?? 0) >= 3) {
            fail('RATE_LIMITED', '该邮箱获取验证码过于频繁，请 10 分钟后再试', 429);
        }

        $code = (string) random_int(100000, 999999);
        db_run('DELETE FROM `email_codes` WHERE `email` = ? AND `consumed` = 0', [$email]);
        db_run(
            'INSERT INTO `email_codes`(`email`,`code_hash`,`purpose`,`expires_at`,`attempts`,`consumed`,`created_at`) VALUES(?,?,?,?,0,0,?)',
            [$email, hash_code($code), $mode, now_ms() + 10 * 60_000, now_ms()]
        );
        log_login($existing['id'] ?? null, $email, 'code_send', true);

        $sent = false;
        $reason = '';
        if (smtp_configured()) {
            try {
                smtp_send($email, '【' . setting('siteName', '千早爱音的AI站') . '】' . $code . ' 是你的验证码', code_email_html(setting('siteName', '千早爱音的AI站'), $code, 10, $mode));
                $sent = true;
            } catch (Throwable $e) {
                $reason = $e->getMessage();
            }
        } else {
            $reason = '邮件服务未配置';
        }
        $out = ['ok' => true, 'isNewUser' => $mode === 'register', 'sent' => $sent, 'needGroup' => false];
        if (!$sent && MAIL_DEV_FALLBACK) {
            $out['devCode'] = $code;
            $out['fallback'] = $reason;
        } elseif (!$sent) {
            fail('MAIL_FAILED', '验证码发送失败：' . $reason, 502);
        }
        json_out($out);
    }

    if ($m === 'POST' && $p === '/api/auth/verify') {
        $b = body_json();
        $email = strtolower(trim((string) ($b['email'] ?? '')));
        $code = trim((string) ($b['code'] ?? ''));
        if (!preg_match('/^\d{6}$/', $code)) fail('BAD_REQUEST', '请输入 6 位数字验证码', 400);
        $row = db_get(
            "SELECT * FROM `email_codes` WHERE `email` = ? AND `consumed` = 0 AND `expires_at` > ? ORDER BY `id` DESC LIMIT 1",
            [$email, now_ms()]
        );
        if (!$row) fail('CODE_INVALID', '验证码已过期，请重新获取', 400);
        // 与 Node 版一致：注册必须过图形验证码；已有账号的邮箱码登录不必再填一次
        $isRegister = $row['purpose'] === 'register' || ($b['mode'] ?? '') === 'register';
        if ($isRegister) verify_captcha((string) ($b['captchaId'] ?? ''), (string) ($b['captchaCode'] ?? ''));
        else verify_captcha_if_provided((string) ($b['captchaId'] ?? ''), (string) ($b['captchaCode'] ?? ''));
        if ((int) $row['attempts'] >= 5) fail('CODE_LOCKED', '验证码尝试次数过多，请重新获取', 429);
        if (!hash_equals($row['code_hash'], hash_code($code))) {
            db_run('UPDATE `email_codes` SET `attempts` = `attempts` + 1 WHERE `id` = ?', [(int) $row['id']]);
            fail('CODE_INVALID', '验证码不正确', 400);
        }

        $user = db_get('SELECT * FROM `users` WHERE `email` = ?', [$email]);
        $password = '';
        if ($isRegister) {
            if ($user) fail('ALREADY_REGISTERED', '该邮箱已注册', 409);
            if (setting('allowRegistration', 'true') !== 'true') fail('REGISTRATION_CLOSED', '当前未开放注册，请联系超级管理员', 403);
            $password = (string) ($b['password'] ?? '');
            if (strlen($password) < 8) fail('BAD_REQUEST', '密码至少 8 位', 400);
            $groups = array_values(array_filter(preg_split('/[\s,，;；、]+/', setting('registerGroupNumbers', '')) ?: []));
            if ($groups) {
                $group = trim((string) ($b['groupNumber'] ?? ''));
                if ($group === '') fail('GROUP_REQUIRED', '请填写分部群号', 400);
                if (!in_array($group, $groups, true)) fail('GROUP_INVALID', '分部群号不正确', 400);
            }
        } elseif (!$user) {
            fail('NOT_REGISTERED', '该邮箱还没有注册', 404);
        }
        if ($user) {
            if ($user['status'] !== 'active') fail('ACCOUNT_DISABLED', '账号已被停用', 403);
            if (ban_info($user)) fail('ACCOUNT_BANNED', '账号已被封禁', 403, ['ban' => ban_info($user)]);
        }

        // 所有校验通过后才消费验证码：密码不合规、群号错误时可以用同一码重试
        db_run('UPDATE `email_codes` SET `consumed` = 1 WHERE `id` = ?', [(int) $row['id']]);

        if ($isRegister) {
            db_run(
                'INSERT INTO `users`(`email`,`password_hash`,`role`,`status`,`provider_preference`,`last_ip`,`created_at`,`last_login_at`) VALUES(?,?,?,?,?,?,?,?)',
                [$email, password_hash($password, PASSWORD_DEFAULT), 'user', 'active', 'own_first', client_ip(), now_ms(), now_ms()]
            );
            $user = db_get('SELECT * FROM `users` WHERE `id` = ?', [db_last_id()]);
            log_event('user_registered', $email, client_ip(), (int) $user['id']);
        }
        db_run('UPDATE `users` SET `last_login_at` = ?, `last_ip` = ? WHERE `id` = ?', [now_ms(), client_ip(), (int) $user['id']]);
        create_session((int) $user['id'], 'code');
        log_login((int) $user['id'], $email, 'login', true);
        $fresh = db_get('SELECT * FROM `users` WHERE `id` = ?', [(int) $user['id']]);
        json_out(['ok' => true, 'user' => public_user($fresh), 'sessionDays' => SESSION_DAYS]);
    }

    if ($m === 'POST' && $p === '/api/auth/password-login') {
        $b = body_json();
        $email = strtolower(trim((string) ($b['email'] ?? '')));
        $password = (string) ($b['password'] ?? '');
        verify_captcha((string) ($b['captchaId'] ?? ''), (string) ($b['captchaCode'] ?? ''));
        $fails = db_get(
            "SELECT COUNT(*) c FROM `login_events` WHERE `ok` = 0 AND `kind` = 'password_login' AND `ip` = ? AND `created_at` > ?",
            [client_ip(), now_ms() - 15 * 60_000]
        );
        if ((int) ($fails['c'] ?? 0) >= 10) {
            fail('RATE_LIMITED', '密码错误次数过多，请 15 分钟后再试', 429);
        }
        $user = db_get('SELECT * FROM `users` WHERE `email` = ?', [$email]);
        if (!$user || empty($user['password_hash']) || !password_verify($password, $user['password_hash'])) {
            log_login($user['id'] ?? null, $email, 'password_login', false, '密码不正确');
            fail('BAD_CREDENTIALS', '邮箱或密码不正确', 401);
        }
        if ($user['status'] !== 'active') fail('ACCOUNT_DISABLED', '账号已被停用', 403);
        if (ban_info($user)) fail('ACCOUNT_BANNED', '账号已被封禁', 403, ['ban' => ban_info($user)]);
        db_run('UPDATE `users` SET `last_login_at` = ?, `last_ip` = ? WHERE `id` = ?', [now_ms(), client_ip(), (int) $user['id']]);
        create_session((int) $user['id'], 'password');
        log_login((int) $user['id'], $email, 'password_login', true);
        $fresh = db_get('SELECT * FROM `users` WHERE `id` = ?', [(int) $user['id']]);
        json_out(['ok' => true, 'user' => public_user($fresh), 'sessionDays' => SESSION_DAYS]);
    }

    if ($m === 'POST' && $p === '/api/auth/logout') {
        if (current_user()) {
            $token = $_COOKIE[SESSION_COOKIE] ?? '';
            db_run('DELETE FROM `sessions` WHERE `token` = ?', [hash('sha256', $token)]);
        }
        clear_auth_cookie(SESSION_COOKIE);
        json_out(['ok' => true]);
    }

    if ($m === 'GET' && $p === '/api/auth/me') {
        $user = current_user();
        json_out(['ok' => true, 'user' => public_user($user)]);
    }

    if ($m === 'POST' && $p === '/api/auth/password') {
        $user = require_user();
        $b = body_json();
        $new = (string) ($b['newPassword'] ?? '');
        if (strlen($new) < 8) fail('BAD_REQUEST', '新密码至少 8 位', 400);

        // 重设密码必须再过一次邮箱验证码（发送给当前账号邮箱，用途 reset）
        $code = trim((string) ($b['code'] ?? ''));
        if (!preg_match('/^\d{6}$/', $code)) fail('BAD_REQUEST', '请输入 6 位邮箱验证码', 400);
        $row = db_get(
            "SELECT * FROM `email_codes` WHERE `email` = ? AND `purpose` = 'reset' AND `consumed` = 0 AND `expires_at` > ? ORDER BY `id` DESC LIMIT 1",
            [$user['email'], now_ms()]
        );
        if (!$row) fail('CODE_INVALID', '请先获取邮箱验证码', 400);
        if ((int) ($row['attempts'] ?? 0) >= 5) fail('CODE_LOCKED', '验证码尝试次数过多，请重新获取', 429);
        if (!hash_equals($row['code_hash'], hash_code($code))) {
            db_run('UPDATE `email_codes` SET `attempts` = `attempts` + 1 WHERE `id` = ?', [$row['id']]);
            fail('CODE_INVALID', '邮箱验证码不正确', 400);
        }

        db_run('UPDATE `email_codes` SET `consumed` = 1 WHERE `id` = ?', [$row['id']]);
        db_run('UPDATE `users` SET `password_hash` = ? WHERE `id` = ?', [password_hash($new, PASSWORD_DEFAULT), (int) $user['id']]);
        log_event('password_changed', $user['email'], null, (int) $user['id']);
        json_out(['ok' => true]);
    }

    /* ── 公告 / App 版本 ─────────────────────────────── */
    if ($m === 'GET' && $p === '/api/announcements/active') {
        require_user();
        json_out(['ok' => true, 'announcement' => announcement_active()]);
    }

    if ($m === 'GET' && preg_match('#^/api/announcements/(\d+)/image$#', $p, $mm)) {
        $user = require_user();
        $row = db_get('SELECT * FROM `announcements` WHERE `id` = ?', [(int) $mm[1]]);
        if (!$row || !$row['image_id']) fail('NOT_FOUND', '公告图片不存在', 404);
        if (!(int) $row['enabled'] && $user['role'] !== 'admin') fail('NOT_FOUND', '公告图片不存在', 404);
        $img = announcement_image_by_id((int) $row['image_id']);
        if (!$img || !is_file($img['path'])) fail('NOT_FOUND', '公告图片文件已丢失', 404);
        header('Content-Type: ' . ($img['mime'] ?: 'image/png'));
        header('Cache-Control: private, max-age=600');
        readfile($img['path']);
        exit;
    }

    if ($m === 'GET' && $p === '/api/app/version') {
        json_out(['ok' => true, 'latest' => app_version_info()]);
    }

    /* ── 个人 ─────────────────────────────────────────── */
    if ($m === 'GET' && $p === '/api/me') {
        $user = require_user();
        json_out([
            'ok' => true,
            'user' => public_user($user),
            'providerPreference' => $user['provider_preference'] ?: 'own_first',
            'personas' => personas_for($user),
            'llmModels' => collect_models($user),
            'ttsVoices' => tts_voices($user),
            'categories' => array_map(fn($c) => category_view($user, $c), CATEGORIES),
        ]);
    }

    if ($m === 'PATCH' && $p === '/api/me/preference') {
        $user = require_user();
        $pref = body_json()['providerPreference'] ?? '';
        if (!in_array($pref, ['own_first', 'shared_first'], true)) fail('BAD_REQUEST', '无效的优先策略', 400);
        db_run('UPDATE `users` SET `provider_preference` = ? WHERE `id` = ?', [$pref, (int) $user['id']]);
        json_out(['ok' => true, 'providerPreference' => $pref]);
    }

    if ($m === 'GET' && $p === '/api/me/quota') {
        $user = require_user();
        json_out(['ok' => true] + user_quota_summary($user));
    }

    if ($m === 'GET' && $p === '/api/me/shared-inventory') {
        require_user();
        $out = [];
        foreach (CATEGORIES as $c) {
            $out[$c] = (bool) db_get(
                "SELECT 1 AS x FROM `providers` WHERE `owner_type` = 'global' AND `category` = ? AND `enabled` = 1 LIMIT 1",
                [$c]
            );
        }
        json_out(['ok' => true, 'inventory' => $out]);
    }

    /* ── 会话 ─────────────────────────────────────────── */
    if ($m === 'GET' && $p === '/api/conversations') {
        $user = require_user();
        $rows = db_all(
            'SELECT c.`id`,c.`title`,c.`created_at`,c.`updated_at`,c.`persona_name`,
                (SELECT COUNT(*) FROM `messages` m WHERE m.`conversation_id` = c.`id`) AS msg_count,
                (SELECT `content` FROM `messages` m WHERE m.`conversation_id` = c.`id` ORDER BY m.`id` DESC LIMIT 1) AS last
             FROM `conversations` c WHERE c.`user_id` = ? ORDER BY c.`updated_at` DESC LIMIT 200',
            [(int) $user['id']]
        );
        json_out(['ok' => true, 'conversations' => array_map(fn($r) => [
            'id' => (int) $r['id'],
            'title' => $r['title'],
            'personaName' => $r['persona_name'],
            'createdAt' => (int) $r['created_at'],
            'updatedAt' => (int) $r['updated_at'],
            'messageCount' => (int) $r['msg_count'],
            'preview' => mb_substr((string) ($r['last'] ?? ''), 0, 80),
        ], $rows)]);
    }

    if ($m === 'POST' && $p === '/api/conversations') {
        $user = require_user();
        $title = mb_substr(trim((string) (body_json()['title'] ?? '')), 0, 120) ?: '新对话';
        db_run('INSERT INTO `conversations`(`user_id`,`title`,`created_at`,`updated_at`) VALUES(?,?,?,?)', [(int) $user['id'], $title, now_ms(), now_ms()]);
        json_out(['ok' => true, 'conversation' => ['id' => db_last_id(), 'title' => $title, 'createdAt' => now_ms(), 'updatedAt' => now_ms(), 'messageCount' => 0]]);
    }

    if ($m === 'GET' && preg_match('#^/api/conversations/(\d+)$#', $p, $mm)) {
        $user = require_user();
        $conv = db_get('SELECT * FROM `conversations` WHERE `id` = ? AND `user_id` = ?', [(int) $mm[1], (int) $user['id']]);
        if (!$conv) fail('NOT_FOUND', '对话不存在', 404);
        $msgs = db_all('SELECT * FROM `messages` WHERE `conversation_id` = ? ORDER BY `id`', [(int) $conv['id']]);
        // 与 Node 版保持一致：messages 放在顶层，前端直接读 r.messages
        $list = array_map(fn($m) => [
            'id' => (int) $m['id'],
            'role' => $m['role'],
            'content' => $m['content'],
            'reasoning' => (string) ($m['reasoning'] ?? ''),
            'meta' => json_decode($m['meta_json'] ?: '{}', true) ?: new stdClass(),
            'createdAt' => (int) $m['created_at'],
        ], $msgs);
        // 旧消息里可能残留 <think> 标签，读出来时拆到 reasoning，避免正文外泄
        foreach ($list as &$mm) {
            if (preg_match('#^\s*<think(?:ing)?>(.*?)</think(?:ing)?>#is', (string) $mm['content'], $mt)) {
                $mm['content'] = ltrim(substr((string) $mm['content'], strlen($mt[0])));
                if ($mm['reasoning'] === '') $mm['reasoning'] = trim($mt[1]);
            }
        }
        unset($mm);
        json_out([
            'ok' => true,
            'conversation' => [
                'id' => (int) $conv['id'],
                'title' => $conv['title'],
                'personaName' => $conv['persona_name'],
                'createdAt' => (int) $conv['created_at'],
                'updatedAt' => (int) $conv['updated_at'],
            ],
            'messages' => $list,
        ]);
    }

    if ($m === 'GET' && $p === '/api/conversations/export') {
        $user = require_user();
        $convs = db_all('SELECT * FROM `conversations` WHERE `user_id` = ? ORDER BY `id`', [(int) $user['id']]);
        header('Content-Disposition: attachment; filename="conversations-' . date('Y-m-d') . '.json"');
        json_out(['app' => 'anon-ai-station', 'version' => 1, 'exportedAt' => now_ms(), 'conversations' => array_map('export_conversation', $convs)]);
    }

    if ($m === 'GET' && preg_match('#^/api/conversations/(\d+)/export$#', $p, $mm)) {
        $user = require_user();
        $conv = db_get('SELECT * FROM `conversations` WHERE `id` = ? AND `user_id` = ?', [(int) $mm[1], (int) $user['id']]);
        if (!$conv) fail('NOT_FOUND', '对话不存在', 404);
        header('Content-Disposition: attachment; filename="conversation-' . (int) $conv['id'] . '.json"');
        json_out(['app' => 'anon-ai-station', 'version' => 1, 'exportedAt' => now_ms(), 'conversations' => [export_conversation($conv)]]);
    }

    if ($m === 'POST' && $p === '/api/conversations/import') {
        $user = require_user();
        $body = body_json();
        // PHP 里 JSON 对象和数组都会解码成 array，必须用 array_is_list 区分；
        // 否则导出文件 { conversations: [...] } 会被当成对话列表，导致导入 0 条
        if (array_is_list($body)) {
            $list = $body;
        } elseif (is_array($body['conversations'] ?? null)) {
            $list = $body['conversations'];
        } else {
            $list = null;
        }
        if (!is_array($list)) fail('BAD_REQUEST', '文件格式不正确：需要是导出文件，或包含 conversations 数组', 400);
        if (!$list) fail('BAD_REQUEST', '文件里没有可导入的对话', 400);
        if (count($list) > 300) fail('BAD_REQUEST', '一次最多导入 300 个对话', 400);
        $imported = 0;
        $totalMessages = 0;
        db()->beginTransaction();
        try {
            foreach ($list as $item) {
                $msgs = is_array($item['messages'] ?? null) ? $item['messages'] : [];
                if (!$msgs) continue;
                if (count($msgs) > 500) fail('BAD_REQUEST', '单个对话超过 500 条消息，无法导入', 400);
                $totalMessages += count($msgs);
                if ($totalMessages > 5000) fail('BAD_REQUEST', '一次最多导入 5000 条消息', 400);
                $ts = now_ms();
                $title = mb_substr(trim((string) ($item['title'] ?? '导入的对话')), 0, 120) ?: '导入的对话';
                db_run(
                    'INSERT INTO `conversations`(`user_id`,`title`,`persona_name`,`persona_prompt`,`created_at`,`updated_at`) VALUES(?,?,?,?,?,?)',
                    [(int) $user['id'], $title, isset($item['personaName']) ? mb_substr((string) $item['personaName'], 0, 40) : null, isset($item['personaPrompt']) ? mb_substr((string) $item['personaPrompt'], 0, 8000) : null, (int) ($item['createdAt'] ?? $ts), (int) ($item['updatedAt'] ?? $ts)]
                );
                $cid = db_last_id();
                foreach ($msgs as $msg) {
                    $role = in_array($msg['role'] ?? '', ['user', 'assistant', 'system'], true) ? $msg['role'] : 'user';
                    $meta = is_array($msg['meta'] ?? null) ? json_encode($msg['meta'], JSON_UNESCAPED_UNICODE) : null;
                    db_run(
                        'INSERT INTO `messages`(`conversation_id`,`role`,`content`,`reasoning`,`meta_json`,`created_at`) VALUES(?,?,?,?,?,?)',
                        [
                            $cid,
                            $role,
                            mb_substr((string) ($msg['content'] ?? ''), 0, 200000),
                            mb_substr((string) ($msg['reasoning'] ?? ''), 0, 200000),
                            $meta === false ? null : ($meta === null ? null : mb_substr($meta, 0, 20000)),
                            (int) ($msg['createdAt'] ?? $ts),
                        ]
                    );
                }
                $imported++;
            }
            db()->commit();
        } catch (Throwable $e) {
            db()->rollBack();
            throw $e;
        }
        json_out(['ok' => true, 'imported' => $imported, 'messages' => $totalMessages]);
    }

    if ($m === 'DELETE' && preg_match('#^/api/conversations/(\d+)$#', $p, $mm)) {
        $user = require_user();
        $id = (int) $mm[1];
        $conv = db_get('SELECT `id` FROM `conversations` WHERE `id` = ? AND `user_id` = ?', [$id, (int) $user['id']]);
        if (!$conv) fail('NOT_FOUND', '对话不存在', 404);
        // 记下这个会话用到的附件，删完消息后把无人引用的文件一并清掉
        $fileIds = [];
        foreach (db_all('SELECT `meta_json` FROM `messages` WHERE `conversation_id` = ?', [$id]) as $row) {
            $meta = json_decode((string) ($row['meta_json'] ?? '{}'), true);
            foreach ((array) ($meta['fileIds'] ?? []) as $fid) $fileIds[] = (int) $fid;
        }
        db_run('DELETE FROM `messages` WHERE `conversation_id` = ?', [$id]);
        db_run('DELETE FROM `conversations` WHERE `id` = ? AND `user_id` = ?', [$id, (int) $user['id']]);
        cleanup_orphan_files($fileIds, (int) $user['id']);
        json_out(['ok' => true]);
    }

    if ($m === 'DELETE' && $p === '/api/conversations') {
        $user = require_user();
        $fileIds = [];
        foreach (db_all(
            'SELECT `meta_json` FROM `messages` WHERE `conversation_id` IN (SELECT `id` FROM `conversations` WHERE `user_id` = ?)',
            [(int) $user['id']]
        ) as $row) {
            $meta = json_decode((string) ($row['meta_json'] ?? '{}'), true);
            foreach ((array) ($meta['fileIds'] ?? []) as $fid) $fileIds[] = (int) $fid;
        }
        db_run('DELETE FROM `messages` WHERE `conversation_id` IN (SELECT `id` FROM `conversations` WHERE `user_id` = ?)', [(int) $user['id']]);
        db_run('DELETE FROM `conversations` WHERE `user_id` = ?', [(int) $user['id']]);
        cleanup_orphan_files($fileIds, (int) $user['id']);
        json_out(['ok' => true]);
    }

    /* ── 角色 ─────────────────────────────────────────── */
    if ($m === 'GET' && $p === '/api/personas') {
        $user = require_user();
        json_out(['ok' => true] + personas_for($user));
    }

    /* ── 用户反馈 ─────────────────────────────────────── */
    if ($m === 'POST' && $p === '/api/feedback/images') {
        $user = require_user();
        $raw = raw_body();
        if ($raw === '') fail('BAD_REQUEST', '图片为空', 400);
        if (strlen($raw) > 5 * 1024 * 1024) fail('BAD_REQUEST', '单张图片不能超过 5MB', 400);
        $mime = strtolower(trim((string) ($_SERVER['HTTP_X_FILE_TYPE'] ?? 'image/png')));
        $map = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/jpg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'];
        if (!isset($map[$mime])) fail('BAD_REQUEST', '只支持 PNG / JPG / WebP / GIF 图片', 400);
        $dir = UPLOAD_DIR . '/feedback';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $name = (int) $user['id'] . '-' . bin2hex(random_bytes(8)) . '.' . $map[$mime];
        if (file_put_contents($dir . '/' . $name, $raw) === false) fail('SERVER_ERROR', '图片保存失败', 500);
        json_out(['ok' => true, 'name' => $name, 'url' => '/api/feedback/images/' . $name]);
    }

    if ($m === 'GET' && preg_match('#^/api/feedback/images/([A-Za-z0-9._-]+)$#', $p, $mm)) {
        $user = require_user();
        $name = $mm[1];
        if ($user['role'] !== 'admin' && !str_starts_with($name, (int) $user['id'] . '-')) {
            fail('FORBIDDEN', '无权查看该图片', 403);
        }
        $path = UPLOAD_DIR . '/feedback/' . $name;
        if (!is_file($path)) fail('NOT_FOUND', '图片不存在', 404);
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp', 'gif' => 'image/gif'];
        header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
        header('Cache-Control: private, max-age=3600');
        readfile($path);
        exit;
    }

    if ($m === 'POST' && $p === '/api/feedback') {
        $user = require_user();
        $b = body_json();
        $content = mb_substr(trim((string) ($b['content'] ?? '')), 0, 4000);
        $images = [];
        foreach ((array) ($b['images'] ?? []) as $n) {
            $n = (string) $n;
            if (preg_match('#^' . (int) $user['id'] . '-[a-f0-9]{16}\.(png|jpg|webp|gif)$#', $n) && !in_array($n, $images, true)) {
                $images[] = $n;
            }
        }
        $images = array_slice($images, 0, 3);
        if ($content === '' && !$images) fail('BAD_REQUEST', '请填写反馈内容或上传截图', 400);
        db_run(
            'INSERT INTO `feedback`(`user_id`,`content`,`images_json`,`status`,`created_at`,`updated_at`) VALUES(?,?,?,?,?,?)',
            [(int) $user['id'], $content, json_encode($images, JSON_UNESCAPED_UNICODE), 'open', now_ms(), now_ms()]
        );
        json_out(['ok' => true, 'id' => db_last_id()]);
    }

    if ($m === 'GET' && $p === '/api/admin/feedback') {
        require_admin();
        $rows = db_all('SELECT f.*, u.`email` FROM `feedback` f LEFT JOIN `users` u ON u.`id` = f.`user_id` ORDER BY f.`id` DESC LIMIT 500');
        $groups = [];
        foreach ($rows as $r) {
            $uid = (int) $r['user_id'];
            if (!isset($groups[$uid])) {
                $groups[$uid] = [
                    'userId' => $uid,
                    'email' => (string) ($r['email'] ?? '已注销用户'),
                    'count' => 0,
                    'lastAt' => (int) $r['created_at'],
                    'items' => [],
                ];
            }
            $groups[$uid]['count']++;
            $groups[$uid]['items'][] = [
                'id' => (int) $r['id'],
                'content' => (string) $r['content'],
                'images' => json_decode((string) $r['images_json'], true) ?: [],
                'status' => (string) $r['status'],
                'createdAt' => (int) $r['created_at'],
            ];
        }
        json_out(['ok' => true, 'groups' => array_values($groups), 'total' => count($rows)]);
    }

    if ($m === 'PATCH' && preg_match('#^/api/admin/feedback/(\d+)$#', $p, $mm)) {
        require_admin();
        $b = body_json();
        $status = ($b['status'] ?? '') === 'resolved' ? 'resolved' : 'open';
        db_run('UPDATE `feedback` SET `status` = ?, `updated_at` = ? WHERE `id` = ?', [$status, now_ms(), (int) $mm[1]]);
        json_out(['ok' => true]);
    }

    if ($m === 'DELETE' && preg_match('#^/api/admin/feedback/(\d+)$#', $p, $mm)) {
        require_admin();
        $row = db_get('SELECT `images_json` FROM `feedback` WHERE `id` = ?', [(int) $mm[1]]);
        db_run('DELETE FROM `feedback` WHERE `id` = ?', [(int) $mm[1]]);
        foreach ((json_decode((string) ($row['images_json'] ?? '[]'), true) ?: []) as $n) {
            $path = UPLOAD_DIR . '/feedback/' . basename((string) $n);
            if (is_file($path)) @unlink($path);
        }
        json_out(['ok' => true]);
    }

    if ($m === 'POST' && $p === '/api/admin/market/sync') {
        require_admin();
        $b = body_json();
        $start = (int) ($b['start'] ?? 0);
        if ($start <= 0) $start = max(1, (int) setting('marketSyncNext', '1'));
        if ($start > 1200) $start = 1;
        $end = min(1200, max($start, $start + 49));
        $ids = range($start, $end);
        $r = market_request('/api/v1/prompts/batch', ['ids' => implode(',', $ids)]);
        $saved = 0;
        foreach (($r['prompts'] ?? []) as $c) {
            if (!empty($c['is_nsfw'])) continue;
            $id = (int) ($c['id'] ?? 0);
            if ($id <= 0) continue;
            $data = [
                (string) ($c['title'] ?? ''),
                (string) ($c['author'] ?? ''),
                (string) ($c['tags'] ?? ''),
                (int) ($c['copy_count'] ?? 0),
                (string) ($c['content'] ?? ''),
                (string) ($c['created_at'] ?? ''),
                now_ms(),
                $id,
            ];
            $exists = db_get('SELECT `id` FROM `market_cards` WHERE `id` = ?', [$id]);
            if ($exists) {
                db_run('UPDATE `market_cards` SET `title`=?, `author`=?, `tags`=?, `copy_count`=?, `content`=?, `created_at`=?, `fetched_at`=? WHERE `id`=?', $data);
            } else {
                db_run('INSERT INTO `market_cards`(`title`,`author`,`tags`,`copy_count`,`content`,`created_at`,`fetched_at`,`id`) VALUES(?,?,?,?,?,?,?,?)', $data);
            }
            $saved++;
        }
        set_setting('marketSyncNext', (string) ($end + 1));
        $cached = (int) (db_get('SELECT COUNT(*) AS c FROM `market_cards`')['c'] ?? 0);
        json_out([
            'ok' => true,
            'next' => $end + 1,
            'done' => $end >= 1200,
            'saved' => $saved,
            'cached' => $cached,
            'scanned' => $end,
        ]);
    }

    if ($m === 'GET' && $p === '/api/admin/market/stats') {
        require_admin();
        $cached = (int) (db_get('SELECT COUNT(*) AS c FROM `market_cards`')['c'] ?? 0);
        json_out(['ok' => true, 'cached' => $cached, 'target' => 1200, 'next' => (int) setting('marketSyncNext', '1'), 'keys' => market_key_status()]);
    }

    /* ── 角色卡广场（服务端代理） ─────────────────────── */
    if ($m === 'GET' && $p === '/api/market/personas') {
        $user = require_user();
        $tag = trim((string) ($_GET['tag'] ?? ''));
        if ($tag === '') $tag = '角色扮演';
        $cursor = max(0, (int) ($_GET['cursor'] ?? 0));
        $keyword = trim((string) ($_GET['q'] ?? ''));

        $cached = (int) (db_get('SELECT COUNT(*) AS c FROM `market_cards`')['c'] ?? 0);
        if ($cached > 0) {
            // 本地缓存优先：可以一次拿到全部角色卡，并按标题/标签/作者搜索
            $where = ['`is_nsfw` = 0'];
            $args = [];
            if ($tag !== '全部') {
                $where[] = '`tags` LIKE ?';
                $args[] = '%' . $tag . '%';
            }
            if ($keyword !== '') {
                $where[] = '(`title` LIKE ? OR `tags` LIKE ? OR `author` LIKE ?)';
                array_push($args, '%' . $keyword . '%', '%' . $keyword . '%', '%' . $keyword . '%');
            }
            $ws = implode(' AND ', $where);
            $total = (int) (db_get('SELECT COUNT(*) AS c FROM `market_cards` WHERE ' . $ws, $args)['c'] ?? 0);
            $rows = db_all(
                'SELECT * FROM `market_cards` WHERE ' . $ws . ' ORDER BY `copy_count` DESC, `id` DESC LIMIT 24 OFFSET ?',
                array_merge($args, [$cursor])
            );
            $items = [];
            foreach ($rows as $r) {
                $items[] = [
                    'id' => (int) $r['id'],
                    'title' => (string) $r['title'],
                    'author' => (string) ($r['author'] ?? ''),
                    'tags' => (string) ($r['tags'] ?? ''),
                    'copyCount' => (int) ($r['copy_count'] ?? 0),
                    'createdAt' => (string) ($r['created_at'] ?? ''),
                ];
            }
            $next = $cursor + 24 < $total ? $cursor + 24 : null;
            json_out([
                'ok' => true,
                'tag' => $tag,
                'q' => $keyword,
                'items' => $items,
                'total' => $total,
                'cached' => $cached,
                'source' => 'local',
                'hasMore' => $next !== null,
                'nextCursor' => $next,
            ]);
        }

        if ($tag === '全部') $tag = '角色扮演';
        if ($keyword !== '') {
            // 上游没有关键词搜索，这里在当前分类里取 100 条按标题/标签过滤
            $r = market_request('/api/v1/prompts/by_tag', ['tag' => $tag, 'per_page' => 100]);
            $all = [];
            foreach (($r['prompts'] ?? []) as $it) {
                if (!empty($it['is_nsfw'])) continue;
                $title = (string) ($it['title'] ?? '');
                $tags = (string) ($it['tags'] ?? '');
                if (mb_stripos($title, $keyword) !== false || mb_stripos($tags, $keyword) !== false) {
                    $all[] = market_card_brief((array) $it);
                }
            }
            $total = count($all);
            $items = array_slice($all, $cursor, 24);
            $next = $cursor + 24 < $total ? $cursor + 24 : null;
            json_out([
                'ok' => true,
                'tag' => $tag,
                'q' => $keyword,
                'items' => $items,
                'total' => $total,
                'cached' => 0,
                'source' => 'live',
                'hasMore' => $next !== null,
                'nextCursor' => $next,
            ]);
        }

        $q = ['tag' => $tag, 'per_page' => 24];
        if ($cursor > 0) $q['cursor'] = $cursor;
        $r = market_request('/api/v1/prompts/by_tag', $q);
        $items = [];
        foreach (($r['prompts'] ?? []) as $it) {
            if (!empty($it['is_nsfw'])) continue;
            $items[] = market_card_brief((array) $it);
        }
        json_out([
            'ok' => true,
            'tag' => $tag,
            'items' => $items,
            'cached' => 0,
            'source' => 'live',
            'hasMore' => !empty($r['has_more']),
            'nextCursor' => $r['next_cursor'] ?? null,
        ]);
    }

    if ($m === 'GET' && preg_match('#^/api/market/personas/(\d+)$#', $p, $mm)) {
        $user = require_user();
        $id = (int) $mm[1];
        $row = db_get('SELECT * FROM `market_cards` WHERE `id` = ?', [$id]);
        if ($row) {
            if ((int) $row['is_nsfw'] === 1) fail('FORBIDDEN', '该角色卡不适合展示', 403);
            json_out(['ok' => true, 'card' => [
                'id' => (int) $row['id'],
                'title' => (string) $row['title'],
                'author' => (string) ($row['author'] ?? ''),
                'tags' => (string) ($row['tags'] ?? ''),
                'copyCount' => (int) ($row['copy_count'] ?? 0),
                'createdAt' => (string) ($row['created_at'] ?? ''),
                'content' => (string) ($row['content'] ?? ''),
            ]]);
        }
        $r = market_request('/api/v1/prompt/' . $id);
        $c = $r['prompt'] ?? null;
        if (!is_array($c)) fail('NOT_FOUND', '角色卡不存在', 404);
        if (!empty($c['is_nsfw'])) fail('FORBIDDEN', '该角色卡不适合展示', 403);
        json_out(['ok' => true, 'card' => market_card_brief($c) + [
            'content' => (string) ($c['content'] ?? ''),
        ]]);
    }

    if ($m === 'GET' && $p === '/api/personas/mine') {
        $user = require_user();
        json_out(['ok' => true, 'personas' => personas_for($user)['own']]);
    }

    if ($m === 'POST' && $p === '/api/personas') {
        $user = require_user();
        $b = body_json();
        $name = trim((string) ($b['name'] ?? ''));
        $prompt = trim((string) ($b['prompt'] ?? ''));
        if ($name === '' || $prompt === '') fail('BAD_REQUEST', '角色名和提示词不能为空', 400);
        db_run(
            'INSERT INTO `personas`(`owner_type`,`owner_id`,`name`,`description`,`prompt`,`enabled`,`sort`,`created_at`,`updated_at`) VALUES(\'user\',?,?,?,?,1,0,?,?)',
            [(int) $user['id'], mb_substr($name, 0, 60), (string) ($b['description'] ?? ''), $prompt, now_ms(), now_ms()]
        );
        $row = db_get('SELECT * FROM `personas` WHERE `id` = ?', [db_last_id()]);
        json_out(['ok' => true, 'persona' => public_persona($row)]);
    }

    if ($m === 'PUT' && preg_match('#^/api/personas/(\d+)$#', $p, $mm)) {
        $user = require_user();
        $row = db_get('SELECT * FROM `personas` WHERE `id` = ?', [(int) $mm[1]]);
        if (!$row || $row['owner_type'] !== 'user' || (int) $row['owner_id'] !== (int) $user['id']) fail('FORBIDDEN', '无权修改该角色', 403);
        $b = body_json();
        db_run(
            'UPDATE `personas` SET `name` = ?, `description` = ?, `prompt` = ?, `updated_at` = ? WHERE `id` = ?',
            [mb_substr(trim((string) ($b['name'] ?? $row['name'])), 0, 60), (string) ($b['description'] ?? $row['description']), (string) ($b['prompt'] ?? $row['prompt']), now_ms(), (int) $row['id']]
        );
        json_out(['ok' => true, 'persona' => public_persona(db_get('SELECT * FROM `personas` WHERE `id` = ?', [(int) $row['id']]))]);
    }

    if ($m === 'DELETE' && preg_match('#^/api/personas/(\d+)$#', $p, $mm)) {
        $user = require_user();
        $row = db_get('SELECT * FROM `personas` WHERE `id` = ?', [(int) $mm[1]]);
        if (!$row || $row['owner_type'] !== 'user' || (int) $row['owner_id'] !== (int) $user['id']) fail('FORBIDDEN', '无权删除该角色', 403);
        db_run('DELETE FROM `personas` WHERE `id` = ?', [(int) $row['id']]);
        json_out(['ok' => true]);
    }

    /* ── 聊天 / 文件 ──────────────────────────────────── */
    if ($m === 'POST' && $p === '/api/chat') {
        handle_chat();
    }

    if ($m === 'POST' && $p === '/api/chat/tts') {
        @set_time_limit(180);
        $user = require_user();
        $b = body_json();
        $text = trim((string) ($b['text'] ?? ''));
        if ($text === '') fail('BAD_REQUEST', '朗读内容为空', 400);
        $audio = run_tts($user, mb_substr($text, 0, 4000), (string) ($b['voice'] ?? ''));
        header('Content-Type: ' . $audio['mime']);
        header('Cache-Control: no-store');
        echo $audio['data'];
        exit;
    }

    if ($m === 'POST' && $p === '/api/tools/search') {
        @set_time_limit(120);
        $user = require_user();
        $b = body_json();
        $query = trim((string) ($b['query'] ?? ''));
        if ($query === '') fail('BAD_REQUEST', '搜索内容为空', 400);
        $started = now_ms();
        $results = run_search($user, $query, max(1, min(10, (int) ($b['limit'] ?? 6))));
        json_out(['ok' => true, 'results' => $results, 'provider' => 'search', 'elapsedMs' => now_ms() - $started]);
    }

    if ($m === 'POST' && $p === '/api/tools/crawl') {
        @set_time_limit(180);
        $user = require_user();
        $url = trim((string) (body_json()['url'] ?? ''));
        if (!preg_match('#^https?://#i', $url)) fail('BAD_REQUEST', '请输入合法的 http(s) 地址', 400);
        json_out(['ok' => true] + run_crawl($user, $url));
    }

    if ($m === 'POST' && $p === '/api/tools/asr') {
        @set_time_limit(300);
        $user = require_user();
        $raw = raw_body();
        if ($raw === '') fail('BAD_REQUEST', '没有收到音频', 400);
        if (strlen($raw) > 20 * 1024 * 1024) fail('BAD_REQUEST', '音频过大', 400);
        $name = rawurldecode($_SERVER['HTTP_X_FILE_NAME'] ?? 'recording.webm');
        $mime = $_SERVER['HTTP_X_FILE_TYPE'] ?? 'audio/webm';
        $asrExt = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!in_array($asrExt, ['webm', 'wav', 'mp3', 'ogg', 'm4a', 'amr', 'flac'], true)) $asrExt = 'webm';
        $tmp = UPLOAD_DIR . '/asr-' . bin2hex(random_bytes(8)) . '.' . $asrExt;
        file_put_contents($tmp, $raw);
        try {
            $started = now_ms();
            $r = run_asr($user, ['path' => $tmp, 'name' => $name, 'mime' => $mime]);
            @unlink($tmp);
            json_out(['ok' => true, 'text' => $r['text'], 'provider' => $r['provider'], 'elapsedMs' => now_ms() - $started]);
        } catch (Throwable $e) {
            @unlink($tmp);
            throw $e;
        }
    }

    if ($m === 'POST' && $p === '/api/files') {
        @set_time_limit(300);
        $user = require_user();
        $raw = raw_body();
        $name = $_SERVER['HTTP_X_FILE_NAME'] ?? 'upload.bin';
        try {
            $name = rawurldecode($name);
        } catch (Throwable $e) {
        }
        $mime = $_SERVER['HTTP_X_FILE_TYPE'] ?? ($_SERVER['CONTENT_TYPE'] ?? 'application/octet-stream');
        $size = strlen($raw);
        if ($size === 0) fail('BAD_REQUEST', '文件为空', 400);
        if ($size > MAX_FILE_MB * 1024 * 1024) fail('BAD_REQUEST', '文件不能超过 ' . MAX_FILE_MB . 'MB', 400);
        // 只保留安全的扩展名：附件目录不允许出现可执行脚本
        $name = mb_substr(str_replace(["\0", '/', '\\'], '', $name), 0, 200);
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        $allowedExt = ['txt', 'md', 'markdown', 'csv', 'json', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'mp3', 'wav', 'webm', 'ogg', 'm4a', 'amr', 'flac'];
        if (!in_array($ext, $allowedExt, true)) $ext = '';
        $stored = date('Ymd') . '-' . bin2hex(random_bytes(8)) . ($ext ? '.' . $ext : '');
        $path = UPLOAD_DIR . '/' . $stored;
        file_put_contents($path, $raw);
        $text = '';
        $parseMode = 'none';
        $warning = '未配置文件解析能力，已保存文件但未提取正文。';
        if (in_array($ext, ['txt', 'md', 'markdown', 'csv', 'json'], true) || str_starts_with($mime, 'text/')) {
            $text = mb_substr($raw, 0, 200000);
            $parseMode = 'inline';
            $warning = null;
        } elseif (str_starts_with($mime, 'image/')) {
            try {
                $r = run_ocr($user, ['path' => $path, 'name' => $name, 'mime' => $mime]);
                $text = $r['text'];
                $parseMode = 'ocr';
                $warning = null;
            } catch (Throwable $e) {
                $warning = '图片识别失败：' . $e->getMessage();
            }
        } elseif (in_array($ext, ['pdf', 'doc', 'docx', 'ppt', 'pptx'], true)) {
            try {
                $r = run_parse_http($user, ['path' => $path, 'name' => $name, 'mime' => $mime]);
                $text = $r['text'];
                $parseMode = 'parse';
                $warning = null;
            } catch (Throwable $e) {
                $warning = '文档解析失败：' . $e->getMessage();
            }
        }
        db_run(
            'INSERT INTO `files`(`user_id`,`name`,`mime`,`size`,`path`,`text`,`created_at`) VALUES(?,?,?,?,?,?,?)',
            [(int) $user['id'], mb_substr($name, 0, 200), $mime, $size, $path, $text, now_ms()]
        );
        json_out(['ok' => true, 'file' => ['id' => db_last_id(), 'name' => $name, 'mime' => $mime, 'size' => $size, 'parseMode' => $parseMode, 'textLength' => mb_strlen($text), 'warning' => $warning]]);
    }

    /* ── 后台 ─────────────────────────────────────────── */
    if ($m === 'GET' && $p === '/api/admin/overview') {
        require_admin();
        $stats = [
            'users' => (int) db_get('SELECT COUNT(*) c FROM `users`')['c'],
            'admins' => (int) db_get("SELECT COUNT(*) c FROM `users` WHERE `role` = 'admin'")['c'],
            'banned' => (int) db_get('SELECT COUNT(*) c FROM `users` WHERE `banned_until` IS NOT NULL')['c'],
            'conversations' => (int) db_get('SELECT COUNT(*) c FROM `conversations`')['c'],
            'messages' => (int) db_get('SELECT COUNT(*) c FROM `messages`')['c'],
            'files' => (int) db_get('SELECT COUNT(*) c FROM `files`')['c'],
            'blockedIps' => (int) db_get('SELECT COUNT(*) c FROM `blocked_ips`')['c'],
            'logins24h' => (int) db_get('SELECT COUNT(*) c FROM `login_events` WHERE `created_at` > ?', [now_ms() - 86400_000])['c'],
            'events24h' => (int) db_get('SELECT COUNT(*) c FROM `security_events` WHERE `created_at` > ?', [now_ms() - 86400_000])['c'],
        ];
        $personas = db_all("SELECT * FROM `personas` WHERE `owner_type` = 'global' ORDER BY `sort`,`id`");
        json_out([
            'ok' => true,
            'stats' => $stats,
            'categories' => array_map(function ($c) {
                $shared = array_map('provider_public', provider_rows('global', null, $c));
                return [
                    'key' => $c,
                    'label' => CATEGORY_META[$c]['label'],
                    'hint' => CATEGORY_META[$c]['hint'],
                    'needsModel' => CATEGORY_META[$c]['needsModel'] ?? false,
                    'modelHint' => CATEGORY_META[$c]['modelHint'] ?? '',
                    'defaults' => DEFAULT_EXTRA[$c],
                    'entries' => $shared,
                    'provider' => $shared[0] ?? null,
                    'routing' => routing_get('global', null, $c),
                ];
            }, CATEGORIES),
            'settings' => [
                'siteName' => setting('siteName', '千早爱音的AI站'),
                'allowRegistration' => setting('allowRegistration', 'true') === 'true',
                'insufficientComputeMsg' => setting('insufficientComputeMsg', '算力暂时不足，请稍后再试或联系管理员。'),
                'appVersionCode' => (int) setting('appVersionCode', '2'),
                'appVersionName' => setting('appVersionName', '1.1.0'),
                'appDownloadUrl' => setting('appDownloadUrl', PUBLIC_URL . '/downloads/anno-ai.apk'),
                'appUpdateNotes' => setting('appUpdateNotes', '爱音的第一个安卓版本，欢迎来玩～'),
                'appUpdateMandatory' => setting('appUpdateMandatory', 'true') !== 'false',
            ],
            'mail' => ['configured' => smtp_configured(), 'devFallback' => MAIL_DEV_FALLBACK, 'host' => SMTP_HOST, 'port' => SMTP_PORT, 'user' => SMTP_USER, 'from' => SMTP_FROM],
            'personas' => array_map('public_persona', $personas),
            'traffic' => [],
            'appVersion' => app_version_admin_info(),
            'events' => db_all('SELECT * FROM `security_events` ORDER BY `id` DESC LIMIT 10'),
        ]);
    }

    if ($m === 'GET' && $p === '/api/admin/users') {
        require_admin();
        $rows = db_all('SELECT * FROM `users` ORDER BY `id`');
        json_out(['ok' => true, 'users' => array_map(fn($r) => public_user($r) + [
            'conversationCount' => (int) db_get('SELECT COUNT(*) c FROM `conversations` WHERE `user_id` = ?', [(int) $r['id']])['c'],
            'providerCount' => (int) db_get('SELECT COUNT(*) c FROM `providers` WHERE `owner_type`=\'user\' AND `owner_id`=?', [(int) $r['id']])['c'],
            'providerPreference' => $r['provider_preference'],
            'sessionCount' => (int) db_get('SELECT COUNT(*) c FROM `sessions` WHERE `user_id`=?', [(int) $r['id']])['c'],
        ], $rows)]);
    }

    if ($m === 'POST' && $p === '/api/admin/users') {
        require_admin();
        $b = body_json();
        $email = strtolower(trim((string) ($b['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('BAD_REQUEST', '邮箱格式不正确', 400);
        if (db_get('SELECT `id` FROM `users` WHERE `email` = ?', [$email])) fail('CONFLICT', '该邮箱已存在', 409);
        $role = ($b['role'] ?? '') === 'admin' ? 'admin' : 'user';
        db_run('INSERT INTO `users`(`email`,`role`,`status`,`created_at`,`last_ip`) VALUES(?,?,?,?,?)', [$email, $role, 'active', now_ms(), client_ip()]);
        $row = db_get('SELECT * FROM `users` WHERE `id` = ?', [db_last_id()]);
        json_out(['ok' => true, 'user' => public_user($row)]);
    }

    if ($m === 'PATCH' && preg_match('#^/api/admin/users/(\d+)$#', $p, $mm)) {
        $admin = require_admin();
        $id = (int) $mm[1];
        $target = db_get('SELECT * FROM `users` WHERE `id` = ?', [$id]);
        if (!$target) fail('NOT_FOUND', '用户不存在', 404);
        $b = body_json();
        if (isset($b['email'])) {
            $email = strtolower(trim((string) $b['email']));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('BAD_REQUEST', '邮箱格式不正确', 400);
            if (db_get('SELECT `id` FROM `users` WHERE `email` = ? AND `id` <> ?', [$email, $id])) fail('CONFLICT', '该邮箱已被其他账号使用', 409);
            db_run('UPDATE `users` SET `email` = ? WHERE `id` = ?', [$email, $id]);
        }
        if (isset($b['role'])) {
            if (!in_array($b['role'], ['user', 'admin'], true)) fail('BAD_REQUEST', '无效的角色', 400);
            if ($id === (int) $admin['id'] && $b['role'] !== 'admin') fail('BAD_REQUEST', '不能取消自己的管理员身份', 400);
            if ($target['role'] === 'admin' && $b['role'] === 'user') {
                if ((int) db_get("SELECT COUNT(*) c FROM `users` WHERE `role` = 'admin'")['c'] <= 1) fail('BAD_REQUEST', '系统必须保留至少一名超级管理员', 400);
            }
            db_run('UPDATE `users` SET `role` = ? WHERE `id` = ?', [$b['role'], $id]);
        }
        if (!empty($b['ban'])) {
            if ($id === (int) $admin['id']) fail('BAD_REQUEST', '不能封禁自己的账号', 400);
            $hours = (float) ($b['ban']['hours'] ?? 0);
            $permanent = !empty($b['ban']['permanent']) || $hours == 0;
            if (!$permanent && ($hours <= 0 || $hours > 24 * 365 * 5)) fail('BAD_REQUEST', '封禁时长不合法', 400);
            $until = $permanent ? 0 : now_ms() + (int) round($hours * 3600_000);
            db_run("UPDATE `users` SET `status` = 'disabled', `banned_until` = ?, `ban_reason` = ? WHERE `id` = ?", [$until, mb_substr((string) ($b['ban']['reason'] ?? ''), 0, 200), $id]);
            db_run('DELETE FROM `sessions` WHERE `user_id` = ?', [$id]);
            log_event('user_banned', $target['email'] . ' ' . ($permanent ? 'permanent' : $hours . 'h'), null, (int) $admin['id']);
        }
        if (!empty($b['unban'])) {
            db_run("UPDATE `users` SET `status` = 'active', `banned_until` = NULL, `ban_reason` = NULL WHERE `id` = ?", [$id]);
            log_event('user_unbanned', $target['email'], null, (int) $admin['id']);
        }
        if (isset($b['status']) && empty($b['ban']) && empty($b['unban'])) {
            if (!in_array($b['status'], ['active', 'disabled'], true)) fail('BAD_REQUEST', '无效的状态', 400);
            if ($id === (int) $admin['id'] && $b['status'] === 'disabled') fail('BAD_REQUEST', '不能停用自己的账号', 400);
            db_run('UPDATE `users` SET `status` = ? WHERE `id` = ?', [$b['status'], $id]);
            if ($b['status'] === 'disabled') db_run('DELETE FROM `sessions` WHERE `user_id` = ?', [$id]);
        }
        json_out(['ok' => true, 'user' => public_user(db_get('SELECT * FROM `users` WHERE `id` = ?', [$id]))]);
    }

    if ($m === 'DELETE' && preg_match('#^/api/admin/users/(\d+)$#', $p, $mm)) {
        $admin = require_admin();
        $id = (int) $mm[1];
        if ($id === (int) $admin['id']) fail('BAD_REQUEST', '不能删除自己的账号', 400);
        $files = db_all('SELECT `path` FROM `files` WHERE `user_id` = ?', [$id]);
        db_run('DELETE FROM `messages` WHERE `conversation_id` IN (SELECT `id` FROM `conversations` WHERE `user_id` = ?)', [$id]);
        db_run('DELETE FROM `files` WHERE `user_id` = ?', [$id]);
        db_run('DELETE FROM `usage_user_counters` WHERE `user_id` = ?', [$id]);
        db_run('DELETE FROM `sessions` WHERE `user_id` = ?', [$id]);
        db_run('DELETE FROM `email_codes` WHERE `email` = (SELECT `email` FROM `users` WHERE `id` = ?)', [$id]);
        db_run('DELETE FROM `conversations` WHERE `user_id` = ?', [$id]);
        db_run('DELETE FROM `providers` WHERE `owner_type` = \'user\' AND `owner_id` = ?', [$id]);
        db_run('DELETE FROM `personas` WHERE `owner_type` = \'user\' AND `owner_id` = ?', [$id]);
        db_run('DELETE FROM `users` WHERE `id` = ?', [$id]);
        foreach ($files as $f) {
            if (!empty($f['path']) && is_file($f['path'])) @unlink($f['path']);
        }
        log_event('user_deleted', 'uid=' . $id, null, (int) $admin['id']);
        json_out(['ok' => true]);
    }

    if ($m === 'GET' && preg_match('#^/api/admin/users/(\d+)/conversations$#', $p, $mm)) {
        require_admin();
        $id = (int) $mm[1];
        $user = db_get('SELECT `id`,`email`,`role`,`status` FROM `users` WHERE `id` = ?', [$id]);
        if (!$user) fail('NOT_FOUND', '用户不存在', 404);
        $rows = db_all(
            'SELECT c.`id`,c.`title`,c.`persona_name`,c.`created_at`,c.`updated_at`,
                (SELECT COUNT(*) FROM `messages` m WHERE m.`conversation_id` = c.`id`) AS msg_count
             FROM `conversations` c WHERE c.`user_id` = ? ORDER BY c.`updated_at` DESC LIMIT 300',
            [$id]
        );
        json_out(['ok' => true, 'user' => $user, 'conversations' => array_map(fn($r) => [
            'id' => (int) $r['id'],
            'title' => $r['title'],
            'personaName' => $r['persona_name'],
            'messageCount' => (int) $r['msg_count'],
            'createdAt' => (int) $r['created_at'],
            'updatedAt' => (int) $r['updated_at'],
        ], $rows)]);
    }

    if ($m === 'GET' && preg_match('#^/api/admin/users/(\d+)/conversations/(\d+)$#', $p, $mm)) {
        require_admin();
        $id = (int) $mm[1];
        $cid = (int) $mm[2];
        $user = db_get('SELECT `id`,`email` FROM `users` WHERE `id` = ?', [$id]);
        if (!$user) fail('NOT_FOUND', '用户不存在', 404);
        $conv = db_get('SELECT * FROM `conversations` WHERE `id` = ? AND `user_id` = ?', [$cid, $id]);
        if (!$conv) fail('NOT_FOUND', '对话不存在', 404);
        $msgs = array_reverse(db_all('SELECT * FROM `messages` WHERE `conversation_id` = ? ORDER BY `id` DESC LIMIT 500', [$cid]));
        json_out([
            'ok' => true,
            'user' => $user,
            'conversation' => [
                'id' => (int) $conv['id'],
                'title' => $conv['title'],
                'personaName' => $conv['persona_name'],
                'createdAt' => (int) $conv['created_at'],
                'updatedAt' => (int) $conv['updated_at'],
                'truncated' => count($msgs) >= 500,
                'messages' => array_map(fn($m) => [
                    'id' => (int) $m['id'],
                    'role' => $m['role'],
                    'content' => $m['content'],
                    'reasoning' => $m['reasoning'] ?? '',
                    'meta' => json_decode($m['meta_json'] ?: '{}', true) ?: new stdClass(),
                    'createdAt' => (int) $m['created_at'],
                ], $msgs),
            ],
        ]);
    }

    if ($m === 'DELETE' && preg_match('#^/api/admin/users/(\d+)/sessions$#', $p, $mm)) {
        require_admin();
        db_run('DELETE FROM `sessions` WHERE `user_id` = ?', [(int) $mm[1]]);
        json_out(['ok' => true]);
    }

    if ($m === 'GET' && preg_match('#^/api/admin/users/(\d+)/detail$#', $p, $mm)) {
        require_admin();
        $id = (int) $mm[1];
        $user = db_get('SELECT * FROM `users` WHERE `id` = ?', [$id]);
        if (!$user) fail('NOT_FOUND', '用户不存在', 404);
        // 字段命名与 Node 版保持一致：弹窗直接读 deviceId / lastSeenAt / expiresAt
        $sessions = array_map(fn($s) => [
            'deviceId' => $s['device_id'] ? substr((string) $s['device_id'], 0, 8) : '',
            'ip' => $s['ip'],
            'ua' => $s['ua'],
            'createdAt' => (int) $s['created_at'],
            'expiresAt' => (int) $s['expires_at'],
            'lastSeenAt' => $s['last_seen_at'] !== null ? (int) $s['last_seen_at'] : null,
        ], db_all('SELECT `ip`,`device_id`,`user_agent` AS `ua`,`kind`,`created_at`,`expires_at`,`last_seen_at` FROM `sessions` WHERE `user_id` = ? ORDER BY `created_at` DESC', [$id]));
        $logins = db_all('SELECT `ip`,`device_id`,`ua`,`kind`,`ok`,`reason`,`created_at` FROM `login_events` WHERE `user_id` = ? ORDER BY `id` DESC LIMIT 40', [$id]);
        json_out(['ok' => true, 'user' => public_user($user), 'sessions' => $sessions, 'logins' => $logins]);
    }

    if ($m === 'PUT' && $p === '/api/admin/settings') {
        require_admin();
        $b = body_json();
        if (isset($b['siteName'])) set_setting('siteName', mb_substr(trim((string) $b['siteName']), 0, 40) ?: '千早爱音的AI站');
        if (isset($b['allowRegistration'])) set_setting('allowRegistration', !empty($b['allowRegistration']) ? 'true' : 'false');
        if (isset($b['insufficientComputeMsg'])) set_setting('insufficientComputeMsg', mb_substr(trim((string) $b['insufficientComputeMsg']), 0, 200));
        if (isset($b['appVersionCode'])) {
            $code = (int) $b['appVersionCode'];
            if ($code < 1 || $code > 1000000) fail('BAD_REQUEST', '版本号需为正整数', 400);
            set_setting('appVersionCode', (string) $code);
            set_setting('appPublishedAt', (string) now_ms());
        }
        if (isset($b['appVersionName'])) {
            $v = mb_substr(trim((string) $b['appVersionName']), 0, 30);
            if ($v === '') fail('BAD_REQUEST', '版本名称不能为空', 400);
            set_setting('appVersionName', $v);
        }
        if (isset($b['appDownloadUrl'])) {
            $v = trim((string) $b['appDownloadUrl']);
            if (!preg_match('#^https?://#i', $v)) fail('BAD_REQUEST', '下载地址必须是 http(s) 链接', 400);
            set_setting('appDownloadUrl', mb_substr($v, 0, 500));
        }
        if (isset($b['appUpdateNotes'])) set_setting('appUpdateNotes', mb_substr(trim((string) $b['appUpdateNotes']), 0, 500));
        if (isset($b['appUpdateMandatory'])) set_setting('appUpdateMandatory', !empty($b['appUpdateMandatory']) ? 'true' : 'false');
        json_out(['ok' => true, 'settings' => [
            'siteName' => setting('siteName'),
            'allowRegistration' => setting('allowRegistration') === 'true',
            'insufficientComputeMsg' => setting('insufficientComputeMsg'),
            'appVersionCode' => (int) setting('appVersionCode', '2'),
            'appVersionName' => setting('appVersionName', '1.1.0'),
            'appDownloadUrl' => setting('appDownloadUrl'),
            'appUpdateNotes' => setting('appUpdateNotes'),
            'appUpdateMandatory' => setting('appUpdateMandatory', 'true') !== 'false',
        ]]);
    }

    if ($m === 'GET' && $p === '/api/admin/security') {
        require_admin();
        $groups = array_values(array_filter(preg_split('/[\s,，;；、]+/', setting('registerGroupNumbers', '')) ?: []));
        json_out(['ok' => true, 'settings' => [
            'registerGroupNumbers' => $groups,
            'rateLimit' => (int) setting('securityRateLimit', '600'),
            'autoBlock' => setting('securityAutoBlock', 'true') === 'true',
            'autoBlockMinutes' => (int) setting('securityAutoBlockMinutes', '30'),
            'banNotice' => setting('banNotice', ''),
            'userProvidersOpen' => setting('userProvidersOpen', 'false') === 'true',
        ], 'stats' => [
            'banned' => (int) db_get('SELECT COUNT(*) c FROM `users` WHERE `banned_until` IS NOT NULL')['c'],
            'blockedIps' => (int) db_get('SELECT COUNT(*) c FROM `blocked_ips`')['c'],
            'logins24h' => (int) db_get('SELECT COUNT(*) c FROM `login_events` WHERE `created_at` > ?', [now_ms() - 86400_000])['c'],
            'failed24h' => (int) db_get('SELECT COUNT(*) c FROM `login_events` WHERE `ok` = 0 AND `created_at` > ?', [now_ms() - 86400_000])['c'],
            'registrations24h' => (int) db_get("SELECT COUNT(*) c FROM `security_events` WHERE `kind` = 'user_registered' AND `created_at` > ?", [now_ms() - 86400_000])['c'],
            'activeSessions' => (int) db_get('SELECT COUNT(*) c FROM `sessions` WHERE `expires_at` > ?', [now_ms()])['c'],
            'events24h' => (int) db_get('SELECT COUNT(*) c FROM `security_events` WHERE `created_at` > ?', [now_ms() - 86400_000])['c'],
        ],
            'bannedUsers' => array_map(fn($u) => [
                'id' => (int) $u['id'], 'email' => $u['email'], 'reason' => $u['ban_reason'] ?? '',
                'until' => (int) $u['banned_until'], 'lastIp' => $u['last_ip'], 'lastLoginAt' => $u['last_login_at'],
            ], db_all('SELECT * FROM `users` WHERE `banned_until` IS NOT NULL ORDER BY `banned_until`')),
            'blocks' => array_map(fn($b) => [
                'ip' => $b['ip'], 'reason' => $b['reason'], 'until' => (int) $b['until'], 'createdAt' => (int) $b['created_at'], 'permanent' => false,
            ], db_all('SELECT * FROM `blocked_ips` ORDER BY `created_at` DESC')),
            'logins' => array_map(fn($l) => [
                'id' => (int) $l['id'], 'email' => $l['email'] ?: ($l['user_email'] ?? ''), 'ip' => $l['ip'],
                'device' => $l['device_id'] ? substr($l['device_id'], 0, 8) : '', 'ua' => $l['ua'], 'kind' => $l['kind'],
                'ok' => (bool) $l['ok'], 'reason' => $l['reason'], 'createdAt' => (int) $l['created_at'],
            ], db_all('SELECT l.*,u.`email` AS user_email FROM `login_events` l LEFT JOIN `users` u ON u.`id` = l.`user_id` ORDER BY l.`id` DESC LIMIT 50')),
            'traffic' => [],
            'events' => array_map(fn($e) => [
                'id' => (int) $e['id'], 'kind' => $e['kind'], 'ip' => $e['ip'], 'userId' => $e['user_id'],
                'detail' => $e['detail'], 'createdAt' => (int) $e['created_at'],
            ], db_all('SELECT * FROM `security_events` ORDER BY `id` DESC LIMIT 60')),
        ]);
    }

    if ($m === 'POST' && $p === '/api/admin/security/block') {
        $admin = require_admin();
        $b = body_json();
        $ip = trim((string) ($b['ip'] ?? ''));
        if (!filter_var($ip, FILTER_VALIDATE_IP)) fail('BAD_REQUEST', 'IP 格式不正确', 400);
        $minutes = max(1, min(60 * 24 * 365, (int) ($b['minutes'] ?? 60)));
        $until = now_ms() + $minutes * 60_000;
        db_upsert('blocked_ips', ['ip' => $ip, 'reason' => mb_substr((string) ($b['reason'] ?? ''), 0, 200), 'until' => $until, 'created_at' => now_ms()], ['ip']);
        log_event('ip_block_manual', $ip . ' ' . $minutes . 'min', $ip, (int) $admin['id']);
        json_out(['ok' => true, 'ip' => $ip, 'until' => $until]);
    }

    if ($m === 'DELETE' && preg_match('#^/api/admin/security/block/(.+)$#', $p, $mm)) {
        $admin = require_admin();
        $ip = rawurldecode($mm[1]);
        db_run('DELETE FROM `blocked_ips` WHERE `ip` = ?', [$ip]);
        log_event('ip_unblock', $ip, $ip, (int) $admin['id']);
        json_out(['ok' => true]);
    }

    if ($m === 'GET' && $p === '/api/admin/security/logins') {
        require_admin();
        $limit = min(500, max(1, (int) ($_GET['limit'] ?? 100)));
        $email = strtolower(trim((string) ($_GET['email'] ?? '')));
        $sql = 'SELECT l.*,u.`email` AS user_email FROM `login_events` l LEFT JOIN `users` u ON u.`id` = l.`user_id`';
        $params = [];
        if ($email !== '') {
            $sql .= ' WHERE l.`email` = ? OR u.`email` = ?';
            $params = [$email, $email];
        }
        $sql .= ' ORDER BY l.`id` DESC LIMIT ' . $limit;
        json_out(['ok' => true, 'logins' => db_all($sql, $params)]);
    }

    if ($m === 'POST' && $p === '/api/admin/security/purge') {
        $admin = require_admin();
        $cut = now_ms() - 7 * 86400_000;
        db_run('DELETE FROM `login_events` WHERE `created_at` < ?', [$cut]);
        db_run('DELETE FROM `security_events` WHERE `created_at` < ?', [$cut]);
        log_event('security_purge', '清理 7 天前日志', null, (int) $admin['id']);
        json_out(['ok' => true]);
    }

    if ($m === 'PUT' && $p === '/api/admin/security/settings') {
        require_admin();
        $b = body_json();
        if (isset($b['registerGroupNumbers'])) {
            $raw = $b['registerGroupNumbers'];
            $list = is_array($raw)
                ? $raw
                : (preg_split('/[\s,，;；、]+/', (string) $raw) ?: []);
            $list = array_values(array_filter(array_map(fn($x) => mb_substr(trim((string) $x), 0, 40), $list), fn($x) => $x !== ''));
            set_setting('registerGroupNumbers', implode("\n", array_slice($list, 0, 50)));
        }
        if (isset($b['rateLimit'])) set_setting('securityRateLimit', (string) max(30, min(20000, (int) $b['rateLimit'])));
        if (isset($b['autoBlock'])) set_setting('securityAutoBlock', !empty($b['autoBlock']) ? 'true' : 'false');
        if (isset($b['autoBlockMinutes'])) set_setting('securityAutoBlockMinutes', (string) max(1, min(1440, (int) $b['autoBlockMinutes'])));
        if (isset($b['banNotice'])) set_setting('banNotice', mb_substr(trim((string) $b['banNotice']), 0, 300));
        if (isset($b['userProvidersOpen'])) set_setting('userProvidersOpen', !empty($b['userProvidersOpen']) ? 'true' : 'false');
        log_event('security_settings_updated');
        json_out(['ok' => true]);
    }

    if ($m === 'GET' && $p === '/api/admin/models') {
        $admin = require_admin();
        json_out(['ok' => true] + collect_models($admin));
    }

    if ($m === 'PUT' && $p === '/api/admin/models/order') {
        $admin = require_admin();
        $b = body_json();

        $providers = [];
        foreach ((array) ($b['providers'] ?? []) as $pid) {
            $pid = (int) $pid;
            if ($pid > 0 && !in_array($pid, $providers, true)) $providers[] = $pid;
        }
        $models = [];
        foreach ((array) ($b['models'] ?? []) as $pid => $names) {
            $pid = (int) $pid;
            if ($pid <= 0) continue;
            $list = [];
            foreach ((array) $names as $name) {
                $name = trim((string) $name);
                if ($name !== '' && !in_array($name, $list, true)) $list[] = $name;
            }
            if ($list) $models[(string) $pid] = $list;
        }

        // 兼容旧接口：只传扁平 order 时按单一列表保存
        if (!$providers && !$models && isset($b['order'])) {
            $order = [];
            foreach ((array) $b['order'] as $name) {
                $name = trim((string) $name);
                if ($name !== '' && !in_array($name, $order, true)) $order[] = $name;
            }
            set_setting('modelOrder', json_encode($order, JSON_UNESCAPED_UNICODE));
        } else {
            set_setting('modelGroups', json_encode(['providers' => $providers, 'models' => $models], JSON_UNESCAPED_UNICODE));
        }

        json_out(['ok' => true] + collect_models($admin));
    }

    if ($m === 'GET' && $p === '/api/admin/usage') {
        require_admin();
        json_out(['ok' => true] + usage_summary());
    }

    if ($m === 'POST' && $p === '/api/admin/usage/reset') {
        require_admin();
        $scope = (string) (body_json()['scope'] ?? '');
        if ($scope === '') fail('BAD_REQUEST', '缺少配额组', 400);
        reset_usage($scope);
        json_out(['ok' => true]);
    }

    if ($m === 'POST' && $p === '/api/admin/usage/disable') {
        require_admin();
        $scope = (string) (body_json()['scope'] ?? '');
        if ($scope === '') fail('BAD_REQUEST', '缺少配额组', 400);
        $n = disable_scope($scope);
        log_event('quota_disable', $scope);
        json_out(['ok' => true, 'disabled' => $n]);
    }

    if ($m === 'GET' && $p === '/api/admin/announcements') {
        require_admin();
        json_out(['ok' => true, 'items' => announcement_list()]);
    }

    if ($m === 'POST' && $p === '/api/admin/announcements/image') {
        $admin = require_admin();
        $raw = raw_body();
        $name = rawurldecode($_SERVER['HTTP_X_FILE_NAME'] ?? 'announcement.png');
        $img = announcement_save_image($raw, $name, (int) $admin['id']);
        json_out(['ok' => true, 'image' => [
            'id' => (int) $img['id'],
            'name' => $img['name'],
            'size' => (int) $img['size'],
            'mime' => $img['mime'],
            'url' => api_url('/api/admin/announcements/image/' . (int) $img['id']),
        ]]);
    }

    if ($m === 'GET' && preg_match('#^/api/admin/announcements/image/(\d+)$#', $p, $mm)) {
        require_admin();
        $img = announcement_image_by_id((int) $mm[1]);
        if (!$img || !is_file($img['path'])) fail('NOT_FOUND', '图片不存在', 404);
        header('Content-Type: ' . ($img['mime'] ?: 'image/png'));
        header('Cache-Control: private, max-age=600');
        readfile($img['path']);
        exit;
    }

    if ($m === 'POST' && $p === '/api/admin/announcements') {
        $admin = require_admin();
        $row = announcement_create(body_json(), (int) $admin['id']);
        $item = null;
        foreach (announcement_list() as $it) if ((int) $it['id'] === (int) $row['id']) $item = $it;
        json_out(['ok' => true, 'item' => $item]);
    }

    if ($m === 'PUT' && preg_match('#^/api/admin/announcements/(\d+)$#', $p, $mm)) {
        require_admin();
        announcement_update((int) $mm[1], body_json());
        $items = announcement_list();
        $id = (int) $mm[1];
        $item = null;
        foreach ($items as $it) if ((int) $it['id'] === $id) $item = $it;
        json_out(['ok' => true, 'item' => $item]);
    }

    if ($m === 'DELETE' && preg_match('#^/api/admin/announcements/(\d+)$#', $p, $mm)) {
        require_admin();
        announcement_delete((int) $mm[1]);
        json_out(['ok' => true]);
    }

    if ($m === 'GET' && $p === '/api/admin/broadcast') {
        require_admin();
        $count = (int) db_get("SELECT COUNT(DISTINCT `email`) c FROM `users`")['c'];
        $jobs = db_all('SELECT `id`,`subject`,`total`,`sent`,`failed`,`status`,`created_at`,`finished_at` FROM `broadcast_jobs` ORDER BY `id` DESC LIMIT 20');
        json_out(['ok' => true, 'recipientCount' => $count, 'jobs' => $jobs]);
    }

    if ($m === 'POST' && $p === '/api/admin/broadcast/image') {
        $admin = require_admin();
        $raw = raw_body();
        $name = rawurldecode($_SERVER['HTTP_X_FILE_NAME'] ?? 'notice.png');
        $img = broadcast_save_image($raw, $name, (int) $admin['id']);
        json_out(['ok' => true, 'image' => [
            'id' => (int) $img['id'],
            'name' => $img['name'],
            'size' => (int) $img['size'],
            'mime' => $img['mime'],
            'url' => '/api/index.php?p=' . rawurlencode('/api/admin/broadcast/image/' . $img['id']),
        ]]);
    }

    if ($m === 'GET' && preg_match('#^/api/admin/broadcast/image/(\d+)$#', $p, $mm)) {
        require_admin();
        $img = broadcast_image_by_id((int) $mm[1]);
        if (!$img || !is_file($img['path'])) fail('NOT_FOUND', '图片不存在', 404);
        header('Content-Type: ' . ($img['mime'] ?: 'image/png'));
        header('Cache-Control: private, max-age=600');
        readfile($img['path']);
        exit;
    }

    if ($m === 'POST' && $p === '/api/admin/broadcast/preview') {
        $admin = require_admin();
        $b = body_json();
        try {
            broadcast_preview($admin['email'], (string) ($b['subject'] ?? ''), (string) ($b['content'] ?? ''), isset($b['imageId']) ? (int) $b['imageId'] : null);
        } catch (ApiError $e) {
            throw $e;
        } catch (Throwable $e) {
            fail('PROVIDER_FAILED', '预览发送失败：' . $e->getMessage(), 502);
        }
        json_out(['ok' => true, 'to' => $admin['email']]);
    }

    if ($m === 'POST' && $p === '/api/admin/broadcast') {
        $admin = require_admin();
        $b = body_json();
        $job = broadcast_create((string) ($b['subject'] ?? ''), (string) ($b['content'] ?? ''), isset($b['imageId']) ? (int) $b['imageId'] : null, (int) $admin['id']);
        json_out(['ok' => true, 'job' => $job]);
    }

    if ($m === 'GET' && preg_match('#^/api/admin/broadcast/(\d+)$#', $p, $mm)) {
        require_admin();
        json_out(['ok' => true, 'job' => broadcast_get((int) $mm[1])]);
    }

    if ($m === 'POST' && preg_match('#^/api/admin/broadcast/(\d+)/run$#', $p, $mm)) {
        require_admin();
        json_out(['ok' => true, 'job' => broadcast_run((int) $mm[1])]);
    }

    if ($m === 'POST' && preg_match('#^/api/admin/broadcast/(\d+)/cancel$#', $p, $mm)) {
        require_admin();
        broadcast_cancel((int) $mm[1]);
        json_out(['ok' => true]);
    }

    if ($m === 'POST' && $p === '/api/admin/mail/verify') {
        require_admin();
        json_out(['ok' => true, 'result' => smtp_verify()]);
    }

    if ($m === 'POST' && $p === '/api/admin/mail/test') {
        require_admin();
        $to = trim((string) (body_json()['to'] ?? ''));
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) fail('BAD_REQUEST', '收件邮箱格式不正确', 400);
        try {
            smtp_send($to, '【' . setting('siteName', '千早爱音的AI站') . '】测试邮件 · 通道正常', mail_shell(setting('siteName'), '邮件通道正常', mail_opener() . ' 这封测试邮件能顺利到你手上，说明配置可用。', '<p style="font-size:14px;color:#5c4a52">PHP 版 SMTP 通路正常。</p>'));
        } catch (Throwable $e) {
            fail('PROVIDER_FAILED', '测试邮件发送失败：' . $e->getMessage(), 502);
        }
        json_out(['ok' => true]);
    }

    if ($m === 'POST' && $p === '/api/admin/personas') {
        require_admin();
        $b = body_json();
        $name = trim((string) ($b['name'] ?? ''));
        $prompt = trim((string) ($b['prompt'] ?? ''));
        if ($name === '' || $prompt === '') fail('BAD_REQUEST', '角色名和提示词不能为空', 400);
        db_run(
            'INSERT INTO `personas`(`owner_type`,`owner_id`,`name`,`description`,`prompt`,`enabled`,`sort`,`created_at`,`updated_at`) VALUES(\'global\',NULL,?,?,?,1,0,?,?)',
            [mb_substr($name, 0, 60), (string) ($b['description'] ?? ''), $prompt, now_ms(), now_ms()]
        );
        json_out(['ok' => true, 'persona' => public_persona(db_get('SELECT * FROM `personas` WHERE `id` = ?', [db_last_id()]))]);
    }

    if ($m === 'PUT' && preg_match('#^/api/admin/personas/(\d+)$#', $p, $mm)) {
        require_admin();
        $row = db_get("SELECT * FROM `personas` WHERE `id` = ? AND `owner_type` = 'global'", [(int) $mm[1]]);
        if (!$row) fail('NOT_FOUND', '角色不存在', 404);
        $b = body_json();
        db_run(
            'UPDATE `personas` SET `name` = ?, `description` = ?, `prompt` = ?, `enabled` = ?, `updated_at` = ? WHERE `id` = ?',
            [mb_substr(trim((string) ($b['name'] ?? $row['name'])), 0, 60), (string) ($b['description'] ?? $row['description']), (string) ($b['prompt'] ?? $row['prompt']), array_key_exists('enabled', $b) ? (!empty($b['enabled']) ? 1 : 0) : (int) $row['enabled'], now_ms(), (int) $row['id']]
        );
        json_out(['ok' => true, 'persona' => public_persona(db_get('SELECT * FROM `personas` WHERE `id` = ?', [(int) $row['id']]))]);
    }

    if ($m === 'DELETE' && preg_match('#^/api/admin/personas/(\d+)$#', $p, $mm)) {
        require_admin();
        db_run("DELETE FROM `personas` WHERE `id` = ? AND `owner_type` = 'global'", [(int) $mm[1]]);
        json_out(['ok' => true]);
    }

    if ($m === 'GET' && preg_match('#^/api/admin/providers/parse/(\d+)/cloud$#', $p, $mm)) {
        @set_time_limit(120);
        require_admin();
        $row = provider_row((int) $mm[1]);
        if (!$row || $row['category'] !== 'parse' || $row['owner_type'] !== 'global') fail('NOT_FOUND', '接口配置不存在', 404);
        $rt = provider_runtime($row);
        if (($rt['extra']['mode'] ?? '') !== 'docmind') fail('BAD_REQUEST', '该接口不是阿里云文档智能', 400);
        $q = quota_of($rt);
        $period = period_key();
        $used = scope_used($q['scope'], $period);
        $cloud = check_docmind_billing($rt, $period);
        json_out(['ok' => true, 'period' => $period, 'scope' => $q['scope'], 'used' => $used, 'monthly' => $q['monthly'], 'unit' => $q['unit'], 'unitLabel' => unit_label($q['unit']), 'remaining' => max(0, $q['monthly'] - $used), 'cloud' => $cloud, 'consoleUrl' => 'https://docmind.console.aliyun.com/service-manager']);
    }

    if ($m === 'POST' && preg_match('#^/api/admin/providers/parse/(\d+)/calibrate$#', $p, $mm)) {
        require_admin();
        $row = provider_row((int) $mm[1]);
        if (!$row || $row['category'] !== 'parse' || $row['owner_type'] !== 'global') fail('NOT_FOUND', '接口配置不存在', 404);
        $rt = provider_runtime($row);
        if (($rt['extra']['mode'] ?? '') !== 'docmind') fail('BAD_REQUEST', '该接口不是阿里云文档智能', 400);
        $units = (float) (body_json()['units'] ?? -1);
        if ($units < 0 || $units > 1e9) fail('BAD_REQUEST', '已用页数不正确', 400);
        $q = quota_of($rt);
        calibrate_usage($q['scope'], $units);
        json_out(['ok' => true, 'scope' => $q['scope'], 'period' => period_key(), 'units' => $units, 'monthly' => $q['monthly'], 'unitLabel' => unit_label($q['unit']), 'remaining' => max(0, $q['monthly'] - $units)]);
    }

    /* ── 能力配置（admin + me）───────────────────────── */
    if (preg_match('#^/api/(admin|me)/providers(?:/([a-z]+))?(?:/(\d+))?(?:/(keys|test|models|routing))?(?:/(\d+))?$#', $p, $mm)) {
        $scope = $mm[1];
        $ownerType = $scope === 'admin' ? 'global' : 'user';
        $guard = $scope === 'admin' ? 'require_admin' : 'require_user';
        $user = $guard();
        $cat = $mm[2] ?? '';
        $id = isset($mm[3]) && $mm[3] !== '' ? (int) $mm[3] : null;
        $action = $mm[4] ?? '';
        handle_provider_route($m, $scope, $ownerType, $user, $cat, $id, $action, $mm[5] ?? null);
    }

    fail('NOT_FOUND', '接口不存在', 404);
}


function export_conversation(array $c): array
{
    $msgs = db_all('SELECT `role`,`content`,`reasoning`,`meta_json`,`created_at` FROM `messages` WHERE `conversation_id` = ? ORDER BY `id`', [(int) $c['id']]);
    return [
        'title' => $c['title'],
        'personaName' => $c['persona_name'],
        'personaPrompt' => $c['persona_prompt'],
        'createdAt' => (int) $c['created_at'],
        'updatedAt' => (int) $c['updated_at'],
        'messages' => array_map(fn($m) => [
            'role' => $m['role'],
            'content' => $m['content'],
            'reasoning' => $m['reasoning'] ?? '',
            'meta' => json_decode($m['meta_json'] ?: '{}', true) ?: new stdClass(),
            'createdAt' => (int) $m['created_at'],
        ], $msgs),
    ];
}
