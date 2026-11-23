<?php
declare(strict_types=1);

const BROADCAST_BATCH = 5;
const BROADCAST_IMAGE_LIMIT = 5 * 1024 * 1024;

function broadcast_recipients(): array
{
    $rows = db_all("SELECT DISTINCT LOWER(`email`) AS email FROM `users` WHERE `status` IN ('active','disabled') AND `email` IS NOT NULL AND `email` <> '' ORDER BY `email`");
    return array_values(array_filter(array_column($rows, 'email')));
}

function broadcast_image_kind(string $data): ?array
{
    if (strlen($data) < 12) return null;
    if (substr($data, 0, 4) === "\x89PNG") return ['ext' => 'png', 'mime' => 'image/png'];
    if (substr($data, 0, 3) === "\xff\xd8\xff") return ['ext' => 'jpg', 'mime' => 'image/jpeg'];
    if (substr($data, 0, 4) === 'GIF8') return ['ext' => 'gif', 'mime' => 'image/gif'];
    if (substr($data, 0, 4) === 'RIFF' && substr($data, 8, 4) === 'WEBP') return ['ext' => 'webp', 'mime' => 'image/webp'];
    return null;
}

function broadcast_save_image(string $data, string $name, int $adminId): array
{
    if ($data === '') fail('BAD_REQUEST', '图片为空', 400);
    if (strlen($data) > BROADCAST_IMAGE_LIMIT) fail('BAD_REQUEST', '图片不能超过 5MB', 400);
    $kind = broadcast_image_kind($data);
    if (!$kind) fail('BAD_REQUEST', '只支持 PNG / JPG / GIF / WEBP 图片', 400);
    $dir = DATA_DIR . '/broadcast';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $stored = date('Ymd') . '-' . bin2hex(random_bytes(6)) . '.' . $kind['ext'];
    $path = $dir . '/' . $stored;
    file_put_contents($path, $data);
    db_run(
        'INSERT INTO `broadcast_images`(`name`,`mime`,`size`,`path`,`created_by`,`created_at`) VALUES(?,?,?,?,?,?)',
        [mb_substr($name ?: 'notice.' . $kind['ext'], 0, 150), $kind['mime'], strlen($data), $path, $adminId, now_ms()]
    );
    return db_get('SELECT * FROM `broadcast_images` WHERE `id` = ?', [db_last_id()]);
}

function broadcast_image_by_id(int $id): ?array
{
    return db_get('SELECT * FROM `broadcast_images` WHERE `id` = ?', [$id]);
}

function broadcast_linkify(string $escaped): string
{
    return preg_replace('~(https?://[^\s<]+)~', '<a href="$1" style="color:#c8507d;text-decoration:underline">$1</a>', $escaped);
}

/**
 * 读图片真实像素尺寸（不依赖 GD/Imagick，虚拟主机没装也能用）。
 * 返回 [宽, 高]，解析失败返回 null。
 */
function image_pixel_size(string $path): ?array
{
    if (!is_file($path)) return null;
    $data = @file_get_contents($path);
    if ($data === false || strlen($data) < 16) return null;

    // PNG：IHDR 里 4 字节宽 + 4 字节高（大端）
    if (substr($data, 0, 4) === "\x89PNG" && strlen($data) >= 24) {
        $w = unpack('N', substr($data, 16, 4))[1];
        $h = unpack('N', substr($data, 20, 4))[1];
        return [$w, $h];
    }
    // GIF：逻辑屏幕宽高（小端）
    if (substr($data, 0, 4) === 'GIF8' && strlen($data) >= 10) {
        $w = unpack('v', substr($data, 6, 2))[1];
        $h = unpack('v', substr($data, 8, 2))[1];
        return [$w, $h];
    }
    // WEBP：VP8X / VP8 / VP8L 三种块
    if (substr($data, 0, 4) === 'RIFF' && substr($data, 8, 4) === 'WEBP' && strlen($data) >= 30) {
        $chunk = substr($data, 12, 4);
        if ($chunk === 'VP8X') {
            $w = 1 + (ord($data[24]) | (ord($data[25]) << 8) | (ord($data[26]) << 16));
            $h = 1 + (ord($data[27]) | (ord($data[28]) << 8) | (ord($data[29]) << 16));
            return [$w, $h];
        }
        if ($chunk === 'VP8 ' && strlen($data) >= 30) {
            $w = (ord($data[26]) | (ord($data[27]) << 8)) & 0x3fff;
            $h = (ord($data[28]) | (ord($data[29]) << 8)) & 0x3fff;
            return [$w, $h];
        }
        if ($chunk === 'VP8L' && strlen($data) >= 25) {
            $b = unpack('V', substr($data, 21, 4))[1];
            return [($b & 0x3fff) + 1, (($b >> 14) & 0x3fff) + 1];
        }
        return null;
    }
    // JPEG：逐段找 SOF0/SOF1/SOF2
    if (substr($data, 0, 2) === "\xff\xd8") {
        $i = 2;
        $len = strlen($data);
        while ($i + 9 < $len) {
            if (ord($data[$i]) !== 0xFF) { $i++; continue; }
            $marker = ord($data[$i + 1]);
            if ($marker === 0xD8 || $marker === 0x01 || ($marker >= 0xD0 && $marker <= 0xD7)) { $i += 2; continue; }
            $segLen = (ord($data[$i + 2]) << 8) | ord($data[$i + 3]);
            if ($marker >= 0xC0 && $marker <= 0xCF && !in_array($marker, [0xC4, 0xC8, 0xCC], true)) {
                $h = (ord($data[$i + 5]) << 8) | ord($data[$i + 6]);
                $w = (ord($data[$i + 7]) << 8) | ord($data[$i + 8]);
                return [$w, $h];
            }
            $i += 2 + $segLen;
        }
    }
    return null;
}

