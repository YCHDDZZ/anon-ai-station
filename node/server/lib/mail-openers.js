/**
 * 邮件开场白池：每封信随机挑一句，避免所有邮件都用同一句开头。
 * 称呼按原作里爱音对队友的叫法：
 *   Tomori → Tomorin、Soyo → Soyorin、Taki → Rikki、乐奈 → 直接叫名字（爱音没给她起成昵称）。
 */
export const MAIL_OPENERS = [
  // 高松灯（Tomorin）
  { who: 'Tomorin', text: 'Tomorin，今天也把想说的话好好说出来吧——是我，爱音，来送信啦。' },
  { who: 'Tomorin', text: 'Tomorin，笔记本和歌词都带好了吗？爱音这边有条消息。' },
  { who: 'Tomorin', text: 'Tomorin，别紧张，先深呼吸——爱音有件事要告诉你。' },

  // 长崎爽世（Soyorin）
  { who: 'Soyorin', text: 'Soyorin，红茶的香气都飘过来了——是我，爱音，带了条通知。' },
  { who: 'Soyorin', text: 'Soyorin，今天也别一个人扛着，换爱音来提醒你一句。' },
  { who: 'Soyorin', text: 'Soyorin，优雅的午后先暂停一下，爱音有正事要说。' },

  // 椎名立希（Rikki）
  { who: 'Rikki', text: 'Rikki，鼓棒先放一放，爱音有件事要说。' },
  { who: 'Rikki', text: 'Rikki，今天也没迟到吧？爱音来查岗……开玩笑的，是正事。' },
  { who: 'Rikki', text: 'Rikki，练习计划先等等，看完这封邮件再敲。' },

  // 要乐奈（爱音直接叫名字）
  { who: '乐奈', text: '乐奈，抹茶糖先收起来，听爱音说一句。' },
  { who: '乐奈', text: '乐奈，别又一个人跑去找猫啦——这里有封邮件等你。' },
  { who: '乐奈', text: '乐奈，今天也有好好吃饭吗？爱音来送通知了。' },

  // 千早爱音（自己）
  { who: '爱音', text: '今天轮到我给自己开场：千早爱音，登场！' },
  { who: '爱音', text: '大家好，我是爱音！今天的通知由我来念。' },
  { who: '爱音', text: '爱音检查完毕，状态绝佳——现在开始念通知！' },

  // 全员
  { who: 'MyGO!!!!!', text: 'MyGO!!!!! 的大家，练习前先看这里——爱音的通知时间。' },
];

/** 随机取一句开场白 */
export function pickMailOpener() {
  return MAIL_OPENERS[Math.floor(Math.random() * MAIL_OPENERS.length)].text;
}
