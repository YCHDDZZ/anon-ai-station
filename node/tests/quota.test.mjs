import { billablePages, estimatePages } from '../server/lib/quota.js';

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

console.log('── 文档计费页数 ──');

const pdf3 = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R 4 0 R] /Count 3 >> endobj\n' +
    '2 0 obj << /Type /Page /Parent 1 0 R >> endobj\n' +
    '3 0 obj << /Type /Page /Parent 1 0 R >> endobj\n' +
    '4 0 obj << /Type /Page /Parent 1 0 R >> endobj\n'
);
ok('PDF 按实际页数（/Type /Page）', estimatePages({ name: 'a.pdf', mime: 'application/pdf', buffer: pdf3 }) === 3);
ok('PDF 按实际页数（页树 /Count 兜底）', estimatePages({
  name: 'b.pdf',
  mime: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Pages /Kids [2 0 R] /Count 7 >> endobj\n'),
}) === 7);
ok('图片算 1 页', estimatePages({ name: 'a.png', mime: 'image/png', buffer: Buffer.alloc(10) }) === 1);
ok('docx 按体积保守估算', estimatePages({ name: 'a.docx', buffer: Buffer.alloc(450 * 1024) }) >= 2);

ok('PDF 解析结果以服务端页数为准', billablePages({ name: 'a.pdf' }, { pages: 5, text: '随便一点文字' }) === 5);
ok('图片 1 张 = 1 页', billablePages({ name: 'a.jpg' }, { pages: 0, text: '' }) === 1);

const cjk2000 = '中'.repeat(2000);
const cjk2001 = '中'.repeat(2001);
ok('Excel：2000 中文字 = 1 页', billablePages({ name: 'a.xlsx' }, { text: cjk2000 }) === 1);
ok('Excel：2001 中文字 = 2 页', billablePages({ name: 'a.xlsx' }, { text: cjk2001 }) === 2);
ok('HTML：按字数折算', billablePages({ name: 'a.html' }, { text: 'word '.repeat(4000) }) === 2);
ok('纯文本：英文 2000 词 = 1 页', billablePages({ name: 'a.txt' }, { text: 'word '.repeat(2000) }) === 1);
ok('中英文混排不会重复计页', billablePages({ name: 'a.md' }, { text: `${cjk2000} ${'word '.repeat(2000)}` }) === 2);

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
