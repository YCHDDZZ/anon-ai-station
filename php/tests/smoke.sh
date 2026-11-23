#!/usr/bin/env bash
set -u
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
PHP=${PHP:-php}
WORK=${WORK:-tests/tmp}
rm -rf "$WORK"; mkdir -p "$WORK"
COOK="$WORK/cookies.json"
pass=0; fail=0
ok(){ pass=$((pass+1)); printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad(){ fail=$((fail+1)); printf "  \033[31m✘\033[0m %s\n" "$1"; }
has(){ if echo "$2" | grep -q -- "$3"; then ok "$1"; else bad "$1"; fi; }
hasnt(){ if echo "$2" | grep -q -- "$3"; then bad "$1"; else ok "$1"; fi; }
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
jget(){ node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);console.log(eval(process.argv[1]))}catch(e){console.log('')}})" "$1"; }

req(){ local m=$1 p=$2 body=${3:-} jar=${4:-$COOK}; local bf="$WORK/body.json"; : > "$bf"; [ -n "$body" ] && printf '%s' "$body" > "$bf"; "$PHP" tests/req.php "$m" "$p" "$bf" "$jar"; }
cap(){ local r; r=$(req GET /api/auth/captcha); CID=$(echo "$r" | jget "o.id"); CCODE=$(echo "$r" | jget "o.devCode"); }

# 每次从干净库开始（本地 SQLite 才清；生产走 MySQL 不受影响）
if grep -q '^DB_DRIVER=sqlite' .env 2>/dev/null; then
  rm -f data/app.sqlite data/app.sqlite-wal data/app.sqlite-shm
  rm -rf data/announcements data/broadcast data/uploads
fi

echo "── PHP 版冒烟 ──"
R=$(req GET /api/health); has "健康检查" "$R" '"ok":true'
R=$(req GET /api/bootstrap); has "bootstrap" "$R" '"siteName"'
R=$(req GET /api/auth/captcha); CID=$(echo "$R" | jget "o.id"); CCODE=$(echo "$R" | jget "o.devCode"); [ -n "$CID" ] && ok "图形验证码" || bad "图形验证码"
R=$(req POST /api/auth/send-code "{\"email\":\"admin@example.com\",\"mode\":\"login\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}")
has "发送验证码（dev 回显）" "$R" '"devCode"'
ECODE=$(echo "$R" | jget "o.devCode")
R=$(req GET /api/auth/captcha); CID=$(echo "$R" | jget "o.id"); CCODE=$(echo "$R" | jget "o.devCode")
R=$(req POST /api/auth/verify "{\"email\":\"admin@example.com\",\"code\":\"$ECODE\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}")
has "验证码登录" "$R" '"role":"admin"'

