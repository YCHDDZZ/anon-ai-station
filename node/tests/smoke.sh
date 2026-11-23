#!/usr/bin/env bash
# 端到端冒烟测试：认证 / 共享算力 / 自有算力 / 降级 / 适配器 / 文件 / 角色扮演
set -u
cd "$(dirname "$0")/.."

# 端口与数据目录都可覆盖：默认跑在独立临时库上，不会污染开发数据
PORT=${SMOKE_PORT:-8899}
BASE=http://127.0.0.1:$PORT
DATA=${SMOKE_DATA:-tests/tmp/data}
JAR=/tmp/smoke-admin.txt
USERJAR=/tmp/smoke-user.txt
rm -rf "$DATA"; mkdir -p "$DATA"
rm -f "$JAR" "$USERJAR"

pass=0; fail=0
ok()   { pass=$((pass+1)); printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad()  { fail=$((fail+1)); printf "  \033[31m✘\033[0m %s\n" "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1（期望 $3，实际 $2）"; fi; }
has()  { if echo "$2" | grep -q "$3"; then ok "$1"; else bad "$1（未找到 $3）"; fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(eval(process.argv[1]))}catch(e){console.log('')}})" "$1"; }

source tests/lib.sh

node --no-warnings tests/mock-upstream.mjs >/tmp/mock.log 2>&1 &
MOCK_PID=$!
# SMTP_HOST 置空：测试只走 dev 回显，绝不向真实邮箱发信
PORT=$PORT DATA_DIR="$DATA" SMTP_HOST= MAIL_DEV_FALLBACK=true PUBLIC_URL=http://127.0.0.1:$PORT APP_SECRET="${APP_SECRET:-release-smoke-secret-0123456789abcdef}" ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}" ADMIN_PASSWORD="${ADMIN_PASSWORD:-Test123456!}" node --no-warnings server/index.js >/tmp/app.log 2>&1 &
APP_PID=$!
cleanup() { kill $APP_PID $MOCK_PID 2>/dev/null; wait $APP_PID $MOCK_PID 2>/dev/null; }
trap cleanup EXIT
sleep 4

echo "── 1. 图形验证码 + 邮箱验证码登录 ──"
R=$(curl -s $BASE/api/auth/captcha)
has "图形验证码返回 SVG" "$R" '<svg'
CAPID=$(echo "$R" | json "j.id")
CAPCODE=$(echo "$R" | json "j.devCode")
if [ -n "$CAPID" ] && [ -n "$CAPCODE" ]; then ok "验证码 id / 答案已下发"; else bad "验证码结构异常"; fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/send-code -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@example.com\",\"captchaId\":\"$CAPID\",\"captchaCode\":\"ZZZZ\"}")
check "错误的图形验证码被拒绝" "$CODE" "400"
CAP=$(curl -s $BASE/api/auth/captcha); CID=$(echo "$CAP" | json "j.id"); CCODE=$(echo "$CAP" | json "j.devCode")
R=$(curl -s -c /tmp/old.txt -X POST $BASE/api/auth/password-login -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@example.com\",\"password\":\"Test123456!\",\"captchaId\":\"$CID\",\"captchaCode\":\"ZZZZ\"}")
has "密码登录缺少正确图形码被拒" "$R" 'CAPTCHA_INVALID'
CAP=$(curl -s $BASE/api/auth/captcha); CID=$(echo "$CAP" | json "j.id"); CCODE=$(echo "$CAP" | json "j.devCode")
R=$(curl -s -c /tmp/pw.txt -X POST $BASE/api/auth/password-login -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@example.com\",\"password\":\"Test123456!\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}")
has "密码登录成功（邮箱+密码+图形码）" "$R" '"role":"admin"'
R=$(login_via_code admin@example.com "$JAR")
has "验证码登录成功" "$R" '"role":"admin"'
R=$(curl -s -b "$JAR" $BASE/api/me)
has "会话带上设备与 IP 绑定信息" "$R" '"email":"admin@example.com"'

R=$(curl -s -b "$JAR" $BASE/api/me)
has "7 类能力齐备" "$R" '"key":"asr"'
has "自带可用角色列表" "$R" '"personas"'

echo "── 2. 默认角色 ──"
R=$(curl -s -b "$JAR" $BASE/api/personas)
has "存在默认全局角色" "$R" '千早爱音'
PID=$(echo "$R" | json "j.global[0].id")
if [ -n "$PID" ]; then ok "默认角色 id=$PID"; else bad "未取到角色 id"; fi

