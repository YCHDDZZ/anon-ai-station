import { MAIL_OPENERS, pickMailOpener } from '../server/lib/mail-openers.js';

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

console.log('── 邮件随机开场白 ──');

const members = ['Tomorin', 'Soyorin', 'Rikki', '乐奈', '爱音'];
ok('开场白数量足够', MAIL_OPENERS.length >= 12, `${MAIL_OPENERS.length} 条`);

for (const m of members) {
  const count = MAIL_OPENERS.filter((o) => o.who === m).length;
  ok(`${m} 至少 2 条`, count >= 2, `${count} 条`);
}

ok('包含全员开场', MAIL_OPENERS.some((o) => o.who === 'MyGO!!!!!'));

const nameHit = (text) => /Tomorin|Soyorin|Rikki|乐奈|爱音|大家/i.test(text);
ok('每条都在对某位队友说话', MAIL_OPENERS.every((o) => nameHit(o.text)));
ok('不再固定用同一句开头', MAIL_OPENERS.every((o) => !o.text.startsWith('灯灯——是我')));
ok('Tomorin 的开场占比不超过一半', MAIL_OPENERS.filter((o) => o.who === 'Tomorin').length <= MAIL_OPENERS.length / 2);

const picked = new Set();
for (let i = 0; i < 300; i++) picked.add(pickMailOpener());
ok('随机能覆盖到多位队友', picked.size >= 4, `${picked.size} 种`);
ok('随机结果都来自池子', [...picked].every((t) => MAIL_OPENERS.some((o) => o.text === t)));

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