# 邮箱验证码登录：网页端不显示图形验证码，发码与登录都不该强制图形码
R=$(req POST /api/auth/send-code '{"email":"admin@example.com","mode":"login"}')
has "发码无需图形验证码" "$R" '"devCode"'
ECODE2=$(echo "$R" | jget "o.devCode")
R=$(req POST /api/auth/verify "{\"email\":\"admin@example.com\",\"code\":\"$ECODE2\",\"mode\":\"login\"}")
has "验证码登录无需图形验证码" "$R" '"role":"admin"'
R=$(req POST /api/auth/send-code '{"email":"php-reg@test.local","mode":"register","groupNumber":"10001"}')
has "注册发码无需图形验证码" "$R" '"devCode"'
RECODE=$(echo "$R" | jget "o.devCode")
R=$(req POST /api/auth/verify "{\"email\":\"php-reg@test.local\",\"code\":\"$RECODE\",\"password\":\"test12345\",\"mode\":\"register\"}" "$WORK/register.json")
has "注册仍强制图形验证码" "$R" 'CAPTCHA_INVALID'
R=$(req GET /api/me); has "个人总览" "$R" '"categories"'
R=$(req GET /api/conversations); has "会话列表" "$R" '"conversations"'
R=$(req GET /api/personas/mine); has "我的角色接口" "$R" '"personas"'
R=$(req GET /api/personas); has "默认角色" "$R" '千早爱音'
R=$(req GET /api/admin/overview); has "后台总览" "$R" '"stats"'
has "后台总览含当前 App 版本" "$R" '"appVersion"'
has "App 版本含版本名称" "$R" '"versionName"'
has "后台区分 APK 版本与推送版本" "$R" '"apkVersionCode"'
R=$(req GET /api/admin/security); has "安全接口含流量字段" "$R" '"traffic":\[\]'
R=$(req GET /api/admin/users); has "用户列表" "$R" 'admin@example.com'
R=$(req GET /api/admin/users/1/detail); has "用户详情含会话列表" "$R" '"sessions"'
has "会话字段与前端一致" "$R" '"deviceId"'
R=$(req GET /api/admin/providers/llm); has "共享接口列表" "$R" '"category":"llm"'
R=$(req POST /api/admin/providers/llm '{"name":"mock","baseUrl":"http://127.0.0.1:9001/v1","apiKey":"sk-test","model":"mock-model","extra":{"models":["mock-model"],"modelConfig":{"mock-model":{"effort":"high","context":128000,"label":"多模态模型","labelColor":"green"}}}}')
has "创建共享接口" "$R" '"name":"mock"'
has "模型思考强度与上下文已保存" "$R" '"context":128000'
has "模型自定义标识已保存" "$R" '"label":"多模态模型"'
has "模型标识颜色已保存" "$R" '"labelColor":"green"'
R=$(req GET /api/admin/models); has "后台模型列表含分组" "$R" '"providerName"'
has "后台模型列表含分组结构" "$R" '"groups"'
PID=$(echo "$R" | jget "o.groups.0.providerId")
R=$(req PUT /api/admin/models/order "{\"providers\":[$PID],\"models\":{\"$PID\":[\"mock-model\"]}}"); has "保存两级模型顺序" "$R" '"ok":true'
R=$(req GET /api/me); has "个人模型列表含分组" "$R" '"providerName"'
has "个人模型列表含自定义标识" "$R" '"label":"多模态模型"'
R=$(req GET /api/admin/overview); has "后台总览显示共享接口" "$R" '"name":"mock"'
R=$(req PUT /api/admin/security/settings '{"userProvidersOpen":true}'); has "开启用户自建 API" "$R" '"ok":true'
R=$(req GET /api/bootstrap); has "bootstrap 同步开关" "$R" '"userProvidersOpen":true'
R=$(req PUT /api/admin/security/settings '{"userProvidersOpen":false}'); has "关闭用户自建 API" "$R" '"ok":true'


echo ""
echo "── 2. 注册、验证码与权限 ──"
UCOOK="$WORK/user.json"
R=$(req PUT /api/admin/settings '{"allowRegistration":false}')
has "关闭注册" "$R" '"ok":true'
cap
R=$(req POST /api/auth/send-code "{\"email\":\"php-new@test.local\",\"mode\":\"register\",\"groupNumber\":\"24680\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}" "$UCOOK")
has "关闭注册后拒绝发码" "$R" 'REGISTRATION_CLOSED'

R=$(req PUT /api/admin/settings '{"allowRegistration":true}')
has "重新开放注册" "$R" '"ok":true'
R=$(req PUT /api/admin/security/settings '{"registerGroupNumbers":["24680"]}')
has "群号数组保存" "$R" '"ok":true'
R=$(req GET /api/admin/security)
has "群号回读" "$R" '24680'

