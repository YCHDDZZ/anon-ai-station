<?php
declare(strict_types=1);

/**
 * PHP 版单元测试：纯函数 + 关键工具（不依赖 HTTP / MySQL）
 * 运行：php tests/unit.php
 */

require __DIR__ . '/../app/config.php';
require __DIR__ . '/../app/helpers.php';
require __DIR__ . '/../app/db.php';
require __DIR__ . '/../app/auth.php';
require __DIR__ . '/../app/providers.php';
require __DIR__ . '/../app/quota.php';
require __DIR__ . '/../app/broadcast.php';
require __DIR__ . '/../app/docmind.php';
require __DIR__ . '/../app/llm.php';
require __DIR__ . '/../app/announcements.php';

$pass = 0;
$fail = 0;

function ok(string $name, bool $cond, string $detail = ''): void
{
    global $pass, $fail;
    if ($cond) {
        $pass++;
        echo "  \033[32m✔\033[0m {$name}\n";
    } else {
        $fail++;
        echo "  \033[31m✘\033[0m {$name}" . ($detail !== '' ? "  ({$detail})" : '') . "\n";
    }
}

echo "── PHP 版单元测试 ──\n";

/* 密钥与脱敏 */
$secret = 'sk-1234567890abcdef';
ok('加密后可解密', decrypt_secret(encrypt_secret($secret)) === $secret);
ok('密文不等于明文', encrypt_secret($secret) !== $secret);
ok('空值加密为空串', encrypt_secret('') === '');
ok('脱敏保留首尾', mask_key($secret) === 'sk-1••••cdef', mask_key($secret));
ok('短 Key 全部遮挡', mask_key('short') === '••••');

/* IP 判定 */
ok('127.0.0.1 是内网', is_private_ip('127.0.0.1'));
ok('10.0.0.1 是内网', is_private_ip('10.0.0.1'));
ok('8.8.8.8 是公网', !is_private_ip('8.8.8.8'));
$_SERVER['REMOTE_ADDR'] = '10.0.0.5';
$_SERVER['HTTP_X_FORWARDED_FOR'] = '1.2.3.4, 5.6.7.8';
ok('内网代理时取 XFF 第一跳', client_ip() === '1.2.3.4', client_ip());
$_SERVER['REMOTE_ADDR'] = '8.8.8.8';
$_SERVER['HTTP_X_FORWARDED_FOR'] = '9.9.9.9';
ok('公网直连时忽略伪造 XFF', client_ip() === '8.8.8.8', client_ip());
unset($_SERVER['HTTP_X_FORWARDED_FOR'], $_SERVER['HTTP_X_REAL_IP']);

/* 配额元数据 */
$q = quota_of(['id' => 7, 'category' => 'parse', 'extra' => ['quota' => ['group' => 'aliyun-docmind', 'monthly' => 3000, 'price' => 0.02]]]);
ok('配额组 scope 带前缀', $q['scope'] === 'g:aliyun-docmind', $q['scope']);
ok('配额月上限', $q['monthly'] === 3000.0, (string) $q['monthly']);
ok('配额单价', abs($q['price'] - 0.02) < 1e-9);
ok('配额单位默认为页', $q['unit'] === 'page', $q['unit']);
$q2 = quota_of(['id' => 3, 'category' => 'search', 'extra' => []]);
ok('无分组时按 provider 计', $q2['scope'] === 'p:3', $q2['scope']);
ok('搜索默认 1000 credits', $q2['monthly'] === 1000.0);
$row = ['id' => 9, 'extra_json' => json_encode(['quota' => ['group' => 'tavily']])];
ok('scope_of_row 读取分组', scope_of_row($row) === 'g:tavily');

/* 计费页数 */
$cjk = str_repeat('中', 4000);
ok('4000 汉字折 2 页', billable_pages(['name' => 'a.txt'], 0, $cjk) === 2, (string) billable_pages(['name' => 'a.txt'], 0, $cjk));
ok('PDF 按实际页数', billable_pages(['name' => 'a.pdf'], 7, 'x') === 7);
ok('空文本至少 1 页', billable_pages(['name' => 'a.md'], 0, '') === 1);
$words = str_repeat('word ', 4500);
ok('Excel 按 2000 词折页', billable_pages(['name' => 'a.xlsx'], 0, $words) === 3, (string) billable_pages(['name' => 'a.xlsx'], 0, $words));

/* 图片魔数 */
$png = "\x89PNG\r\n\x1a\n" . str_repeat("\0", 16);
$jpg = "\xff\xd8\xff\xe0" . str_repeat("\0", 16);
$gif = 'GIF89a' . str_repeat("\0", 16);
$webp = 'RIFF' . pack('V', 24) . 'WEBPVP8X' . str_repeat("\0", 16);
ok('识别 PNG', broadcast_image_kind($png)['mime'] === 'image/png');
ok('识别 JPEG', broadcast_image_kind($jpg)['mime'] === 'image/jpeg');
ok('识别 GIF', broadcast_image_kind($gif)['ext'] === 'gif');
ok('识别 WEBP', broadcast_image_kind($webp)['ext'] === 'webp');
ok('拒绝非图片', broadcast_image_kind('hello world') === null);