echo "── 3. 新会话必须选角色 ──"
R=$(curl -s -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' -d '{"content":"你好"}')
has "未选角色被拒绝" "$R" 'PERSONA_REQUIRED'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' -d '{"content":"你好"}')
check "HTTP 状态为 400" "$CODE" "400"
R=$(curl -s -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' -d '{"content":"你好","personaId":999999}')
has "无效角色被拒绝" "$R" 'PERSONA_INVALID'

echo "── 4. 未配置算力时降级 ──"
R=$(curl -s -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' -d "{\"content\":\"你好\",\"personaId\":$PID}")
has "返回算力不足" "$R" '算力暂时不足'
has "错误码为 INSUFFICIENT_COMPUTE" "$R" 'INSUFFICIENT_COMPUTE'

echo "── 5. 配置共享算力（指向本地 mock）──"
R=$(curl -s -b "$JAR" -X PUT $BASE/api/admin/providers/llm -H 'Content-Type: application/json' \
  -d '{"name":"共享大模型","baseUrl":"http://127.0.0.1:9001/v1","apiKey":"sk-shared-key-1234","model":"deepseek-chat","extra":{"modelConfig":{"deepseek-chat":{"label":"旗舰模型","labelColor":"blue","effort":"high","context":64000}}}}')
has "共享 LLM 已保存" "$R" '"hasApiKey":true'
has "密钥已掩码" "$R" 'sk-••••1234'
R=$(curl -s -b "$JAR" $BASE/api/admin/models)
has "后台模型列表含分组" "$R" '"providerName"'
has "后台模型列表含分组结构" "$R" '"groups"'
PID=$(echo "$R" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).groups[0].providerId))")
R=$(curl -s -b "$JAR" -X PUT $BASE/api/admin/models/order -H 'Content-Type: application/json' -d "{\"providers\":[$PID],\"models\":{\"$PID\":[\"deepseek-chat\"]}}")
has "保存两级模型顺序" "$R" '"ok":true'
R=$(curl -s -b "$JAR" $BASE/api/me)
has "个人模型列表含分组" "$R" '"providerName"'
has "个人模型列表含自定义标识" "$R" '"label":"旗舰模型"'
has "个人模型列表含标识颜色" "$R" '"labelColor":"blue"'

R=$(curl -s -b "$JAR" -X PUT $BASE/api/admin/providers/search -H 'Content-Type: application/json' \
  -d '{"name":"共享搜索","baseUrl":"http://127.0.0.1:9001","apiKey":"sk-search","extra":{}}')
has "共享搜索已保存" "$R" '"category":"search"'

echo "── 6. 流式对话 ──"
R=$(curl -sN -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d "{\"content\":\"介绍一下你自己\",\"personaId\":$PID}" -m 20)
has "收到 delta 事件" "$R" 'event: delta'
has "收到完整文本" "$R" '本地 mock 模型'
has "收到 reasoning" "$R" 'event: reasoning'
has "收到 done 事件" "$R" 'event: done'
has "返回 provider 信息" "$R" '共享大模型'

echo "── 7. 会话持久化与角色快照 ──"
R=$(curl -s -b "$JAR" $BASE/api/conversations)
has "会话列表有记录" "$R" '"conversations"'
has "列表带角色名" "$R" '"personaName":"千早爱音"'
CID=$(echo "$R" | json "j.conversations[0].id")
R=$(curl -s -b "$JAR" $BASE/api/conversations/$CID)
has "消息已落库" "$R" '"role":"assistant"'
has "助手内容完整" "$R" '本地 mock 模型'

echo "── 8. 已有会话不再要求角色 ──"
R=$(curl -sN -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d "{\"content\":\"继续聊\",\"conversationId\":$CID}" -m 20)
has "不带 personaId 也能续聊" "$R" 'event: done'

echo "── 8.5 不使用角色模式 ──"
R=$(curl -sN -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d "{\"content\":\"不用角色直接答\",\"personaId\":0}" -m 20)
has "personaId=0 可正常对话" "$R" 'event: done'
if echo "$R" | grep -q 'PERSONA_REQUIRED'; then bad "0 不应被当成未选择"; else ok "0 不被误判为未选择"; fi
R=$(curl -s -b "$JAR" $BASE/api/conversations)
has "会话记录为不使用角色" "$R" '"personaName":"不使用角色"'

echo "── 9. 联网搜索注入 ──"
R=$(curl -sN -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d "{\"content\":\"搜一下测试\",\"search\":true,\"personaId\":$PID}" -m 20)
has "返回 search 事件" "$R" '"results"'
has "搜索结果已归一化" "$R" '测试结果 A'

echo "── 10. 注册门槛：分部群号 ──"
R=$(curl -s -b "$JAR" -X PUT $BASE/api/admin/security/settings -H 'Content-Type: application/json' \
  -d '{"registerGroupNumbers":"10001\n10002","rateLimit":600,"autoBlock":true,"autoBlockMinutes":30}')
has "管理员设置分部群号" "$R" '"ok":true'
R=$(curl -s $BASE/api/bootstrap)
has "bootstrap 暴露注册门槛" "$R" '"requireGroup":true'
CAP=$(curl -s $BASE/api/auth/captcha); CID=$(echo "$CAP" | json "j.id"); CCODE=$(echo "$CAP" | json "j.devCode")
R=$(curl -s -X POST $BASE/api/auth/send-code -H 'Content-Type: application/json' \
  -d "{\"email\":\"user1@test.com\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\"}")
has "未填群号无法注册" "$R" 'GROUP_REQUIRED'
CAP=$(curl -s $BASE/api/auth/captcha); CID=$(echo "$CAP" | json "j.id"); CCODE=$(echo "$CAP" | json "j.devCode")
R=$(curl -s -X POST $BASE/api/auth/send-code -H 'Content-Type: application/json' \
  -d "{\"email\":\"user1@test.com\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\",\"groupNumber\":\"99999\"}")
has "错误的群号无法注册" "$R" 'GROUP_INVALID'
CAP=$(curl -s $BASE/api/auth/captcha); CID=$(echo "$CAP" | json "j.id"); CCODE=$(echo "$CAP" | json "j.devCode")
R=$(curl -s -X POST $BASE/api/auth/send-code -H 'Content-Type: application/json' \
  -d "{\"email\":\"user1@test.com\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\",\"groupNumber\":\"10001\",\"mode\":\"login\"}")
has "登录模式拒绝未注册邮箱" "$R" 'NOT_REGISTERED'
R=$(login_via_code user1@test.com "$USERJAR" 10001)
has "群号与密码正确时注册并登录" "$R" '"role":"user"'
has "注册后带密码" "$R" '"hasPassword":true'
CAP=$(curl -s $BASE/api/auth/captcha); CID=$(echo "$CAP" | json "j.id"); CCODE=$(echo "$CAP" | json "j.devCode")
R=$(curl -s -X POST $BASE/api/auth/send-code -H 'Content-Type: application/json' \
  -d "{\"email\":\"user1@test.com\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\",\"groupNumber\":\"10001\",\"mode\":\"register\"}")
has "注册模式拒绝已注册邮箱" "$R" 'ALREADY_REGISTERED'

echo "── 11. 普通用户走共享算力 ──"
R=$(curl -sN -b "$USERJAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d "{\"content\":\"普通用户提问\",\"personaId\":$PID}" -m 20)
has "普通用户可免费用共享算力" "$R" '本地 mock 模型'
has "来源标记为共享算力" "$R" '共享大模型'

echo "── 11.5 反馈 ──"
R=$(curl -s -b "$USERJAR" -X POST $BASE/api/feedback -H 'Content-Type: application/json' -d '{"content":"node smoke 反馈内容"}')
has "用户可以提交反馈" "$R" '"ok":true'
R=$(curl -s -b "$JAR" $BASE/api/admin/feedback)
has "后台按用户收到反馈" "$R" 'node smoke 反馈内容'
has "反馈带用户邮箱" "$R" '"email"'

echo "── 12. 越权检查 ──"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$USERJAR" $BASE/api/admin/users)
check "访问后台被拒绝" "$CODE" "403"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$USERJAR" -X PUT $BASE/api/admin/providers/llm -H 'Content-Type: application/json' -d '{"baseUrl":"http://x.com"}')
check "修改全局配置被拒绝" "$CODE" "403"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$USERJAR" -X PUT $BASE/api/admin/personas/$PID -H 'Content-Type: application/json' -d '{"name":"劫持"}')
check "修改全局角色被拒绝" "$CODE" "403"

echo "── 12.5 普通用户自建 API 默认关闭 ──"
R=$(curl -s $BASE/api/bootstrap)
has "bootstrap 标记为未开放" "$R" '"userProvidersOpen":false'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$USERJAR" -X POST $BASE/api/me/providers/llm \
  -H 'Content-Type: application/json' -d '{"name":"x","baseUrl":"http://127.0.0.1:9001/v1","apiKey":"k"}')
check "新建 API 返回 403" "$CODE" "403"
R=$(curl -s -b "$USERJAR" -X POST $BASE/api/me/providers/llm \
  -H 'Content-Type: application/json' -d '{"name":"x","baseUrl":"http://127.0.0.1:9001/v1","apiKey":"k"}')
has "提示等待后续版本" "$R" '后续版本开放'
R=$(curl -s -b "$JAR" -X PUT $BASE/api/admin/security/settings -H 'Content-Type: application/json' -d '{"userProvidersOpen":true}')
has "管理员可临时开放" "$R" '"ok":true'

echo "── 13. 用户自有算力与自有角色 ──"
curl -s -b "$USERJAR" -X PUT $BASE/api/me/providers/llm -H 'Content-Type: application/json' \
  -d '{"name":"我的模型","baseUrl":"http://127.0.0.1:9001/v1","apiKey":"sk-own-key-9999","model":"my-model","extra":{}}' >/dev/null
R=$(curl -sN -b "$USERJAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' -d "{\"content\":\"再用一次\",\"personaId\":$PID}" -m 20)
has "自有算力优先生效" "$R" '我的模型'

R=$(curl -s -b "$USERJAR" -X POST $BASE/api/personas -H 'Content-Type: application/json' \
  -d '{"name":"测试角色","description":"仅自己可见","prompt":"你是一个测试角色。"}')
has "普通用户可创建自己的角色" "$R" '"name":"测试角色"'
UPID=$(echo "$R" | json "j.persona.id")
R=$(curl -s -b "$USERJAR" $BASE/api/personas)
has "自有角色对本人可见" "$R" '"scope":"user"'
R=$(curl -s -b "$JAR" $BASE/api/personas)
if echo "$R" | grep -q '测试角色'; then bad "自有角色不应出现在管理员列表"; else ok "自有角色不污染他人列表"; fi

R=$(curl -s -b "$USERJAR" -X PUT $BASE/api/personas/$UPID -H 'Content-Type: application/json' -d '{"name":"测试角色改"}')
has "可编辑自己的角色" "$R" '"name":"测试角色改"'

echo "── 14. 管理员全局角色 ──"
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/personas -H 'Content-Type: application/json' \
  -d '{"name":"全局助手","description":"官方提供的角色","prompt":"你是一个官方助手。"}')
has "管理员可创建全局角色" "$R" '"scope":"global"'
GPID=$(echo "$R" | json "j.persona.id")
R=$(curl -s -b "$USERJAR" $BASE/api/personas)
has "全局角色对所有用户可见" "$R" '全局助手'
R=$(curl -s -b "$JAR" -X DELETE $BASE/api/admin/personas/$GPID)
has "管理员可删除全局角色" "$R" '"ok":true'

echo "── 15. 文件上传 + 解析适配器 ──"
printf '这是一个测试文本文件的内容。' > /tmp/test-note.txt
R=$(curl -s -b "$USERJAR" -X POST "$BASE/api/files?name=test-note.txt" \
  -H 'Content-Type: text/plain' -H 'X-File-Name: test-note.txt' -H 'X-File-Type: text/plain' \
  --data-binary @/tmp/test-note.txt)
has "文本文件直接解析" "$R" '"parseMode":"inline"'

printf '%%PDF-1.4 fake' > /tmp/test-doc.pdf
R=$(curl -s -b "$USERJAR" -X POST "$BASE/api/files?name=test-doc.pdf" \
  -H 'Content-Type: application/pdf' -H 'X-File-Name: test-doc.pdf' -H 'X-File-Type: application/pdf' \
  --data-binary @/tmp/test-doc.pdf)
has "无解析能力时降级不报错" "$R" '"parseMode":"none"'
has "给出可读告警" "$R" '未配置文件解析能力'

echo "── 16. 管理员用户管理 ──"
R=$(curl -s -b "$JAR" $BASE/api/admin/users)
has "用户列表可读" "$R" 'user1@test.com'
TARGET_ID=$(echo "$R" | json "j.users.find(u=>u.email==='user1@test.com').id")
R=$(curl -s -b "$JAR" -X PATCH $BASE/api/admin/users/$TARGET_ID -H 'Content-Type: application/json' -d '{"role":"admin"}')
has "可提升为管理员" "$R" '"role":"admin"'
R=$(curl -s -b "$JAR" -X PATCH $BASE/api/admin/users/$TARGET_ID -H 'Content-Type: application/json' -d '{"role":"user","status":"disabled"}')
has "可停用账号" "$R" '"status":"disabled"'
has "被停用后会话返回空用户" "$(curl -s -b "$USERJAR" $BASE/api/auth/me)" '"user":null'

echo "── 17. 自我保护 ──"
R=$(curl -s -b "$JAR" -X PATCH $BASE/api/admin/users/1 -H 'Content-Type: application/json' -d '{"role":"user"}')
has "不能取消自己的管理员身份" "$R" '不能取消自己的管理员身份'

echo "── 18. 自定义报错提示 ──"
curl -s -b "$JAR" -X PUT $BASE/api/admin/providers/llm -H 'Content-Type: application/json' \
  -d '{"name":"维护中的模型","baseUrl":"http://127.0.0.1:1/v1","apiKey":"sk-x","model":"m","extra":{},"errorMessage":"自定义提示：大模型正在维护，请稍后再试"}' >/dev/null
R=$(curl -s -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' -d "{\"content\":\"你好\",\"personaId\":$PID}")
has "返回该接口的自定义文案" "$R" '自定义提示：大模型正在维护'
R=$(curl -s -b "$JAR" $BASE/api/me)
has "配置里能读回自定义文案" "$R" '自定义提示：大模型正在维护'

echo "── 19. 聊天记录导出 / 导入 ──"
R=$(curl -s -b "$JAR" $BASE/api/conversations/export)
has "导出内容带版本号" "$R" '"version":1'
has "导出包含消息正文" "$R" '"messages"'
BEFORE=$(curl -s -b "$JAR" $BASE/api/conversations | json "j.conversations.length")
R=$(curl -s -b "$JAR" -X POST $BASE/api/conversations/import -H 'Content-Type: application/json' -d '{"conversations":[{"title":"导入测试 A","personaName":"千早爱音","messages":[{"role":"user","content":"你好"},{"role":"assistant","content":"你也好"}]},{"title":"导入测试 B","messages":[{"role":"user","content":"第二条"},{"role":"assistant","content":"收到"}]}]}')
has "导入成功计数" "$R" '"imported":2'
has "导入消息计数" "$R" '"messages":4'
AFTER=$(curl -s -b "$JAR" $BASE/api/conversations | json "j.conversations.length")
if [ "$AFTER" -eq "$((BEFORE+2))" ]; then ok "对话数增加 2（$BEFORE → $AFTER）"; else bad "对话数异常（$BEFORE → $AFTER）"; fi
R=$(curl -s -b "$JAR" $BASE/api/conversations)
has "导入的标题存在" "$R" '导入测试 A'
CID2=$(curl -s -b "$JAR" $BASE/api/conversations | json "j.conversations[0].id")
R=$(curl -s -b "$JAR" $BASE/api/conversations/$CID2/export)
has "单个对话可导出" "$R" '"version":1'
ONE=$(echo "$R" | json "j.conversations.length")
check "单个导出只含 1 个对话" "$ONE" "1"

CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST $BASE/api/conversations/import -H 'Content-Type: application/json' -d '{"foo":1}')
check "非法文件被拒绝" "$CODE" "400"
R=$(curl -s -b "$JAR" -X DELETE $BASE/api/conversations)
has "清空全部成功" "$R" '"ok":true'
LEFT=$(curl -s -b "$JAR" $BASE/api/conversations | json "j.conversations.length")
check "清空后为 0" "$LEFT" "0"

echo "── 20. 多 API 与模型列表 ──"
MOCK=http://127.0.0.1:9001
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/providers/llm/models -H 'Content-Type: application/json' -d "{\"baseUrl\":\"$MOCK/v1\"}")
has "从上游拉取模型列表" "$R" '"count":4'
has "模型名正确" "$R" 'Qwen3-8B'
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/providers/llm -H 'Content-Type: application/json' \
  -d "{\"name\":\"冒烟线路 1\",\"baseUrl\":\"$MOCK/v1\",\"apiKey\":\"sk-smoke-aaaa11\",\"model\":\"Qwen3-8B\",\"extra\":{\"models\":[\"Qwen3-8B\"]}}")
