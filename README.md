<p align="center">
  <img src="logo.png" width="104" alt="AI 对话站 Logo" />
</p>

<h1 align="center">AI 对话站</h1>

<p align="center"><strong>一个仓库，三端可用</strong></p>

<p align="center">
  <a href="https://github.com/YCHDDZZ/anon-ai-station/releases/tag/v1.1.0"><img src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-v1.1.0-2563EB?style=flat-square" alt="版本" /></a>
  <a href="#快速开始"><img src="https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows%20%C2%B7%20Linux%20%C2%B7%20Android-0F172A?style=flat-square" alt="平台" /></a>
  <a href="#项目结构"><img src="https://img.shields.io/badge/%E6%9E%B6%E6%9E%84-%E5%8D%95%E4%BB%93%E5%BA%93%20%C2%B7%20%E4%B8%89%E7%AB%AF-334155?style=flat-square" alt="架构" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF-MIT-A16207?style=flat-square" alt="许可" /></a>
</p>

<p align="center">
  <a href="#项目结构">项目结构</a> · <a href="#功能一览">功能一览</a> · <a href="#快速开始">快速开始</a> · <a href="#环境变量">环境变量</a> · <a href="#角色卡广场">角色卡广场</a> · <a href="#安全与隐私">安全与隐私</a> · <a href="https://github.com/YCHDDZZ/anon-ai-station/releases/tag/v1.1.0">下载</a>
</p>

**AI 对话站**是一个多用户 AI 对话系统的开源实现，把 Node.js 服务端、PHP 服务端和安卓客户端放进同一个仓库。两个服务端共用同一份前端，接口一一对应，功能基本对齐；安卓端只是一个 WebView 壳，连到你部署好的站点即可使用。

三端都是**密钥自配**的设计：仓库里没有任何内置 API Key、数据库、上传文件或签名证书。所有第三方能力都要你自己填写凭据后才能启用。

