#!/usr/bin/env bash
# 测试公共函数：图形验证码 + 邮箱验证码登录
# 用法：source tests/lib.sh; login_via_code 邮箱  CookieJar  群号

BASE=${BASE:-http://127.0.0.1:8787}

_jget() {
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);console.log(eval(process.argv[1]))}catch(e){console.log('')}})" "$1"
}

# 取一张图形验证码，回显 {id}\n{code}
captcha_pair() {
  local jar=$1
  curl -s -c "$jar" -b "$jar" "$BASE/api/auth/captcha"
}

# 完整登录流程，输出 /api/auth/verify 的响应
login_via_code() {
  local email=$1 jar=$2 group=${3:-} pw=${4:-test12345}
  local c id code send ecode c2 id2 code2
  c=$(captcha_pair "$jar")
  id=$(printf '%s' "$c" | _jget "o.id")
  code=$(printf '%s' "$c" | _jget "o.devCode")
  send=$(curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/auth/send-code" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"captchaId\":\"$id\",\"captchaCode\":\"$code\",\"groupNumber\":\"$group\"}")
  ecode=$(printf '%s' "$send" | _jget "o.devCode||''")
  c2=$(captcha_pair "$jar")
  id2=$(printf '%s' "$c2" | _jget "o.id")
  code2=$(printf '%s' "$c2" | _jget "o.devCode")
  curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/auth/verify" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"code\":\"$ecode\",\"password\":\"$pw\",\"captchaId\":\"$id2\",\"captchaCode\":\"$code2\",\"groupNumber\":\"$group\"}"
}

# 密码登录（需要图形验证码），输出 verify 响应
pw_login() {
  local email=$1 jar=$2 pw=$3
  local c id code
  c=$(captcha_pair "$jar")
  id=$(printf '%s' "$c" | _jget "o.id")
  code=$(printf '%s' "$c" | _jget "o.devCode")
  curl -s -c "$jar" -b "$jar" -X POST "$BASE/api/auth/password-login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pw\",\"captchaId\":\"$id\",\"captchaCode\":\"$code\"}"
}
