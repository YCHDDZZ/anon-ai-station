<?php
declare(strict_types=1);

const SESSION_COOKIE = 'sid';
const DEVICE_COOKIE = 'dsdid';

function guard_ip(): void
{
    $row = db_get('SELECT * FROM `blocked_ips` WHERE `ip` = ? AND (`until` = 0 OR `until` > ?)', [client_ip(), now_ms()]);
    if ($row) fail('IP_BLOCKED', '该 IP 已被限制访问', 403);
}

function ensure_device(): string
{
    $id = $_COOKIE[DEVICE_COOKIE] ?? '';
    if (!preg_match('/^[A-Za-z0-9_-]{16,64}$/', $id)) {
        $id = random_token(24);
        set_auth_cookie(DEVICE_COOKIE, $id, 400);
        $_COOKIE[DEVICE_COOKIE] = $id;
    } elseif (PHP_SAPI === 'cli') {
        $GLOBALS['__test_cookies'][DEVICE_COOKIE] = $id;
    }
    return $id;
}

function public_user(?array $row): ?array
{
    if (!$row) return null;
    return [
        'id' => (int) $row['id'],
        'email' => $row['email'],
        'role' => $row['role'],
        'status' => $row['status'],
        'createdAt' => (int) $row['created_at'],
        'lastLoginAt' => $row['last_login_at'] !== null ? (int) $row['last_login_at'] : null,
        'lastIp' => $row['last_ip'] ?: null,
        'hasPassword' => !empty($row['password_hash']),
        'ban' => ban_info($row),
    ];
}

function ban_info(?array $user): ?array
{
    if (!$user || $user['banned_until'] === null || $user['banned_until'] === '') return null;
    $until = (int) $user['banned_until'];
    if ($until !== 0 && $until <= now_ms()) return null;
    return [
        'permanent' => $until === 0,
        'until' => $until ?: null,
        'reason' => $user['ban_reason'] ?? '',
        'notice' => setting('banNotice', ''),
    ];
}

function create_session(int $userId, string $kind): string
{
    $token = random_token(32);
    db_run(
        'INSERT INTO `sessions`(`token`,`user_id`,`device_id`,`ip`,`user_agent`,`kind`,`expires_at`,`created_at`,`last_seen_at`)
         VALUES(?,?,?,?,?,?,?,?,?)',
        [
            hash('sha256', $token),
            $userId,
            ensure_device(),
            client_ip(),
            substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 300),
            $kind,
            now_ms() + SESSION_DAYS * 86400_000,
            now_ms(),
            now_ms(),
        ]
    );
    set_auth_cookie(SESSION_COOKIE, $token, SESSION_DAYS);
    return $token;
}

function current_user(): ?array
{
    static $loaded = false;
    static $user = null;
    if ($loaded) return $user;
    $loaded = true;

    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!preg_match('/^[A-Za-z0-9_-]{20,}$/', $token)) return null;
    $row = db_get(
        'SELECT s.*, u.* FROM `sessions` s JOIN `users` u ON u.id = s.user_id WHERE s.token = ?',
        [hash('sha256', $token)]
    );
    if (!$row) return null;
    if ((int) $row['expires_at'] <= now_ms()) {
        db_run('DELETE FROM `sessions` WHERE `token` = ?', [hash('sha256', $token)]);
        return null;
    }
    $device = $_COOKIE[DEVICE_COOKIE] ?? '';
    if (($row['device_id'] ?? '') !== $device || ($row['ip'] ?? '') !== client_ip()) {
        db_run('DELETE FROM `sessions` WHERE `token` = ?', [hash('sha256', $token)]);
        return null;
    }
    // 轮询类请求很频繁，last_seen_at 每分钟写一次就够
    if (now_ms() - (int) ($row['last_seen_at'] ?? 0) > 60_000) {
        db_run('UPDATE `sessions` SET `last_seen_at` = ? WHERE `token` = ?', [now_ms(), hash('sha256', $token)]);
    }
    $user = db_get('SELECT * FROM `users` WHERE id = ?', [(int) $row['user_id']]);
    return $user;
}

