# Node.js 版

零第三方依赖，只用 Node 内置模块：`node:http`、`node:sqlite`、`node:crypto`、`node:tls`。
前端是原生 ES 模块，服务端直接托管，无需构建。

## 依赖

- Node.js ≥ 22.5（需要内置 `node:sqlite`）
- 无需 `npm install`

## 启动

```bash
cp .env.example .env
# 至少填写：APP_SECRET / ADMIN_EMAIL / ADMIN_PASSWORD
npm start
```

默认监听 `http://localhost:8787`。

## 配置

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口，默认 8787 |
| `APP_SECRET` | 32 字节 hex，用于加密数据库里的第三方 Key，**必填** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 首次启动创建管理员 |
| `SMTP_*` | 邮箱验证码；QQ 邮箱填授权码 |
| `MARKET_API_KEYS` | 角色卡市场 Key，多个逗号分隔 |
| `MAX_FILE_MB` | 单文件上限，默认 30 |

生产环境务必关闭 `MAIL_DEV_FALLBACK` 与 `CAPTCHA_DEV_ECHO`。

## 数据

默认 SQLite：`data/app.db`，上传文件在 `data/uploads/`。
启动时自动迁移建表，不需要手动执行 SQL。

## 反向代理

SSE 需要关闭缓冲，例如 nginx：

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_buffering off;
  proxy_read_timeout 3600s;
  client_max_body_size 30m;
}
```

## 测试

```bash
bash tests/smoke.sh
```

测试使用独立临时库与 mock 上游，不会调用真实模型；管理员账号需与 `.env` 中的 `ADMIN_EMAIL` 一致。
