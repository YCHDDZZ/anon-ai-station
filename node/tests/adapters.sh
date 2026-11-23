#!/usr/bin/env bash
# 验证「API集合」里六类真实接口的适配器形态（用本地 mock 模拟各厂商返回结构）
set -u
cd "$(dirname "$0")/.."

BASE=http://127.0.0.1:8787
MOCK=http://127.0.0.1:9001
JAR=/tmp/adm.txt
rm -f "$JAR"

pass=0; fail=0
ok()  { pass=$((pass+1)); printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad() { fail=$((fail+1)); printf "  \033[31m✘\033[0m %s\n" "$1"; }
has() { if echo "$2" | grep -q "$3"; then ok "$1"; else bad "$1（未找到 $3）"; fi; }
nhas(){ if echo "$2" | grep -q "$3"; then bad "$1（不应出现 $3）"; else ok "$1"; fi; }

node --no-warnings tests/mock-upstream.mjs >/tmp/mock.log 2>&1 &
APP_SECRET="${APP_SECRET:-release-smoke-secret-0123456789abcdef}" ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}" ADMIN_PASSWORD="${ADMIN_PASSWORD:-Test123456!}" node --no-warnings server/index.js >/tmp/app.log 2>&1 &
sleep 4

source tests/lib.sh
login_via_code admin@example.com "$JAR" >/dev/null
# 适配器用用户级配置验证多 Key / 调度；临时打开自建开关（结束时恢复）
curl -s -b "$JAR" -X PUT $BASE/api/admin/security/settings -H 'Content-Type: application/json' -d '{"userProvidersOpen":true}' >/dev/null

echo "── 1. Tavily 搜索 ──"
curl -s -b "$JAR" -X PUT $BASE/api/me/providers/search -H 'Content-Type: application/json' -d "{
  \"name\":\"Tavily 搜索\",\"baseUrl\":\"$MOCK/tavily\",\"apiKey\":\"tvly-test\",
  \"extra\":{\"path\":\"/search\",\"method\":\"POST\",
    \"auth\":{\"type\":\"header\",\"name\":\"Authorization\",\"prefix\":\"Bearer \"},
    \"headers\":{\"Content-Type\":\"application/json\"},
    \"body\":{\"query\":\"{{query}}\",\"max_results\":\"{{limit}}\",\"search_depth\":\"basic\"},
    \"resultPath\":\"results\",
    \"fieldMap\":{\"title\":\"title\",\"url\":\"url\",\"snippet\":\"content\"}}}" >/dev/null
R=$(curl -s -b "$JAR" -X POST $BASE/api/tools/search -H 'Content-Type: application/json' -d '{"query":"测试","limit":6}')
has "返回结果已归一化" "$R" 'Tavily 结果 A'
has "max_results 仍是数字类型" "$R" '"ok":true'

echo "── 2. Tavily 网页提取 ──"
curl -s -b "$JAR" -X PUT $BASE/api/me/providers/crawl -H 'Content-Type: application/json' -d "{
  \"name\":\"Tavily 提取\",\"baseUrl\":\"$MOCK/tavily\",\"apiKey\":\"tvly-test\",
  \"extra\":{\"path\":\"/extract\",\"method\":\"POST\",
    \"auth\":{\"type\":\"header\",\"name\":\"Authorization\",\"prefix\":\"Bearer \"},
    \"headers\":{\"Content-Type\":\"application/json\"},
    \"body\":{\"urls\":[\"{{url}}\"],\"format\":\"markdown\"},
    \"textPath\":\"results.0.raw_content\"}}" >/dev/null
R=$(curl -s -b "$JAR" -X POST $BASE/api/tools/crawl -H 'Content-Type: application/json' -d '{"url":"https://example.com/a"}')
has "取到正文（数组内路径）" "$R" '这是提取出来的网页正文'

