import crypto from 'node:crypto';
import { parseCredential, signV3, layoutsToText } from '../server/lib/docmind.js';

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

console.log('── 阿里云文档智能适配器 ──');

/* AccessKey 解析 */
const a = parseCredential('fake-access-key-id:fake-access-key-secret');
ok('冒号格式解析出 AccessKeyId', a.accessKeyId === 'fake-access-key-id');
ok('冒号格式解析出 AccessKeySecret', a.accessKeySecret === 'fake-access-key-secret');
const b = parseCredential('{"accessKeyId":"ak","accessKeySecret":"sk"}');
ok('JSON 格式解析', b.accessKeyId === 'ak' && b.accessKeySecret === 'sk');
let badCred = false;
try {
  parseCredential('only-id');
} catch (err) {
  badCred = err.code === 'BAD_CREDENTIAL';
}
ok('缺少 Secret 时报 BAD_CREDENTIAL', badCred);

/* 签名：与官方文档一致的规范化请求 */
const credential = { accessKeyId: 'ak', accessKeySecret: 'sk' };
const signed = signV3({
  credential,
  method: 'GET',
  host: 'openplatform.aliyuncs.com',
  query: { Product: 'docmind-api', RegionId: 'cn-hangzhou' },
  headers: { 'x-acs-action': 'AuthorizeFileUpload', 'x-acs-version': '2019-12-19' },
  date: '2026-11-18T02:02:21Z',
  nonce: 'a7eae744-dfa1-4542-ba9f-3c6390353885',
});

const expectedCanonical = [
  'GET',
  '/',
  'Product=docmind-api&RegionId=cn-hangzhou',
  'host:openplatform.aliyuncs.com',
  'x-acs-action:AuthorizeFileUpload',
  'x-acs-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'x-acs-date:2026-11-18T02:02:21Z',
  'x-acs-signature-nonce:a7eae744-dfa1-4542-ba9f-3c6390353885',
  'x-acs-version:2019-12-19',
  '',
  'host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version',
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
].join('\n');
ok('规范化请求与阿里云格式一致', signed.canonicalRequest === expectedCanonical);

const expectedHash = crypto
  .createHash('sha256')
  .update(expectedCanonical, 'utf8')
  .digest('hex');
ok('规范化请求的 SHA256 与线上实测一致', expectedHash === '67ce3dae9271d35b673c69c7b8049909136986b3e10297b604f323b4c982c000');
ok('签名算法为 HMAC-SHA256', signed.signature === crypto.createHmac('sha256', 'sk').update(signed.stringToSign).digest('hex'));
ok('Authorization 头格式正确', /^ACS3-HMAC-SHA256 Credential=ak,SignedHeaders=host;x-acs-action;.*,Signature=[0-9a-f]{64}$/.test(signed.headers.authorization));

/* 表单请求体：中文与空格按 RFC3986 编码 */
const post = signV3({
  credential,
  host: 'docmind-api.cn-hangzhou.aliyuncs.com',
  query: {},
  headers: {
    'x-acs-action': 'SubmitDocParserJob',
    'x-acs-version': '2022-07-11',
    'content-type': 'application/x-www-form-urlencoded',
  },
  payload: 'FileName=%E6%88%91%E7%9A%84%E6%96%87%E6%A1%A3.pdf&PageIndex=1-5',
  date: '2026-11-18T02:02:21Z',
  nonce: 'fixed',
});
ok('POST 请求的 content-type 参与签名', post.canonicalRequest.includes('content-type:application/x-www-form-urlencoded\n'));
ok('请求体哈希写入签名头', post.headers['x-acs-content-sha256'] === crypto.createHash('sha256')
  .update('FileName=%E6%88%91%E7%9A%84%E6%96%87%E6%A1%A3.pdf&PageIndex=1-5', 'utf8')
  .digest('hex'));

/* 结果拼接 */
const text = layoutsToText([
  { index: 1, pageNum: 0, text: '纯文本 A' },
  { index: 2, pageNum: 0, markdownContent: '# 标题 B\n', text: '标题 B' },
  { index: 3, pageNum: 1, markdownContent: '   ' },
]);
ok('有 markdownContent 时优先使用', text.includes('# 标题 B'));
ok('没有 markdownContent 时回落到 text', text.includes('纯文本 A'));
ok('空版面被跳过', !text.includes('undefined') && text.trim().endsWith('标题 B'));
ok('多余空行被压缩', !/\n{3,}/.test(text));

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
