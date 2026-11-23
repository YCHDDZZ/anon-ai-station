import fs from 'node:fs';
import { broadcastEmailHtml, buildMessage } from '../server/lib/mailer.js';
import { imageSize } from '../server/lib/broadcast.js';

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

console.log('── 全体邮件模板 ──');

const html = broadcastEmailHtml({
  siteName: '千早爱音的AI站',
  subject: '本周更新通知',
  content: '大家好，\n本周更新了文档解析。\n\n详情见 https://example.com/notes?a=1&b=2\n<script>alert(1)</script>',
  hasImage: true,
  siteUrl: 'https://example.com',
});

ok('使用品牌色', html.includes('#c8507d'));
ok('标题被转义', html.includes('本周更新通知'));
ok('正文保留换行', html.includes('大家好，<br />本周更新了文档解析。'));
ok('段落按空行拆分', (html.match(/<p style="margin:0 0 14px/g) || []).length >= 2);
ok('链接自动识别', html.includes('href="https://example.com/notes?a=1&amp;b=2"'));
ok('脚本被转义', !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));
ok('配图走 CID', html.includes('src="cid:broadcast-image"'));
ok('含打开站点按钮', html.includes('href="https://example.com"') && html.includes('打开 千早爱音的AI站'));

const noImage = broadcastEmailHtml({ siteName: '站', subject: 's', content: 'c', hasImage: false, siteUrl: '' });
ok('无配图时不渲染图片', !noImage.includes('broadcast-image'));

const smallImg = broadcastEmailHtml({
  siteName: '站', subject: 's', content: 'c', hasImage: true, imageWidth: 128, imageHeight: 128, siteUrl: '',
});
ok('小图不被拉大', smallImg.includes('max-width:128px') && smallImg.includes('width="128"'));

const bigImg = broadcastEmailHtml({
  siteName: '站', subject: 's', content: 'c', hasImage: true, imageWidth: 1200, imageHeight: 800, siteUrl: '',
});
ok('大图缩到 500px', bigImg.includes('max-width:500px') && bigImg.includes('width="500"'));
ok('大图按比例给出高度', bigImg.includes('height="333"'));

const png = fs.readFileSync('web/logo-email.png');
const jpg = fs.readFileSync('web/logo.jpg');
const pngSize = imageSize(png);
ok('读取 PNG 尺寸', pngSize?.width === 156 && pngSize?.height === 156, JSON.stringify(pngSize));
const jpgSize = imageSize(jpg);
ok('读取 JPEG 尺寸', jpgSize?.width === 1080 && jpgSize?.height === 1080, JSON.stringify(jpgSize));

const gif = Buffer.alloc(20);
gif.write('GIF89a', 0, 'latin1');
gif.writeUInt16LE(320, 6);
gif.writeUInt16LE(200, 8);
const gifSize = imageSize(gif);
ok('读取 GIF 尺寸', gifSize?.width === 320 && gifSize?.height === 200, JSON.stringify(gifSize));

const webp = Buffer.alloc(32);
webp.write('RIFF', 0, 'latin1');
webp.writeUInt32LE(24, 4);
webp.write('WEBP', 8, 'latin1');
webp.write('VP8X', 12, 'latin1');
webp.writeUInt32LE(10, 16);
webp.writeUIntLE(799, 24, 3);
webp.writeUIntLE(599, 27, 3);
const webpSize = imageSize(webp);
ok('读取 WEBP 尺寸', webpSize?.width === 800 && webpSize?.height === 600, JSON.stringify(webpSize));

const msg = buildMessage({
  to: 'user@example.com',
  subject: '测试',
  html,
  inlineImages: [
    { cid: 'broadcast-image', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mime: 'image/png', filename: 'a.png' },
  ],
});
const boundary = msg.match(/boundary="([^"]+)"/)?.[1];
const parts = boundary ? msg.split(`--${boundary}`).length - 2 : 0;
ok('MIME 含 HTML + logo + 配图', parts >= 3, `parts=${parts}`);
ok('配图 Content-ID', msg.includes('Content-ID: <broadcast-image>'));
ok('logo Content-ID', msg.includes('Content-ID: <chihaya-logo>'));
ok('HTML part 可还原', Buffer.from(
  (msg.split(`--${boundary}`)[1] || '').split('\r\n\r\n')[1]?.replace(/\s+/g, '') || '',
  'base64'
).toString('utf8').includes('本周更新通知'));

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