cap
R=$(req POST /api/auth/send-code "{\"email\":\"php-new@test.local\",\"mode\":\"register\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}" "$UCOOK")
has "缺群号被拒" "$R" 'GROUP_REQUIRED'
cap
R=$(req POST /api/auth/send-code "{\"email\":\"php-new@test.local\",\"mode\":\"register\",\"groupNumber\":\"99999\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}" "$UCOOK")
has "错误群号被拒" "$R" 'GROUP_INVALID'
cap
R=$(req POST /api/auth/send-code "{\"email\":\"php-new@test.local\",\"mode\":\"register\",\"groupNumber\":\"24680\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}" "$UCOOK")
has "正确群号可发码" "$R" '"devCode"'
ECODE=$(echo "$R" | jget "o.devCode")
cap
R=$(req POST /api/auth/verify "{\"email\":\"php-new@test.local\",\"code\":\"$ECODE\",\"password\":\"123\",\"groupNumber\":\"24680\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}" "$UCOOK")
has "短密码被拒绝" "$R" '至少 8 位'
cap
R=$(req POST /api/auth/verify "{\"email\":\"php-new@test.local\",\"code\":\"$ECODE\",\"password\":\"test12345\",\"groupNumber\":\"24680\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}" "$UCOOK")
has "同一验证码可重试注册" "$R" '"role":"user"'
cap
R=$(req POST /api/auth/verify "{\"email\":\"php-new@test.local\",\"code\":\"$ECODE\",\"password\":\"test12345\",\"groupNumber\":\"24680\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}" "$UCOOK")
hasnt "验证码一次性" "$R" '"role":"user"'
R=$(req GET /api/me "" "$UCOOK")
has "新用户可访问个人总览" "$R" '"categories"'
R=$(req GET /api/admin/overview "" "$UCOOK")
has "普通用户不能看后台总览" "$R" '仅超级管理员'
R=$(req POST /api/me/providers/llm '{"name":"x","baseUrl":"https://example.com/v1","apiKey":"k"}' "$UCOOK")
has "自建 API 默认关闭" "$R" '后续版本开放'

# 单邮箱发码频率
for i in 1 2 3; do
  cap
  R=$(req POST /api/auth/send-code "{\"email\":\"rate-test@test.local\",\"mode\":\"register\",\"groupNumber\":\"24680\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}")
done
cap
R=$(req POST /api/auth/send-code "{\"email\":\"rate-test@test.local\",\"mode\":\"register\",\"groupNumber\":\"24680\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}")
has "同一邮箱发码限流" "$R" 'RATE_LIMITED'

# 图形验证码错误次数
cap
for i in $(seq 1 9); do
  R=$(req POST /api/auth/send-code "{\"email\":\"captcha-test@test.local\",\"mode\":\"login\",\"captchaId\":\"$CID\",\"captchaCode\":\"ZZZZ\"}")
done
has "图形验证码错误次数锁" "$R" 'CAPTCHA_LOCKED'

echo ""
echo "── 3. 会话、文件与导入导出 ──"
R=$(req POST /api/conversations '{"title":"导入导出测试"}' "$UCOOK")
CONV=$(echo "$R" | jget "o.conversation.id")
has "新建会话" "$R" '导入导出测试'
EXP=$(req GET "/api/conversations/$CONV/export" "" "$UCOOK")
has "导出包含标题" "$EXP" '导入导出测试'
IMPORT='{"conversations":[{"title":"导入的对话","messages":[{"role":"user","content":"你好"},{"role":"assistant","content":"你好呀"}]}]}'
R=$(req POST /api/conversations/import "$IMPORT" "$UCOOK")
has "导入成功" "$R" '"imported":1'
R=$(req GET /api/conversations "" "$UCOOK")
has "导入的对话出现在列表" "$R" '导入的对话'
R=$(req GET "/api/conversations/$CONV" "" "$UCOOK")
has "会话详情含顶层 messages" "$R" '"messages":'
R=$(req POST /api/conversations '{"title":"管理员私有"}' "$COOK")
ACONV=$(echo "$R" | jget "o.conversation.id")
R=$(req GET "/api/conversations/$ACONV" "" "$UCOOK")
has "不能读取他人会话" "$R" 'NOT_FOUND'

LONGCHAT=$(node -e "console.log(JSON.stringify({content:'a'.repeat(200001),personaId:1}))")
R=$(req POST /api/feedback '{"content":"smoke 反馈内容"}' "$UCOOK")
has "用户可以提交反馈" "$R" '"ok":true'
R=$(req GET /api/admin/feedback '' "$COOK")
has "后台按用户收到反馈" "$R" 'smoke 反馈内容'
has "反馈带用户邮箱" "$R" '"email"'