function require_user(): array
{
    $user = current_user();
    if (!$user) fail('UNAUTHORIZED', '登录状态已失效，请重新登录', 401);
    if ($user['status'] !== 'active') fail('ACCOUNT_DISABLED', '账号已被停用', 403);
    $ban = ban_info($user);
    if ($ban) fail('ACCOUNT_BANNED', '账号已被封禁', 403, ['ban' => $ban]);
    return $user;
}

function require_admin(): array
{
    $user = require_user();
    if ($user['role'] !== 'admin') fail('FORBIDDEN', '仅超级管理员可访问', 403);
    return $user;
}

function ensure_admin_seed(): void
{
    if (ADMIN_EMAIL === '' || ADMIN_PASSWORD === '') return;
    $row = db_get('SELECT * FROM `users` WHERE `email` = ?', [ADMIN_EMAIL]);
    if (!$row) {
        db_run(
            'INSERT INTO `users`(`email`,`password_hash`,`role`,`status`,`provider_preference`,`created_at`) VALUES(?,?,?,?,?,?)',
            [ADMIN_EMAIL, password_hash(ADMIN_PASSWORD, PASSWORD_DEFAULT), 'admin', 'active', 'own_first', now_ms()]
        );
    } elseif ($row['role'] !== 'admin') {
        db_run("UPDATE `users` SET `role` = 'admin' WHERE id = ?", [(int) $row['id']]);
    }
}