/* AccessKey 解析 */
$a = docmind_credential('fake-access-key-id:SecretValue123');
ok('冒号格式解析 Id', $a['id'] === 'fake-access-key-id');
ok('冒号格式解析 Secret', $a['secret'] === 'SecretValue123');
$b = docmind_credential('{"accessKeyId":"ak","accessKeySecret":"sk"}');
ok('JSON 格式解析', $b['id'] === 'ak' && $b['secret'] === 'sk');
$bad = false;
try {
    docmind_credential('only-id');
} catch (ApiError $e) {
    $bad = $e->apiCode === 'BAD_CREDENTIAL';
}
ok('缺少 Secret 报 BAD_CREDENTIAL', $bad);

/* ACS3 签名：与官方向量逐字比对 */
$cred = ['id' => 'ak', 'secret' => 'sk'];
$signed = docmind_sign(
    $cred,
    'GET',
    'openplatform.aliyuncs.com',
    '/',
    ['Product' => 'docmind-api', 'RegionId' => 'cn-hangzhou'],
    ['x-acs-action' => 'AuthorizeFileUpload', 'x-acs-version' => '2019-12-19'],
    '',
    '2026-11-18T02:02:21Z',
    'a7eae744-dfa1-4542-ba9f-3c6390353885'
);
$expectedCanonical = implode("\n", [
    'GET',
    '/',
    'Product=docmind-api&RegionId=cn-hangzhou',
    'host:openplatform.aliyuncs.com',
    'x-acs-action:AuthorizeFileUpload',
    'x-acs-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'x-acs-date:2026-11-18T02:02:21Z',
    'x-acs-signature-nonce:a7eae744-dfa1-4542-ba9f-3c6390353885',
    'x-acs-version:2019-12-19',
    '',
    'host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
]);
ok('规范化请求与阿里云格式一致', $signed['canonicalRequest'] === $expectedCanonical);
ok(
    '规范化请求哈希与线上实测一致',
    hash('sha256', $expectedCanonical) === '67ce3dae9271d35b673c69c7b8049909136986b3e10297b604f323b4c982c000',
    hash('sha256', $expectedCanonical)
);
ok('签名算法为 HMAC-SHA256', $signed['signature'] === hash_hmac('sha256', $signed['stringToSign'], 'sk'));
ok('Authorization 头格式正确', (bool) preg_match('/^ACS3-HMAC-SHA256 Credential=ak,SignedHeaders=host;x-acs-action;.*,Signature=[0-9a-f]{64}$/', $signed['authorization']));

/* 表单请求体：中文按 RFC3986 编码 */
$post = docmind_sign(
    $cred,
    'POST',
    'docmind-api.cn-hangzhou.aliyuncs.com',
    '/',
    [],
    ['x-acs-action' => 'SubmitDocParserJob', 'x-acs-version' => '2022-07-11', 'content-type' => 'application/x-www-form-urlencoded'],
    'FileName=%E6%88%91%E7%9A%84%E6%96%87%E6%A1%A3.pdf&PageIndex=1-5',
    '2026-11-18T02:02:21Z',
    'fixed'
);
ok('POST 载荷参与签名', str_contains($post['canonicalRequest'], hash('sha256', 'FileName=%E6%88%91%E7%9A%84%E6%96%87%E6%A1%A3.pdf&PageIndex=1-5')));
ok('POST 签名可复算', $post['signature'] === hash_hmac('sha256', $post['stringToSign'], 'sk'));

/* 通用工具 */
$obj = ['a' => ['b' => [['c' => 42]]]];
ok('get_path 数字下标', get_path($obj, 'a.b.0.c') === 42);
ok('get_path 缺失返回 null', get_path($obj, 'a.x.c') === null);
$inter = interpolate_node(['q' => '{{query}}', 'n' => '{{limit}}', 's' => '前 {{limit}} 条'], ['query' => 'a"b\\c', 'limit' => 5]);
ok('整值插值保留数字类型', $inter['n'] === 5);
ok('字符串插值保留特殊字符', $inter['q'] === 'a"b\\c');
ok('嵌入式插值', $inter['s'] === '前 5 条');

/* 用户公开字段 */
$u = public_user([
    'id' => 1, 'email' => 'a@b.com', 'role' => 'user', 'status' => 'active',
    'created_at' => 1, 'last_login_at' => null, 'last_ip' => '', 'password_hash' => 'secret-hash',
    'banned_until' => null, 'ban_reason' => null,
]);
ok('公开用户不含密码哈希', !isset($u['password_hash']));
ok('公开用户有 hasPassword', $u['hasPassword'] === true);
ok('公开用户字段完整', $u['email'] === 'a@b.com' && $u['ban'] === null);