R=$(req POST /api/chat "$LONGCHAT" "$UCOOK")
has "超长消息被拒绝" "$R" '200000'
printf 'hello php file' > "$WORK/a.txt"
R=$(TEST_HEADERS='{"X-File-Name":"../../evil.php","X-File-Type":"text/plain"}' "$PHP" tests/req.php POST /api/files "$WORK/a.txt" "$UCOOK")
has "文本文件直接内联" "$R" '"parseMode":"inline"'
hasnt "文件名不含路径分隔符" "$R" 'evil.php/'
PHPLEFT=$(ls data/uploads/*.php 2>/dev/null | wc -l)
[ "$PHPLEFT" = "0" ] && ok "附件目录没有可执行脚本" || bad "附件目录出现 .php 文件"

echo ""
echo "── 4. 全体邮件与安全 ──"
R=$(req GET /api/admin/broadcast "" "$UCOOK")
has "普通用户不能看群发" "$R" '仅超级管理员'
R=$(req POST /api/admin/broadcast '{"subject":"","content":""}')
has "空主题被拒绝" "$R" '请填写邮件主题'
LONGBC=$(node -e "console.log(JSON.stringify({subject:'x',content:'b'.repeat(8001)}))")
R=$(req POST /api/admin/broadcast "$LONGBC")
has "正文超长被拒绝" "$R" '8000'
printf '\x89PNG\r\n\x1a\nxxxxxxxxxxxxxxxx' > "$WORK/pic.png"
R=$(TEST_HEADERS='{"X-File-Name":"pic.png"}' "$PHP" tests/req.php POST /api/admin/broadcast/image "$WORK/pic.png" "$COOK")
has "配图上传成功" "$R" '"mime":"image/png"'
IMG=$(echo "$R" | jget "o.image.id")
R=$(req GET "/api/admin/broadcast/image/$IMG" "" "$UCOOK")
has "普通用户不能读配图" "$R" '仅超级管理员'
R=$(req POST /api/admin/broadcast/preview '{"subject":"x","content":"y"}')
has "SMTP 未配置时预览失败" "$R" '邮件服务未配置'
R=$(req POST /api/admin/broadcast '{"subject":"通知","content":"正文"}')
JOB=$(echo "$R" | jget "o.job.id")
has "创建群发任务" "$R" '"status":"queued"'
R=$(req GET "/api/admin/broadcast/$JOB")
has "任务可查询" "$R" '"status":"queued"'
R=$(req POST "/api/admin/broadcast/$JOB/cancel")
has "取消群发任务" "$R" '"ok":true'
R=$(req GET "/api/admin/broadcast/$JOB")
has "取消后状态正确" "$R" '"status":"canceled"'
R=$(req POST "/api/admin/broadcast/$JOB/cancel")
has "重复取消被拒绝" "$R" '已经结束'

R=$(req POST /api/admin/security/block '{"ip":"not-an-ip"}')
has "非法 IP 被拒绝" "$R" 'IP 格式'
R=$(req POST /api/admin/security/block '{"ip":"203.0.113.9","minutes":1,"reason":"test"}')
has "手动封禁 IP" "$R" '"ip":"203.0.113.9"'
R=$(req GET /api/admin/security)
has "封禁列表包含 IP" "$R" '203.0.113.9'
R=$(req DELETE /api/admin/security/block/203.0.113.9)
has "解除 IP 封禁" "$R" '"ok":true'
R=$(req POST /api/admin/security/purge)
has "清理安全日志" "$R" '"ok":true'
R=$(req POST /api/admin/providers/parse '{"name":"aliyun-docmind","baseUrl":"https://docmind-api.cn-hangzhou.aliyuncs.com","apiKey":"ak:sk","model":"","extra":{"mode":"docmind","quota":{"group":"aliyun-docmind","monthly":3000,"price":0.02,"unit":"page"}}}')
has "创建文档解析接口" "$R" 'aliyun-docmind'
R=$(req GET /api/admin/usage)
has "后台用量列表" "$R" '"items"'
R=$(req GET /api/me/quota "" "$UCOOK")
has "个人额度按组展示" "$R" 'g:aliyun-docmind'
R=$(req GET /api/me/quota "" "$UCOOK")
has "个人额度含份额" "$R" '"share"'
R=$(req GET /api/nope)
has "未知接口返回 JSON 404" "$R" '"code":"NOT_FOUND"'

echo ""
echo "── 5. 公告 / App 版本 / 后台聊天记录 ──"
R=$(req GET /api/admin/announcements)
has "管理员可读公告列表" "$R" '"items"'
R=$(req POST /api/admin/announcements '{"title":"","content":""}')
has "空公告被拒绝" "$R" '公告标题'
R=$(TEST_HEADERS='{"X-File-Name":"ann.png"}' "$PHP" tests/req.php POST /api/admin/announcements/image public/logo-email.png "$COOK")
has "公告配图上传成功" "$R" '"mime":"image/png"'
ANNIMG=$(echo "$R" | jget "o.image.id")
R=$(req POST /api/admin/announcements "{\"title\":\"自检公告\",\"content\":\"第一行\\n第二行\",\"tone\":\"important\",\"enabled\":true,\"imageId\":$ANNIMG}")
has "创建公告" "$R" '自检公告'
ANNID=$(echo "$R" | jget "o.item.id")
R=$(req GET /api/announcements/active "" "$UCOOK")
has "用户侧读到当前公告" "$R" '自检公告'
CODE=$(req GET "/api/announcements/$ANNID/image" "" "$UCOOK" | head -c 4 | od -An -tx1 | tr -d ' \n')
has "公告配图返回 PNG" "$CODE" '89504e47'
R=$(req GET /api/admin/announcements "" "$UCOOK")
has "普通用户不能管理公告" "$R" '仅超级管理员'
R=$(req PUT "/api/admin/announcements/$ANNID" "{\"title\":\"自检公告\",\"content\":\"已停用\",\"tone\":\"info\",\"enabled\":false,\"imageId\":$ANNIMG}")
has "公告可停用" "$R" '"enabled":false'
R=$(req GET /api/announcements/active "" "$UCOOK")
has "停用后用户侧不再返回" "$R" '"announcement":null'
R=$(req DELETE "/api/admin/announcements/$ANNID")
has "公告可删除" "$R" '"ok":true'
R=$(req GET /api/app/version)
has "App 版本接口" "$R" '"versionCode"'
has "App 下载地址" "$R" '"url"'

R=$(req GET /api/me "" "$UCOOK")
TARGET_UID=$(echo "$R" | jget "o.user.id")
R=$(req POST /api/conversations '{"title":"后台审计测试"}' "$UCOOK")
CHATCID=$(echo "$R" | jget "o.conversation.id")
R=$(req GET "/api/admin/users/$TARGET_UID/conversations")
has "后台可列用户会话" "$R" '后台审计测试'
R=$(req GET "/api/admin/users/$TARGET_UID/conversations/$CHATCID")
has "后台可读会话消息" "$R" '"messages"'
R=$(req GET "/api/admin/users/$TARGET_UID/conversations" "" "$UCOOK")
has "普通用户不能看他人会话" "$R" '仅超级管理员'
R=$(req DELETE "/api/conversations/$CHATCID" "" "$UCOOK")
has "清理测试会话" "$R" '"ok":true'

echo ""
echo "── 6. 密码登录限流 ──"
for i in $(seq 1 10); do
  cap
  R=$(req POST /api/auth/password-login "{\"email\":\"lock@test.local\",\"password\":\"wrong-pass\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}")
done
cap
R=$(req POST /api/auth/password-login "{\"email\":\"lock@test.local\",\"password\":\"wrong-pass\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}")
has "密码错误过多触发限流" "$R" 'RATE_LIMITED'

echo ""
# 重设密码必须带邮箱验证码
R=$(req POST /api/auth/send-code '{"email":"admin@example.com","mode":"reset"}')
has "重设密码发码" "$R" '"devCode"'
RCODE=$(echo "$R" | jget "o.devCode")
R=$(req POST /api/auth/password '{"newPassword":"newpass123"}')
has "无验证码不能改密码" "$R" 'BAD_REQUEST'
R=$(req POST /api/auth/password "{\"code\":\"$RCODE\",\"newPassword\":\"newpass123\"}")
has "邮箱验证码重设密码" "$R" '"ok":true'

echo "════ 结果：通过 $pass 项，失败 $fail 项 ════"
exit 0