P1=$(echo "$R" | json "j.provider.id")
if [ -n "$P1" ]; then ok "新增第一条 API（id=$P1）"; else bad "新增 API 失败"; fi
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/providers/llm -H 'Content-Type: application/json' \
  -d "{\"name\":\"冒烟线路 2\",\"baseUrl\":\"$MOCK/v1\",\"apiKey\":\"sk-smoke-bbbb22\",\"model\":\"Lingshu-32B\",\"extra\":{\"models\":[\"Lingshu-32B\"]}}")
P2=$(echo "$R" | json "j.provider.id")
if [ -n "$P2" ]; then ok "新增第二条 API（id=$P2）"; else bad "新增 API 失败"; fi
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/providers/llm/$P1/keys -H 'Content-Type: application/json' -d '{"key":"sk-smoke-cccc33","label":"备用"}')
has "同一条 API 可挂多把 Key" "$R" 'sk-••••cc33'
R=$(curl -s -b "$JAR" $BASE/api/admin/providers/llm)
N=$(echo "$R" | json "j.entries.length")
if [ "$N" -ge 3 ]; then ok "列表返回多条 API（$N 条）"; else bad "多条 API 列表异常（$N）"; fi
R=$(curl -s -b "$JAR" -X PUT $BASE/api/admin/providers/llm/$P1 -H 'Content-Type: application/json' \
  -d '{"name":"冒烟线路 1","baseUrl":"http://127.0.0.1:9001/v1","model":"Lingshu-32B","extra":{"models":["Qwen3-8B","Lingshu-32B"]}}')