echo "── 3. SiliconFlow 视觉 OCR ──"
curl -s -b "$JAR" -X PUT $BASE/api/me/providers/ocr -H 'Content-Type: application/json' -d "{
  \"name\":\"SF OCR\",\"baseUrl\":\"$MOCK/sf/v1\",\"apiKey\":\"sk-test\",\"model\":\"deepseek-ai/DeepSeek-OCR\",
  \"extra\":{\"mode\":\"vision\",\"path\":\"/chat/completions\",\"method\":\"POST\",
    \"auth\":{\"type\":\"header\",\"name\":\"Authorization\",\"prefix\":\"Bearer \"},
    \"headers\":{\"Content-Type\":\"application/json\"},
    \"body\":{\"model\":\"{{model}}\",\"messages\":[{\"role\":\"user\",\"content\":[
      {\"type\":\"image_url\",\"image_url\":{\"url\":\"{{imageUrl}}\",\"detail\":\"high\"}},
      {\"type\":\"text\",\"text\":\"{{prompt}}\"}]}],\"stream\":false},
    \"textPath\":\"choices.0.message.content\",
    \"prompt\":\"请提取图片中的全部文字\"}}" >/dev/null
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > /tmp/px.png
R=$(curl -s -b "$JAR" -X POST "$BASE/api/files?name=px.png" \
  -H 'Content-Type: image/png' -H 'X-File-Name: px.png' -H 'X-File-Type: image/png' --data-binary @/tmp/px.png)
has "图片走 vision 模式" "$R" '"parseMode":"ocr"'
nhas "视觉接口确有文本产出" "$R" '"textLength":0'

echo "── 4. 小米 MiMo 语音合成 ──"
curl -s -b "$JAR" -X PUT $BASE/api/me/providers/tts -H 'Content-Type: application/json' -d "{
  \"name\":\"MiMo TTS\",\"baseUrl\":\"$MOCK/mimo/v1\",\"apiKey\":\"sk-test\",\"model\":\"mimo-v2.5-tts\",
  \"extra\":{\"mode\":\"chat-audio\",\"path\":\"/chat/completions\",\"method\":\"POST\",
    \"auth\":{\"type\":\"header\",\"name\":\"Authorization\",\"prefix\":\"Bearer \"},
    \"headers\":{\"Content-Type\":\"application/json\"},
    \"body\":{\"model\":\"{{model}}\",\"messages\":[{\"role\":\"assistant\",\"content\":\"{{text}}\"}],
      \"audio\":{\"format\":\"wav\",\"voice\":\"{{voice}}\"},\"stream\":false},
    \"audioPath\":\"choices.0.message.audio.data\",\"audioMime\":\"audio/wav\",
    \"defaultVoice\":\"冰糖\",\"voices\":[{\"id\":\"冰糖\",\"label\":\"冰糖\"}]}}" >/dev/null
CODE=$(curl -s -o /tmp/tts.out -w '%{http_code}' -b "$JAR" -X POST $BASE/api/chat/tts -H 'Content-Type: application/json' -d '{"text":"你好"}')
SIZE=$(wc -c < /tmp/tts.out | tr -d ' ')
if [ "$CODE" = "200" ] && [ "$SIZE" -gt 10 ]; then ok "返回音频二进制（$SIZE 字节）"; else bad "音频未返回（code=$CODE size=$SIZE）"; fi
has "音频内容正确" "$(cat /tmp/tts.out)" 'RIFFfake-wav'

echo "── 5. 模力方舟语音识别 ──"
curl -s -b "$JAR" -X PUT $BASE/api/me/providers/asr -H 'Content-Type: application/json' -d "{
  \"name\":\"Moark ASR\",\"baseUrl\":\"$MOCK/moark/v1\",\"apiKey\":\"test\",\"model\":\"SenseVoiceSmall\",
  \"extra\":{\"path\":\"/audio/transcriptions\",\"method\":\"POST\",
    \"auth\":{\"type\":\"header\",\"name\":\"Authorization\",\"prefix\":\"Bearer \"},
    \"fileField\":\"file\",\"fields\":{\"model\":\"{{model}}\",\"language\":\"zh\"},
    \"textPath\":\"text\"}}" >/dev/null
printf 'RIFFfake-audio' > /tmp/a.wav
R=$(curl -s -b "$JAR" -X POST $BASE/api/tools/asr \
  -H 'Content-Type: audio/wav' -H 'X-File-Name: a.wav' -H 'X-File-Type: audio/wav' --data-binary @/tmp/a.wav)
has "返回能力来源" "$R" '"provider":"Moark ASR"'
has "转写文本被解析" "$R" '这是模力方舟转写的文字'

echo "── 6. 模型白名单 ──"
R=$(curl -s -b "$JAR" $BASE/api/me)
has "对外暴露模型清单" "$R" '"llmModels"'
has "暴露音色清单" "$R" '"ttsVoices"'

echo "── 7. 模型白名单 ──"
curl -s -b "$JAR" -X PUT $BASE/api/me/providers/llm -H 'Content-Type: application/json' -d "{
  \"name\":\"Mock LLM\",\"baseUrl\":\"$MOCK/v1\",\"apiKey\":\"sk-test\",\"model\":\"Qwen3-8B\",
  \"extra\":{\"path\":\"/chat/completions\",\"models\":[\"Qwen3-8B\",\"Lingshu-32B\"]}}" >/dev/null
PID=$(curl -s -b "$JAR" $BASE/api/personas | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log(JSON.parse(s).global[0].id)})")
R=$(curl -sN -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d "{\"content\":\"hi\",\"personaId\":$PID,\"model\":\"Lingshu-32B\"}" -m 20)
has "白名单内的模型被采用" "$R" 'm=Lingshu-32B'
R=$(curl -sN -b "$JAR" -X POST $BASE/api/chat -H 'Content-Type: application/json' \
  -d "{\"content\":\"hi\",\"personaId\":$PID,\"model\":\"some-evil-model\"}" -m 20)
has "白名单外的模型回落到默认" "$R" 'm=Qwen3-8B'
nhas "不会把非法模型透传给上游" "$R" 'm=some-evil-model'

# 清理：移除测试用的用户级能力，恢复走全局配置
for c in llm; do curl -s -b "$JAR" -X DELETE $BASE/api/me/providers/$c >/dev/null; done
for c in search crawl ocr tts asr; do
  curl -s -b "$JAR" -X DELETE $BASE/api/me/providers/$c >/dev/null
done
echo "（已清理测试用的用户级配置）"
curl -s -b "$JAR" -X PUT $BASE/api/admin/security/settings -H 'Content-Type: application/json' -d '{"userProvidersOpen":false}' >/dev/null

echo ""
echo "════ 适配器测试：通过 $pass 项，失败 $fail 项 ════"
[ "$fail" -eq 0 ] || tail -20 /tmp/app.log
exit 0
