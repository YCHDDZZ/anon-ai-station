<?php
declare(strict_types=1);

const ANNOUNCEMENT_IMAGE_LIMIT = 5 * 1024 * 1024;
const ANNOUNCEMENT_TONES = ['info', 'important', 'success'];

function announcement_image_kind(string $data): ?array
{
    if (strlen($data) < 12) return null;
    if (substr($data, 0, 4) === "\x89PNG") return ['ext' => 'png', 'mime' => 'image/png'];
    if (substr($data, 0, 3) === "\xff\xd8\xff") return ['ext' => 'jpg', 'mime' => 'image/jpeg'];
    if (substr($data, 0, 4) === 'GIF8') return ['ext' => 'gif', 'mime' => 'image/gif'];
    if (substr($data, 0, 4) === 'RIFF' && substr($data, 8, 4) === 'WEBP') return ['ext' => 'webp', 'mime' => 'image/webp'];
    return null;
}

function announcement_save_image(string $data, string $name, int $adminId): array
{
    if ($data === '') fail('BAD_REQUEST', '图片为空', 400);
    if (strlen($data) > ANNOUNCEMENT_IMAGE_LIMIT) fail('BAD_REQUEST', '图片不能超过 5MB', 400);
    $kind = announcement_image_kind($data);
    if (!$kind) fail('BAD_REQUEST', '只支持 PNG / JPG / GIF / WEBP 图片', 400);
    $dir = DATA_DIR . '/announcements';
    if (!is_dir($dir)) @mkdir($dir, 0775, true);
    $stored = date('Ymd') . '-' . bin2hex(random_bytes(6)) . '.' . $kind['ext'];
    $path = $dir . '/' . $stored;
    file_put_contents($path, $data);
    db_run(
        'INSERT INTO `announcement_images`(`name`,`mime`,`size`,`path`,`created_by`,`created_at`) VALUES(?,?,?,?,?,?)',
        [mb_substr($name ?: 'announcement.' . $kind['ext'], 0, 150), $kind['mime'], strlen($data), $path, $adminId, now_ms()]
    );
    return db_get('SELECT * FROM `announcement_images` WHERE `id` = ?', [db_last_id()]);
}

function announcement_image_by_id(int $id): ?array
{
    return db_get('SELECT * FROM `announcement_images` WHERE `id` = ?', [$id]);
}

function announcement_public(?array $row): ?array
{
    if (!$row) return null;
    return [
        'id' => (int) $row['id'],
        'title' => $row['title'],
        'content' => $row['content'],
        'tone' => in_array($row['tone'] ?? '', ANNOUNCEMENT_TONES, true) ? $row['tone'] : 'info',
        'imageUrl' => $row['image_id'] ? api_url('/api/announcements/' . (int) $row['id'] . '/image') : null,
        'updatedAt' => (int) $row['updated_at'],
    ];
}

function announcement_active(): ?array
{
    $ts = now_ms();
    $row = db_get(
        'SELECT * FROM `announcements`
         WHERE `enabled` = 1
           AND (`starts_at` IS NULL OR `starts_at` = 0 OR `starts_at` <= ?)
           AND (`ends_at` IS NULL OR `ends_at` = 0 OR `ends_at` > ?)
         ORDER BY `updated_at` DESC, `id` DESC LIMIT 1',
        [$ts, $ts]
    );
    return announcement_public($row);
}

function announcement_list(): array
{
    return array_map(function ($r) {
        $r['enabled'] = (bool) $r['enabled'];
        $r['imageUrl'] = $r['image_id'] ? api_url('/api/admin/announcements/image/' . (int) $r['image_id']) : null;
        $r['publicImageUrl'] = $r['image_id'] ? api_url('/api/announcements/' . (int) $r['id'] . '/image') : null;
        return $r;
    }, db_all('SELECT * FROM `announcements` ORDER BY `updated_at` DESC, `id` DESC'));
}

function announcement_text(string $title, string $content): array
{
    $t = trim($title);
    $c = trim($content);
    if ($t === '') fail('BAD_REQUEST', '请填写公告标题', 400);
    if (mb_strlen($t) > 120) fail('BAD_REQUEST', '公告标题不能超过 120 字', 400);
    if ($c === '') fail('BAD_REQUEST', '请填写公告内容', 400);
    if (mb_strlen($c) > 5000) fail('BAD_REQUEST', '公告内容不能超过 5000 字', 400);
    return [$t, $c];
}

function announcement_create(array $b, int $adminId): array
{
    [$title, $content] = announcement_text((string) ($b['title'] ?? ''), (string) ($b['content'] ?? ''));
    $tone = in_array($b['tone'] ?? '', ANNOUNCEMENT_TONES, true) ? $b['tone'] : 'info';
    $imageId = !empty($b['imageId']) ? (int) $b['imageId'] : null;
    if ($imageId && !announcement_image_by_id($imageId)) fail('BAD_REQUEST', '配图不存在，请重新上传', 400);
    $ts = now_ms();
    db_run(
        'INSERT INTO `announcements`(`title`,`content`,`image_id`,`tone`,`enabled`,`starts_at`,`ends_at`,`created_by`,`created_at`,`updated_at`)
         VALUES(?,?,?,?,?,?,?,?,?,?)',
        [$title, $content, $imageId, $tone, !isset($b['enabled']) || $b['enabled'] ? 1 : 0, $b['startsAt'] ?? null, $b['endsAt'] ?? null, $adminId, $ts, $ts]
    );
    return db_get('SELECT * FROM `announcements` WHERE `id` = ?', [db_last_id()]);
}