has "默认模型可单独设置" "$R" '"model":"Lingshu-32B"'
R=$(curl -s -b "$JAR" $BASE/api/me)
has "勾选的模型进入可选列表" "$R" 'Lingshu-32B'
has "暴露默认模型" "$R" '"defaultModel"'

echo "── 21. 多 API 轮询 ──"
R=$(curl -s -b "$JAR" -X PATCH $BASE/api/admin/providers/llm/routing -H 'Content-Type: application/json' -d '{"mode":"round_robin"}')
has "切换为轮询模式" "$R" 'round_robin'
curl -s $MOCK/__reset >/dev/null
for i in 1 2 3 4 5 6; do
  curl -sN -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' \
    -d "{\"content\":\"轮询 $i\",\"personaId\":$PID}" -m 20 >/dev/null
done
R=$(curl -s $MOCK/__log)
has "轮询用到线路 1 的 Key" "$R" 'aaa11'
has "轮询用到线路 2 的 Key" "$R" 'bbb22'
R=$(curl -s -b "$JAR" -X PATCH $BASE/api/admin/providers/llm/routing -H 'Content-Type: application/json' -d '{"mode":"failover"}')
has "可切回失败切换" "$R" 'failover'

echo "── 22. 设备 + IP 绑定（7 天会话）──"
JAR2=/tmp/smoke-bind.txt
rm -f "$JAR2"
R=$(login_via_code user2@test.com "$JAR2" 10001)
has "新设备验证码登录成功" "$R" '"role":"user"'
has "会话有效期 7 天" "$R" '"sessionDays":7'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR2" $BASE/api/me)
check "同设备同 IP 可继续访问" "$CODE" "200"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR2" -H 'X-Forwarded-For: 198.51.100.7' $BASE/api/me)
check "换 IP 后会话立即失效" "$CODE" "401"
R=$(login_via_code user2@test.com "$JAR2" 10001)
has "换 IP 后可重新验证码登录" "$R" '"role":"user"'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR2" $BASE/api/me)
check "重新登录后恢复访问" "$CODE" "200"
UID2=$(curl -s -b "$JAR" $BASE/api/admin/users | json "j.users.find(u=>u.email==='user2@test.com').id")
if [ -n "$UID2" ]; then ok "取到普通用户 id=$UID2"; else bad "未取到用户 id"; fi

