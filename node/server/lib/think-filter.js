/**
 * 把模型内联输出的 <think>...</think> 从正文里剥出来；
 * keep=false 时这部分直接丢弃，避免关闭深度思考后仍外泄思考过程。
 */
export function createThinkFilter(keep = true) {
  let buf = '';
  let mode = 'unknown';

  const feed = (text) => {
    buf += text;
    const out = [];
    for (;;) {
      if (mode === 'content') {
        if (buf) {
          out.push({ type: 'content', text: buf });
          buf = '';
        }
        break;
      }
      if (mode === 'think') {
        const idx = buf.toLowerCase().indexOf('</think');
        if (idx < 0) {
          let safe = Math.max(0, buf.length - 8);
          // 不要切开代理对（emoji）
          while (safe > 0 && /[\uDC00-\uDFFF]/.test(buf[safe])) safe--;
          if (safe > 0) {
            out.push({ type: 'reason', text: buf.slice(0, safe) });
            buf = buf.slice(safe);
          }
          break;
        }
        if (idx > 0) out.push({ type: 'reason', text: buf.slice(0, idx) });
        buf = buf.slice(idx).replace(/^<\/think(?:ing)?>/i, '').replace(/^[\r\n]+/, '');
        mode = 'content';
        continue;
      }
      const t = buf.replace(/^\s+/, '');
      if (!t) {
        buf = '';
        break;
      }
      const m = t.match(/^<(think|thinking|reasoning)>/i);
      if (m) {
        buf = t.slice(m[0].length);
        mode = 'think';
        continue;
      }
      if (t.length < 12 && /^<[a-z]*$/i.test(t)) {
        buf = t;
        break;
      }
      mode = 'content';
      buf = t;
    }
    return keep ? out : out.filter((e) => e.type !== 'reason');
  };

  const flush = () => {
    if (!buf) return [];
    const out = [{ type: mode === 'think' ? 'reason' : 'content', text: buf }];
    buf = '';
    return keep ? out : out.filter((e) => e.type !== 'reason');
  };

  return { feed, flush };
}