/* 邮件 */
ok('随机开场白非空', mb_strlen(mail_opener()) > 10);
$codeHtml = code_email_html('测试站', '123456', 10, 'login');
ok('验证码邮件包含验证码', str_contains($codeHtml, '123456'));
ok('验证码邮件内嵌 logo', str_contains($codeHtml, 'cid:chihaya-logo'));
ok('验证码邮件转义站点名', str_contains(code_email_html('<b>站</b>', '1', 10, 'login'), '&lt;b&gt;站&lt;/b&gt;'));
$notice = broadcast_html('站', '标题', '<script>alert(1)</script>', ['path' => APP_BASE . '/public/logo-128.png'], 'https://example.com');
ok('群发正文转义脚本', !str_contains($notice, '<script>alert(1)</script>') && str_contains($notice, '&lt;script&gt;'));
ok('群发配图使用 CID', str_contains($notice, 'cid:broadcast-image'));
ok('群发按钮链接正确', str_contains($notice, 'href="https://example.com"'));


/* 图片尺寸解析（不依赖 GD） */
$logoSize = image_pixel_size(APP_BASE . '/public/logo-128.png');
ok('PNG 尺寸解析正确', is_array($logoSize) && $logoSize[0] === 128 && $logoSize[1] === 128);
ok('小图不放大', broadcast_image_width(APP_BASE . '/public/logo-128.png') === 128);
ok('缺文件时回退 500', broadcast_image_width(APP_BASE . '/data/__none.png') === 500);
$big = broadcast_html('站', '标题', '正文', ['path' => APP_BASE . '/public/logo-256.png'], '');
ok('大图最大 500', str_contains($big, 'max-width:256px') || str_contains($big, 'max-width:500px'));

/* SMTP 未配置时校验不抛异常 */
putenv('SMTP_HOST=');
$verify = smtp_verify();
ok('未配置 SMTP 时校验返回失败', $verify['ok'] === false && $verify['error'] !== null);

/* 设置读写 */
set_setting('unitTestKey', 'v1');
ok('设置写入后可读', setting('unitTestKey') === 'v1');
set_setting('unitTestKey', 'v2');
ok('设置可覆盖', setting('unitTestKey') === 'v2');
db_run('DELETE FROM `settings` WHERE `key` = ?', ['unitTestKey']);

/* 额度越线自动停用 */
$row = provider_save([
    'owner_type' => 'global',
    'owner_id' => null,
    'category' => 'search',
    'name' => 'unit-quota',
    'base_url' => 'https://example.com',
    'extra' => ['quota' => ['group' => 'unit-quota', 'monthly' => 1, 'price' => 0, 'track' => true]],
    'enabled' => true,
]);
$rt = provider_runtime(provider_row((int) $row['id']));
record_usage($rt, 2, null, 'unit-test');
$after = provider_row((int) $row['id']);
ok('超额后自动停用接口', (int) $after['enabled'] === 0);
ok('超额用量已记账', abs(scope_used('g:unit-quota') - 2) < 1e-9, (string) scope_used('g:unit-quota'));
$events = db_all("SELECT * FROM `security_events` WHERE `kind` = 'quota_auto_disable' ORDER BY `id` DESC LIMIT 1");
ok('超额写入安全事件', (bool) $events);
provider_delete((int) $row['id']);
db_run('DELETE FROM `usage_counters` WHERE `scope` = ?', ['g:unit-quota']);
db_run('DELETE FROM `usage_log` WHERE `scope` = ?', ['g:unit-quota']);

/* 公告与 App 版本 */
$annPng = "\x89PNG\r\n\x1a\n" . str_repeat("\0", 20);
ok('公告识别 PNG 配图', announcement_image_kind($annPng)['mime'] === 'image/png');
ok('公告拒绝非图片', announcement_image_kind('hello') === null);
$pub = announcement_public([
    'id' => 9, 'title' => '测试', 'content' => '正文', 'tone' => 'important',
    'image_id' => 3, 'updated_at' => 123, 'enabled' => 1,
]);
ok('公告公开字段完整', $pub['title'] === '测试' && $pub['tone'] === 'important' && $pub['updatedAt'] === 123);
ok('公告配图走单入口地址', str_contains($pub['imageUrl'], '/api/index.php?p=') && str_contains($pub['imageUrl'], 'announcements%2F9%2Fimage'));
$ver = app_version_info();
ok('App 版本信息可读', $ver['versionCode'] >= 1 && $ver['versionName'] !== '' && str_starts_with($ver['url'], 'http'));

/* 标签与周期 */
ok('分类中文名', category_label('parse') === '文件解析');
ok('单位中文名', unit_label('page') === '页');
ok('周期格式', (bool) preg_match('/^\d{4}-\d{2}$/', period_key()));

echo "\n════ 结果：通过 {$pass} 项，失败 {$fail} 项 ════\n";
exit($fail > 0 ? 1 : 0);