echo "── 23. 封禁与告知 ──"
R=$(curl -s -b "$JAR" -X PATCH $BASE/api/admin/users/$UID2 -H 'Content-Type: application/json' \
  -d '{"ban":{"hours":1,"reason":"自动化测试封禁"}}')
has "按小时封禁成功" "$R" '"permanent":false'
R=$(curl -s -b "$JAR2" $BASE/api/auth/me)
has "被封禁用户看到封禁信息" "$R" '"banned"'
has "封禁原因可展示" "$R" '自动化测试封禁'
R=$(curl -s -b "$JAR2" $BASE/api/me)
has "封禁后接口返回 ACCOUNT_BANNED" "$R" 'ACCOUNT_BANNED'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR2" $BASE/api/me)
check "封禁后接口不可用" "$CODE" "403"
CAP=$(curl -s $BASE/api/auth/captcha); CID=$(echo "$CAP" | json "j.id"); CCODE=$(echo "$CAP" | json "j.devCode")
R=$(curl -s -X POST $BASE/api/auth/send-code -H 'Content-Type: application/json' \
  -d "{\"email\":\"user2@test.com\",\"captchaId\":\"$CID\",\"captchaCode\":\"$CCODE\",\"groupNumber\":\"10001\"}")
has "被封禁账号无法获取验证码" "$R" 'ACCOUNT_BANNED'
R=$(curl -s -b "$JAR" -X PATCH $BASE/api/admin/users/$UID2 -H 'Content-Type: application/json' -d '{"unban":true}')
has "解封成功" "$R" '"role":"user"'
R=$(login_via_code user2@test.com "$JAR2" 10001)
has "解封后可正常登录" "$R" '"role":"user"'

echo "── 24. 安全管理与反爬 ──"
R=$(curl -s -b "$JAR" $BASE/api/admin/security)
has "安全总览返回策略" "$R" '"registerGroupNumbers"'
has "安全总览返回统计" "$R" '"activeSessions"'
has "安全总览返回登录登记" "$R" '"logins"'
R=$(curl -s $BASE/robots.txt)
has "robots.txt 拒绝抓取" "$R" 'Disallow: /'
has "robots.txt 覆盖主流爬虫" "$R" 'GPTBot'
H=$(curl -s -D - -o /dev/null $BASE/)
has "响应头带 X-Robots-Tag" "$H" 'X-Robots-Tag: noindex'
has "响应头带 CSP" "$H" "frame-ancestors 'none'"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 203.0.113.55' "$BASE/__trap")
check "爬虫蜜罐返回 404" "$CODE" "404"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 203.0.113.55' $BASE/api/bootstrap)
check "触发蜜罐的 IP 被封禁" "$CODE" "403"
R=$(curl -s -b "$JAR" -X DELETE "$BASE/api/admin/security/block/203.0.113.55")
has "可解除 IP 封禁" "$R" '"ok":true'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 203.0.113.55' $BASE/api/bootstrap)
check "解封后恢复访问" "$CODE" "200"
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/security/block -H 'Content-Type: application/json' -d '{"ip":"198.51.100.9","minutes":10,"reason":"测试封禁"}')
has "手动封禁 IP" "$R" '"ok":true'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 198.51.100.9' $BASE/api/bootstrap)
check "被封禁 IP 被挡在入口" "$CODE" "403"
curl -s -b "$JAR" -X DELETE "$BASE/api/admin/security/block/198.51.100.9" >/dev/null

echo "── 25. 异常流量自动封禁 ──"
curl -s -b "$JAR" -X PUT $BASE/api/admin/security/settings -H 'Content-Type: application/json' \
  -d '{"rateLimit":30,"autoBlock":true,"autoBlockMinutes":1}' >/dev/null
