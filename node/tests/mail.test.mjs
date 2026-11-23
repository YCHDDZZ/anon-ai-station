import { buildMessage, codeEmailHtml, quotaEmailHtml } from '../server/lib/mailer.js';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✘\x1b[0m ${name}${extra ? `（${extra}）` : ''}`);
  }
};

console.log('── 邮件模板与 MIME ──');

const codeHtml = codeEmailHtml({ siteName: '千早爱音的AI站', code: '482913', minutes: 10, purpose: 'login' });
ok('验证码邮件含品牌色', codeHtml.includes('#c8507d'));
ok('验证码邮件含 logo CID', codeHtml.includes('cid:chihaya-logo'));
ok('验证码邮件含验证码', codeHtml.includes('482913'));
ok('验证码邮件使用爱音口吻', codeHtml.includes('千早爱音'));
ok('验证码邮件无外链图片', !/<img[^>]+src="https?:/.test(codeHtml));

const quotaHtml = quotaEmailHtml({
  siteName: '千早爱音的AI站',
  groupName: 'Tavily',
  unit: 'credits',
  used: 913,
  monthly: 1000,
  percent: 91,
  cost: 7.3,
  currency: 'USD',
  period: '2026-11',
  disableUrl: 'https://example.com/disable',
  keepUrl: 'https://example.com/keep',
  adminUrl: 'https://example.com/admin',
});
ok('告警邮件进度条宽度为 91%', quotaHtml.includes('width="91%"'));
ok('告警邮件有风险色', quotaHtml.includes('#d97706'));
ok('告警邮件含关闭链接', quotaHtml.includes('https://example.com/disable'));
ok('告警邮件含后台入口', quotaHtml.includes('https://example.com/admin'));

const msg = buildMessage({ to: 'user@example.com', subject: '测试主题', html: codeHtml });
ok('使用 multipart/related', /Content-Type: multipart\/related; boundary="[^"]+"/.test(msg));
const boundary = msg.match(/boundary="([^"]+)"/)?.[1];
ok('存在两个 MIME part', Boolean(boundary) && msg.split(`--${boundary}`).length >= 3);
ok('HTML part 为 base64', /Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64/.test(msg));
ok('图片 part 为 inline', msg.includes('Content-Disposition: inline; filename="logo.png"'));
ok('图片 Content-ID 正确', msg.includes('Content-ID: <chihaya-logo>'));
ok('以结束边界收尾', msg.trimEnd().endsWith(`--${boundary}--`));

const logoPart = msg.split(`--${boundary}`)[2] || '';
const logoB64 = logoPart.split('\r\n\r\n')[1]?.replace(/\s+/g, '') || '';
const logoBytes = Buffer.from(logoB64, 'base64');
ok('logo 是有效 PNG', logoBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
ok('logo 体积合理', logoBytes.length > 5000 && logoBytes.length < 200000, `${logoBytes.length}B`);

const htmlPart = msg.split(`--${boundary}`)[1] || '';
const htmlB64 = htmlPart.split('\r\n\r\n')[1]?.replace(/\s+/g, '') || '';
const decoded = Buffer.from(htmlB64, 'base64').toString('utf8');
ok('HTML 正文可还原', decoded.includes('482913') && decoded.includes('#c8507d'));

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