> [!NOTE]
>
> 这是一个可以直接部署的站点，不是一个开箱即用的 SaaS。你需要一台机器（或虚拟主机）和一个域名，并按 [环境变量](#环境变量) 完成初始配置。

## 项目结构

| 目录 | 内容 | 运行方式 |
| --- | --- | --- |
| [`node/`](node/) | Node.js 服务端 + 前端，零第三方依赖 | Node.js ≥ 22.5，`npm start` |
| [`php/`](php/) | PHP 服务端 + 前端，单入口 API | PHP ≥ 8.1 + MySQL / SQLite |
| [`android/`](android/) | 安卓 WebView 客户端源码 | Android SDK，minSdk 24 |

两个服务端的前端文件 `app.js` / `styles.css` 完全一致；后端路由覆盖认证、聊天、文件、角色、额度、公告、广播、反馈、角色卡广场等同一组能力。

## 功能一览

| 分类 | 能力 |
| --- | --- |
| 账号 | 邮箱验证码 / 密码登录、图形验证码、管理员与普通用户分级、设备与 IP 绑定 |
| 对话 | SSE 流式输出、深度思考、联网搜索、Markdown 渲染、会话导入导出 |
| 工具 | 文件上传与解析、OCR、TTS、ASR、阿里云账单读取 |
| 角色 | 全局角色与个人角色、新对话选择角色、角色卡广场搜索与详情、一键添加 |
| 运营 | 共享算力池、用量统计、额度告警、公告、广播、用户管理、安全封禁 |
| 反馈 | 用户图文反馈、后台按用户归类的收件箱、标记处理与删除 |
| 客户端 | 启动自检、登录态保持、应用内更新、文件与麦克风权限 |

## 快速开始

### Node 版

零第三方依赖，只用 Node 内置模块；`web/` 是原生 ES 模块，服务端直接托管，无需构建。

```bash
cd node
cp .env.example .env      # 填写 APP_SECRET / ADMIN_EMAIL / ADMIN_PASSWORD
npm start                 # 默认 http://localhost:8787
```

首次启动自动建表。反向代理需要关闭 SSE 缓冲，示例见 [`node/README.md`](node/README.md)。

### PHP 版

适合普通虚拟主机 / 宝塔 / LNMP 环境，站点根目录指向 `php/public/`：

```bash
cd php
cp .env.example .env      # 填写数据库、APP_SECRET、管理员账号
```

所有接口统一走单入口 `/api/index.php?p=/api/xxx`；`data/` 目录需要可写。nginx 请把 `client_max_body_size` 设到 10MB 以上，否则图片上传会返回 413。

### 安卓客户端

编译前把 `android/java/com/chihaya/anon/MainActivity.java` 里的 `BASE_URL` 改成你的站点地址，然后按 [`android/README.md`](android/README.md) 用 Android SDK 编译。脚本会自动生成演示用签名证书，正式发布请换成自己的证书。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `APP_SECRET` | 32 字节随机串，用于加密数据库中的第三方 Key，**必填** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | 首次启动创建的管理员账号 |
| `MARKET_API_KEYS` | 角色卡市场 Key，多个用逗号分隔；可留空 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | 邮箱验证码发送；QQ 邮箱填授权码 |
| `PUBLIC_URL` | 对外访问地址，用于额度告警邮件里的链接 |
| `PORT`（Node） | 监听端口，默认 8787 |

完整列表见 [`node/.env.example`](node/.env.example) 与 [`php/.env.example`](php/.env.example)。

> [!IMPORTANT]
>
> 生产环境务必关闭 `MAIL_DEV_FALLBACK` 与 `CAPTCHA_DEV_ECHO`，否则验证码会直接回显到接口。

## 角色卡广场

角色卡数据会按 ID 批量拉取并缓存到本地，之后浏览、搜索、详情都读本地库，不再受上游频率限制。

上游 Key 每个每天 500 次，服务端按轮询方式使用：

- 在 `.env` 里用 `MARKET_API_KEYS=key1,key2,key3` 配置任意多个
- 每次请求换下一个 Key，跨天自动清零计数
- 某个 Key 失效或超限会自动跳过，全部不可用时给出明确提示
- 缓存命中不消耗额度

不配置 `MARKET_API_KEYS` 也能正常使用其他所有功能，只是角色卡广场会提示未配置。

## 安全与隐私

> [!CAUTION]
>
> 本仓库不包含任何 API Key、管理员密码、数据库、上传文件或安卓签名证书。请不要把 `.env`、`data/`、证书或 APK 提交进来，`.gitignore` 已做排除。

- 所有第三方 Key 只保存在服务端，前端拿不到
- 测试脚本使用占位账号 `admin@example.com`，需要与你配置的 `ADMIN_EMAIL` 一致才能跑通
- 角色卡内容版权归原作者，本项目只做接口对接与展示
- 安卓客户端编译时需要自行填入站点域名

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [`node/README.md`](node/README.md) | Node 版配置、反向代理与测试 |
| [`php/README.md`](php/README.md) | PHP 版部署、nginx 注意事项与测试 |
| [`android/README.md`](android/README.md) | 安卓客户端编译、签名与应用内更新 |
| [Release](https://github.com/YCHDDZZ/anon-ai-station/releases/tag/v1.1.0) | 版本说明与源码打包下载 |

## 版本基线

| 组成 | 版本 |
| --- | --- |
| 本仓库 | v1.1.0 |
| Node 版 | Node.js ≥ 22.5，内置 `node:sqlite` |
| PHP 版 | PHP ≥ 8.1，MySQL / SQLite |
| 安卓客户端 | versionCode 2 / versionName 1.1.0，minSdk 24 |

## 致谢

- 角色卡数据来自 [玖帕喵 Prompt Market](https://jiupamiao.asia)，版权归各角色卡作者所有
- 前端图标与样式基于开源 UI 实践实现
- 本项目以 [MIT](LICENSE) 发布