function announcement_update(int $id, array $b): array
{
    $row = db_get('SELECT * FROM `announcements` WHERE `id` = ?', [$id]);
    if (!$row) fail('NOT_FOUND', '公告不存在', 404);
    [$title, $content] = announcement_text((string) ($b['title'] ?? ''), (string) ($b['content'] ?? ''));
    $tone = in_array($b['tone'] ?? '', ANNOUNCEMENT_TONES, true) ? $b['tone'] : ($row['tone'] ?: 'info');
    $imageId = array_key_exists('imageId', $b) ? ($b['imageId'] ? (int) $b['imageId'] : null) : ($row['image_id'] ? (int) $row['image_id'] : null);
    if ($imageId && !announcement_image_by_id($imageId)) fail('BAD_REQUEST', '配图不存在，请重新上传', 400);
    db_run(
        'UPDATE `announcements` SET `title` = ?, `content` = ?, `image_id` = ?, `tone` = ?, `enabled` = ?, `starts_at` = ?, `ends_at` = ?, `updated_at` = ? WHERE `id` = ?',
        [
            $title,
            $content,
            $imageId,
            $tone,
            array_key_exists('enabled', $b) ? (!empty($b['enabled']) ? 1 : 0) : (int) $row['enabled'],
            array_key_exists('startsAt', $b) ? ($b['startsAt'] ?: null) : $row['starts_at'],
            array_key_exists('endsAt', $b) ? ($b['endsAt'] ?: null) : $row['ends_at'],
            now_ms(),
            $id,
        ]
    );
    return db_get('SELECT * FROM `announcements` WHERE `id` = ?', [$id]);
}

function announcement_delete(int $id): void
{
    $row = db_get('SELECT * FROM `announcements` WHERE `id` = ?', [$id]);
    if (!$row) fail('NOT_FOUND', '公告不存在', 404);
    db_run('DELETE FROM `announcements` WHERE `id` = ?', [$id]);
    if (!empty($row['image_id'])) {
        $used = db_get('SELECT COUNT(*) c FROM `announcements` WHERE `image_id` = ?', [(int) $row['image_id']]);
        if ((int) ($used['c'] ?? 0) === 0) {
            $img = announcement_image_by_id((int) $row['image_id']);
            if ($img) {
                if (is_file($img['path'])) @unlink($img['path']);
                db_run('DELETE FROM `announcement_images` WHERE `id` = ?', [(int) $img['id']]);
            }
        }
    }
}

function app_version_info(): array
{
    return [
        'versionCode' => (int) setting('appVersionCode', '2'),
        'versionName' => setting('appVersionName', '1.1.0'),
        'url' => setting('appDownloadUrl', PUBLIC_URL . '/downloads/anno-ai.apk'),
        'notes' => setting('appUpdateNotes', '应用内直接下载安装，装完就能继续聊～'),
        'mandatory' => setting('appUpdateMandatory', 'true') !== 'false',
        'publishedAt' => (int) (setting('appPublishedAt', '0') ?: 0) ?: null,
    ];
}

/** 后台展示用：线上 APK 的真实文件信息 + 最近登录过的客户端版本分布 */
function app_version_admin_info(): array
{
    $info = app_version_info();
    $apk = APP_BASE . '/downloads/anno-ai.apk';
    $info['apk'] = is_file($apk)
        ? [
            'size' => (int) filesize($apk),
            'modifiedAt' => (int) filemtime($apk) * 1000,
            'sha256' => hash_file('sha256', $apk),
        ]
        : null;

    // 真实 APK 版本来自构建时生成的元数据；后台填的版本是「推送给用户」的版本，两者可能不同
    $metaPath = APP_BASE . '/downloads/anno-ai.json';
    $meta = is_file($metaPath) ? json_decode((string) file_get_contents($metaPath), true) : null;
    $meta = is_array($meta) ? $meta : [];
    $info['apkVersionCode'] = isset($meta['versionCode']) ? (int) $meta['versionCode'] : null;
    $info['apkVersionName'] = (string) ($meta['versionName'] ?? '');
    $info['publishedVersionCode'] = (int) $info['versionCode'];
    $info['publishedVersionName'] = (string) $info['versionName'];
    $info['mismatch'] = $info['apkVersionCode'] !== null && $info['apkVersionCode'] !== $info['publishedVersionCode'];

    $counts = [];
    foreach (db_all("SELECT `ua` FROM `login_events` WHERE `ua` LIKE '%AnonApp/%' ORDER BY `id` DESC LIMIT 300") as $row) {
        if (preg_match('~AnonApp/([^\s]+)~', (string) ($row['ua'] ?? ''), $m)) {
            $ver = $m[1];
            $counts[$ver] = ($counts[$ver] ?? 0) + 1;
        }
    }
    arsort($counts);
    $clients = [];
    foreach ($counts as $ver => $n) {
        $clients[] = ['version' => $ver, 'count' => $n];
    }
    $info['clients'] = $clients;
    return $info;
}
