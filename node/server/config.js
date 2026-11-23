import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 极简 .env 解析，避免引入 dotenv 依赖 */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const bool = (v, d = false) => (v === undefined ? d : String(v).toLowerCase() === 'true');
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 8787),
  env: process.env.NODE_ENV || 'development',
  /** 监听地址；生产建议配合 nginx 设为 127.0.0.1 */
  host: process.env.HOST || '0.0.0.0',
  isProd: process.env.NODE_ENV === 'production',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:5173',
  /** 对外可访问的站点根地址，用于邮件里的链接 */
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${num(process.env.PORT, 8787)}`).replace(/\/+$/, ''),
  appSecret: process.env.APP_SECRET || '',
  sessionDays: num(process.env.SESSION_DAYS, 7),
  /** 开发环境把验证码答案回传给前端，便于本地联调；生产务必关闭 */
  captchaDevEcho: bool(process.env.CAPTCHA_DEV_ECHO, process.env.NODE_ENV !== 'production'),
  adminEmail: (process.env.ADMIN_EMAIL || '').toLowerCase().trim(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
    fromName: process.env.SMTP_FROM_NAME || '',
  },
  mailDevFallback: bool(process.env.MAIL_DEV_FALLBACK, false),
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || './data/uploads'),
  maxFileMb: num(process.env.MAX_FILE_MB, 30),
  /** 数据目录；测试时可用 DATA_DIR 指向临时目录，避免污染开发库 */
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data'),
};

if (!config.appSecret || config.appSecret.length < 32) {
  console.error(
    '\n[致命] 未配置 APP_SECRET（至少 32 位）。它会用来加密数据库中的第三方 API Key。\n' +
      '生成：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n'
  );
  process.exit(1);
}

export const smtpConfigured = Boolean(
  config.smtp.host && config.smtp.user && config.smtp.pass
);

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
