# PHP 版

PHP 8.1+ 实现，支持 MySQL 与 SQLite，适合虚拟主机 / 宝塔 / LNMP 环境。

## 依赖

- PHP 8.1+，扩展：`pdo_mysql` 或 `pdo_sqlite`、`curl`、`mbstring`、`json`、`gd`（图形验证码）
- nginx / Apache 任意一种
- 可写目录：`data/`

## 配置

```bash
cp .env.example .env
```

关键项：

```ini
APP_SECRET=至少32位随机串
DB_DRIVER=mysql
DB_HOST=localhost
DB_NAME=your_db
DB_USER=your_user
DB_PASS=your_pass

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-please

# 角色卡市场（可留空）
MARKET_API_KEYS=key1,key2,key3
```

SMTP 不配置时，开发环境可以把验证码回显到接口（`MAIL_DEV_FALLBACK=true`），生产务必关闭。

## 部署

站点根目录指向 `public/`：

```
public/
  index.html
  app.js
  styles.css
  config.js          # window.__API_BASE__ = '/api/index.php?p='
  api/index.php      # 所有接口的唯一入口
app/                 # 业务代码
data/                # SQLite / 上传 / 缓存（不要放进版本库）
```

nginx 需要：

- `try_files` 兜底到 `index.html`（前端是 hash 路由）
- `/api/` 交给 `api/index.php`，参数为 `?p=/api/xxx`
- `client_max_body_size` 建议 ≥ 10m（默认 1m 会让反馈截图返回 413）

首次访问会自动建表，并按 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 创建管理员。

## 测试

```bash
PHP=/usr/bin/php bash tests/smoke.sh
php tests/unit.php
```

测试使用独立 SQLite 临时库，不会污染生产数据。

## 备注

- 角色卡广场的 Key 池按天计数，跨天自动清零；Key 失效或超限会自动切换到下一个
- 所有第三方 Key 都只存在服务端，前端拿不到