for i in $(seq 1 36); do
  curl -s -o /dev/null -H 'X-Forwarded-For: 198.51.100.88' $BASE/api/bootstrap
done
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 198.51.100.88' $BASE/api/bootstrap)
if [ "$CODE" = "403" ] || [ "$CODE" = "429" ]; then ok "超阈值后被限制（HTTP $CODE）"; else bad "异常流量未触发限制（HTTP $CODE）"; fi
R=$(curl -s -b "$JAR" $BASE/api/admin/security)
has "异常流量写入安全事件" "$R" 'traffic_spike'
curl -s -b "$JAR" -X DELETE "$BASE/api/admin/security/block/198.51.100.88" >/dev/null
curl -s -b "$JAR" -X PUT $BASE/api/admin/security/settings -H 'Content-Type: application/json' \
  -d '{"rateLimit":600,"autoBlock":true,"autoBlockMinutes":30}' >/dev/null

echo "── 26. 接口用量与额度 ──"
MOCK=http://127.0.0.1:9001

# 准备 3 个可用账号（管理员 + user1 + user2），确保额度能被真实分摊
USER1_ID=$(curl -s -b "$JAR" $BASE/api/admin/users | json "j.users.find(u=>u.email==='user1@test.com').id")
curl -s -b "$JAR" -X PATCH $BASE/api/admin/users/$USER1_ID -H 'Content-Type: application/json' -d '{"status":"active"}' >/dev/null
rm -f /tmp/u1pw.txt /tmp/u2pw.txt
R=$(pw_login user1@test.com /tmp/u1pw.txt test12345)
has "user1 可用密码登录" "$R" '"role":"user"'
R=$(pw_login user2@test.com /tmp/u2pw.txt test12345)
has "user2 可用密码登录" "$R" '"role":"user"'
N=$(curl -s -b "$JAR" $BASE/api/admin/users | json "j.users.filter(u=>u.status==='active').length")
check "当前活跃账号数为 3" "$N" "3"

R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/providers/search -H 'Content-Type: application/json' -d "{
  \"name\":\"额度测试搜索\",\"baseUrl\":\"$MOCK/tavily\",\"apiKey\":\"tvly-quota\",
  \"extra\":{\"path\":\"/search\",\"method\":\"POST\",
    \"auth\":{\"type\":\"header\",\"name\":\"Authorization\",\"prefix\":\"Bearer \"},
    \"headers\":{\"Content-Type\":\"application/json\"},
    \"body\":{\"query\":\"{{query}}\",\"max_results\":\"{{limit}}\",\"search_depth\":\"basic\"},
    \"resultPath\":\"results\",\"fieldMap\":{\"title\":\"title\",\"url\":\"url\",\"snippet\":\"content\"},
    \"quota\":{\"group\":\"smoke-quota\",\"monthly\":10,\"unit\":\"credit\",\"price\":0.008,\"currency\":\"USD\",\"warnAt\":90}}}")
QID=$(echo "$R" | json "j.provider.id")
if [ -n "$QID" ]; then ok "创建带额度的搜索接口（id=$QID）"; else bad "创建失败"; fi
has "额度配置已保存" "$R" '"group":"smoke-quota"'

# 只保留这一条搜索接口，避免请求落到别的线路
R=$(curl -s -b "$JAR" $BASE/api/admin/providers/search)
for id in $(echo "$R" | json "j.entries.map(e=>e.id).join(' ')"); do
  [ "$id" = "$QID" ] || curl -s -b "$JAR" -X PUT $BASE/api/admin/providers/search/$id \
    -H 'Content-Type: application/json' -d '{"enabled":false}' >/dev/null
done

# 3 个账号各用 3 次，合计 9/10 = 90%
for jar in "$JAR" /tmp/u1pw.txt /tmp/u2pw.txt; do
  for i in 1 2 3; do
    curl -s -b "$jar" -X POST $BASE/api/tools/search -H 'Content-Type: application/json' -d '{"query":"quota"}' >/dev/null
  done
done
R=$(curl -s -b "$JAR" $BASE/api/admin/usage)
has "用量按次累计为 9" "$R" '"used":9'
has "额度达到 90% 标记预警" "$R" '"status":"warn"'
has "已记录告警通知" "$R" '"notifiedAt"'
COST=$(echo "$R" | json "j.items.find(x=>x.group==='smoke-quota').costText")
if [ "$COST" = '$0.07' ]; then ok "费用按 9 × \$0.008 估算（$COST）"; else bad "费用估算异常（$COST）"; fi

URL=$(echo "$R" | json "j.items.find(x=>x.group==='smoke-quota').disableUrl")
CODE=$(curl -s -o /tmp/quota-confirm.html -w '%{http_code}' "$URL")
check "邮件链接先到确认页" "$CODE" "200"
has "确认页不会直接执行" "$(cat /tmp/quota-confirm.html)" '确认关闭该接口'
QUERY=$(echo "$URL" | sed 's/.*?//')
CODE=$(curl -s -o /tmp/quota-action.html -w '%{http_code}' -X POST $BASE/api/quota/action \
  -H 'Content-Type: application/x-www-form-urlencoded' -d "$QUERY")
check "确认后执行关闭" "$CODE" "200"
has "关闭结果页" "$(cat /tmp/quota-action.html)" '接口已关闭'
R=$(curl -s -b "$JAR" $BASE/api/admin/providers/search)
DIS=$(echo "$R" | json "j.entries.find(e=>e.id===$QID).enabled")
check "接口已被关闭" "$DIS" "false"

curl -s -b "$JAR" -X PUT $BASE/api/admin/providers/search/$QID -H 'Content-Type: application/json' -d '{"enabled":true}' >/dev/null
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/usage/reset -H 'Content-Type: application/json' -d '{"scope":"g:smoke-quota"}')
USED=$(echo "$R" | json "j.items.find(x=>x.group==='smoke-quota').used")
check "重置后本月用量归零" "$USED" "0"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/quota/action?scope=g:smoke-quota&period=2026-01&act=disable&exp=9999999999999&sig=bad")
check "伪造签名的操作链接被拒绝" "$CODE" "400"

