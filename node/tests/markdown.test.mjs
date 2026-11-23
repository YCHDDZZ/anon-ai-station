import { renderMarkdown } from '../web/markdown.js';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✘\x1b[0m ${name}`);
  }
};

console.log('── Markdown 渲染 ──');

const h = renderMarkdown('# 标题\n\n正文一段。');
ok('标题', h.includes('<h1>标题</h1>'));
ok('段落', h.includes('<p>正文一段。</p>'));

const bold = renderMarkdown('这是 **粗体** 和 *斜体* 以及 `代码`。');
ok('粗体', bold.includes('<strong>粗体</strong>'));
ok('斜体', bold.includes('<em>斜体</em>'));
ok('行内代码', bold.includes('<code>代码</code>'));

const code = renderMarkdown('```python\nprint("hi")\n```');
ok('代码块容器', code.includes('class="code-block"'));
ok('语言标签', code.includes('<span>python</span>'));
ok('代码已转义', code.includes('print(&quot;hi&quot;)'));
ok('复制按钮', code.includes('data-act="copy-code"'));

const lst = renderMarkdown('- 甲\n- 乙\n\n1. 一\n2. 二');
ok('无序列表', lst.includes('<ul><li>甲</li><li>乙</li></ul>'));
ok('有序列表', lst.includes('<ol><li>一</li><li>二</li></ol>'));

const table = renderMarkdown('| 能力 | 状态 |\n| --- | --- |\n| 大模型 | 已配置 |');
ok('表格表头', table.includes('<th>能力</th>'));
ok('表格单元格', table.includes('<td>已配置</td>'));

const quote = renderMarkdown('> 引用一段');
ok('引用块', quote.includes('<blockquote>引用一段</blockquote>'));

const link = renderMarkdown('[官网](https://example.com)');
ok('外链', link.includes('href="https://example.com"') && link.includes('target="_blank"'));

const xss1 = renderMarkdown('<script>alert(1)</script>');
ok('脚本标签被转义', !xss1.includes('<script>') && xss1.includes('&lt;script&gt;'));

const xss2 = renderMarkdown('[恶意](javascript:alert(1))');
ok('javascript: 协议不生成链接', !xss2.includes('href="javascript:'));

const xss3 = renderMarkdown('<img src=x onerror=alert(1)>');
ok('内联事件不会成为真实标签', !xss3.includes('<img') && xss3.includes('&lt;img'));

const fence = renderMarkdown('```html\n<div onclick="x">t</div>\n```');
ok('代码块内的 HTML 不被执行', fence.includes('&lt;div') && !fence.includes('<div onclick'));

console.log('');
console.log(`════ Markdown 测试：通过 ${pass}，失败 ${fail} ════`);
process.exit(fail === 0 ? 0 : 1);