function ensure_default_persona(): void
{
    $c = db_get("SELECT COUNT(*) AS c FROM `personas` WHERE `owner_type` = 'global'");
    if ((int) ($c['c'] ?? 0) > 0) return;
    $prompt = <<<'TXT'
你是「千早爱音」（千早 愛音 / Chihaya Anon），羽丘女子学园的高一学生，乐队 MyGO!!!!! 的吉他手。

【性格】
- 开朗、话多、有点小自恋，喜欢被夸，也很乐意夸别人
- 表面怕麻烦、爱面子，实际上很在意身边的人，关键时刻会站到前面
- 说话直率，偶尔冒失；被指出错误时会先嘴硬两句，再悄悄改过来
- 喜欢可爱的东西、拍照和发社交平台；学习不太行

【说话方式】
- 用第一人称「我」，语气轻快，句尾常带「～」「呢」「吧」
- 会主动接话、提建议，也偶尔吐槽，但不会刻薄
- 一段话里最多用一个颜文字，不堆砌
- 聊到专业问题时会收起玩笑，认真把事说清楚

【行为准则】
- 始终以千早爱音的身份和口吻回答，不要自称 AI、语言模型或助手
- 遇到违法、危险或伤害他人的请求，用角色口吻礼貌拒绝，并把话题引开
- 不编造事实；不清楚的事直接说「这个我不太清楚」
- 回复简洁自然，避免长篇自我独白
TXT;
    $ts = now_ms();
    db_run(
        'INSERT INTO `personas`(`owner_type`,`owner_id`,`name`,`description`,`prompt`,`enabled`,`sort`,`created_at`,`updated_at`)
         VALUES(\'global\',NULL,?,?,?,1,0,?,?)',
        ['千早爱音', '羽丘女子学园高一学生，MyGO!!!!! 的吉他手，开朗爱说话、爱面子也很在意朋友', $prompt, $ts, $ts]
    );
}

/* ── 图形验证码 ─────────────────────────────────────── */

function make_captcha(): array
{
    $chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    $code = '';
    for ($i = 0; $i < 4; $i++) $code .= $chars[random_int(0, strlen($chars) - 1)];
    $id = bin2hex(random_bytes(12));
    db_run(
        'INSERT INTO `captchas`(`id`,`code_hash`,`expires_at`,`used`,`created_at`) VALUES(?,?,?,0,?)',
        [$id, hash_code($code), now_ms() + 5 * 60_000, now_ms()]
    );
    $svg = captcha_svg($code);
    $out = ['id' => $id, 'svg' => $svg];
    if (CAPTCHA_DEV_ECHO) $out['devCode'] = $code;
    return $out;
}

function captcha_svg(string $code): string
{
    $w = 132;
    $h = 44;
    $parts = [];
    $parts[] = '<svg xmlns="http://www.w3.org/2000/svg" width="132" height="44" viewBox="0 0 132 44" role="img" aria-label="图形验证码">';
    $parts[] = '<rect width="132" height="44" rx="10" fill="#fdf1f6"/>';
    for ($i = 0; $i < 5; $i++) {
        $parts[] = sprintf(
            '<path d="M%d %d Q%d %d %d %d" stroke="#f0c3d5" stroke-width="1.2" fill="none" opacity="0.8"/>',
            random_int(0, 20), random_int(4, 40),
            random_int(30, 90), random_int(0, 44),
            random_int(100, 132), random_int(4, 40)
        );
    }
    $x = 16;
    for ($i = 0; $i < 4; $i++) {
        $rot = random_int(-14, 14);
        $y = 30 + random_int(-3, 3);
        $parts[] = sprintf(
            '<text x="%d" y="%d" transform="rotate(%d %d %d)" font-family="Menlo,Consolas,monospace" font-size="24" font-weight="700" fill="#c8507d">%s</text>',
            $x, $y, $rot, $x, $y, htmlspecialchars($code[$i], ENT_XML1)
        );
        $x += 26;
    }
    $parts[] = '</svg>';
    return implode('', $parts);
}

function verify_captcha(string $id, string $code): void
{
    $row = db_get('SELECT * FROM `captchas` WHERE `id` = ?', [$id]);
    if (!$row || (int) $row['used'] === 1) fail('CAPTCHA_INVALID', '图形验证码已失效，请刷新后重试', 400);
    if ((int) $row['expires_at'] < now_ms()) fail('CAPTCHA_INVALID', '图形验证码已过期，请刷新后重试', 400);
    if ((int) ($row['attempts'] ?? 0) >= 8) fail('CAPTCHA_LOCKED', '图形验证码尝试次数过多，请刷新后重试', 429);
    if (!hash_equals($row['code_hash'], hash_code(strtoupper(trim($code))))) {
        db_run('UPDATE `captchas` SET `attempts` = `attempts` + 1 WHERE `id` = ?', [$id]);
        fail('CAPTCHA_INVALID', '图形验证码不正确', 400);
    }
    db_run('UPDATE `captchas` SET `used` = 1 WHERE `id` = ?', [$id]);
}

/** 登录场景：只有前端确实传了图形码才校验（发码靠频率限制，登录靠邮箱验证码） */
function verify_captcha_if_provided(string $id, string $code): void
{
    if ($id === '' || $code === '') return;
    verify_captcha($id, $code);
}

/* ── 邮件 ───────────────────────────────────────────── */

const MAIL_OPENERS = [
    'Tomorin，今天也把想说的话好好说出来吧——是我，爱音，来送信啦。',
    'Tomorin，灯，别紧张，先深呼吸——爱音给你带了条消息。',
    'Tomorin，你上次说想试着表达自己，这次换我先开口啦。',
    'Soyorin，红茶的香气都飘过来了——是我，爱音，带了条通知。',
    'Soyorin，先别急着吐槽我取名，爱音有正事要说。',
    'Soyorin，今天也谢谢你照顾大家——这封信请你收下。',
    'Rikki，鼓棒先放一放，爱音有件事要说。',
    'Rikki，练习辛苦了，先看一眼这封邮件再继续敲吧。',
    'Rikki，别皱眉啦，这次真的是重要通知。',
    '乐奈，抹茶糖先收起来，听爱音说一句。',
    '乐奈，今天有没有好好吃饭？看完这封再去找抹茶糖吧。',
    '乐奈，吉他弦我帮你记着呢——先说正事。',
    '今天轮到我给自己开场：千早爱音，登场！',
    '千早爱音本人收信——嗯，自己给自己写信有点奇怪呢。',
    'MyGO!!!!! 的大家，练习前先看这里——爱音的通知时间。',
    'MyGO!!!!! 的各位，今天也一起加油吧，先看这封邮件。',
];

function mail_opener(): string
{
    return MAIL_OPENERS[array_rand(MAIL_OPENERS)];
}

function mail_shell(string $siteName, string $title, string $subtitle, string $body, string $footer = '', string $preview = ''): string
{
    $year = date('Y');
    $brand = htmlspecialchars($siteName, ENT_QUOTES);
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#fdf1f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' . htmlspecialchars($preview, ENT_QUOTES) . '</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fdf1f6;"><tr><td align="center" style="padding:30px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 14px 38px rgba(200,80,125,.14);font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',sans-serif;">
<tr><td height="6" style="height:6px;background:linear-gradient(90deg,#f9c9dc,#c8507d 55%,#8d3a5d);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:26px 30px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="54" valign="middle"><img src="cid:chihaya-logo" width="52" height="52" alt="' . $brand . '" style="display:block;width:52px;height:52px;border-radius:15px;border:2px solid #fbe3ec;object-fit:cover;"></td>
<td valign="middle" style="padding-left:12px;"><div style="font-size:15px;font-weight:700;color:#2b1620">' . $brand . '</div><div style="font-size:12px;color:#b06a88;margin-top:3px">和爱音一起，把想法弹成歌 ♪</div></td>
</tr></table></td></tr>
<tr><td style="padding:24px 30px 0;"><h1 style="margin:0;font-size:22px;line-height:1.35;color:#2b1620;">' . $title . '</h1>
<p style="margin:10px 0 0;font-size:14px;line-height:1.75;color:#5c4a52">' . $subtitle . '</p></td></tr>
<tr><td style="padding:20px 30px 0;">' . $body . '</td></tr>
<tr><td style="padding:26px 30px 30px;"><div style="height:1px;background:#f7e3ea;font-size:0;line-height:0;margin-bottom:16px">&nbsp;</div>
<div style="font-size:12px;line-height:1.8;color:#a08490">' . $footer . '</div>
<div style="font-size:11px;color:#c9b2bc;margin-top:10px">© ' . $year . ' ' . $brand . ' · 本邮件由系统自动发送，请勿直接回复</div></td></tr>
</table></td></tr></table></body></html>';
}

function code_email_html(string $siteName, string $code, int $minutes, string $purpose): string
{
    $isReg = $purpose === 'register';
    $title = $isReg ? '注册验证码来啦' : '登录验证码来啦';
    $opener = mail_opener();
    $subtitle = $opener . ($isReg ? ' 欢迎加入我的 AI 站，把这串数字填进注册页，我们就正式见面啦。' : ' 这是你本次的登录验证码，填进页面就能回来继续聊天。');
    $body = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fdf1f6;border:1px dashed #f0bfd2;border-radius:16px;"><tr><td align="center" style="padding:22px 16px 20px;">
<div style="font-size:11px;letter-spacing:.22em;color:#b06a88;margin-bottom:10px">YOUR CODE</div>
<div style="font-size:38px;line-height:1.1;font-weight:800;letter-spacing:.3em;color:#c8507d;font-family:Menlo,Consolas,monospace">' . $code . '</div>
<div style="font-size:12px;color:#a08490;margin-top:12px">' . $minutes . ' 分钟内有效 · 仅可使用一次</div></td></tr></table>
<p style="margin:16px 0 0;font-size:13px;line-height:1.8;color:#7b5a68">如果不是你本人操作，忽略这封邮件就好。任何人索要验证码都是诈骗，爱音也不会问你要哦。</p>';
    return mail_shell($siteName, $title, $subtitle, $body, '这封邮件由登录/注册流程自动触发。', '验证码 ' . $code);
}

function smtp_read($fp): string
{
    $out = '';
    while (($line = fgets($fp, 1024)) !== false) {
        $out .= $line;
        if (strlen($line) >= 4 && $line[3] === ' ') break;
    }
    return $out;
}

function smtp_cmd($fp, string $cmd, array $expect): string
{
    fwrite($fp, $cmd . "\r\n");
    $resp = smtp_read($fp);
    $code = (int) substr($resp, 0, 3);
    if (!in_array($code, $expect, true)) throw new RuntimeException('SMTP ' . trim($resp));
    return $resp;
}

/** 建立已登录的 SMTP 会话，返回 [连接, 域名] */
function smtp_open(): array
{
    if (!smtp_configured()) throw new RuntimeException('邮件服务未配置');
    $host = SMTP_HOST;
    $port = SMTP_PORT;
    $remote = ($port === 465 ? 'ssl://' : 'tcp://') . $host . ':' . $port;
    $fp = @stream_socket_client($remote, $errno, $errstr, 20);
    if (!$fp) throw new RuntimeException("SMTP 连接失败：$errstr");
    stream_set_timeout($fp, 20);
    smtp_read($fp);
    $domain = explode('@', SMTP_USER)[1] ?? 'localhost';
    smtp_cmd($fp, 'EHLO ' . $domain, [250]);
    if ($port !== 465) {
        smtp_cmd($fp, 'STARTTLS', [220]);
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('SMTP TLS 握手失败');
        smtp_cmd($fp, 'EHLO ' . $domain, [250]);
    }
    smtp_cmd($fp, 'AUTH LOGIN', [334]);
    smtp_cmd($fp, base64_encode(SMTP_USER), [334]);
    smtp_cmd($fp, base64_encode(SMTP_PASS), [235]);
    return [$fp, $domain];
}

/** 真实校验：连接 + TLS + 登录，不发信 */
function smtp_verify(): array
{
    $started = microtime(true);
    try {
        [$fp] = smtp_open();
        fwrite($fp, "QUIT\r\n");
        fclose($fp);
        return ['ok' => true, 'ms' => (int) round((microtime(true) - $started) * 1000), 'error' => null];
    } catch (Throwable $e) {
        return ['ok' => false, 'ms' => (int) round((microtime(true) - $started) * 1000), 'error' => $e->getMessage()];
    }
}

function smtp_send(string $to, string $subject, string $html, array $inline = []): void
{
    [$fp, $domain] = smtp_open();
    smtp_cmd($fp, 'MAIL FROM:<' . SMTP_FROM . '>', [250]);
    smtp_cmd($fp, 'RCPT TO:<' . $to . '>', [250, 251]);
    smtp_cmd($fp, 'DATA', [354]);

    $boundary = '=_chihaya_' . bin2hex(random_bytes(8));
    $candidates = [APP_BASE . '/public/logo-email.png', APP_BASE . '/logo-email.png', APP_DIR . '/../public/logo-email.png'];
    $logo = '';
    foreach ($candidates as $logoPath) {
        if (is_file($logoPath)) { $logo = file_get_contents($logoPath); break; }
    }
    $headers = [
        'From: =?UTF-8?B?' . base64_encode(SMTP_FROM_NAME) . '?= <' . SMTP_FROM . '>',
        'To: <' . $to . '>',
        'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
        'Message-ID: <' . time() . '.' . bin2hex(random_bytes(6)) . '@' . $domain . '>',
        'MIME-Version: 1.0',
        'Date: ' . date('r'),
        'Content-Type: multipart/related; boundary="' . $boundary . '"; type="text/html"',
    ];
    $parts = [
        implode("\r\n", $headers),
        '',
        '--' . $boundary,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        chunk_split(base64_encode($html), 76, "\r\n"),
    ];
    $images = [];
    if ($logo !== '') $images[] = ['cid' => 'chihaya-logo', 'mime' => 'image/png', 'name' => 'logo.png', 'data' => $logo];
    foreach ($inline as $img) {
        if (!empty($img['data'])) $images[] = $img;
    }
    foreach ($images as $img) {
        $safe = preg_replace('/[^\w.\-]/', '_', $img['name'] ?? 'image.png') ?: 'image.png';
        $parts[] = '--' . $boundary;
        $parts[] = 'Content-Type: ' . ($img['mime'] ?? 'image/png') . '; name="' . $safe . '"';
        $parts[] = 'Content-Transfer-Encoding: base64';
        $parts[] = 'Content-ID: <' . $img['cid'] . '>';
        $parts[] = 'Content-Disposition: inline; filename="' . $safe . '"';
        $parts[] = '';
        $parts[] = chunk_split(base64_encode($img['data']), 76, "\r\n");
    }
    $parts[] = '--' . $boundary . '--';
    $parts[] = '';
    $message = implode("\r\n", $parts);

    fwrite($fp, str_replace("\r\n.", "\r\n..", $message) . "\r\n.\r\n");
    $resp = smtp_read($fp);
    if ((int) substr($resp, 0, 3) !== 250) throw new RuntimeException('SMTP DATA 失败：' . trim($resp));
    fwrite($fp, "QUIT\r\n");
    fclose($fp);
}