echo "── 27. 共享额度按账号平分 ──"
N=$(curl -s -b "$JAR" $BASE/api/admin/users | json "j.users.filter(u=>u.status==='active').length")
if [ "$N" -ge 2 ]; then ok "当前活跃账号数 N=$N"; else bad "活跃账号数异常（$N）"; fi
QUOTA_TOTAL=$((2 * N))
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/providers/search -H 'Content-Type: application/json' -d "{
  \"name\":\"平分测试搜索\",\"baseUrl\":\"$MOCK/tavily\",\"apiKey\":\"tvly-split\",
  \"extra\":{\"path\":\"/search\",\"method\":\"POST\",
    \"auth\":{\"type\":\"header\",\"name\":\"Authorization\",\"prefix\":\"Bearer \"},
    \"headers\":{\"Content-Type\":\"application/json\"},
    \"body\":{\"query\":\"{{query}}\",\"max_results\":\"{{limit}}\",\"search_depth\":\"basic\"},
    \"resultPath\":\"results\",\"fieldMap\":{\"title\":\"title\",\"url\":\"url\",\"snippet\":\"content\"},
    \"quota\":{\"group\":\"split-test\",\"monthly\":$QUOTA_TOTAL,\"unit\":\"credit\",\"price\":0.008,\"currency\":\"USD\",\"warnAt\":90}}}")
QID2=$(echo "$R" | json "j.provider.id")
if [ -n "$QID2" ]; then ok "创建平分测试接口（总额度 $QUOTA_TOTAL，每人 2）"; else bad "创建失败"; fi
R=$(curl -s -b "$JAR" $BASE/api/admin/providers/search)
for id in $(echo "$R" | json "j.entries.map(e=>e.id).join(' ')"); do
  [ "$id" = "$QID2" ] || curl -s -b "$JAR" -X PUT $BASE/api/admin/providers/search/$id \
    -H 'Content-Type: application/json' -d '{"enabled":false}' >/dev/null
done

# 管理员本人 2 次成功、第 3 次被拦
for i in 1 2; do
  R=$(curl -s -b "$JAR" -X POST $BASE/api/tools/search -H 'Content-Type: application/json' -d '{"query":"split"}')
  has "管理员第 $i 次可用" "$R" 'Tavily 结果 A'
done
R=$(curl -s -b "$JAR" -X POST $BASE/api/tools/search -H 'Content-Type: application/json' -d '{"query":"split"}')
has "管理员超出个人份额被拦" "$R" 'QUOTA_EXCEEDED'
has "提示平分规则" "$R" '平均分配'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST $BASE/api/tools/search \
  -H 'Content-Type: application/json' -d '{"query":"split"}')
check "超额返回 402" "$CODE" "402"

# 另一个账号还有自己的 2 次
rm -f /tmp/split2.txt
R=$(pw_login user2@test.com /tmp/split2.txt test12345)
has "第二账号登录成功" "$R" '"role":"user"'
for i in 1 2; do
  R=$(curl -s -b /tmp/split2.txt -X POST $BASE/api/tools/search -H 'Content-Type: application/json' -d '{"query":"split2"}')
  has "第二账号第 $i 次可用" "$R" 'Tavily 结果 A'
done
R=$(curl -s -b /tmp/split2.txt -X POST $BASE/api/tools/search -H 'Content-Type: application/json' -d '{"query":"split2"}')
has "第二账号超出份额被拦" "$R" 'QUOTA_EXCEEDED'

R=$(curl -s -b /tmp/split2.txt $BASE/api/me/quota)
has "个人额度页显示平分份额" "$R" '"share":2'
has "个人额度页显示账号数" "$R" "\"users\":$N"
R=$(curl -s -b "$JAR" $BASE/api/admin/usage)
has "后台用量含每人份额" "$R" '"shareText":"2"'
has "后台列出使用者用量" "$R" 'user2@test.com'

echo "── 28. 密码修改必须过邮箱验证码 ──"
R=$(curl -s -b /tmp/split2.txt -X POST $BASE/api/auth/password -H 'Content-Type: application/json' \
  -d '{"newPassword":"newpass123"}')
has "密码会话无验证码不能改密" "$R" '邮箱验证码'
rm -f /tmp/code2.txt
R=$(login_via_code user2@test.com /tmp/code2.txt 10001 test12345)
has "验证码会话登录成功" "$R" '"role":"user"'
R=$(curl -s -b /tmp/code2.txt -X POST $BASE/api/auth/password -H 'Content-Type: application/json' \
  -d '{"newPassword":"test12345"}')
has "验证码会话也无绕过改密" "$R" '邮箱验证码'

R=$(curl -s -b "$JAR" -X PUT $BASE/api/admin/security/settings -H 'Content-Type: application/json' -d '{"userProvidersOpen":false}')
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/code2.txt -X POST $BASE/api/me/providers/llm \
  -H 'Content-Type: application/json' -d '{"name":"y","baseUrl":"http://127.0.0.1:9001/v1","apiKey":"k"}')
check "关闭后重新拦截" "$CODE" "403"

echo "── 29. 全体邮件（权限与校验，不发信）──"
R=$(curl -s -b "$JAR" $BASE/api/admin/broadcast)
has "管理员可读全体邮件概况" "$R" '"recipientCount"'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/code2.txt $BASE/api/admin/broadcast)
check "普通用户不能读全体邮件" "$CODE" "403"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/code2.txt -X POST $BASE/api/admin/broadcast \
  -H 'Content-Type: application/json' -d '{"subject":"x","content":"y"}')