/** 邮件里图片的显示宽度：小图不放大（放大会糊），大图最多 500px */
function broadcast_image_width(string $path): int
{
    $size = image_pixel_size($path);
    if (!$size || $size[0] <= 0) return 500;
    return max(120, min(500, (int) $size[0]));
}

function broadcast_html(string $siteName, string $subject, string $content, ?array $image, string $siteUrl): string
{
    $safe = broadcast_linkify(htmlspecialchars($content, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
    $paras = [];
    foreach (preg_split('/\n{2,}/', $safe) as $p) {
        $paras[] = '<p style="margin:0 0 14px;font-size:14px;line-height:1.85;color:#3f2b34">' . nl2br($p, false) . '</p>';
    }
    $body = implode('', $paras);
    if ($image) {
        $width = broadcast_image_width((string) ($image['path'] ?? ''));
        $body .= '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;"><tr><td align="center" style="padding:4px 0 8px;">'
            . '<img src="cid:broadcast-image" width="' . $width . '" alt="通知配图" style="display:block;width:100%;max-width:' . $width . 'px;height:auto;border-radius:14px;border:1px solid #f7e3ea;"></td></tr></table>';
    }
    if ($siteUrl !== '') {
        $body .= '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr><td>'
            . '<a href="' . htmlspecialchars($siteUrl, ENT_QUOTES) . '" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#c8507d;color:#fff;text-decoration:none;font-size:14px;font-weight:700;">打开 ' . htmlspecialchars($siteName, ENT_QUOTES) . '</a>'
            . '</td></tr></table>';
    }
    return mail_shell(
        $siteName,
        htmlspecialchars($subject, ENT_QUOTES),
        mail_opener() . ' 这封是站点通知，记得看完哦。',
        $body,
        '你收到这封邮件，是因为你注册了 ' . htmlspecialchars($siteName, ENT_QUOTES) . '。'
    );
}

function broadcast_create(string $subject, string $content, ?int $imageId, int $adminId): array
{
    $subject = trim($subject);
    $content = trim($content);
    if ($subject === '') fail('BAD_REQUEST', '请填写邮件主题', 400);
    if (mb_strlen($subject) > 120) fail('BAD_REQUEST', '主题不能超过 120 字', 400);
    if ($content === '') fail('BAD_REQUEST', '请填写邮件正文', 400);
    if (mb_strlen($content) > 8000) fail('BAD_REQUEST', '正文不能超过 8000 字', 400);
    $active = db_get("SELECT `id` FROM `broadcast_jobs` WHERE `status` IN ('queued','sending') LIMIT 1");
    if ($active) fail('BROADCAST_BUSY', '已有正在发送的全体邮件，请等它完成或取消后再发', 409);
    if ($imageId) {
        if (!broadcast_image_by_id($imageId)) fail('BAD_REQUEST', '配图不存在，请重新上传', 400);
    }
    $recipients = broadcast_recipients();
    if (!$recipients) fail('BAD_REQUEST', '还没有已注册的账号', 400);
    db_run(
        'INSERT INTO `broadcast_jobs`(`subject`,`content`,`image_id`,`total`,`sent`,`failed`,`status`,`created_by`,`created_at`) VALUES(?,?,?,?,0,0,\'queued\',?,?)',
        [$subject, $content, $imageId, count($recipients), $adminId, now_ms()]
    );
    return db_get('SELECT * FROM `broadcast_jobs` WHERE `id` = ?', [db_last_id()]);
}

function broadcast_run(int $id): array
{
    @set_time_limit(300);
    $job = db_get('SELECT * FROM `broadcast_jobs` WHERE `id` = ?', [$id]);
    if (!$job) fail('NOT_FOUND', '任务不存在', 404);
    if (!in_array($job['status'], ['queued', 'sending'], true)) return $job;

    if ($job['status'] === 'queued') {
        db_run("UPDATE `broadcast_jobs` SET `status` = 'sending', `started_at` = ? WHERE `id` = ?", [now_ms(), $id]);
    }

    $processed = (int) $job['sent'] + (int) $job['failed'];
    $recipients = broadcast_recipients();
    $batch = array_slice($recipients, $processed, BROADCAST_BATCH);
    if (!$batch) {
        db_run("UPDATE `broadcast_jobs` SET `status` = 'done', `finished_at` = ? WHERE `id` = ?", [now_ms(), $id]);
        return db_get('SELECT * FROM `broadcast_jobs` WHERE `id` = ?', [$id]);
    }

    $siteName = setting('siteName', '千早爱音的AI站');
    $subject = str_starts_with($job['subject'], '【') ? $job['subject'] : '【' . $siteName . '】' . $job['subject'];

    $inline = [];
    $imgRow = null;
    if ($job['image_id']) {
        $img = broadcast_image_by_id((int) $job['image_id']);
        if ($img && is_file($img['path'])) {
            $imgRow = $img;
            $inline[] = ['cid' => 'broadcast-image', 'mime' => $img['mime'], 'name' => $img['name'] ?: 'notice.png', 'data' => file_get_contents($img['path'])];
        }
    }

    foreach ($batch as $email) {
        try {
            // 每封单独渲染：开场白会随机换成不同队友
            $html = broadcast_html($siteName, $job['subject'], $job['content'], $imgRow, PUBLIC_URL);
            smtp_send($email, $subject, $html, $inline);
            db_run('UPDATE `broadcast_jobs` SET `sent` = `sent` + 1 WHERE `id` = ?', [$id]);
            db_run('INSERT INTO `broadcast_logs`(`job_id`,`email`,`ok`,`error`,`created_at`) VALUES(?,?,1,NULL,?)', [$id, $email, now_ms()]);
        } catch (Throwable $e) {
            db_run('UPDATE `broadcast_jobs` SET `failed` = `failed` + 1 WHERE `id` = ?', [$id]);
            db_run('INSERT INTO `broadcast_logs`(`job_id`,`email`,`ok`,`error`,`created_at`) VALUES(?,?,0,?,?)', [$id, $email, mb_substr($e->getMessage(), 0, 300), now_ms()]);
        }
    }

    $fresh = db_get('SELECT * FROM `broadcast_jobs` WHERE `id` = ?', [$id]);
    if ((int) $fresh['sent'] + (int) $fresh['failed'] >= (int) $fresh['total']) {
        db_run("UPDATE `broadcast_jobs` SET `status` = 'done', `finished_at` = ? WHERE `id` = ?", [now_ms(), $id]);
        $fresh = db_get('SELECT * FROM `broadcast_jobs` WHERE `id` = ?', [$id]);
    }
    return $fresh;
}

function broadcast_get(int $id): array
{
    $job = db_get('SELECT * FROM `broadcast_jobs` WHERE `id` = ?', [$id]);
    if (!$job) fail('NOT_FOUND', '任务不存在', 404);
    $job['failures'] = db_all('SELECT `email`,`error`,`created_at` FROM `broadcast_logs` WHERE `job_id` = ? AND `ok` = 0 ORDER BY `id` DESC LIMIT 10', [$id]);
    return $job;
}

function broadcast_list(int $limit = 20): array
{
    return db_all('SELECT `id`,`subject`,`total`,`sent`,`failed`,`status`,`error`,`created_at`,`finished_at` FROM `broadcast_jobs` ORDER BY `id` DESC LIMIT ' . max(1, min(50, $limit)));
}

function broadcast_cancel(int $id): void
{
    $job = db_get('SELECT * FROM `broadcast_jobs` WHERE `id` = ?', [$id]);
    if (!$job) fail('NOT_FOUND', '任务不存在', 404);
    if (!in_array($job['status'], ['queued', 'sending'], true)) fail('BAD_REQUEST', '该任务已经结束', 400);
    db_run("UPDATE `broadcast_jobs` SET `status` = 'canceled', `finished_at` = ? WHERE `id` = ?", [now_ms(), $id]);
}

function broadcast_preview(string $to, string $subject, string $content, ?int $imageId): void
{
    $subject = trim($subject);
    $content = trim($content);
    if ($subject === '' || $content === '') fail('BAD_REQUEST', '请填写主题和正文', 400);
    if (mb_strlen($subject) > 120) fail('BAD_REQUEST', '主题不能超过 120 字', 400);
    if (mb_strlen($content) > 8000) fail('BAD_REQUEST', '正文不能超过 8000 字', 400);
    $siteName = setting('siteName', '千早爱音的AI站');
    $inline = [];
    $imgRow = null;
    if ($imageId) {
        $img = broadcast_image_by_id($imageId);
        if (!$img) fail('BAD_REQUEST', '配图不存在，请重新上传', 400);
        $imgRow = $img;
        if (is_file($img['path'])) $inline[] = ['cid' => 'broadcast-image', 'mime' => $img['mime'], 'name' => $img['name'] ?: 'notice.png', 'data' => file_get_contents($img['path'])];
    }
    $html = broadcast_html($siteName, $subject, $content, $imgRow, PUBLIC_URL);
    smtp_send($to, '【' . $siteName . '】[预览] ' . $subject, $html, $inline);
}