check "普通用户不能群发" "$CODE" "403"
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/broadcast -H 'Content-Type: application/json' -d '{"subject":"","content":""}')
has "空主题被拒绝" "$R" '请填写邮件主题'
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/broadcast -H 'Content-Type: application/json' -d '{"subject":"x","content":""}')
has "空正文被拒绝" "$R" '请填写邮件正文'
R=$(curl -s -b "$JAR" -X POST --data-binary 'not-an-image' -H 'Content-Type: text/plain' \
  -H 'X-File-Name: a.txt' $BASE/api/admin/broadcast/image)
has "非图片配图被拒绝" "$R" '只支持'
R=$(curl -s -b "$JAR" -X POST --data-binary @web/logo-email.png -H 'Content-Type: image/png' \
  -H 'X-File-Name: logo-email.png' $BASE/api/admin/broadcast/image)
has "配图上传成功" "$R" '"id"'
IMGID=$(echo "$R" | json "j.image.id")
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $BASE/api/admin/broadcast/image/$IMGID)
check "管理员可读取配图" "$CODE" "200"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/code2.txt $BASE/api/admin/broadcast/image/$IMGID)
check "普通用户不能读配图" "$CODE" "403"
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/broadcast/preview -H 'Content-Type: application/json' -d '{"subject":"x"}')
has "预览缺正文被拒绝" "$R" '请填写主题和正文'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $BASE/api/admin/broadcast/999999)
check "不存在的任务返回 404" "$CODE" "404"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X POST $BASE/api/admin/broadcast/999999/cancel)
check "取消不存在的任务返回 404" "$CODE" "404"


echo "── 30. 公告 / App 版本 / 后台聊天记录 ──"
R=$(curl -s -b "$JAR" $BASE/api/admin/announcements)
has "管理员可读公告列表" "$R" '"items"'
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/announcements -H 'Content-Type: application/json' -d '{"title":"","content":""}')
has "空公告被拒绝" "$R" '公告标题'
R=$(curl -s -b "$JAR" -X POST --data-binary @web/logo-email.png -H 'Content-Type: image/png' \
  -H 'X-File-Name: ann.png' $BASE/api/admin/announcements/image)
has "公告配图上传成功" "$R" '"mime":"image/png"'
ANNIMG=$(echo "$R" | json "j.image.id")
R=$(curl -s -b "$JAR" -X POST $BASE/api/admin/announcements -H 'Content-Type: application/json' \
  -d "{\"title\":\"自检公告\",\"content\":\"第一行\\n第二行\",\"tone\":\"important\",\"enabled\":true,\"imageId\":$ANNIMG}")
has "创建公告" "$R" '自检公告'
ANNID=$(echo "$R" | json "j.item.id")
R=$(curl -s -b "$JAR" $BASE/api/announcements/active)
has "用户侧读到当前公告" "$R" '自检公告'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" $BASE/api/announcements/$ANNID/image)
check "公告配图可读取" "$CODE" "200"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/code2.txt $BASE/api/admin/announcements)
check "普通用户不能管理公告" "$CODE" "403"
R=$(curl -s -b /tmp/code2.txt $BASE/api/announcements/active)
has "普通用户能看到公告" "$R" '自检公告'
R=$(curl -s -b "$JAR" -X PUT $BASE/api/admin/announcements/$ANNID -H 'Content-Type: application/json' \
  -d "{\"title\":\"自检公告\",\"content\":\"已停用\",\"tone\":\"info\",\"enabled\":false,\"imageId\":$ANNIMG}")
has "公告可停用" "$R" '"enabled":false'
R=$(curl -s -b "$JAR" $BASE/api/announcements/active)
has "停用后用户侧不再返回" "$R" '"announcement":null'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -X DELETE $BASE/api/admin/announcements/$ANNID)
check "公告可删除" "$CODE" "200"
R=$(curl -s $BASE/api/app/version)
has "App 版本接口" "$R" '"versionCode"'
has "App 下载地址" "$R" '"url"'

R=$(curl -s -b "$JAR" -X POST $BASE/api/conversations -H 'Content-Type: application/json' -d '{"title":"后台审计测试"}')
CHATCID=$(echo "$R" | json "j.conversation.id")
R=$(curl -s -b "$JAR" $BASE/api/admin/users/1/conversations)
has "后台可列用户会话" "$R" '后台审计测试'
R=$(curl -s -b "$JAR" $BASE/api/admin/users/1/conversations/$CHATCID)
has "后台可读会话消息" "$R" '"messages"'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -b /tmp/code2.txt $BASE/api/admin/users/1/conversations)
check "普通用户不能看他人会话" "$CODE" "403"
curl -s -b "$JAR" -X DELETE $BASE/api/conversations/$CHATCID >/dev/null
MSGLEFT=$(node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('$DATA/app.db');
console.log(db.prepare('SELECT COUNT(*) c FROM messages WHERE conversation_id = ?').get($CHATCID).c);
")
check "删除会话后消息不留在数据库" "$MSGLEFT" "0"


echo ""
echo "── 30. 重设密码需邮箱验证码 ──"
R=$(curl -s -b "$JAR" -X POST $BASE/api/auth/send-code -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","mode":"reset"}')
has "重设密码发码" "$R" '"devCode"'
RCODE=$(echo "$R" | json "j.devCode")
R=$(curl -s -b "$JAR" -X POST $BASE/api/auth/password -H 'Content-Type: application/json' \
  -d '{"newPassword":"newpass123"}')
has "无验证码不能改密码" "$R" '邮箱验证码'
R=$(curl -s -b "$JAR" -X POST $BASE/api/auth/password -H 'Content-Type: application/json' \
  -d "{\"code\":\"$RCODE\",\"newPassword\":\"newpass123\"}")
has "邮箱验证码重设密码" "$R" '"ok":true'

echo ""
echo "════ 结果：通过 $pass 项，失败 $fail 项 ════"
[ "$fail" -eq 0 ] || { echo "--- 服务端日志 ---"; tail -25 /tmp/app.log; }
exit 0
