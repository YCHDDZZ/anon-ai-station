/* 千早爱音的AI站 · 零依赖前端 */
import { esc, renderMarkdown } from './markdown.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const appEl = document.getElementById('app');

/* PHP 版通过单一入口转发 API；Node 版留空即为原始路径 */
const API_BASE = window.__API_BASE__ || '';
const apiPath = (path) => (API_BASE ? API_BASE + encodeURIComponent(path) : path);

/* ── 图标 ─────────────────────────────────────────────── */
const ICON_PATHS = {
  plus: 'M8 3.2v9.6M3.2 8h9.6',
  send: 'M2 8l12-5.4L9.6 14 8 9.2 2 8z',
  stop: 'M5 5h6v6H5z',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  copy: 'M5.5 5.5V3.2h7.3v7.3h-2.3M3.2 5.5h7.3v7.3H3.2z',
  trash: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.2h5.8l.6-8.2M6.8 7v3.4M9.2 7v3.4',
  settings:
    'M8 10a2 2 0 100-4 2 2 0 000 4zM12.6 9.9l.9.7-1 1.7-1.1-.4a4.3 4.3 0 01-1.1.6l-.2 1.2H8.3l-.2-1.2a4.3 4.3 0 01-1.1-.6l-1.1.4-1-1.7.9-.7a4.4 4.4 0 010-1.3l-.9-.7 1-1.7 1.1.4c.35-.25.72-.45 1.1-.6l.2-1.2h1.8l.2 1.2c.39.15.76.35 1.1.6l1.1-.4 1 1.7-.9.7a4.4 4.4 0 010 1.3z',
  back: 'M10 3.5L5.5 8l4.5 4.5',
  search: 'M7.2 12a4.8 4.8 0 100-9.6 4.8 4.8 0 000 9.6zM10.8 10.8L14 14',
  brain:
    'M6 3.2a2 2 0 00-2 2v.3a2 2 0 00-1 3.5v.4a2 2 0 001.2 1.9A2 2 0 006 13.6h.5V3.2H6zM10 3.2a2 2 0 012 2v.3a2 2 0 011 3.5v.4a2 2 0 01-1.2 1.9 2 2 0 01-1.8.3H9.5V3.2H10z',
  paperclip: 'M11.1 7.4l-3.9 3.9a2 2 0 11-2.8-2.8l4.6-4.6a1.4 1.4 0 012 2l-4.6 4.6',
  volume: 'M3 6.2h2.2L8 3.6v8.8L5.2 9.8H3zM10.2 5.8a3.2 3.2 0 010 4.4M12 4a5.4 5.4 0 010 8',
  check: 'M3 8.4l3.2 3.2L13 4.8',
  logout: 'M6.5 2.8H3.2v10.4h3.3M9.4 5.2L12.4 8l-3 2.8M12.4 8H6.2',
  shield: 'M8 2.2l4.8 1.7v3.6c0 2.7-1.9 4.7-4.8 5.8-2.9-1.1-4.8-3.1-4.8-5.8V3.9L8 2.2z',
  chevron: 'M6 4l4 4-4 4',
  alert: 'M8 2.6l5.6 9.6H2.4L8 2.6zM8 6.4v2.6M8 10.6v.6',
  refresh: 'M12.8 8a4.8 4.8 0 11-1.5-3.5M12.8 2.4V5h-2.6',
  key: 'M9.6 6.4a2.6 2.6 0 11-1.9-1.9M9.6 6.4L13.4 10.2M11.6 8.4l1 1M12.6 9.4l-1 1',
  x: 'M4 4l8 8M12 4l-8 8',
  message: 'M2.8 3.4h10.4v7.2H7.6L4 13.2v-2.6H2.8V3.4z',
  store: 'M3 6.4h10l-.7-3.2H3.7L3 6.4zM4.2 6.4v6.4h7.6V6.4M6.4 12.8V9.2h3.2v3.6',
  bell: 'M8 2.2a3.8 3.8 0 0 0-3.8 3.8v2.3L3 11.2h10L11.8 8.3V6A3.8 3.8 0 0 0 8 2.2zM6.5 12.4a1.5 1.5 0 0 0 3 0',
  edit: 'M10.6 2.8l2.6 2.6-7.3 7.3-3.1.5.5-3.1 7.3-7.3z',
  download: 'M8 2.6v7.4M5 7.4L8 10.4l3-3M3 13h10',
  code: 'M5.6 4.6L2.6 8l3 3.4M10.4 4.6L13.4 8l-3 3.4',
  list: 'M3 4.6h1.2M6.2 4.6h6.8M3 8h1.2M6.2 8h6.8M3 11.4h1.2M6.2 11.4h6.8',
  sun: 'M8 11a3 3 0 100-6 3 3 0 000 6zM8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1',
  user: 'M8 8.2a2.7 2.7 0 100-5.4 2.7 2.7 0 000 5.4zM2.8 13.6c0-2.5 2.3-4 5.2-4s5.2 1.5 5.2 4',
  phone:
    'M5.6 2.3h4.8a1.7 1.7 0 0 1 1.7 1.7v8a1.7 1.7 0 0 1-1.7 1.7H5.6a1.7 1.7 0 0 1-1.7-1.7v-8a1.7 1.7 0 0 1 1.7-1.7zM6.6 4.6h2.8M7.1 11.6h1.8',
};

const icon = (name, size = 16) => {
  const s = Math.round(size * 1.18);
  if (name === 'dots') {
    return `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="flex:none"><circle cx="3.6" cy="8" r="1.35"/><circle cx="8" cy="8" r="1.35"/><circle cx="12.4" cy="8" r="1.35"/></svg>`;
  }
  return `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="flex:none"><path d="${
    ICON_PATHS[name] || ''
  }" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="${
    name === 'stop' ? 'currentColor' : 'none'
  }"/></svg>`;
};

/* ── 工具 ─────────────────────────────────────────────── */

function toast(text, kind = 'info') {
  const host = document.getElementById('toasts');
  const node = document.createElement('div');
  node.className = `toast${kind === 'error' ? ' err' : ''}`;
  node.textContent = text;
  host.appendChild(node);
  setTimeout(() => node.remove(), kind === 'error' ? 6000 : 3000);
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (raw) {
    init.body = raw;
    if (init.headers['Content-Type']) delete init.headers['Content-Type'];
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(apiPath(path), init);
  } catch {
    throw new Error('网络异常，无法连接服务端');
  }
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok || json.ok === false) {
    const err = new Error(json?.error?.message || `请求失败（${res.status}）`);
    err.code = json?.error?.code;
    err.status = res.status;
    err.detail = json?.error?.detail;
    if (res.status === 401 && state.user) {
      state.user = null;
      state.messages = [];
      state.convs = [];
      state.banned = null;
      if (state.route !== '/') navigate('/');
      render();
    }
    throw err;
  }
  return json;
}

const fmtNum = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

const initial = (email, role) => {
  const m = String(email || '').match(/[a-zA-Z\u4e00-\u9fa5]/);
  if (m) return m[0].toUpperCase();
  return role === 'admin' ? '管' : '用';
};

/** 统一错误提示框 */
function showErrorDialog({ title = '出错了', message = '', action = null }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = [
    '<div class="modal">',
    '  <div class="modal-head"><span class="modal-icon">' + icon('alert', 16) + '</span><span>' + esc(title) + '</span></div>',
    '  <div class="modal-body">' + esc(message) + '</div>',
    '  <div class="modal-foot">',
    action ? '    <button class="btn" data-modal-action="1">' + esc(action.label) + '</button>' : '',
    '    <button class="btn btn-primary" data-modal-close="1">知道了</button>',
    '  </div>',
    '</div>',
  ].join('');
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-modal-close]')) return close();
    if (e.target.closest('[data-modal-action]')) {
      close();
      if (action && action.href) location.hash = action.href;
    }
  });
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
}

async function exportConversations() {
  try {
    const res = await fetch(apiPath('/api/conversations/export'), { credentials: 'same-origin' });
    if (!res.ok) throw new Error('导出失败（' + res.status + '）');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'conversations-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('已导出全部对话');
  } catch (err) {
    showErrorDialog({ title: '导出失败', message: err.message || String(err) });
  }
}

async function importConversations(file) {
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('这不是合法的 JSON 文件');
    }
    const r = await api('/api/conversations/import', { method: 'POST', body: data });
    toast('已导入 ' + r.imported + ' 个对话、' + r.messages + ' 条消息');
    await loadConversations();
    renderSettings();
  } catch (err) {
    showErrorDialog({ title: '导入失败', message: err.message || String(err) });
  }
}

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—');
const fmtSize = (n) => (!n ? '—' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

/* ── 全局状态 ─────────────────────────────────────────── */
const IS_APP_WEBVIEW = /AnonApp\//.test(navigator.userAgent || '');

const state = {
  ready: false,
  user: null,
  boot: { siteName: '千早爱音的AI站', allowRegistration: true, mailConfigured: false },
  route: '/',
  devCode: null,
  captcha: null,
  authMode: 'login',
  loginMethod: 'password',
  authEmail: '',
  authGroup: '',
  banned: null,
  needGroup: false,
  security: null,
  banTarget: null,
  userDetail: null,
  modelCache: {},
  newCard: null,
  // chat
  convs: [],
  activeId: null,
  convQuery: '',
  convMenuOpen: false,
  messages: [],
  thinking: true,
  search: false,
  attachments: [],
  uploading: false,
  streaming: false,
  alertMsg: null,
  menuOpen: false,
  appInfo: null,
  appInfoAt: 0,
  sidebarOpen: window.innerWidth > 860,
  // 角色扮演
  personas: { global: [], own: [] },
  llmModels: { list: [], defaultModel: '' },
  ttsVoices: { list: [], defaultVoice: '' },
  model: '',
  persona: null,
  currentPersonaName: null,
  personaPickerOpen: false,
  modelPickerOpen: false,
  market: { open: false, tag: '全部', q: '', items: [], nextCursor: null, hasMore: false, loading: false, error: '', detail: null, detailLoading: false },
  feedback: { open: false, content: '', images: [], uploading: false, sending: false, error: '' },
  marketSync: { running: false, next: 1, cached: 0, saved: 0, timer: null },
  // settings / admin
  me: null,
  admin: null,
  adminUsers: [],
  myPersonas: [],
  myQuota: { users: 1, items: [] },
  pref: 'own_first',
  openCard: null,
};

let abortCtrl = null;
let streamBuf = '';
let streamReasoning = '';
let rafPending = false;

/* ── 主题 ─────────────────────────────────────────────── */
function applyTheme(pref) {
  const dark =
    pref === 'dark' ||
    (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
function initTheme() {
  const saved = localStorage.getItem('theme-pref') || 'system';
  applyTheme(saved);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('theme-pref') || 'system') === 'system') applyTheme('system');
  });
}
const themePref = () => localStorage.getItem('theme-pref') || 'system';

/* ── 路由 ─────────────────────────────────────────────── */
function currentRoute() {
  const h = location.hash.replace(/^#/, '');
  return h || '/';
}

function navigate(path) {
  location.hash = path;
}

/* ── 渲染入口 ─────────────────────────────────────────── */
function render() {
  state.route = currentRoute();

  if (state.banned) {
    renderBanPage();
    return;
  }
  if (!state.user) {
    state.authMode = state.route === '/register' ? 'register' : 'login';
    renderLogin();
    return;
  }
  if (state.route === '/security') {
    if (state.user.role !== 'admin') {
      navigate('/');
      return;
    }
    renderSecurity();
    return;
  }
  if (state.route === '/settings') {
    renderSettings();
    return;
  }
  if (state.route === '/admin') {
    if (state.user.role !== 'admin') {
      navigate('/');
      return;
    }
    renderAdmin();
    return;
  }
  renderChat();
}

/* ── 登录 / 注册页 ─────────────────────────────────────── */
function renderLogin() {
  const s = state;
  const days = s.boot.sessionDays || 7;
  const isRegister = s.authMode === 'register';
  const method = s.loginMethod === 'code' ? 'code' : 'password';
  const captchaField = `<div class="field">
      <label>图形验证码</label>
      <div class="captcha-row">
        <input class="input" name="captchaCode" placeholder="输入右侧 4 位字符" maxlength="4" autocomplete="off" />
        <div class="captcha-box" id="captcha-box" data-act="refresh-captcha" title="点击刷新">${captchaSvg()}</div>
      </div>
    </div>`;

  appEl.innerHTML = `
  <div class="auth-page">
    <div class="auth-shell">
      <aside class="auth-aside">
        <div class="aa-brand">
          <img class="brand-mark" src="/logo-128.png" alt="" />
          <span>${esc(s.boot.siteName || '千早爱音的AI站')}</span>
        </div>
        <h1>和 AI 一起<br />把想法聊清楚</h1>
        <p class="aa-desc">支持多角色扮演、深度思考、联网检索与文件解析。登录后所有对话保存在你自己的账号里。</p>
        <ul class="aa-points">
          <li><b>两种登录方式</b><span>密码登录或邮箱验证码，随你习惯</span></li>
          <li><b>多设备安全</b><span>会话绑定设备与网络，${days} 天免登录</span></li>
          <li><b>自带算力</b><span>也可直接使用管理员提供的共享额度</span></li>
        </ul>
      </aside>

      <div class="auth-card">
        <div class="auth-brand">
          <img class="brand-mark" src="/logo-128.png" alt="" />
          <div>${esc(s.boot.siteName || '千早爱音的AI站')}</div>
        </div>

        <div class="auth-tabs">
          <button type="button" data-act="auth-tab" data-mode="login" class="${isRegister ? '' : 'on'}">登录</button>
          <button type="button" data-act="auth-tab" data-mode="register" class="${isRegister ? 'on' : ''}">注册</button>
        </div>

        <h2 class="auth-title">${isRegister ? '注册新账号' : '欢迎回来'}</h2>
        <p class="auth-sub">${
          isRegister
            ? '设置登录密码并完成邮箱验证，即可创建账号'
            : method === 'code'
              ? '输入邮箱，收一条验证码即可登录'
              : '使用注册时设置的密码登录'
        }</p>

        ${
          isRegister
            ? ''
            : `<div class="auth-methods">
                 <button type="button" data-act="login-method" data-method="password" class="${method === 'password' ? 'on' : ''}">密码登录</button>
                 <button type="button" data-act="login-method" data-method="code" class="${method === 'code' ? 'on' : ''}">验证码登录</button>
               </div>`
        }

        <form class="auth-form" id="login-form" autocomplete="on">
          <div class="field">
            <label>邮箱</label>
            <input class="input" type="email" name="email" value="${esc(s.authEmail || '')}" placeholder="you@example.com" autocomplete="username" required />
          </div>

          ${
            isRegister
              ? `<div class="field">
                   <label>密码</label>
                   <input class="input" type="password" name="password" placeholder="至少 8 位" autocomplete="new-password" minlength="8" required />
                 </div>`
              : method === 'password'
                ? `<div class="field">
                     <label>密码</label>
                     <input class="input" type="password" name="password" placeholder="请输入登录密码" autocomplete="current-password" required />
                   </div>`
                : ''
          }

          ${
            isRegister || method === 'code'
              ? `<div class="field">
                   <label>邮箱验证码</label>
                   <div class="code-row">
                     <input class="input" name="code" placeholder="6 位数字" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required />
                     <button type="button" class="btn" id="send-code" data-act="send-code">获取验证码</button>
                   </div>
                 </div>`
              : ''
          }

          ${isRegister || method === 'password' ? captchaField : ''}

          ${
            isRegister && s.boot.requireGroup
              ? `<div class="field">
                   <label>分部群号</label>
                   <input class="input" name="groupNumber" value="${esc(s.authGroup || '')}" placeholder="请输入你所在的分部群号" autocomplete="off" required />
                   <div class="hint">填管理员在「安全管理」登记过的群号</div>
                 </div>`
              : ''
          }

          <div id="login-msg"></div>
          ${
            s.devCode
              ? `<div class="auth-msg ok mono-code">本地调试验证码：<b>${esc(s.devCode)}</b> <button type="button" class="btn btn-sm btn-ghost" data-act="fill-code">填入</button></div>`
              : ''
          }

          <button class="btn btn-primary auth-submit" type="submit">${
            isRegister ? '注册并登录' : '登录'
          }</button>
        </form>

        <div class="auth-switch">
          ${
            isRegister
              ? `已有账号？<a data-act="auth-tab" data-mode="login">直接登录</a>`
              : `还没有账号？<a data-act="auth-tab" data-mode="register">立即注册</a>`
          }
        </div>

        <div class="auth-note">
          <p>同一设备 + 同一 IP 登录后可保持 <b>${days} 天</b>免登录；更换设备或切换网络需重新验证。</p>
          <p>${
            s.boot.registrationLocked
              ? '管理员尚未配置分部群号，新账号暂时无法注册；已有账号可直接登录'
              : s.boot.allowRegistration
                ? s.boot.requireGroup
                  ? '注册需要管理员设置的分部群号'
                  : '当前已开放自助注册'
                : '当前未开放自助注册，请联系超级管理员开通'
          }。</p>
        </div>

        ${
          IS_APP_WEBVIEW
            ? ''
            : `<button class="auth-app" data-act="app-download">
                 <span class="aa-ic">${icon('phone', 18)}</span>
                 <span class="aa-tx"><b>下载安卓 App</b><i>和网页端共用账号，装到手机桌面随时聊</i></span>
                 ${icon('chevron', 13)}
               </button>`
        }

        <div class="auth-foot">${esc(s.boot.siteName || '')} · 请勿在公共设备上保存登录状态</div>
      </div>
    </div>
  </div>`;

  $('#login-form').addEventListener('submit', onLoginSubmit);
  if ((isRegister || method === 'password') && !state.captcha) loadCaptcha();
}

function switchAuthMode(mode) {
  if (!['login', 'register'].includes(mode) || state.authMode === mode) return;
  const form = $('#login-form');
  if (form) {
    state.authEmail = form.email?.value.trim() || state.authEmail || '';
    state.authGroup = form.groupNumber?.value.trim() || state.authGroup || '';
  }
  state.authMode = mode;
  state.devCode = null;
  const target = mode === 'register' ? '/register' : '/login';
  if (currentRoute() !== target) navigate(target);
  else renderLogin();
}

function switchLoginMethod(method) {
  if (!['password', 'code'].includes(method) || state.loginMethod === method) return;
  const form = $('#login-form');
  if (form) state.authEmail = form.email?.value.trim() || state.authEmail || '';
  state.loginMethod = method;
  state.devCode = null;
  renderLogin();
}

function captchaSvg() {
  if (state.captcha?.svg) return state.captcha.svg;
  return `<span class="captcha-loading">加载中…</span>`;
}

async function loadCaptcha() {
  try {
    const c = await api('/api/auth/captcha');
    state.captcha = { id: c.id, svg: c.svg, devCode: c.devCode || '' };
  } catch {
    state.captcha = null;
  }
  const box = $('#captcha-box');
  if (box) box.innerHTML = captchaSvg();
}

async function refreshCaptcha() {
  state.captcha = null;
  const box = $('#captcha-box');
  if (box) box.innerHTML = '<span class="captcha-loading">刷新中…</span>';
  await loadCaptcha();
}

function authErrorHtml(err) {
  if (err.code === 'NOT_REGISTERED') {
    return `${esc(err.message)} <a data-act="auth-tab" data-mode="register">去注册</a>`;
  }
  if (err.code === 'ALREADY_REGISTERED') {
    return `${esc(err.message)} <a data-act="auth-tab" data-mode="login">去登录</a>`;
  }
  return esc(err.message);
}

async function onLoginSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const email = form.email.value.trim();
  const msg = $('#login-msg');
  msg.innerHTML = '';
  const isRegister = state.authMode === 'register';
  const usePassword = !isRegister && state.loginMethod !== 'code';
  const needCaptcha = isRegister || usePassword;

  if (needCaptcha) {
    if (!state.captcha) await loadCaptcha();
    if (!state.captcha) {
      msg.innerHTML = '<div class="auth-msg err">验证码加载失败，请刷新页面</div>';
      return;
    }
    if (!form.captchaCode.value.trim()) {
      msg.innerHTML = '<div class="auth-msg err">请输入图形验证码</div>';
      return;
    }
  }

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = isRegister ? '注册中…' : '登录中…';
  try {
    let out;
    if (usePassword) {
      out = await api('/api/auth/password-login', {
        method: 'POST',
        body: {
          email,
          password: form.password.value,
          captchaId: state.captcha.id,
          captchaCode: form.captchaCode.value.trim(),
        },
      });
    } else {
      out = await api('/api/auth/verify', {
        method: 'POST',
        body: {
          email,
          code: form.code.value.trim(),
          password: form.password?.value || '',
          captchaId: state.captcha?.id || '',
          captchaCode: form.captchaCode?.value.trim() || '',
          groupNumber: form.groupNumber?.value.trim() || '',
          mode: state.authMode,
        },
      });
    }
    state.user = out.user;
    state.devCode = null;
    state.captcha = null;
    state.banned = null;
    state.authEmail = '';
    state.authGroup = '';
    navigate('/');
    await Promise.all([loadConversations(), loadPersonas(), loadCapabilities()]);
    render();
  } catch (err) {
    if (err.code === 'ACCOUNT_BANNED') {
      state.banned = err.detail || { notice: err.message };
      renderBanPage();
      return;
    }
    msg.innerHTML = `<div class="auth-msg err">${authErrorHtml(err)}</div>`;
    if (form.captchaCode) form.captchaCode.value = '';
    if (needCaptcha) await refreshCaptcha();
  } finally {
    btn.disabled = false;
    btn.textContent = isRegister ? '注册并登录' : '登录';
  }
}

async function sendCode() {
  const form = $('#login-form');
  const email = form?.email?.value.trim();
  const msg = $('#login-msg');
  if (!email) {
    msg.innerHTML = '<div class="auth-msg err">请先填写邮箱</div>';
    return;
  }
  if (state.authMode === 'register' && state.boot.requireGroup && !form.groupNumber?.value.trim()) {
    msg.innerHTML = '<div class="auth-msg err">请先填写你所在的分部群号</div>';
    form.groupNumber?.focus();
    return;
  }
  const btn = $('#send-code');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '发送中…';
  }
  try {
    const r = await api('/api/auth/send-code', {
      method: 'POST',
      body: {
        email,
        // 图形验证码只在最终提交时校验，这里传空避免提前消耗
        groupNumber: form.groupNumber?.value.trim() || '',
        mode: state.authMode,
      },
    });
    state.devCode = r.devCode || null;
    msg.innerHTML = `<div class="auth-msg ok">${
      r.sent ? '验证码已发送，10 分钟内有效' : '邮件通道未就绪，验证码见下方'
    }</div>`;
    let left = 60;
    const tick = () => {
      if (!document.getElementById('send-code')) return;
      if (left <= 0) {
        btn.disabled = false;
        btn.textContent = '获取验证码';
        return;
      }
      btn.textContent = `${left--}s 后重发`;
      setTimeout(tick, 1000);
    };
    tick();
    if (r.devCode) {
      renderLogin();
    } else if (document.getElementById('captcha-box')) {
      await refreshCaptcha();
    }
  } catch (err) {
    if (err.code === 'ACCOUNT_BANNED') {
      state.banned = err.detail || { notice: err.message };
      renderBanPage();
      return;
    }
    msg.innerHTML = `<div class="auth-msg err">${authErrorHtml(err)}</div>`;
    if (btn) {
      btn.disabled = false;
      btn.textContent = '获取验证码';
    }
    if (document.getElementById('captcha-box')) await refreshCaptcha();
  }
}

/* ── 封禁告知页 ───────────────────────────────────────── */
function renderBanPage() {
  const s = state;
  const b = s.banned || {};
  const untilText = b.permanent
    ? '永久限制'
    : b.until
      ? new Date(b.until).toLocaleString('zh-CN', { hour12: false })
      : '—';
  appEl.innerHTML = `
  <div class="auth-page ban-page">
    <div class="ban-card">
      <div class="ban-icon">${icon('shield', 26)}</div>
      <h1>账号已被限制访问</h1>
      <p class="ban-sub">${esc(b.email || s.user?.email || '')}</p>
      <div class="ban-grid">
        <div><span>限制类型</span><b>${b.permanent ? '永久封禁' : '临时封禁'}</b></div>
        <div><span>${b.permanent ? '生效时间' : '解封时间'}</span><b>${esc(untilText)}</b></div>
      </div>
      ${
        b.reason
          ? `<div class="ban-reason"><span>封禁原因</span><p>${esc(b.reason)}</p></div>`
          : ''
      }
      <div class="ban-notice">${esc(
        b.notice || '你的账号因违反站点使用规范已被限制访问。如有疑问请联系管理员申诉。'
      )}</div>
      <div class="ban-actions">
        <button class="btn" data-act="logout">换个账号登录</button>
        <button class="btn btn-ghost" data-act="reload">刷新页面</button>
      </div>
      <p class="ban-foot">如果你的账号被误封，请带上注册邮箱联系超级管理员。</p>
    </div>
  </div>`;
}

/* ── 会话列表 ─────────────────────────────────────────── */
async function loadConversations() {
  try {
    const r = await api('/api/conversations');
    state.convs = r.conversations;
  } catch {
    /* ignore */
  }
}

async function loadCapabilities() {
  try {
    const r = await api('/api/me');
    state.llmModels = r.llmModels || { list: [], defaultModel: '' };
    state.ttsVoices = r.ttsVoices || { list: [], defaultVoice: '' };
  } catch {
    /* ignore */
  }
}

async function loadPersonas() {
  try {
    const r = await api('/api/personas');
    state.personas = { global: r.global || [], own: r.own || [] };
  } catch {
    /* ignore */
  }
}

function groupConversations(list) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '7 天内', items: [] },
    { label: '更早', items: [] },
  ];
  for (const c of list) {
    if (c.updatedAt >= today) buckets[0].items.push(c);
    else if (c.updatedAt >= today - 86400000) buckets[1].items.push(c);
    else if (c.updatedAt >= today - 7 * 86400000) buckets[2].items.push(c);
    else buckets[3].items.push(c);
  }
  return buckets.filter((b) => b.items.length);
}

/* ── 聊天页 ───────────────────────────────────────────── */
function renderChat() {
  const s = state;
  const siteName = s.boot.siteName || '千早爱音的AI站';
  const active = s.convs.find((c) => c.id === s.activeId) || null;
  const activeTitle = active ? active.title : '新对话';
  const groups = groupConversations(filterConversations());

  appEl.innerHTML = `
  <div class="app">
    <aside class="sidebar${s.sidebarOpen ? '' : ' collapsed'}">
      <div class="sidebar-head">
        <div class="brand">
          <img class="brand-mark" style="width:32px;height:32px;border-radius:9px" src="/logo-128.png" alt="" />
          <span>${esc(siteName)}</span>
        </div>
        <button class="icon-btn" data-act="toggle-sidebar" title="收起边栏">${icon('menu')}</button>
      </div>

      <div class="sidebar-actions">
        <button class="btn btn-primary new-chat" data-act="new-chat">${icon('plus', 15)} 开启新对话</button>
        <div class="conv-search${s.convQuery ? ' has-value' : ''}" id="conv-search">
          ${icon('search', 14)}
          <input id="conv-search-input" placeholder="搜索对话" value="${esc(s.convQuery)}" autocomplete="off" />
          <button class="cs-clear" data-act="clear-search" title="清除">${icon('x', 12)}</button>
        </div>
      </div>

      <div class="conv-list" id="conv-list">${convListHtml(groups, s)}</div>

      <div class="sidebar-foot">
        ${
          s.menuOpen
            ? `<div class="dropdown">
                 <button data-act="go" data-to="/settings">${icon('settings', 14)} 我的算力设置</button>
                 ${
                   IS_APP_WEBVIEW
                     ? ''
                     : `<button data-act="app-download">${icon('phone', 14)} 下载安卓 App</button>`
                 }
                 ${
                   s.user.role === 'admin'
                     ? `<button data-act="go" data-to="/admin">${icon('shield', 14)} 超级管理员后台</button>`
                     : ''
                 }
                 <button class="danger" data-act="logout">${icon('logout', 14)} 退出登录</button>
               </div>`
            : ''
        }
        <button class="user-chip" data-act="toggle-menu">
          <div class="avatar">${esc(initial(s.user.email, s.user.role))}</div>
          <div class="u">
            <div>${esc(s.user.email)}</div>
            <div>${s.user.role === 'admin' ? '超级管理员' : '普通用户'}</div>
          </div>
          ${icon('chevron', 12)}
        </button>
      </div>
    </aside>
    ${s.sidebarOpen ? '<div class="sidebar-backdrop" data-act="toggle-sidebar"></div>' : ''}

    <main class="main">
      <div class="topbar">
        ${!s.sidebarOpen ? `<button class="icon-btn" data-act="toggle-sidebar" title="打开边栏">${icon('menu', 18)}</button>` : ''}
        <div class="topbar-title">
          <h2>${esc(activeTitle)}</h2>
          <span class="topbar-sub">${
            active
              ? `${active.personaName ? esc(active.personaName) + ' · ' : ''}${active.messageCount} 条消息`
              : '选择角色后开始对话'
          }</span>
        </div>
        <div class="topbar-actions">
          ${
            active
              ? `<div class="tb-menu-wrap">
                   <button class="icon-btn" data-act="toggle-conv-menu" title="更多操作">${icon('dots', 18)}</button>
                   ${
                     s.convMenuOpen
                       ? `<div class="dropdown right">
                            <button data-act="rename-conv">${icon('edit', 14)} 重命名</button>
                            <button data-act="export-conv">${icon('download', 14)} 导出此对话</button>
                            <button class="danger" data-act="del-active-conv">${icon('trash', 14)} 删除</button>
                          </div>`
                       : ''
                   }
                 </div>`
              : ''
          }
          <button class="icon-btn" data-act="open-feedback" title="意见反馈">${icon('message', 18)}</button>
          <button class="icon-btn" data-act="open-market" title="角色卡广场">${icon('store', 18)}</button>
          ${IS_APP_WEBVIEW ? '' : `<button class="icon-btn" data-act="app-download" title="下载安卓 App">${icon('phone', 18)}</button>`}
          <button class="icon-btn" data-act="go" data-to="/settings" title="我的算力设置">${icon('settings', 18)}</button>
          ${
            s.user.role === 'admin'
              ? `<button class="icon-btn" data-act="go" data-to="/admin" title="管理后台">${icon('shield', 18)}</button>`
              : ''
          }
        </div>
      </div>

      <div class="scroll" id="scroll-area">
        <div id="msg-area">${messagesHtml()}</div>
      </div>

      <div class="composer-wrap">
        ${s.alertMsg ? computeAlertHtml(s.alertMsg) : ''}
        ${personaPickerHtml(s)}
        <div class="composer">
          <div id="attach-area">${attachmentsHtml()}</div>
          <textarea id="composer-input" rows="1" placeholder="${
            window.matchMedia('(pointer: coarse)').matches ? '给 AI 发送消息…' : '给 AI 发送消息，Shift + Enter 换行'
          }"></textarea>
          <div class="composer-bar">
            ${s.messages.length === 0 ? personaChipHtml(s) : personaLockedHtml(s)}
            <button class="chip-toggle${s.thinking ? ' on' : ''}" data-act="toggle-thinking" title="先思考后回答">${icon(
              'brain',
              13
            )} 深度思考</button>
            <button class="chip-toggle${s.search ? ' on' : ''}" data-act="toggle-search" title="按需搜索网页">${icon(
              'search',
              13
            )} 联网</button>
            <button class="chip-toggle" data-act="pick-file" ${s.uploading ? 'disabled' : ''}>${icon(
              'paperclip',
              13
            )} 文件</button>
            <input type="file" id="file-input" hidden multiple />
            <div class="spacer"></div>
            ${modelSelectHtml(s)}
            <button class="send-btn" id="send-btn" data-act="${s.streaming ? 'stop' : 'send'}" title="${
              s.streaming ? '停止生成' : '发送'
            }">${s.streaming ? icon('stop', 14) : icon('send', 15)}</button>
          </div>
        </div>
        <div class="composer-note">内容由 AI 生成，请仔细甄别</div>
      </div>
    </main>
  </div>`;

  bindComposer();
  bindMessages();
  bindConvSearch();
  if (s.messages.length > 0) scrollBottom();
  setTimeout(() => maybeShowAnnouncement(), 350);
}

function filterConversations() {
  const q = (state.convQuery || '').trim().toLowerCase();
  if (!q) return state.convs;
  return state.convs.filter((c) => String(c.title || '').toLowerCase().includes(q));
}

function convListHtml(groups, s) {
  if (s.convs.length === 0) {
    return `<div class="sidebar-empty">还没有对话记录<br><span>点击上方按钮开始</span></div>`;
  }
  if (groups.length === 0) {
    return `<div class="sidebar-empty">没有匹配「${esc(s.convQuery)}」的对话</div>`;
  }
  return groups
    .map(
      (g) =>
        `<div class="conv-group">${g.label}</div>` +
        g.items
          .map(
            (c) => `<div class="conv-item${s.activeId === c.id ? ' active' : ''}" data-act="open-conv" data-id="${
              c.id
            }"><span class="t">${esc(c.title)}</span><button class="del" data-act="del-conv" data-id="${
              c.id
            }" title="删除">${icon('trash', 13)}</button></div>`
          )
          .join('')
    )
    .join('');
}

function bindConvSearch() {
  const input = $('#conv-search-input');
  const box = $('#conv-search');
  if (!input) return;
  input.addEventListener('input', () => {
    state.convQuery = input.value;
    if (box) box.classList.toggle('has-value', Boolean(input.value));
    const list = $('#conv-list');
    if (list) list.innerHTML = convListHtml(groupConversations(filterConversations()), state);
  });
}

function positionModelPop() {
  const wrap = document.querySelector('.model-picker-wrap');
  const pop = document.querySelector('.model-pop');
  if (!wrap || !pop) return;
  const rect = wrap.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(340, vw - 16);
  pop.style.width = `${width}px`;
  pop.style.maxHeight = `${Math.round(vh * 0.5)}px`;
  const height = Math.min(pop.offsetHeight || 320, vh * 0.5);
  let left = rect.right - width;
  left = Math.max(8, Math.min(left, vw - width - 8));
  let top = rect.top - height - 10;
  if (top < 8) top = Math.min(rect.bottom + 10, vh - height - 8);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.right = 'auto';
  pop.style.bottom = 'auto';
}

function modelSelectHtml(s) {
  const list = s.llmModels.list || [];
  if (list.length <= 1) return '';
  let saved = '';
  try {
    saved = localStorage.getItem('anon.model') || '';
  } catch {
    saved = '';
  }
  const cur = s.model || (list.includes(saved) ? saved : '') || s.llmModels.defaultModel || list[0];

  // 按 API 线路分组；没有分组信息时退化成平铺
  const items = Array.isArray(s.llmModels.items) && s.llmModels.items.length
    ? s.llmModels.items
    : list.map((m) => ({ model: m, providerName: '' }));
  const curItem = items.find((i) => i.model === cur);
  const curLabel = curItem?.label || '';

  // 原生 select 无法渲染标签，这里用自定义下拉
  const groups = [];
  for (const it of items) {
    const label = it.providerName || '其他';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }
  const body = groups
    .map(
      (g) =>
        `<div class="mpo-group">
          <div class="mpo-group-label">${esc(g.label)}</div>
          ${g.items
            .map(
              (it) => `<button type="button" class="mpo-item${it.model === cur ? ' on' : ''}" data-act="pick-model" data-model="${esc(
                it.model
              )}" role="option" aria-selected="${it.model === cur}">
                <span class="mpo-name">${esc(it.model)}</span>
                ${it.label ? `<em class="model-tag ${esc(it.labelColor || '')}">${esc(it.label)}</em>` : ''}
                ${it.model === cur ? `<span class="mpo-check">${icon('check', 12)}</span>` : ''}
              </button>`
            )
            .join('')}
        </div>`
    )
    .join('');

  return `<div class="model-picker-wrap">
    <button type="button" class="model-picker" data-act="toggle-model-picker" aria-haspopup="listbox" aria-expanded="${
      s.modelPickerOpen ? 'true' : 'false'
    }" title="切换本次对话使用的模型">
      <span class="mpo-cur">${esc(cur)}</span>
      ${curLabel ? `<em class="model-tag ${esc(curItem?.labelColor || '')}">${esc(curLabel)}</em>` : ''}
      ${icon('chevron', 12)}
    </button>
    ${s.modelPickerOpen ? `<div class="model-pop" role="listbox">${body}</div>` : ''}
  </div>`;
}

function personaChipHtml(s) {
  const label = s.persona ? s.persona.name : '选择角色';
  return `<button class="chip-toggle${s.persona ? ' on' : ' require'}" data-act="pick-persona" title="新对话的第一条消息需要先选择角色">${icon(
    'user',
    13
  )} ${esc(label)}</button>`;
}

function personaLockedHtml(s) {
  return `<span class="chip-toggle locked" title="角色在本对话中已固定，不可更改">${icon('user', 13)} ${esc(
    s.currentPersonaName || '角色'
  )}</span>`;
}

function personaPickerHtml(s) {
  if (!s.personaPickerOpen) return '';
  const all = [...(s.personas.global || []), ...(s.personas.own || [])];
  return `<div class="persona-pop">
    <div class="pp-head">选择本次对话的角色<span>仅新对话的第一条消息前可设置</span></div>
    <div class="pp-list">
      <button class="pp-item${s.persona?.id === 0 ? ' on' : ''}" data-act="choose-persona" data-id="0">
        <b>不使用角色<span class="pp-tag plain">默认助手</span></b>
        <span>直接使用站点默认助手，不套用任何角色设定</span>
      </button>
      ${
        all.length
          ? all
              .map(
                (p) => `<button class="pp-item${s.persona?.id === p.id ? ' on' : ''}" data-act="choose-persona" data-id="${
                  p.id
                }">
                  <b>${esc(p.name)}${p.scope === 'global' ? '<span class="pp-tag">官方</span>' : ''}</b>
                  <span>${esc(p.description || '')}</span>
                </button>`
              )
              .join('')
          : ''
      }
    </div>
    <div class="pp-foot"><a href="#/settings">管理和添加角色 →</a></div>
  </div>`;
}

function computeAlertHtml(msg) {
  return `<div class="compute-alert">${icon('alert', 15)}<div>${esc(msg)}<br><a href="#/settings">前往「我的算力设置」查看共享额度 →</a></div></div>`;
}

function attachmentsHtml() {
  const s = state;
  if (!s.attachments.length && !s.uploading) return '';
  return `<div class="attach-list">${s.attachments
    .map(
      (a) =>
        `<span class="attach-chip" title="${esc(
          a.warning || (a.textLength ? `已解析 ${a.textLength} 字` : '未提取到文字')
        )}">${icon('paperclip', 12)}<span>${esc(a.name)}</span>${
          a.warning
            ? '<em class="attach-meta warn">解析失败</em>'
            : a.textLength
              ? `<em class="attach-meta">${a.textLength} 字</em>`
              : '<em class="attach-meta warn">无文本</em>'
        }<button data-act="rm-attach" data-id="${a.id}" title="移除">${icon('x', 11)}</button></span>`
    )
    .join('')}${
    s.uploading ? `<span class="attach-chip"><span class="spin" style="width:12px;height:12px"></span> 上传解析中…</span>` : ''
  }</div>`;
}

function messagesHtml() {
  const s = state;
  if (s.messages.length === 0) {
    const hint = s.persona
      ? `现在以「${esc(s.persona.name)}」的身份回答`
      : '先在下方选择一个角色，再发送第一条消息';
    const items = [
      { icon: 'brain', t: '解释一个概念', d: '用类比讲清楚「向量数据库」是什么' },
      { icon: 'code', t: '写一段代码', d: '用 Python 写一个带重试的 HTTP 客户端' },
      { icon: 'list', t: '整理一段材料', d: '把会议记录整理成结论与待办' },
      { icon: 'search', t: '联网查资料', d: '搜索今天的人工智能行业要闻并总结' },
    ];
    return `<div class="empty-state">
      <img class="empty-logo" src="/logo.jpg" alt="" />
      <h3>今天想聊点什么？</h3>
      <p>${hint}</p>
      <div class="suggestions">
        ${items
          .map(
            (i) => `<button class="suggestion" data-act="use-suggestion" data-text="${esc(i.d)}">
              <span class="s-icon">${icon(i.icon, 15)}</span>
              <span class="s-body"><b>${esc(i.t)}</b><em>${esc(i.d)}</em></span>
            </button>`
          )
          .join('')}
      </div>
    </div>`;
  }
  return `<div class="messages">${s.messages.map(messageHtml).join('')}</div>`;
}

function messageHtml(m) {
  const isUser = m.role === 'user';
  const files = m.meta?.files || [];
  const search = m.meta?.search;
  const provider = m.meta?.provider;
  const elapsed = m.meta?.elapsedMs;

  const filesHtml = files.length
    ? `<div class="attach-list" style="padding:0 0 6px">${files
        .map((f) => `<span class="attach-chip">${icon('paperclip', 12)}<span>${esc(f.name)}</span></span>`)
        .join('')}</div>`
    : '';

  // DeepSeek 风格：一条轻量的「已深度思考（用时 X 秒）」折叠条，默认收起
  const thinkingMs = Number(m.thinkingMs || 0);
  const thinkingText = thinkingMs >= 1000
    ? `${(thinkingMs / 1000).toFixed(thinkingMs < 10000 ? 1 : 0)} 秒`
    : thinkingMs > 0 ? '不到 1 秒' : '';
  const reasoningHtml =
    !isUser && m.meta?.think !== false && (m.reasoning || m.streaming)
      ? `<details class="reasoning${m.streaming ? ' thinking' : ''}">
          <summary>
            <span class="think-orb" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="think-label">${
              m.streaming ? '正在深度思考…' : `已深度思考${thinkingText ? `（用时 ${thinkingText}）` : ''}`
            }</span>
            ${icon('chevron', 12)}
          </summary>
          <div class="reasoning-body">${esc(m.reasoning || '')}</div>
        </details>`
      : '';


  // 默认折叠成一行，和「深度思考」同一套视觉；点开才展开网页列表
  const searchHtml =
    !isUser && search?.results?.length
      ? `<details class="search-panel">
          <summary>
            ${icon('search', 12)}
            <span class="sp-label">已阅读 ${search.results.length} 个网页</span>
            ${icon('chevron', 12)}
          </summary>
          <div class="sp-body">${search.results
            .map(
              (r, i) =>
                `<div class="search-item"><span class="idx">[${i + 1}]</span><div style="min-width:0"><a href="${esc(
                  r.url
                )}" target="_blank" rel="noreferrer noopener">${esc(r.title)}</a>${
                  r.snippet ? `<span class="snippet">${esc(r.snippet)}</span>` : ''
                }</div></div>`
            )
            .join('')}</div>
        </details>`
      : '';

  const body = isUser
    ? esc(m.content)
    : m.content
      ? `<div class="md">${renderMarkdown(m.content)}</div>`
      : m.streaming
        ? `<div style="display:flex;align-items:center;gap:8px;color:var(--text-3);font-size:13px"><span class="typing-dot"></span> 正在生成…</div>`
        : '';

  const actions =
    !isUser && (m.content || m.streaming)
      ? `<div class="msg-actions">
           ${m.content ? `<button class="txt" data-act="copy-msg" data-id="${m.id}">${icon('copy', 12)} 复制</button>` : ''}
           ${
             m.content
               ? `<button class="txt" data-act="speak" data-id="${m.id}" data-playing="0">${icon('volume', 12)} 朗读</button>`
               : ''
           }
           ${
             provider?.name
               ? `<span class="txt static">${esc(provider.name)}${elapsed ? ` · ${(elapsed / 1000).toFixed(1)}s` : ''}</span>`
               : ''
           }
         </div>`
      : '';

  return `<div class="msg ${isUser ? 'user' : 'assistant'}${m.streaming ? ' streaming' : ''}" data-mid="${m.id}">
    ${isUser ? '<div class="msg-avatar">你</div>' : '<img class="msg-avatar" src="/logo.jpg" alt="AI" />'}
    <div class="msg-body">${filesHtml}${reasoningHtml}${searchHtml}${body}${actions}</div>
  </div>`;
}

function bindMessages() {
  const area = $('#msg-area');
  if (!area) return;
  area.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'copy-code') {
      const code = btn.closest('.code-block')?.querySelector('code')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = '已复制';
        setTimeout(() => (btn.textContent = '复制'), 1400);
      } catch {
        btn.textContent = '复制失败';
      }
    }
  });
}

function scrollBottom() {
  const el = $('#scroll-area');
  if (el) el.scrollTop = el.scrollHeight;
}

/** 重绘对话页但保留输入框内容与光标（切换角色时用） */
function rerenderChat() {
  const ta = $('#composer-input');
  // 只有原本就在输入状态才恢复焦点，否则重渲染会把手机输入法顶出来
  const hadFocus = !!ta && document.activeElement === ta;
  const val = ta ? ta.value : '';
  const pos = ta ? ta.selectionStart : 0;
  renderChat();
  const next = $('#composer-input');
  if (!next) return;
  next.value = val;
  next.style.height = 'auto';
  next.style.height = `${Math.min(next.scrollHeight, 240)}px`;
  if (hadFocus) next.focus();
  try {
    next.setSelectionRange(pos, pos);
  } catch {
    /* ignore */
  }
}

function bindComposer() {
  const ta = $('#composer-input');
  const sendBtn = $('#send-btn');
  if (!ta) return;
  const update = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
    if (sendBtn && !state.streaming) sendBtn.disabled = !ta.value.trim() && state.attachments.length === 0;
  };
  ta.addEventListener('input', update);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  // 不主动聚焦输入框：任何自动聚焦都会在手机上弹出输入法
  update();
  if (sendBtn && !state.streaming) sendBtn.disabled = !ta.value.trim() && state.attachments.length === 0;

  $('#file-input')?.addEventListener('change', (e) => uploadFiles(e.target.files));

}

async function openConversation(id) {
  if (abortCtrl) abortCtrl.abort();
  try {
    const r = await api(`/api/conversations/${id}`);
    state.activeId = id;
    state.messages = r.messages || r.conversation?.messages || [];
    state.alertMsg = null;
    state.menuOpen = false;
    state.persona = null;
    state.personaPickerOpen = false;
    state.convMenuOpen = false;
    state.currentPersonaName = r.conversation?.personaName || null;
    if (window.innerWidth <= 860) state.sidebarOpen = false;
    renderChat();
    setTimeout(scrollBottom, 30);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ── 发送与流式接收 ───────────────────────────────────── */
async function sendMessage() {
  if (state.streaming) return;
  const ta = $('#composer-input');
  const text = (ta?.value || '').trim();
  if (!text && state.attachments.length === 0) return;

  const isNew = state.messages.length === 0;
  if (isNew && !state.persona) {
    toast('请先选择一个角色，再发送第一条消息', 'error');
    state.personaPickerOpen = true;
    renderChat();
    return;
  }

  const fileIds = state.attachments.map((a) => a.id);
  const filesMeta = state.attachments.map((a) => ({ name: a.name }));

  state.messages.push({
    id: `u-${Date.now()}`,
    role: 'user',
    content: text,
    meta: { files: filesMeta },
  });
  const aid = `a-${Date.now()}`;
  state.messages.push({
    id: aid,
    role: 'assistant',
    content: '',
    reasoning: '',
    streaming: true,
    thinkingStartedAt: Date.now(),
    thinkingMs: 0,
    meta: { think: state.thinking },
  });
  state.attachments = [];
  state.alertMsg = null;
  state.streaming = true;
  if (isNew && state.persona) state.currentPersonaName = state.persona.name;
  state.personaPickerOpen = false;
  streamBuf = '';
  streamReasoning = '';

  renderChat();
  const node = document.querySelector(`[data-mid="${aid}"]`);
  const bodyEl = node?.querySelector('.msg-body');

  const paint = () => {
    rafPending = false;
    if (!bodyEl) return;
    const mdEl = bodyEl.querySelector('.md');
    if (mdEl) mdEl.innerHTML = renderMarkdown(streamBuf);
    else {
      const stub = bodyEl.querySelector('.typing-dot')?.parentElement;
      if (stub) {
        const div = document.createElement('div');
        div.className = 'md';
        div.innerHTML = renderMarkdown(streamBuf);
        stub.replaceWith(div);
      }
    }
    const rb = bodyEl.querySelector('.reasoning-body');
    if (rb) rb.textContent = streamReasoning;
    const sc = $('#scroll-area');
    if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 220) sc.scrollTop = sc.scrollHeight;
  };
  const schedule = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(paint);
  };

  const ctrl = new AbortController();
  abortCtrl = ctrl;

  try {
    const res = await fetch(apiPath('/api/chat'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.activeId,
        content: text,
        thinking: state.thinking,
        search: state.search,
        fileIds,
        ...(isNew ? { personaId: state.persona.id } : {}),
        ...(state.model ? { model: state.model } : {}),
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw Object.assign(new Error(j?.error?.message || `请求失败（${res.status}）`), {
        code: j?.error?.code,
      });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        let event = 'message';
        const dataLines = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let data = {};
        try {
          data = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
        handleStreamEvent(event, data, aid, schedule);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      state.alertMsg = err.message;
      const m = state.messages.find((x) => x.id === aid);
      if (m && !m.content) m.content = `⚠️ ${err.message}`;
      if (m) m.streaming = false;
      toast(err.message, 'error');
    }
  } finally {
    const m = state.messages.find((x) => x.id === aid);
    if (m) {
      m.streaming = false;
      if (m.reasoning) m.thinkingMs = Math.max(1, Date.now() - (m.thinkingStartedAt || Date.now()));
    }
    state.streaming = false;
    abortCtrl = null;
    await loadConversations();
    renderChat();
    if (state.messages.length && state.messages.at(-1)?.content) setTimeout(scrollBottom, 30);
  }
}

function handleStreamEvent(event, data, aid, schedule) {
  const m = state.messages.find((x) => x.id === aid);
  if (!m) return;
  switch (event) {
    case 'meta':
      if (!state.activeId) state.activeId = data.conversationId;
      break;
    case 'provider':
      m.meta.provider = data;
      break;
    case 'search':
      m.meta.search = { query: data.query, results: data.results };
      break;
    case 'search_error':
      toast(`联网搜索不可用：${data.message}`, 'error');
      break;
    case 'reasoning':
      streamReasoning += data.text || '';
      m.reasoning = streamReasoning;
      schedule();
      break;
    case 'delta':
      streamBuf += data.text || '';
      m.content = streamBuf;
      schedule();
      break;
    case 'done':
      m.meta.elapsedMs = data.elapsedMs;
      m.meta.provider = data.provider || m.meta.provider;
      break;
    case 'error':
      m.meta.error = data.message;
      if (data.code === 'INSUFFICIENT_COMPUTE' || data.code === 'PROVIDER_FAILED' || data.code === 'PROVIDER_HTTP_ERROR') {
        state.alertMsg = data.message;
        showErrorDialog({
          title: '暂时无法回答',
          message: data.message,
          action: { label: '去设置算力', href: '/settings' },
        });
      } else if (data.code === 'UNAUTHORIZED') {
        state.user = null;
        toast('登录已失效，请重新登录', 'error');
      } else {
        toast(data.message || '生成失败', 'error');
      }
      if (!m.content) m.content = `⚠️ ${data.message}`;
      break;
  }
}

/* ── 文件上传 ─────────────────────────────────────────── */
async function uploadFiles(fileList) {
  if (!fileList?.length) return;
  state.uploading = true;
  renderAttachArea();
  for (const file of Array.from(fileList).slice(0, 4)) {
    try {
      const res = await fetch(apiPath(`/api/files?name=${encodeURIComponent(file.name)}`), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-File-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) throw new Error(json?.error?.message || '上传失败');
      state.attachments.push({
        id: json.file.id,
        name: json.file.name,
        warning: json.file.warning,
        parseMode: json.file.parseMode,
        textLength: json.file.textLength || 0,
      });
      if (json.file.warning) {
        toast(`${json.file.name}：${json.file.warning}`, 'error');
      } else if (!json.file.textLength) {
        toast(`${json.file.name}：没有提取到文字，模型可能读不到内容`, 'error');
      }
    } catch (err) {
      toast(`${file.name}：${err.message}`, 'error');
    }
  }
  state.uploading = false;
  renderAttachArea();
  const ta = $('#composer-input');
  const sendBtn = $('#send-btn');
  if (sendBtn && !state.streaming) sendBtn.disabled = !(ta?.value || '').trim() && state.attachments.length === 0;
}

function renderAttachArea() {
  const area = $('#attach-area');
  if (area) area.innerHTML = attachmentsHtml();
}

/* ── 朗读 ─────────────────────────────────────────────── */
let audioEl = null;
async function speak(messageId, btn) {
  if (audioEl && !audioEl.paused) {
    audioEl.pause();
    audioEl = null;
    btn.dataset.playing = '0';
    btn.innerHTML = `${icon('volume', 12)} 朗读`;
    return;
  }
  const m = state.messages.find((x) => String(x.id) === String(messageId));
  if (!m) return;
  try {
    btn.innerHTML = `${icon('volume', 12)} 合成中…`;
    const res = await fetch(apiPath('/api/chat/tts'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: m.content.slice(0, 4000),
        voice: localStorage.getItem('tts-voice') || state.ttsVoices.defaultVoice || '',
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.error?.message || '朗读不可用');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    audioEl = new Audio(url);
    audioEl.onended = () => {
      btn.innerHTML = `${icon('volume', 12)} 朗读`;
      URL.revokeObjectURL(url);
    };
    await audioEl.play();
    btn.innerHTML = `${icon('stop', 12)} 停止`;
  } catch (err) {
    showErrorDialog({ title: '朗读失败', message: err.message, action: { label: '去设置音色', href: '/settings' } });
    btn.innerHTML = `${icon('volume', 12)} 朗读`;
  }
}

/* ── 设置页 ───────────────────────────────────────────── */
async function renderSettings() {
  appEl.innerHTML = `<div class="loading-screen"><span class="spin"></span> 正在加载…</div>`;
  try {
    const [r, mine, quota] = await Promise.all([
      api('/api/me'),
      api('/api/personas/mine'),
      api('/api/me/quota'),
    ]);
    state.me = r;
    state.myQuota = quota;
    state.pref = r.providerPreference;
    state.myPersonas = mine.personas || [];
  } catch (err) {
    toast(err.message, 'error');
    navigate('/');
    return;
  }
  const s = state;
  const cats = s.me.categories;
  const sharedCount = cats.filter((c) => c.sharedAvailable).length;

  appEl.innerHTML = `
  <div class="page">
    <div class="page-head">
      <button class="icon-btn" data-act="go" data-to="/" title="返回">${icon('back')}</button>
      <h1>我的算力设置</h1>
      <span class="badge ${s.user.role === 'admin' ? 'badge-brand' : ''}">${
        s.user.role === 'admin' ? '超级管理员' : '普通用户'
      }</span>
    </div>
    <div class="page-body">
      <nav class="page-nav">
        <a data-act="scroll-panel" data-target="prov-user-llm" class="on">算力接入</a>
        <a data-act="scroll-panel" data-target="panel-personas">角色扮演</a>
        <a data-act="scroll-panel" data-target="panel-data">聊天记录</a>
        <a data-act="scroll-panel" data-target="panel-appearance">外观</a>
        <a data-act="scroll-panel" data-target="panel-account">账号</a>
        <a data-act="scroll-panel" data-target="panel-quota">共享额度</a>
      </nav>
      <div class="panel" id="panel-pref">
        <div class="panel-head"><h2>优先策略</h2></div>
        <p class="panel-desc">
          你和超级管理员都可以各自接入大模型、联网搜索与爬取、文件解析与 OCR、语音合成与识别接口。
          管理员接入的接口是全体用户的默认免费额度；你接入的接口仅自己可用。
          这里决定先尝试哪一个，首选不可用时会自动切换到另一个。
        </p>
        <div class="seg">
          <button class="${s.pref === 'own_first' ? 'on' : ''}" data-act="set-pref" data-pref="own_first">优先用我的</button>
          <button class="${s.pref === 'shared_first' ? 'on' : ''}" data-act="set-pref" data-pref="shared_first">优先用共享</button>
        </div>
        <div class="hint" style="margin-top:10px">当前管理员已提供 ${sharedCount} / ${cats.length} 项共享能力${
          sharedCount === 0 ? '（暂未提供，你需要自行接入）' : ''
        }</div>
      </div>

      ${cats.map((c) => providerPanelHtml('user', c)).join('')}

      <div class="panel" id="panel-personas">
        <div class="panel-head"><h2>角色扮演</h2><span class="badge">${s.myPersonas.length} 个我的角色</span></div>
        <p class="panel-desc">
          新对话的第一条消息前必须选一个角色，提示词会作为该对话的系统设定。管理员提供的角色所有人都能用，
          这里管理的是你自己的角色，只有你自己可见。
        </p>
        ${
          s.me?.personas?.global?.length
            ? `<div class="hint" style="margin-bottom:12px">管理员提供：${s.me.personas.global
                .map((p) => `<b>${esc(p.name)}</b>`)
                .join('、')}</div>`
            : '<div class="hint" style="margin-bottom:12px">管理员暂未提供全局角色</div>'
        }
        <div class="cards">
          ${s.myPersonas.map((p) => personaCardHtml('user', p)).join('')}
          ${personaCardHtml('user', null)}
        </div>
      </div>

      <div class="panel" id="panel-data">
        <div class="panel-head"><h2>聊天记录</h2></div>
        <p class="panel-desc">
          导出为 JSON 文件备份或换设备使用。导入只会新增对话，不会覆盖现有记录；
          导出内容包含消息正文、角色设定与引用来源，不包含任何 API Key。
        </p>
        <div class="form-actions">
          <button class="btn" data-act="export-convs">导出全部对话</button>
          <button class="btn" data-act="import-convs">导入对话文件</button>
          <input type="file" id="import-file" accept=".json,application/json" hidden />
          <div class="spacer"></div>
          <button class="btn btn-danger" data-act="clear-convs">清空全部对话</button>
        </div>
      </div>

      <div class="panel" id="panel-appearance">
        <div class="panel-head"><h2>外观</h2></div>
        <p class="panel-desc">选择界面主题，设置会保存在本机浏览器。</p>
        <div class="seg">
          <button class="${themePref() === 'light' ? 'on' : ''}" data-act="set-theme" data-theme="light">浅色</button>
          <button class="${themePref() === 'dark' ? 'on' : ''}" data-act="set-theme" data-theme="dark">深色</button>
          <button class="${themePref() === 'system' ? 'on' : ''}" data-act="set-theme" data-theme="system">跟随系统</button>
        </div>
        ${
          s.ttsVoices.list.length
            ? `<div class="field" style="margin-top:18px;max-width:340px">
                 <label>朗读音色</label>
                 <select class="input" id="tts-voice-select">
                   ${s.ttsVoices.list
                     .map(
                       (v) =>
                         `<option value="${esc(v.id)}"${
                           (localStorage.getItem('tts-voice') || s.ttsVoices.defaultVoice) === v.id ? ' selected' : ''
                         }>${esc(v.label || v.id)}</option>`
                     )
                     .join('')}
                 </select>
                 <div class="hint">点击回答下方的「朗读」时使用这个音色</div>
               </div>`
            : ''
        }
      </div>

      <div class="panel" id="panel-account">
        <div class="panel-head"><h2>账号</h2></div>
        <p class="panel-desc">登录邮箱 <code>${esc(s.user.email)}</code> · 注册于 ${new Date(
          s.user.createdAt
        ).toLocaleDateString('zh-CN')}</p>
        <form id="pw-form" class="grid3">
          <div class="field">
            <label>邮箱验证码</label>
            <div class="code-row">
              <input class="input" type="text" name="code" inputmode="numeric" maxlength="6" placeholder="发送到 ${esc(s.user.email)}" autocomplete="one-time-code" />
              <button type="button" class="btn btn-sm" id="pw-send-code">获取验证码</button>
            </div>
            <div class="hint">修改密码需要验证你本人邮箱</div>
          </div>
          <div class="field"><label>新密码</label><input class="input" type="password" name="pw1" placeholder="至少 8 位" autocomplete="new-password" /></div>
          <div class="field"><label>确认新密码</label><input class="input" type="password" name="pw2" placeholder="再输入一次" autocomplete="new-password" /></div>
        </form>
        <div class="form-actions" style="margin-top:12px">
          <button class="btn" id="pw-submit">${s.user.hasPassword ? '修改密码' : '设置密码'}</button>
          <span class="hint">设置后可用「密码登录」，也可以继续用邮箱验证码登录</span>
        </div>
      </div>

      ${myQuotaPanelHtml(s)}

      <div style="text-align:center"><a href="#/" class="hint">返回对话</a></div>
    </div>
  </div>`;

  syncModelCounts();

  $('#pw-send-code')?.addEventListener('click', async () => {
    const btn = $('#pw-send-code');
    if (!btn || btn.disabled) return;
    try {
      const r = await api('/api/auth/send-code', {
        method: 'POST',
        body: { email: state.user.email, mode: 'reset' },
      });
      toast(r.devCode ? `验证码（开发模式）：${r.devCode}` : '验证码已发送到你的邮箱');
      let left = 60;
      btn.disabled = true;
      const tick = () => {
        if (!document.getElementById('pw-send-code')) return;
        if (left <= 0) { btn.disabled = false; btn.textContent = '获取验证码'; return; }
        btn.textContent = `${left--}s 后重发`;
        setTimeout(tick, 1000);
      };
      tick();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('#pw-submit').addEventListener('click', async () => {
    const form = $('#pw-form');
    const pw1 = form.pw1.value;
    const pw2 = form.pw2.value;
    const code = form.code.value.trim();
    if (!/^\d{6}$/.test(code)) return toast('请先填写 6 位邮箱验证码', 'error');
    if (pw1 !== pw2) return toast('两次输入的新密码不一致', 'error');
    if (pw1.length < 8) return toast('新密码至少 8 位', 'error');
    try {
      await api('/api/auth/password', {
        method: 'POST',
        body: { code, newPassword: pw1 },
      });
      form.reset();
      toast('密码已更新，下次可以用新密码登录啦');
      state.user.hasPassword = true;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ── 能力配置：多 API / 多 Key / 模型列表 ─────────────── */

function myQuotaPanelHtml(s) {
  const q = s.myQuota || { users: 1, items: [] };
  return `<div class="panel" id="panel-quota">
    <div class="panel-head"><h2>共享额度</h2><span class="badge">${q.users} 个账号平分</span></div>
    <p class="panel-desc">
      管理员提供的共享接口每月有免费额度，按当前正常账号数平均分配。
      你只能用自己那一份，用完不会占用别人的份额；需要更多可以联系管理员调整共享额度。
    </p>
    ${
      q.items && q.items.length
        ? `<div class="usage-list">${q.items
            .map(
              (it) => `<div class="usage-item">
                <div class="usage-top">
                  <div class="usage-name">
                    <b>${esc(it.label)}</b>
                    <span class="sub">本月已用 ${fmtNum(it.used)} / ${it.shareDisplay} ${esc(it.unitLabel)}</span>
                  </div>
                  <span class="badge ${
                    it.percent >= 100 ? 'badge-err' : it.percent >= 90 ? 'badge-warn' : 'badge-ok'
                  }">${it.percent >= 100 ? '已用完' : it.percent >= 90 ? '快用完' : '正常'}</span>
                </div>
                <div class="usage-bar">
                  <i class="${it.percent >= 100 ? 'over' : it.percent >= 90 ? 'warn' : ''}"
                     style="width:${Math.min(100, it.percent)}%"></i>
                </div>
                <div class="usage-meta">
                  <span>${it.percent}%</span>
                  <span>剩余 ${Math.max(0, it.shareDisplay - Math.floor(it.used))} ${esc(it.unitLabel)}</span>
                  <span>预估 ${it.currency === 'USD' ? '$' : '¥'}${Number(it.cost || 0).toFixed(2)}</span>
                </div>
              </div>`
            )
            .join('')}</div>`
        : '<div class="empty-inline">当前没有需要计量的共享接口</div>'
    }
  </div>`;
}

function providerPanelHtml(scope, c) {
  const entries = c.entries || [];
  const shared = scope === 'user' ? c.sharedEntries || [] : [];
  const routing = c.routing || 'failover';
  const isNew = state.newCard === `${scope}:${c.key}`;
  const cat = c.key;

  return `<div class="panel prov-panel" id="prov-${scope}-${cat}">
    <div class="panel-head">
      <h2>${esc(c.label)}</h2>
      <div class="head-tools">
        <span class="badge">${entries.length} 条 API</span>
        <div class="seg seg-sm" data-act="set-routing" data-scope="${scope}" data-cat="${cat}" title="多条 API / 多把 Key 时的调度方式">
          <button type="button" data-mode="failover" class="${routing === 'failover' ? 'on' : ''}">失败切换</button>
          <button type="button" data-mode="round_robin" class="${routing === 'round_robin' ? 'on' : ''}">轮询</button>
        </div>
      </div>
    </div>
    <p class="panel-desc">
      ${esc(c.hint)}。可以添加多条 API，每条 API 还可以挂多把 Key；调度方式选「轮询」时会依次使用，选「失败切换」时前面的不可用才用后面的。
    </p>
    ${
      scope === 'user'
        ? `<div class="hint" style="margin-bottom:10px">${
            shared.length
              ? `管理员已提供 ${shared.length} 条共享线路：${shared.map((s) => esc(s.name || '未命名')).join('、')}`
              : '管理员暂未提供该能力的共享线路'
          }</div>`
        : ''
    }
    <div class="prov-list">
      ${entries.map((p) => providerEntryHtml(scope, c, p)).join('')}
      ${isNew ? providerEntryHtml(scope, c, null) : ''}
      ${
        entries.length === 0 && !isNew
          ? scope === 'user' && !state.boot?.userProvidersOpen
            ? '<div class="prov-empty">还没有配置。用户自建 API 将在后续版本开放，当前可使用管理员共享的算力。</div>'
            : '<div class="prov-empty">还没有配置。点下方按钮添加第一条 API。</div>'
          : ''
      }
    </div>
    <div class="prov-actions">
      ${
        scope === 'user' && !state.boot?.userProvidersOpen
          ? '<button type="button" class="btn btn-sm is-disabled" data-act="provider-coming-soon" aria-disabled="true" title="等待后续版本开放">＋ 添加 API</button>'
          : `<button type="button" class="btn btn-sm" data-act="add-provider" data-scope="${scope}" data-cat="${cat}">＋ 添加 API</button>`
      }
    </div>
  </div>`;
}

function parseCtxTokens(raw) {
  const str = String(raw ?? '').trim().toLowerCase().replace(/[,\s]/g, '');
  if (!str) return 0;
  const m = str.match(/^([0-9]*\.?[0-9]+)([km]?)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const mul = m[2] === 'm' ? 1000 * 1000 : m[2] === 'k' ? 1000 : 1;
  return Math.round(n * mul);
}

function fmtCtxTokens(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '';
  if (v >= 1000000 && v % 10000 === 0) return `${+(v / 1000000).toFixed(2)}M`;
  if (v % 1000 === 0) return `${v / 1000}K`;
  return String(v);
}

function modelBoxHtml(p, c, uid) {
  const adopted = Array.isArray(p?.extra?.models) ? p.extra.models : [];
  const defaultModel = p?.model || '';
  const ids = [...new Set([...adopted, ...(defaultModel ? [defaultModel] : [])])];
  return `<details class="model-box" data-model-box>
    <summary>
      <span>模型列表</span>
      <span class="mb-count" data-mb-count>已采用 ${adopted.length || (defaultModel ? 1 : 0)} 个</span>
    </summary>
    <div class="mb-body">
      <div class="mb-toolbar">
        <button type="button" class="btn btn-sm" data-act="fetch-models">从上游获取模型</button>
        <input class="input input-sm" data-model-filter placeholder="筛选…" style="max-width:160px" />
        <button type="button" class="btn btn-sm btn-ghost" data-act="toggle-all-models">全选 / 反选</button>
      </div>
      <div class="model-list" data-model-list>
        ${
          ids.length
            ? ids
                .map(
                  (m) => `<label class="mk"><input type="checkbox" name="modelPick" value="${esc(m)}" ${
                    adopted.includes(m) || (!adopted.length && m === defaultModel) ? 'checked' : ''
                  } /><span>${esc(m)}</span></label>`
                )
                .join('')
            : '<div class="mb-empty">还没有模型。填好接口地址与 Key 后点「从上游获取模型」。</div>'
        }
      </div>
      <div class="hint">勾选后这些模型会出现在对话页的模型下拉里；请求里带白名单外的模型名会被回落到默认模型。</div>
      ${
        ids.length
          ? `<details class="mp-box">
              <summary>
                <span class="mp-sum-title">按模型设置 标识 / 强度 / 上下文</span>
                <span class="mp-sum-hint">${ids.length} 个模型可单独设置</span>
                ${icon('chevron', 12)}
              </summary>
              <div class="mp-list">${ids
                .map((m) => {
                  const c = (p?.extra?.modelConfig || {})[m] || {};
                  return `<div class="mp-row" data-model-cfg="${esc(m)}">
                    <span class="mp-name" title="${esc(m)}">${esc(m)}</span>
                    <span class="mp-controls">
                      <label class="mp-field mp-field-text">
                        <span>标识</span>
                        <input class="input input-sm" name="label" maxlength="8" value="${esc(c.label || '')}" placeholder="例：多模态" title="显示在模型选择器里的自定义标识，留空不显示" />
                      </label>
                      <label class="mp-field">
                        <span>颜色</span>
                        <span class="mp-select">
                          <select class="input input-sm" name="labelColor" title="标识颜色">
                            <option value="">粉</option>
                            <option value="red"${c.labelColor === 'red' ? ' selected' : ''}>红</option>
                            <option value="blue"${c.labelColor === 'blue' ? ' selected' : ''}>蓝</option>
                            <option value="green"${c.labelColor === 'green' ? ' selected' : ''}>绿</option>
                          </select>
                          ${icon('chevron', 10)}
                        </span>
                      </label>
                      <label class="mp-field">
                        <span>强度</span>
                        <span class="mp-select">
                          <select class="input input-sm" name="effort" title="思考强度（reasoning_effort）">
                            <option value="">默认</option>
                            <option value="low"${c.effort === 'low' ? ' selected' : ''}>低</option>
                            <option value="medium"${c.effort === 'medium' ? ' selected' : ''}>中</option>
                            <option value="high"${c.effort === 'high' ? ' selected' : ''}>高</option>
                          </select>
                          ${icon('chevron', 10)}
                        </span>
                      </label>
                      <label class="mp-field">
                        <span>上下文</span>
                        <input class="input input-sm" name="ctx" type="text" inputmode="numeric" value="${esc(fmtCtxTokens(c.context) || '128K')}" placeholder="如 256K" title="支持 K / M 简写，例如 256K、1M；留空表示不限制" />
                      </label>
                    </span>
                  </div>`;
                })
                .join('')}</div>
              <div class="hint">思考强度会作为 reasoning_effort 发给上游；上下文支持 256K / 1M 简写，只用于裁剪历史长度，留空表示不限制。</div>
            </details>`
          : ''
      }
    </div>
  </details>
  <datalist id="${uid}">${ids.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>`;
}

function keysBoxHtml(scope, c, p) {
  if (!p?.id) {
    return `<div class="keys-box"><div class="keys-head"><b>多 Key 轮询</b><span>保存后可在这条 API 下追加多把 Key</span></div></div>`;
  }
  const keys = p.keys || [];
  return `<div class="keys-box">
    <div class="keys-head"><b>API Key</b><span>同一地址可以挂多把 Key，轮询模式下会依次使用</span></div>
    ${
      p.hasApiKey
        ? `<div class="key-row"><span class="key-tag primary">主 Key</span><code>${esc(p.apiKeyMasked)}</code><span class="key-flex"></span></div>`
        : '<div class="key-row muted">尚未设置主 Key</div>'
    }
    ${keys
      .map(
        (k) => `<div class="key-row">
          <span class="key-tag">${esc(k.label || '附加 Key')}</span>
          <code>${esc(k.masked)}</code>
          <span class="key-flex"></span><span class="key-state${k.enabled ? '' : ' off'}">${k.enabled ? '启用' : '停用'}</span>
          <button type="button" class="btn btn-sm btn-ghost" data-act="del-key" data-scope="${scope}" data-cat="${c.key}" data-id="${p.id}" data-key="${k.id}">移除</button>
        </div>`
      )
      .join('')}
    <div class="key-add">
      <input class="input input-sm" name="newKeyLabel" placeholder="备注（可选）" style="max-width:130px" />
      <input class="input input-sm" name="newKeyValue" placeholder="再填一把 Key…" autocomplete="off" spellcheck="false" />
      <button type="button" class="btn btn-sm" data-act="add-key" data-scope="${scope}" data-cat="${c.key}" data-id="${p.id}">添加 Key</button>
    </div>
  </div>`;
}

function quotaBoxHtml(scope, c, p) {
  if (scope !== 'admin') return '';
  const q = p?.extra?.quota || {};
  const unitDefault = { search: 'credit', crawl: 'credit', parse: 'page' }[c.key] || '次';
  const unit = q.unit || unitDefault;
  const monthly = q.monthly ?? 0;
  const price = q.price ?? 0;
  const currency = q.currency || (unit === 'credit' ? 'USD' : 'CNY');
  const warnAt = q.warnAt ?? 90;
  const hint =
    c.key === 'search' || c.key === 'crawl'
      ? 'Tavily：免费 1000 credits/月，search 每次 1 credit、extract 每 5 个 URL 1 credit，超出按 $0.008/credit'
      : c.key === 'parse'
        ? '阿里云文档智能：免费 3000 页/月，按页计费 0.02 元/页（图片 1 张 = 1 页，文本 2000 字 = 1 页）'
        : '按实际调用量累计，额度为 0 时只统计不告警';
  return `<details class="quota-box"${q.group || q.monthly ? ' open' : ''}>
    <summary>
      <span>额度与计费</span>
      <span class="mb-count">${monthly ? `每月 ${monthly} ${unit}` : '未设置额度'}</span>
    </summary>
    <div class="quota-body">
      <div class="grid2">
        <div class="field">
          <label>配额组</label>
          <input class="input" name="quotaGroup" value="${esc(q.group || '')}" placeholder="例如 tavily" spellcheck="false" />
          <div class="hint">同账号的接口填同一个组名，共用额度</div>
        </div>
        <div class="field">
          <label>每月额度</label>
          <input class="input" name="quotaMonthly" type="number" min="0" step="1" value="${monthly}" />
          <div class="hint">0 表示只统计、不告警</div>
        </div>
      </div>
      <div class="grid3">
        <div class="field">
          <label>计费单位</label>
          <select class="input" name="quotaUnit">
            <option value="credit"${unit === 'credit' ? ' selected' : ''}>credit</option>
            <option value="page"${unit === 'page' ? ' selected' : ''}>页</option>
            <option value="次"${unit === '次' ? ' selected' : ''}>次</option>
          </select>
        </div>
        <div class="field">
          <label>单价（每单位）</label>
          <input class="input" name="quotaPrice" type="number" min="0" step="0.0001" value="${price}" />
        </div>
        <div class="field">
          <label>币种 / 阈值(%)</label>
          <div class="quota-inline">
            <select class="input" name="quotaCurrency">
              <option value="USD"${currency === 'USD' ? ' selected' : ''}>USD</option>
              <option value="CNY"${currency === 'CNY' ? ' selected' : ''}>CNY</option>
            </select>
            <input class="input" name="quotaWarn" type="number" min="1" max="100" value="${warnAt}" />
            <span class="hint">%</span>
          </div>
        </div>
      </div>
      <div class="hint">${esc(hint)}</div>
    </div>
  </details>`;
}

/** 阿里云文档智能：云端账单核对 + 用量校准 */
function cloudBoxHtml(p) {
  return `<details class="quota-box" data-cloud-box data-id="${p.id}">
    <summary>
      <span>云端额度核对</span>
      <span class="mb-count" data-cloud-summary>点开自动查询</span>
    </summary>
    <div class="quota-body">
      <div class="hint" data-cloud-body>阿里云没有公开「免费额度已用页数」接口；这里按官方计费口径在本地计量，再用账单兜底。</div>
      <div class="form-actions" style="margin-top:10px">
        <button type="button" class="btn btn-sm" data-act="cloud-refresh" data-id="${p.id}">刷新云端账单</button>
        <a class="btn btn-sm btn-ghost" href="https://docmind.console.aliyun.com/service-manager" target="_blank" rel="noopener">打开阿里云控制台</a>
      </div>
      <div class="grid2" style="margin-top:12px">
        <div class="field">
          <label>控制台显示本月已用（页）</label>
          <input class="input" type="number" min="0" step="1" data-calibrate-input="${p.id}" placeholder="例如 120" />
          <div class="hint">把本应用之外的用量也算进来，只影响本月</div>
        </div>
        <div class="field">
          <label>校准总用量</label>
          <button type="button" class="btn" data-act="calibrate-usage" data-id="${p.id}">设为控制台显示的页数</button>
        </div>
      </div>
    </div>
  </details>`;
}

function providerEntryHtml(scope, c, p) {  const isNew = !p;
  const defaults = JSON.stringify(p?.extra || c.defaults || {}, null, 2);
  const docmind = p?.extra?.mode === 'docmind';
  const open =
    state.openCard === `${scope}:${c.key}:${isNew ? 'new' : p.id}` ||
    (isNew && state.newCard === `${scope}:${c.key}`);
  const adopted = Array.isArray(p?.extra?.models) ? p.extra.models : [];
  const uid = `dl-${c.key}-${isNew ? 'new' : p.id}`;

  return `<details class="prov-card${open ? ' open' : ''}" ${open ? 'open' : ''} data-card="${scope}:${c.key}:${
    isNew ? 'new' : p.id
  }">
    <summary class="prov-row">
      <div class="prov-main">
        <div class="name">${esc(p?.name || c.label)}${
          isNew
            ? '<span class="badge" style="margin-left:8px">未配置</span>'
            : `<span class="badge ${p.enabled ? 'badge-ok' : ''}" style="margin-left:8px">${
                p.enabled ? '已启用' : '已停用'
              }</span>`
        }${p?.lastStatus === 'error' ? '<span class="badge badge-err" style="margin-left:6px">上次失败</span>' : ''}</div>
        <div class="sub">${esc(p?.baseUrl || '填写 Base URL、Key 与模型')}${
          p?.model ? ` · ${esc(p.model)}` : ''
        }${p?.keys?.length ? ` · ${p.keys.length} 把附加 Key` : ''}</div>
      </div>
      <span class="btn btn-sm">${isNew ? '配置' : '修改'}</span>
    </summary>

    <form class="prov-form" data-form="provider" data-scope="${scope}" data-cat="${c.key}" data-id="${
      isNew ? '' : p.id
    }">
      <div class="grid2">
        <div class="field"><label>名称</label><input class="input" name="name" value="${esc(
          p?.name || ''
        )}" placeholder="${scope === 'admin' ? '共享线路' : '我的线路'}" /></div>
        <div class="field"><label>接口地址 base URL</label><input class="input" name="baseUrl" value="${esc(
          p?.baseUrl || ''
        )}" placeholder="https://api.example.com/v1" spellcheck="false" /></div>
      </div>

      ${
        c.key === 'parse'
          ? `<div class="field">
        <label>接入方式</label>
        <select class="input" name="parseMode">
          <option value="http"${docmind ? '' : ' selected'}>通用 HTTP（自建或第三方解析接口）</option>
          <option value="docmind"${docmind ? ' selected' : ''}>阿里云文档智能（OSS 直传 + 异步解析）</option>
        </select>
        <div class="hint" data-docmind-hint${docmind ? '' : ' hidden'}>
          Key 填 <code>AccessKeyId:AccessKeySecret</code>，地址填
          <code>https://docmind-api.cn-hangzhou.aliyuncs.com</code>。按页计费（免费 3000 页/月，0.02 元/页），
          失败会按调度策略切到下一条线路。
        </div>
      </div>`
          : ''
      }

      <div class="grid2">
        <div class="field"><label>主 API Key ${
          p?.hasApiKey ? `（已存 ${esc(p.apiKeyMasked)}）` : ''
        }</label><input class="input" type="password" name="apiKey" placeholder="${
          p?.hasApiKey ? '留空则不修改' : docmind ? 'AccessKeyId:AccessKeySecret' : 'sk-...'
        }" autocomplete="off" spellcheck="false" data-keep="${p?.hasApiKey ? '1' : '0'}" /></div>
        ${
          c.needsModel
            ? `<div class="field"><label>默认模型</label><input class="input" name="model" value="${esc(
                p?.model || ''
              )}" placeholder="例如 deepseek-chat" spellcheck="false" list="${uid}" />
                 <div class="hint">${esc(c.modelHint || '')}</div></div>`
            : `<div class="field"><label>说明</label><div class="hint" style="padding-top:9px">${esc(
                c.hint
              )}</div></div>`
        }
      </div>

      ${c.needsModel ? modelBoxHtml(p, c, uid) : ''}
      ${keysBoxHtml(scope, c, p)}
      ${quotaBoxHtml(scope, c, p)}
      ${scope === 'admin' && c.key === 'parse' && docmind && p?.id ? cloudBoxHtml(p) : ''}

      <details class="advanced">
        <summary>高级配置（请求路径、鉴权方式、字段映射）</summary>
        <div class="hint" style="margin-bottom:8px">
          变量：<code>{{query}}</code> <code>{{url}}</code> <code>{{text}}</code> <code>{{limit}}</code>；
          <code>resultPath</code> / <code>textPath</code> 定位返回字段，<code>fieldMap</code> 归一化字段，
          <code>modelsPath</code> 指定模型列表路径（默认 <code>/models</code>）。
        </div>
        <textarea class="textarea" name="extra" rows="12" spellcheck="false">${esc(defaults)}</textarea>
      </details>

      <div class="field">
        <label>自定义报错提示</label>
        <input class="input" name="errorMessage" maxlength="300" value="${esc(
          p?.errorMessage || ''
        )}" placeholder="留空则使用站点默认文案「算力不足，请自行接入第三方工具 API。」" />
        <div class="hint">该接口调用失败时，用户会看到这句话</div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" type="submit">保存</button>
        ${
          isNew
            ? ''
            : `<button class="btn" type="button" data-act="test-provider" data-scope="${scope}" data-cat="${c.key}" data-id="${p.id}">连通测试</button>
               <button class="btn" type="button" data-act="toggle-provider" data-scope="${scope}" data-cat="${c.key}" data-id="${p.id}" data-enabled="${p.enabled ? 1 : 0}">${p.enabled ? '停用' : '启用'}</button>
               <div class="spacer"></div>
               <button class="btn btn-danger" type="button" data-act="del-provider" data-scope="${scope}" data-cat="${c.key}" data-id="${p.id}">删除</button>`
        }
      </div>
      ${
        p?.lastError
          ? `<div class="hint" style="color:var(--danger)">最近错误：${esc(p.lastError)}</div>`
          : ''
      }
    </form>
  </details>`;
}

/* ── 角色卡片（设置页与后台共用） ─────────────────────── */
function personaCardHtml(scope, p) {
  const isNew = !p;
  return `<details class="prov-card">
    <summary class="prov-row">
      <div style="flex:1;min-width:0">
        <div class="name">${isNew ? '＋ 新增角色' : esc(p.name)}${
          !isNew && p.scope === 'global' ? '<span class="badge badge-brand" style="margin-left:8px">全局</span>' : ''
        }${!isNew && !p.enabled ? '<span class="badge" style="margin-left:8px">已停用</span>' : ''}</div>
        <div class="sub">${esc(isNew ? '写一段提示词，让 AI 扮演某个角色' : p.description || '（未填写介绍）')}</div>
      </div>
      <span class="btn btn-sm">${isNew ? '新建' : '编辑'}</span>
    </summary>
    <form class="prov-form" data-form="persona" data-scope="${scope}" data-id="${isNew ? '' : p.id}">
      <div class="grid2">
        <div class="field"><label>角色名称</label><input class="input" name="name" maxlength="40" value="${esc(
          p?.name || ''
        )}" placeholder="例如：千早爱音" /></div>
        <div class="field"><label>一句话介绍</label><input class="input" name="description" maxlength="200" value="${esc(
          p?.description || ''
        )}" placeholder="可选，会显示在选择列表里" /></div>
      </div>
      <div class="field"><label>角色提示词</label><textarea class="textarea" name="prompt" rows="10" placeholder="你是……（设定性格、说话方式、行为准则）">${esc(
        p?.prompt || ''
      )}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${isNew ? '创建' : '保存'}</button>
        ${
          isNew
            ? ''
            : `<button class="btn btn-danger" type="button" data-act="del-persona" data-scope="${scope}" data-id="${p.id}">删除</button>`
        }
      </div>
    </form>
  </details>`;
}

/* ── 后台页 ───────────────────────────────────────────── */
async function renderAdmin() {
  appEl.innerHTML = `<div class="loading-screen"><span class="spin"></span> 正在加载后台…</div>`;
  try {
    const [o, u, usage, models, feedback, marketStats] = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/users'),
      api('/api/admin/usage'),
      api('/api/admin/models'),
      api('/api/admin/feedback'),
    ]);
    state.admin = o;
    state.adminUsers = u.users;
    state.usage = usage;
    state.adminModels = models;
    state.adminFeedback = feedback;
    state.marketStats = marketStats || { cached: 0, next: 1 };
    state.marketSync.cached = Number(marketStats?.cached) || 0;
    state.marketSync.next = Number(marketStats?.next) || 1;
  } catch (err) {
    toast(err.message, 'error');
    navigate('/');
    return;
  }
  const s = state;
  const d = s.admin;
  const av = d.appVersion || {};

  appEl.innerHTML = `
  <div class="page">
    <div class="page-head">
      <button class="icon-btn" data-act="go" data-to="/" title="返回">${icon('back')}</button>
      <h1>超级管理员后台</h1>
      <span class="badge badge-brand">全局配置</span>
      <span class="badge badge-appversion" title="当前线上 APK 版本"><span class="av-full">App v${esc(av.apkVersionName || av.versionName || '—')} · code ${av.apkVersionCode ?? av.versionCode ?? '—'}</span><span class="av-short">v${esc(av.apkVersionName || av.versionName || '—')}</span></span>
      <div class="spacer"></div>
      <button class="btn btn-sm" data-act="go" data-to="/security">${icon('shield', 14)} 安全管理</button>
    </div>
    <div class="page-body">
      <nav class="page-nav">
        <a data-act="scroll-panel" data-target="prov-admin-llm" class="on">共享算力</a>
        <a data-act="scroll-panel" data-target="panel-model-order">模型顺序</a>
        <a data-act="scroll-panel" data-target="panel-feedback">用户反馈</a>
        <a data-act="scroll-panel" data-target="panel-market-cache">角色卡缓存</a>
        <a data-act="scroll-panel" data-target="panel-usage">用量额度</a>
        <a data-act="scroll-panel" data-target="panel-personas">角色扮演</a>
        <a data-act="scroll-panel" data-target="panel-site">站点设置</a>
        <a data-act="scroll-panel" data-target="panel-mail">邮件通道</a>
        <a data-act="scroll-panel" data-target="panel-users">用户管理</a>
      </nav>
      <div class="stats">
        <div class="stat"><b>${d.stats.users}</b><span>用户总数</span></div>
        <div class="stat"><b>${d.stats.admins}</b><span>管理员</span></div>
        <div class="stat"><b>${d.stats.conversations}</b><span>对话数</span></div>
        <div class="stat"><b>${d.stats.messages}</b><span>消息数</span></div>
        <div class="stat"><b>${d.stats.files}</b><span>文件数</span></div>
      </div>

      <div class="panel" id="panel-shared">
        <div class="panel-head"><h2>共享算力（全体用户默认免费使用）</h2></div>
        <p class="panel-desc">
          这里配置的接口对所有用户生效。用户未接入自己的接口、或优先策略选「共享优先」时走这里。
          任何一项不可用时，用户侧会收到「${esc(d.settings.insufficientComputeMsg)}」。
          每条 API 可挂多把 Key，密钥以 AES-256-GCM 加密存储，界面只显示掩码。
        </p>
      </div>
      ${d.categories.map((c) => providerPanelHtml('admin', c)).join('')}

      ${modelOrderPanelHtml(s.adminModels)}

      ${feedbackPanelHtml(s.adminFeedback)}

      ${marketSyncPanelHtml(s.marketStats)}

      ${usagePanelHtml(d)}

      <div class="panel" id="panel-personas">
        <div class="panel-head"><h2>角色扮演（全局）</h2><span class="badge">${
          (d.personas || []).length
        } 个</span></div>
        <p class="panel-desc">
          全局角色对所有用户可见，用户也可以在此基础上添加自己的角色。
          新对话的第一条消息前必须选一个角色，选定的提示词会成为该对话的系统设定。
        </p>
        <div class="cards">
          ${(d.personas || []).map((p) => personaCardHtml('admin', p)).join('')}
          ${personaCardHtml('admin', null)}
        </div>
      </div>

      <div class="panel" id="panel-site">
        <div class="panel-head"><h2>站点设置</h2></div>
        <form id="site-form">
          <div class="grid2">
            <div class="field"><label>站点名称</label><input class="input" name="siteName" value="${esc(
              d.settings.siteName
            )}" maxlength="40" /></div>
            <div class="field"><label>自助注册</label>
              <div style="display:flex;align-items:center;gap:10px;padding-top:6px">
                <button type="button" class="switch${d.settings.allowRegistration ? ' on' : ''}" id="reg-switch"></button>
                <span class="hint" id="reg-hint">${
                  d.settings.allowRegistration ? '已开放：新邮箱可自动注册' : '已关闭：仅管理员创建'
                }</span>
              </div>
            </div>
          </div>
          <div class="field" style="margin-top:12px"><label>算力不足时的提示文案</label>
            <input class="input" name="computeMsg" value="${esc(d.settings.insufficientComputeMsg)}" maxlength="200" /></div>

          <div class="sub-title" style="margin-top:18px">安卓 App 更新</div>
          <p class="panel-desc" style="margin-bottom:10px">
            App 启动时会请求 <code>/api/app/version</code>。远端版本号大于本机时会弹出爱音风格的更新提示；
            勾选「强制更新」时无法跳过。
          </p>
          <div class="app-version-box">
            <div><span>当前线上 APK</span><b>v${esc(av.apkVersionName || '—')}（code ${av.apkVersionCode ?? '—'}）</b></div>
            <div><span>后台推送版本</span><b>v${esc(av.versionName || '—')}（code ${av.versionCode || '—'}）</b></div>
            <div><span>安装包</span><b>${av.apk ? fmtSize(av.apk.size) : '尚未找到 APK'}</b></div>
            <div><span>包更新时间</span><b>${av.apk ? fmtTime(av.apk.modifiedAt) : '—'}</b></div>
            <div><span>用户端版本</span><b>${(av.clients || []).length ? av.clients.map((c) => `v${esc(c.version)} ×${c.count}`).join('，') : '暂无 App 登录记录'}</b></div>
          </div>
          ${av.mismatch ? `<div class="auth-msg err" style="margin:8px 0">版本不一致：后台推送的是 v${esc(av.versionName)}（code ${av.versionCode}），但线上 APK 是 v${esc(av.apkVersionName)}（code ${av.apkVersionCode}）。请至少把下面的版本号改成 ${Number(av.apkVersionCode) + 1}，用户才会收到更新提示。</div>` : ''}
          <p class="hint" style="margin:8px 0 10px">发布新 APK 后，记得把下面的版本号改得比当前版本大，否则用户端不会收到更新提示。</p>
          <div class="grid2">
            <div class="field"><label>最新版本号（整数）</label>
              <input class="input" name="appVersionCode" type="number" min="1" max="1000000" value="${Number(
                d.settings.appVersionCode || 1
              )}" /></div>
            <div class="field"><label>版本名称</label>
              <input class="input" name="appVersionName" maxlength="30" value="${esc(
                d.settings.appVersionName || '1.0.0'
              )}" /></div>
          </div>
          <div class="field"><label>APK 下载地址</label>
            <input class="input" name="appDownloadUrl" value="${esc(
              d.settings.appDownloadUrl || ''
            )}" placeholder="https://你的域名/downloads/anno-ai.apk" /></div>
          <div class="field"><label>更新说明（会显示在更新弹窗里）</label>
            <textarea class="textarea" name="appUpdateNotes" rows="3" maxlength="500">${esc(
              d.settings.appUpdateNotes || ''
            )}</textarea></div>
          <div class="field"><label>强制更新</label>
            <div class="switch-row">
              <button type="button" class="switch${
                d.settings.appUpdateMandatory !== false ? ' on' : ''
              }" id="app-mandatory-switch"></button>
              <span class="hint" id="app-mandatory-hint">${
                d.settings.appUpdateMandatory !== false
                  ? '已开启：旧版本必须更新后才能继续使用'
                  : '已关闭：用户可以稍后再说'
              }</span>
            </div>
          </div>
          <div class="form-actions" style="margin-top:14px"><button class="btn btn-primary" type="submit">保存设置</button></div>
        </form>
      </div>

      <div class="panel" id="panel-mail">
        <div class="panel-head"><h2>邮件通道</h2>
          <span class="badge ${d.mail.configured ? 'badge-ok' : 'badge-err'}">${
            d.mail.configured ? '已配置' : '未配置'
          }</span></div>
        <p class="panel-desc">
          ${
            d.mail.configured
              ? `发信账号 ${esc(d.mail.user)} · 服务器 ${esc(d.mail.host)}:${d.mail.port}`
              : '未配置 SMTP 时，验证码会回显在登录页（仅适合本地调试）。'
          }${d.mail.devFallback ? ' · 已开启调试回显' : ''}${
            d.mail.lastVerify?.at
              ? ` · 最近校验 ${fmtTime(d.mail.lastVerify.at)} → ${d.mail.lastVerify.ok ? '成功' : '失败'}`
              : ''
          }
        </p>
        <div class="form-actions">
          <button class="btn" data-act="mail-verify">检查连接</button>
          <input class="input" id="test-mail-to" style="max-width:240px" placeholder="收件邮箱" />
          <button class="btn" data-act="mail-test">发送测试邮件</button>
        </div>
        ${
          d.mail.lastVerify?.error
            ? `<div class="hint" style="color:var(--danger);margin-top:8px">${esc(d.mail.lastVerify.error)}</div>`
            : ''
        }
      </div>

      <div class="panel" id="panel-users">
        <div class="panel-head"><h2>用户管理</h2><span class="badge">${s.adminUsers.length} 个账号</span></div>
        <div style="overflow-x:auto">
          <table class="table">
            <thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th>对话</th><th>接入</th><th>注册时间</th><th style="text-align:right">操作</th></tr></thead>
            <tbody>
              ${s.adminUsers
                .map(
                  (u) => `<tr>
                    <td class="email">${esc(u.email)}</td>
                    <td><select class="select" data-act="set-role" data-id="${u.id}" style="width:96px;height:28px;padding:0 6px;font-size:12px">
                      <option value="user" ${u.role === 'user' ? 'selected' : ''}>普通用户</option>
                      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
                    </select></td>
                    <td><span class="badge ${u.status === 'active' ? 'badge-ok' : 'badge-err'}">${
                      u.status === 'active' ? '正常' : '停用'
                    }</span></td>
                    <td>${u.conversationCount}</td>
                    <td>${u.providerCount}</td>
                    <td>${new Date(u.createdAt).toLocaleDateString('zh-CN')}</td>
                    <td style="text-align:right;white-space:nowrap">
                      <button class="btn btn-sm btn-ghost" data-act="toggle-user" data-id="${u.id}" data-status="${
                        u.status
                      }">${u.status === 'active' ? '停用' : '启用'}</button>
                      <button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-act="del-user" data-id="${
                        u.id
                      }">删除</button>
                    </td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;

  syncModelCounts();

  let allowReg = d.settings.allowRegistration;
  $('#reg-switch').addEventListener('click', () => {
    allowReg = !allowReg;
    $('#reg-switch').classList.toggle('on', allowReg);
    $('#reg-hint').textContent = allowReg ? '已开放：新邮箱可自动注册' : '已关闭：仅管理员创建';
  });

  let appMandatory = d.settings.appUpdateMandatory !== false;
  $('#app-mandatory-switch')?.addEventListener('click', () => {
    appMandatory = !appMandatory;
    $('#app-mandatory-switch')?.classList.toggle('on', appMandatory);
    const hint = $('#app-mandatory-hint');
    if (hint) hint.textContent = appMandatory ? '已开启：旧版本必须更新后才能继续使用' : '已关闭：用户可以稍后再说';
  });

  $('#site-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const submitBtn = f.querySelector('button[type="submit"]');
    if (submitBtn?.disabled) return;
    const btnLabel = submitBtn?.textContent || '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '保存中…';
    }
    try {
      await api('/api/admin/settings', {
        method: 'PUT',
        body: {
          siteName: f.siteName.value.trim(),
          allowRegistration: allowReg,
          insufficientComputeMsg: f.computeMsg.value.trim(),
          appVersionCode: Number(f.appVersionCode.value),
          appVersionName: f.appVersionName.value.trim(),
          appDownloadUrl: f.appDownloadUrl.value.trim(),
          appUpdateNotes: f.appUpdateNotes.value.trim(),
          appUpdateMandatory: appMandatory,
        },
      });
      toast('设置已保存');
      state.boot.siteName = f.siteName.value.trim();
      document.title = state.boot.siteName;
      renderAdmin();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = btnLabel;
      }
    }
  });
}

/* ── 安全管理（仅超级管理员）───────────────────────────── */

function modelOrderGroupsHtml(groups) {
  return groups
    .map(
      (g, gi) => `<div class="mog">
        <div class="mog-head">
          <span class="mog-index">${gi + 1}</span>
          <b class="mog-name">${esc(g.providerName || '未命名线路')}</b>
          <span class="mog-count">${g.models.length} 个</span>
          <span class="mo-actions">
            <button class="icon-btn mo-btn" data-act="group-order-up" data-index="${gi}" ${
              gi === 0 ? 'disabled' : ''
            } title="整组上移">${icon('chevron', 14)}</button>
            <button class="icon-btn mo-btn mo-down" data-act="group-order-down" data-index="${gi}" ${
              gi === groups.length - 1 ? 'disabled' : ''
            } title="整组下移">${icon('chevron', 14)}</button>
          </span>
        </div>
        <div class="mog-models">
          ${g.models
            .map(
              (it, mi) => `<div class="model-order-row">
                <span class="mo-index">${mi + 1}</span>
                <span class="mo-name">${esc(it.model)}</span>
                <span class="mo-group">${
                  it.label
                    ? `<em class="model-tag ${esc(it.labelColor || '')}">${esc(it.label)}</em>`
                    : '<span class="mo-muted">无标识</span>'
                }</span>
                <span class="mo-actions">
                  <button class="icon-btn mo-btn" data-act="model-order-up" data-gi="${gi}" data-index="${mi}" ${
                    mi === 0 ? 'disabled' : ''
                  } title="上移">${icon('chevron', 14)}</button>
                  <button class="icon-btn mo-btn mo-down" data-act="model-order-down" data-gi="${gi}" data-index="${mi}" ${
                    mi === g.models.length - 1 ? 'disabled' : ''
                  } title="下移">${icon('chevron', 14)}</button>
                </span>
              </div>`
            )
            .join('')}
        </div>
      </div>`
    )
    .join('');
}

function modelOrderPanelHtml(m) {
  const groups = (m && m.groups) || [];
  const total = groups.reduce((n, g) => n + g.models.length, 0);
  return `<div class="panel" id="panel-model-order">
    <div class="panel-head"><h2>模型显示顺序</h2><span class="badge">${groups.length} 条线路 · ${total} 个模型</span></div>
    <p class="panel-desc">
      先排线路顺序（对话页下拉的分组顺序），再排每组里的模型顺序。改完点保存，所有用户都会按这个顺序看到。
    </p>
    ${
      groups.length
        ? `<div class="model-order-list" id="model-order-list">${modelOrderGroupsHtml(groups)}</div>
           <div class="form-actions" style="margin-top:12px">
             <button class="btn btn-primary btn-sm" data-act="model-order-save">保存顺序</button>
             <span class="hint">只影响显示顺序，不影响实际调用</span>
           </div>`
        : '<div class="empty-inline">还没有可用的模型，先在上面「大模型」里接入一条线路。</div>'
    }
  </div>`;
}



/* ── 角色卡本地缓存同步 ─────────────────────────────── */
function marketSyncPanelHtml(d) {
  const st = state.marketSync;
  const cached = st.cached || (d && d.cached) || 0;
  return `<div class="panel" id="panel-market-cache">
    <div class="panel-head"><h2>角色卡缓存</h2><span class="badge">已收录 ${cached} 张</span></div>
    <p class="panel-desc">
      角色卡广场的接口只能按标签查询。开启一次同步后，服务端会按 ID 把全部角色卡拉到本地缓存，
      之后广场就能浏览和搜索所有角色卡，也不再受上游 5 次/分钟的限制。
    </p>
    <div class="form-actions" style="margin-top:0">
      <button class="btn btn-primary btn-sm" data-act="market-sync" ${
        st.running ? 'disabled' : ''
      }>${st.running ? '同步中…' : cached ? (st.next > 1200 ? '重新同步' : '继续同步') : '开始同步'}</button>
      ${
        st.running
          ? '<button class="btn btn-sm" data-act="market-sync-stop">停止</button>'
          : ''
      }
      <span class="hint">${
        st.running
          ? `已扫描到 ID ${st.next - 1}，本次新增 ${st.saved || 0} 张，约每 13 秒一次`
          : '全量约需 5 分钟，中途停止后下次会从断点继续'
      }</span>
    </div>
    <div class="mk-keys">
      ${((d && d.keys) || [])
        .map(
          (k) =>
            `<span class="mk-key${k.used >= k.limit ? ' full' : ''}">Key${k.index} · ${k.used}/${k.limit}</span>`
        )
        .join('')}
    </div>
  </div>`;
}

function refreshMarketSyncPanel() {
  const panel = document.getElementById('panel-market-cache');
  if (panel) panel.outerHTML = marketSyncPanelHtml(state.marketStats || {});
}

async function marketSyncStep() {
  const st = state.marketSync;
  if (!st.running) return;
  try {
    const r = await api('/api/admin/market/sync', {
      method: 'POST',
      body: st.next > 1200 ? { start: 1 } : {},
    });
    st.next = r.next;
    st.cached = r.cached;
    st.saved = (st.saved || 0) + (r.saved || 0);
    state.marketStats = { ...(state.marketStats || {}), cached: r.cached, next: r.next };
    refreshMarketSyncPanel();
    if (r.done) {
      st.running = false;
      toast(`角色卡同步完成，共收录 ${r.cached} 张`);
      refreshMarketSyncPanel();
      return;
    }
    st.timer = setTimeout(marketSyncStep, 13000);
  } catch (err) {
    st.running = false;
    toast(err.message, 'error');
    refreshMarketSyncPanel();
  }
}

function startMarketSync() {
  const st = state.marketSync;
  if (st.running) return;
  st.running = true;
  st.saved = 0;
  refreshMarketSyncPanel();
  marketSyncStep();
}

function feedbackPanelHtml(d) {
  const groups = (d && d.groups) || [];
  const total = (d && d.total) || 0;
  return `<div class="panel" id="panel-feedback">
    <div class="panel-head"><h2>用户反馈</h2><span class="badge">${total} 条 · ${groups.length} 位用户</span></div>
    <p class="panel-desc">按用户归类，最新的在最前面。可以标记已处理，处理完的记录仍会保留。</p>
    ${
      groups.length
        ? groups
            .map(
              (g) => `<div class="fb-group">
                <div class="fb-group-head">
                  <b>${esc(g.email)}</b>
                  <span>${g.count} 条 · 最近 ${fmtTime(g.lastAt)}</span>
                </div>
                ${g.items
                  .map(
                    (it) => `<div class="fb-item${it.status === 'resolved' ? ' resolved' : ''}">
                      <div class="fb-content">${it.content ? esc(it.content) : '<span class="hint">（只上传了截图）</span>'}</div>
                      ${
                        it.images && it.images.length
                          ? `<div class="fb-thumbs">${it.images.map((n) => `<img class="fb-thumb" src="${esc(feedbackImageUrl(n))}" data-act="fb-view" data-url="${esc(feedbackImageUrl(n))}" loading="lazy" alt="反馈截图" />`).join('')}</div>`
                          : ''
                      }
                      <div class="fb-meta">
                        <span>${fmtTime(it.createdAt)}</span>
                        <span class="fb-status ${it.status}">${it.status === 'resolved' ? '已处理' : '待处理'}</span>
                      </div>
                      <div class="fb-actions">
                        <button class="btn btn-sm" data-act="fb-toggle" data-id="${it.id}" data-status="${
                          it.status === 'resolved' ? 'open' : 'resolved'
                        }">${it.status === 'resolved' ? '重新打开' : '标记已处理'}</button>
                        <button class="btn btn-sm btn-danger" data-act="fb-delete" data-id="${it.id}">删除</button>
                      </div>
                    </div>`
                  )
                  .join('')}
              </div>`
            )
            .join('')
        : '<div class="empty-inline">还没有收到反馈。用户可以在对话页右上角提交。</div>'
    }
  </div>`;
}

function refreshFeedbackPanel() {
  const panel = document.getElementById('panel-feedback');
  if (panel) panel.outerHTML = feedbackPanelHtml(state.adminFeedback);
}

function usagePanelHtml(d) {
  const u = state.usage || { period: '', items: [], alerts: [] };
  const statusText = { ok: '正常', warn: '预警', over: '已超额', unset: '未设额度', off: '不统计' };
  return `<div class="panel" id="panel-usage">
    <div class="panel-head"><h2>接口用量与额度</h2><span class="badge">${esc(u.period || '')}</span></div>
    <p class="panel-desc">
      按官方计费口径统计：Tavily 搜索 basic 1 credit/次、advanced 2 credits/次；网页提取每 5 个成功 URL 1 credit；
      阿里云文档解析按页（图片 1 张 = 1 页，文本 2000 字 = 1 页）。
      达到告警阈值会给超级管理员发邮件，邮件里可以直接关闭对应接口。
    </p>
    ${
      u.items && u.items.length
        ? `<div class="usage-list">${u.items.map((it) => usageItemHtml(it, statusText)).join('')}</div>`
        : '<div class="empty-inline">还没有需要统计的接口</div>'
    }
    ${
      u.alerts && u.alerts.length
        ? `<h4 class="sub-title">最近告警</h4><div class="table-wrap"><table class="table compact">
            <thead><tr><th>时间</th><th>配额组</th><th>详情</th></tr></thead><tbody>
            ${u.alerts
              .map(
                (a) =>
                  `<tr><td class="mono">${fmtTime(a.created_at)}</td><td class="mono">${esc(
                    a.scope
                  )}</td><td>${esc(a.detail || '')}</td></tr>`
              )
              .join('')}
          </tbody></table></div>`
        : ''
    }
  </div>`;
}

function usageItemHtml(it, statusText) {
  const names = (it.providers || []).map((p) => p.name + (p.enabled ? '' : '（已停用）')).join(' / ');
  const cls = { ok: 'badge-ok', warn: 'badge-warn', over: 'badge-err', unset: '', off: '' }[it.status] || '';
  return `<div class="usage-item">
    <div class="usage-top">
      <div class="usage-name">
        <b>${esc(it.group || names || it.scope)}</b>
        <span class="sub">${esc(names)}</span>
      </div>
      <span class="badge ${cls}">${statusText[it.status] || it.status}</span>
    </div>
    <div class="usage-bar"><i class="${it.status}" style="width:${Math.min(100, it.percent)}%"></i></div>
    <div class="usage-meta">
      <span>总计 ${fmtNum(it.used)} / ${it.monthly || '—'} ${esc(it.unitLabel)}</span>
      <span>每人 ${it.shareDisplay} ${esc(it.unitLabel)}</span>
      <span>预估 ${esc(it.costText)}</span>
      <span>${it.percent}%</span>
    </div>
    <div class="usage-share">
      共 ${it.users} 个账号参与平分，单个账号最多 ${it.shareDisplay} ${esc(it.unitLabel)}，用完不占用他人份额
    </div>
    ${
      it.topUsers && it.topUsers.length
        ? `<div class="usage-users">${it.topUsers
            .map((u) => `<span><b>${esc(u.email)}</b> ${fmtNum(u.units)} ${esc(it.unitLabel)}</span>`)
            .join('')}</div>`
        : ''
    }
    <div class="usage-foot">
      <span class="hint">${it.notifiedAt ? '已发告警邮件 ' + fmtTime(it.notifiedAt) : '未触发告警'}</span>
      <span class="usage-btns">
        <button class="btn btn-sm btn-ghost" data-act="reset-usage" data-scope="${esc(it.scope)}">重置本月用量</button>
        <button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-act="disable-scope" data-scope="${esc(it.scope)}">关闭该组接口</button>
      </span>
    </div>
  </div>`;
}

function secStat(value, label, tone = '') {
  return `<div class="stat${tone ? ' ' + tone : ''}"><b>${value}</b><span>${esc(label)}</span></div>`;
}

function statusBadge(u) {
  if (u.ban) return `<span class="badge badge-err">${u.ban.permanent ? '永久封禁' : '封禁中'}</span>`;
  if (u.status !== 'active') return '<span class="badge badge-err">已停用</span>';
  return '<span class="badge badge-ok">正常</span>';
}

/* ── 公告管理 ─────────────────────────────────────────── */
function announcementToneText(tone) {
  return { info: '普通', important: '重要', success: '好消息' }[tone] || '普通';
}

function announcementRowsHtml(items) {
  if (!items || !items.length) {
    return '<tr><td colspan="5"><div class="empty-inline">还没有公告，先在上面写一条吧</div></td></tr>';
  }
  return items
    .map(
      (a) => `<tr data-ann-row="${a.id}">
        <td><b>${esc(a.title)}</b>${a.image_id ? ' <span class="badge">图文</span>' : ''}</td>
        <td><span class="ann-tone ann-tone-${esc(a.tone || 'info')}">${announcementToneText(a.tone)}</span></td>
        <td>${a.enabled ? '<span class="badge badge-ok">已启用</span>' : '<span class="badge">已停用</span>'}</td>
        <td class="mono">${fmtTime(a.updated_at)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-sm btn-ghost" data-act="announce-edit" data-id="${a.id}">编辑</button>
          <button class="btn btn-sm btn-ghost" data-act="announce-toggle" data-id="${a.id}" data-enabled="${a.enabled ? 1 : 0}">${a.enabled ? '停用' : '启用'}</button>
          <button class="btn btn-sm btn-ghost" data-act="announce-del" data-id="${a.id}">删除</button>
        </td>
      </tr>`
    )
    .join('');
}

function renderAnnouncementRows(items) {
  state.announcements = items || [];
  const tbody = $('#announce-rows');
  if (tbody) tbody.innerHTML = announcementRowsHtml(state.announcements);
  const badge = $('#ann-count');
  if (badge) badge.textContent = `${state.announcements.length} 条`;
}

function resetAnnouncementForm() {
  const form = $('#announce-form');
  if (!form) return;
  form.reset();
  form.elements.id.value = '';
  state.announceEditingId = null;
  state.announceImage = null;
  state.announceKeepImage = null;
  state.announceRemoveImage = false;
  state.announceEnabled = true;
  const sw = $('#announce-enabled');
  if (sw) sw.classList.add('on');
  const hint = $('#announce-enabled-hint');
  if (hint) hint.textContent = '已启用：用户会看到这条公告';
  const name = $('#announce-image-name');
  if (name) name.textContent = '未选择';
  const preview = $('#announce-image-preview');
  if (preview) preview.innerHTML = '';
  const rm = document.querySelector('[data-act="announce-remove-image"]');
  if (rm) rm.hidden = true;
  const btn = $('#announce-submit');
  if (btn) btn.textContent = '发布公告';
}

async function refreshAnnouncements() {
  const r = await api('/api/admin/announcements');
  renderAnnouncementRows(r.items || []);
}

async function uploadAnnouncementImage(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('请选择图片文件', 'error');
  if (file.size > 5 * 1024 * 1024) return toast('图片不能超过 5MB', 'error');
  const nameEl = $('#announce-image-name');
  if (nameEl) nameEl.textContent = '上传中…';
  try {
    const target = typeof apiPath === 'function' ? apiPath('/api/admin/announcements/image') : '/api/admin/announcements/image';
    const res = await fetch(target, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json?.error?.message || '上传失败');
    state.announceImage = json.image;
    state.announceRemoveImage = false;
    if (nameEl) nameEl.textContent = `${json.image.name} · ${Math.round(json.image.size / 1024)}KB`;
    const preview = $('#announce-image-preview');
    if (preview) preview.innerHTML = `<img src="${esc(json.image.url)}" alt="公告配图预览" />`;
    const rm = document.querySelector('[data-act="announce-remove-image"]');
    if (rm) rm.hidden = false;
  } catch (err) {
    if (nameEl) nameEl.textContent = '未选择';
    toast(err.message, 'error');
  }
}

function fillAnnouncementForm(id) {
  const a = (state.announcements || []).find((x) => x.id === id);
  const form = $('#announce-form');
  if (!a || !form) return;
  form.elements.id.value = a.id;
  form.elements.title.value = a.title;
  form.elements.content.value = a.content;
  form.elements.tone.value = a.tone || 'info';
  state.announceEditingId = a.id;
  state.announceImage = null;
  state.announceKeepImage = a.image_id || null;
  state.announceRemoveImage = false;
  state.announceEnabled = Boolean(a.enabled);
  const sw = $('#announce-enabled');
  if (sw) sw.classList.toggle('on', state.announceEnabled);
  const hint = $('#announce-enabled-hint');
  if (hint) hint.textContent = state.announceEnabled ? '已启用：用户会看到这条公告' : '已停用：不会对用户展示';
  const name = $('#announce-image-name');
  if (name) name.textContent = a.image_id ? '已上传配图' : '未选择';
  const preview = $('#announce-image-preview');
  if (preview) preview.innerHTML = a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="公告配图" />` : '';
  const rm = document.querySelector('[data-act="announce-remove-image"]');
  if (rm) rm.hidden = !a.image_id;
  const btn = $('#announce-submit');
  if (btn) btn.textContent = '保存修改';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitAnnouncementForm(form) {
  const title = form.elements.title.value.trim();
  const content = form.elements.content.value.trim();
  if (!title) return toast('请填写公告标题', 'error');
  if (!content) return toast('请填写公告内容', 'error');
  let imageId = null;
  if (state.announceImage) imageId = state.announceImage.id;
  else if (!state.announceRemoveImage && state.announceKeepImage) imageId = state.announceKeepImage;
  const payload = {
    title,
    content,
    tone: form.elements.tone.value,
    enabled: state.announceEnabled,
    imageId,
  };
  const btn = $('#announce-submit');
  if (btn) btn.disabled = true;
  try {
    if (state.announceEditingId) await api(`/api/admin/announcements/${state.announceEditingId}`, { method: 'PUT', body: payload });
    else await api('/api/admin/announcements', { method: 'POST', body: payload });
    toast(state.announceEditingId ? '公告已更新' : '公告已发布');
    resetAnnouncementForm();
    await refreshAnnouncements();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ── 后台查看用户聊天记录 ─────────────────────────────── */
async function loadChatLogConversations(uid) {
  const box = $('#chatlog-convs');
  const view = $('#chatlog-view');
  if (!box) return;
  box.innerHTML = '<div class="empty-inline"><span class="spin"></span> 加载中…</div>';
  if (view) view.innerHTML = '<div class="empty-inline">选择左侧会话查看消息</div>';
  try {
    const r = await api(`/api/admin/users/${uid}/conversations`);
    state.chatlogUser = r.user;
    const list = r.conversations || [];
    box.innerHTML = list.length
      ? list
          .map(
            (c) => `<button class="chatlog-conv" data-act="chatlog-open" data-uid="${uid}" data-cid="${c.id}">
              <b>${esc(c.title || '未命名对话')}</b>
              <span>${esc(c.personaName || '无角色')} · ${c.messageCount} 条 · ${fmtTime(c.updatedAt)}</span>
            </button>`
          )
          .join('')
      : '<div class="empty-inline">该用户还没有聊天记录</div>';
  } catch (err) {
    box.innerHTML = `<div class="empty-inline">${esc(err.message)}</div>`;
  }
}

function chatLogMessageHtml(m, personaName) {
  const role = m.role === 'user' ? 'user' : m.role === 'system' ? 'system' : 'assistant';
  const label = role === 'user' ? '用户' : role === 'system' ? '系统' : personaName || 'AI';
  const provider = m.meta?.provider?.name;
  const content = esc(m.content || '').replace(/\n/g, '<br />');
  return `<div class="chatlog-msg ${role}">
    <div class="chatlog-role">${esc(label)} · ${fmtTime(m.createdAt)}${provider ? ` · ${esc(provider)}` : ''}</div>
    ${m.reasoning ? `<details class="chatlog-reason"><summary>思考过程</summary><div>${esc(m.reasoning).replace(/\n/g, '<br />')}</div></details>` : ''}
    <div class="chatlog-text">${content || '<span class="hint">（空消息）</span>'}</div>
  </div>`;
}

async function openChatLog(uid, cid) {
  const view = $('#chatlog-view');
  if (!view) return;
  view.innerHTML = '<div class="empty-inline"><span class="spin"></span> 加载消息…</div>';
  $$('.chatlog-conv').forEach((b) => b.classList.toggle('on', Number(b.dataset.cid) === Number(cid)));
  try {
    const r = await api(`/api/admin/users/${uid}/conversations/${cid}`);
    const c = r.conversation;
    view.innerHTML = `<div class="chatlog-head">
        <b>${esc(c.title || '未命名对话')}</b>
        <span class="hint">${esc(c.personaName || '无角色')} · ${fmtTime(c.createdAt)}${c.truncated ? ' · 仅显示最近 500 条' : ''}</span>
      </div>
      <div class="chatlog-messages">${(c.messages || []).map((m) => chatLogMessageHtml(m, c.personaName)).join('') || '<div class="empty-inline">没有消息</div>'}</div>`;
  } catch (err) {
    view.innerHTML = `<div class="empty-inline">${esc(err.message)}</div>`;
  }
}

async function renderSecurity() {
  appEl.innerHTML = `<div class="loading-screen"><span class="spin"></span> 正在加载安全管理…</div>`;
  let d;
  let users;
  try {
    const [a, b, c] = await Promise.all([
      api('/api/admin/security'),
      api('/api/admin/users'),
      api('/api/admin/announcements'),
    ]);
    d = a;
    users = b.users;
    state.security = a;
    state.adminUsers = users;
    state.announcements = c.items || [];
  } catch (err) {
    toast(err.message, 'error');
    navigate('/admin');
    return;
  }

  const st = d.stats;
  const s = d.settings;

  appEl.innerHTML = `
  <div class="page">
    <div class="page-head">
      <button class="icon-btn" data-act="go" data-to="/admin" title="返回后台">${icon('back')}</button>
      <h1>安全管理</h1>
      <span class="badge badge-brand">超级管理员</span>
      <div class="spacer"></div>
      <button class="btn btn-sm btn-ghost" data-act="go" data-to="/admin">返回后台</button>
    </div>

    <div class="page-body">
      <nav class="page-nav">
        <a data-act="scroll-panel" data-target="sec-policy" class="on">注册与登录</a>
        <a data-act="scroll-panel" data-target="sec-users">账号管理</a>
        <a data-act="scroll-panel" data-target="sec-broadcast">全体邮件</a>
        <a data-act="scroll-panel" data-target="sec-announce">站点公告</a>
        <a data-act="scroll-panel" data-target="sec-chatlogs">聊天记录</a>
        <a data-act="scroll-panel" data-target="sec-bans">封禁名单</a>
        <a data-act="scroll-panel" data-target="sec-ip">IP 与流量</a>
        <a data-act="scroll-panel" data-target="sec-logins">登录登记</a>
        <a data-act="scroll-panel" data-target="sec-events">安全事件</a>
      </nav>

      <div class="stats">
        ${secStat(st.banned, '封禁账号')}
        ${secStat(st.blockedIps, '封禁 IP')}
        ${secStat(st.logins24h, '24h 登录')}
        ${secStat(st.failed24h, '24h 失败')}
        ${secStat(st.registrations24h, '24h 注册')}
        ${secStat(st.activeSessions, '活跃会话')}
        ${secStat(st.events24h, '24h 安全事件')}
      </div>

      <div class="panel" id="sec-policy">
        <div class="panel-head"><h2>注册与登录策略</h2></div>
        <p class="panel-desc">
          注册必须输入这里设置的分部群号之一；群号留空则不校验。登录支持「邮箱 + 密码」或「邮箱 + 邮箱验证码」，
          密码登录与注册需图形验证码，邮箱码登录靠验证码与频率限制；会话绑定「设备 + IP」并保持 ${state.boot.sessionDays || 7} 天。
        </p>
        <form id="sec-policy-form">
          <div class="field">
            <label>允许注册的分部群号</label>
            <textarea class="textarea" name="groups" rows="4" placeholder="每行一个，或用逗号 / 空格分隔&#10;例如：&#10;10001&#10;10002">${esc(
              (s.registerGroupNumbers || []).join('\n')
            )}</textarea>
            <div class="hint">已设置 ${(s.registerGroupNumbers || []).length} 个群号；用户注册时必须填写其中之一。</div>
          </div>

          <div class="grid2" style="margin-top:14px">
            <div class="field">
              <label>每分钟请求阈值</label>
              <input class="input" name="rateLimit" type="number" min="30" max="20000" value="${s.rateLimit}" />
              <div class="hint">单 IP 一分钟内超过该值记为异常流量</div>
            </div>
            <div class="field">
              <label>登录方式</label>
              <div class="hint" style="padding-top:9px">邮箱 + 密码 或 邮箱 + 验证码，均需图形验证码</div>
            </div>
          </div>

          <div class="grid2" style="margin-top:14px">
            <div class="field">
              <label>异常流量自动封禁</label>
              <div class="switch-row">
                <button type="button" class="switch${s.autoBlock ? ' on' : ''}" id="auto-block-switch"></button>
                <span class="hint" id="auto-block-hint">${
                  s.autoBlock ? '已开启：超阈值自动封禁该 IP' : '已关闭：只记录不封禁'
                }</span>
              </div>
            </div>
            <div class="field">
              <label>自动封禁时长（分钟）</label>
              <input class="input" name="autoBlockMinutes" type="number" min="1" max="1440" value="${s.autoBlockMinutes}" />
            </div>
          </div>

          <div class="field" style="margin-top:14px">
            <label>普通用户自建 API</label>
            <div class="switch-row">
              <button type="button" class="switch${s.userProvidersOpen ? ' on' : ''}" id="user-providers-switch"></button>
              <span class="hint" id="user-providers-hint">${
                s.userProvidersOpen
                  ? '已开放：用户可在「设置 → 算力接入」里添加自己的 API'
                  : '暂未开放：入口置灰，点击提示等待后续版本'
              }</span>
            </div>
          </div>

          <div class="field" style="margin-top:14px">
            <label>封禁告知文案（展示给被封禁用户）</label>
            <textarea class="textarea" name="banNotice" rows="3">${esc(s.banNotice)}</textarea>
          </div>

          <div class="form-actions" style="margin-top:14px">
            <button class="btn btn-primary" type="submit">保存安全设置</button>
          </div>
        </form>
      </div>

      <div class="panel" id="sec-users">
        <div class="panel-head"><h2>账号管理</h2><span class="badge">${users.length} 个账号</span></div>
        <p class="panel-desc">可以新增账号、改邮箱 / 角色、按时间封禁或永久封禁。封禁后该账号立即无法调用任何接口，登录或刷新时只会看到封禁告知页。</p>
        <form id="sec-add-user" class="inline-form">
          <input class="input" name="email" type="email" placeholder="新账号邮箱" required />
          <select class="input" name="role" style="max-width:130px">
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
          <button class="btn btn-primary" type="submit">新增账号</button>
          <span class="hint">新增的账号用邮箱验证码登录</span>
        </form>

        <div class="table-toolbar">
          <input class="input input-sm" id="sec-user-search" placeholder="搜索邮箱…" />
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>邮箱</th><th>角色</th><th>状态</th><th>最近 IP</th><th>最近登录</th><th style="text-align:right">操作</th></tr></thead>
            <tbody id="sec-user-rows">
              ${users.map((u) => secUserRow(u)).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel" id="sec-broadcast">
        <div class="panel-head">
          <h2>全体邮件通知</h2>
          <span class="badge" id="bc-recipient-badge">${users.length} 个已注册邮箱</span>
        </div>
        <p class="panel-desc">
          给所有已注册账号的邮箱发一封品牌化通知，支持文字和一张配图。发送在后台逐封进行
          （QQ 邮箱有频率限制），可以离开本页，进度会保留。
        </p>

        <form id="sec-broadcast-form">
          <div class="field">
            <label>邮件主题</label>
            <input class="input" name="subject" maxlength="120" placeholder="例如：本周更新与维护通知" />
          </div>
          <div class="field" style="margin-top:14px">
            <label>正文</label>
            <textarea class="textarea" name="content" rows="8" maxlength="8000" placeholder="写点想对大家说的话…&#10;&#10;支持换行，链接会自动识别。"></textarea>
            <div class="hint">正文会放进品牌化模板里；建议控制在 500 字以内，阅读体验更好。</div>
          </div>
          <div class="field" style="margin-top:14px">
            <label>配图（可选，建议宽度 ≥1000px；PNG / JPG / GIF / WEBP，≤5MB）</label>
            <div class="bc-image-row">
              <button type="button" class="btn btn-sm" data-act="bc-pick-image">选择图片</button>
              <span class="hint" id="bc-image-name">未选择</span>
              <button type="button" class="btn btn-sm btn-ghost" data-act="bc-clear-image" hidden>清除</button>
            </div>
            <input type="file" id="bc-image-input" accept="image/png,image/jpeg,image/gif,image/webp" hidden />
            <div class="bc-image-preview" id="bc-image-preview"></div>
          </div>
          <div class="form-actions" style="margin-top:16px">
            <button class="btn btn-primary" type="submit" id="bc-send-btn">发送给全部账号</button>
            <button class="btn" type="button" data-act="bc-send-test">先发给我自己</button>
            <span class="hint">正式发送前会二次确认；发送中可以取消。QQ 邮箱个人账号有每日发信量限制，收件人较多时建议分批。</span>
          </div>
        </form>

        <div id="bc-job"></div>

        <div class="panel-head" style="margin-top:24px">
          <h2>发送记录</h2>
          <span class="badge">最近 20 次</span>
        </div>
        <div class="table-wrap" id="bc-history"><div class="empty-inline">加载中…</div></div>
      </div>

      <div class="panel" id="sec-announce">
        <div class="panel-head">
          <h2>站点公告</h2>
          <span class="badge" id="ann-count">${(state.announcements || []).length} 条</span>
        </div>
        <p class="panel-desc">
          发布后，用户打开主页面会看到爱音风格的公告弹窗；同一版本只提示一次，用户点「不再提示」后不再打扰。
          修改公告内容会重新提示。支持文字 + 一张配图（≤5MB）。
        </p>
        <form id="announce-form">
          <input type="hidden" name="id" value="" />
          <div class="grid2">
            <div class="field">
              <label>公告标题</label>
              <input class="input" name="title" maxlength="120" placeholder="例如：本周维护与更新" />
            </div>
            <div class="field">
              <label>样式</label>
              <select class="input" name="tone">
                <option value="info">普通通知（粉色）</option>
                <option value="important">重要提醒（橙色）</option>
                <option value="success">好消息（绿色）</option>
              </select>
            </div>
          </div>
          <div class="field" style="margin-top:12px">
            <label>公告正文</label>
            <textarea class="textarea" name="content" rows="6" maxlength="5000" placeholder="支持换行，链接会自动识别。&#10;&#10;—— 千早爱音"></textarea>
          </div>
          <div class="field">
            <label>配图（可选，PNG / JPG / GIF / WEBP，≤5MB）</label>
            <div class="bc-image-row">
              <input type="file" id="announce-image" accept="image/png,image/jpeg,image/gif,image/webp" />
              <span class="hint" id="announce-image-name">未选择</span>
              <button type="button" class="btn btn-sm btn-ghost" data-act="announce-remove-image" hidden>移除配图</button>
            </div>
            <div class="bc-image-preview" id="announce-image-preview"></div>
          </div>
          <div class="field">
            <label>发布状态</label>
            <div class="switch-row">
              <button type="button" class="switch on" id="announce-enabled"></button>
              <span class="hint" id="announce-enabled-hint">已启用：用户会看到这条公告</span>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit" id="announce-submit">发布公告</button>
            <button class="btn btn-ghost" type="button" data-act="announce-reset">清空表单</button>
          </div>
        </form>
        <div class="sub-title" style="margin-top:18px">已发布公告</div>
        <div class="table-wrap">
          <table class="table compact">
            <thead><tr><th>标题</th><th>样式</th><th>状态</th><th>更新时间</th><th style="text-align:right">操作</th></tr></thead>
            <tbody id="announce-rows">${announcementRowsHtml(state.announcements || [])}</tbody>
          </table>
        </div>
      </div>

      <div class="panel" id="sec-chatlogs">
        <div class="panel-head"><h2>用户聊天记录</h2><span class="badge">管理员可见</span></div>
        <p class="panel-desc">
          选择一位普通用户，查看其会话列表与消息内容。仅用于处理举报、排障与合规审计；
          单次最多展示最近 500 条消息。
        </p>
        <div class="chatlog-toolbar">
          <select class="input" id="chatlog-user">
            <option value="">选择用户…</option>
            ${users
              .filter((u) => u.role !== 'admin')
              .map((u) => `<option value="${u.id}">${esc(u.email)}（${u.conversationCount || 0} 个会话）</option>`)
              .join('')}
          </select>
          <button class="btn btn-sm" type="button" data-act="chatlog-refresh">刷新</button>
        </div>
        <div class="chatlog-layout">
          <div class="chatlog-convs" id="chatlog-convs">
            <div class="empty-inline">选择用户后加载会话</div>
          </div>
          <div class="chatlog-view" id="chatlog-view">
            <div class="empty-inline">选择左侧会话查看消息</div>
          </div>
        </div>
      </div>

      <div class="panel" id="sec-bans">
        <div class="panel-head"><h2>封禁名单</h2><span class="badge">${d.bannedUsers.length} 个</span></div>
        <p class="panel-desc">到期会自动解封；永久封禁需要手动解封。</p>
        ${
          d.bannedUsers.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>邮箱</th><th>原因</th><th>解封时间</th><th>最近 IP</th><th style="text-align:right">操作</th></tr></thead>
                <tbody>
                  ${d.bannedUsers
                    .map(
                      (u) => `<tr>
                        <td class="email">${esc(u.email)}</td>
                        <td>${esc(u.reason || '—')}</td>
                        <td>${u.until === 0 ? '<b style="color:var(--danger)">永久</b>' : fmtTime(u.until)}</td>
                        <td class="mono">${esc(u.lastIp || '—')}</td>
                        <td style="text-align:right"><button class="btn btn-sm" data-act="sec-unban" data-id="${u.id}">解封</button></td>
                      </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
            : '<div class="empty-inline">当前没有被封禁的账号</div>'
        }
      </div>

      <div class="panel" id="sec-ip">
        <div class="panel-head"><h2>IP 封禁与异常流量</h2></div>
        <p class="panel-desc">手动封禁立即生效；自动封禁由「异常流量」策略触发。本机 127.0.0.1 不会被自动封禁。</p>
        <form id="sec-block-form" class="inline-form">
          <input class="input" name="ip" placeholder="IP 地址，例如 203.0.113.9" required style="max-width:220px" />
          <input class="input" name="minutes" type="number" min="1" value="60" style="max-width:120px" />
          <span class="hint">分钟</span>
          <input class="input" name="reason" placeholder="原因（可选）" style="max-width:220px" />
          <button class="btn btn-danger" type="submit">封禁该 IP</button>
        </form>

        <div class="split">
          <div>
            <h3 class="sub-title">已封禁 IP</h3>
            ${
              d.blocks.length
                ? `<table class="table compact"><thead><tr><th>IP</th><th>原因</th><th>到期</th><th></th></tr></thead><tbody>
                    ${d.blocks
                      .map(
                        (b) => `<tr><td class="mono">${esc(b.ip)}</td><td>${esc(b.reason || '—')}</td><td>${fmtTime(
                          b.until
                        )}</td><td style="text-align:right"><button class="btn btn-sm btn-ghost" data-act="sec-unblock" data-ip="${esc(
                          b.ip
                        )}">解封</button></td></tr>`
                      )
                      .join('')}
                  </tbody></table>`
                : '<div class="empty-inline">暂无</div>'
            }
          </div>
          <div>
            <h3 class="sub-title">近一分钟请求量</h3>
            ${
              (d.traffic || []).length
                ? `<table class="table compact"><thead><tr><th>IP</th><th>请求数</th><th></th></tr></thead><tbody>
                    ${(d.traffic || [])
                      .map(
                        (t) => `<tr><td class="mono">${esc(t.ip)}</td><td>${t.perMinute}</td>
                        <td style="text-align:right"><button class="btn btn-sm btn-ghost" data-act="sec-block-quick" data-ip="${esc(
                          t.ip
                        )}">封禁</button></td></tr>`
                      )
                      .join('')}
                  </tbody></table>`
                : '<div class="empty-inline">暂无流量记录</div>'
            }
          </div>
        </div>
      </div>

      <div class="panel" id="sec-logins">
        <div class="panel-head"><h2>登录与 IP 登记</h2><span class="badge">最近 ${d.logins.length} 条</span></div>
        <p class="panel-desc">记录每次验证码发送、登录成功 / 失败与登出，含 IP、设备标识与浏览器 UA。</p>
        <div class="table-wrap">
          <table class="table compact">
            <thead><tr><th>时间</th><th>邮箱</th><th>类型</th><th>结果</th><th>IP</th><th>设备</th></tr></thead>
            <tbody>
              ${d.logins
                .map(
                  (l) => `<tr>
                    <td class="mono">${fmtTime(l.createdAt)}</td>
                    <td class="email">${esc(l.email || '—')}</td>
                    <td>${esc(loginKindText(l.kind))}</td>
                    <td>${l.ok ? '<span class="badge badge-ok">成功</span>' : `<span class="badge badge-err">失败</span> ${esc(l.reason || '')}`}</td>
                    <td class="mono">${esc(l.ip || '—')}</td>
                    <td class="mono">${esc(l.device || '—')}</td>
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel" id="sec-events">
        <div class="panel-head"><h2>安全事件</h2><span class="badge">${d.events.length} 条</span></div>
        <p class="panel-desc">异常流量、爬虫蜜罐、封禁与策略变更都会记录在这里。</p>
        ${
          d.events.length
            ? `<div class="table-wrap"><table class="table compact">
                <thead><tr><th>时间</th><th>类型</th><th>IP</th><th>详情</th></tr></thead>
                <tbody>${d.events
                  .map(
                    (e) => `<tr><td class="mono">${fmtTime(e.createdAt)}</td><td>${esc(
                      eventKindText(e.kind)
                    )}</td><td class="mono">${esc(e.ip || '—')}</td><td>${esc(e.detail || '')}</td></tr>`
                  )
                  .join('')}</tbody>
              </table></div>`
            : '<div class="empty-inline">暂无安全事件</div>'
        }
        <div class="form-actions" style="margin-top:12px">
          <button class="btn btn-sm btn-ghost" data-act="sec-purge">清理 7 天前的日志</button>
        </div>
      </div>
    </div>
  </div>`;

  /* 开关 */
  let autoBlock = s.autoBlock;
  $('#auto-block-switch')?.addEventListener('click', () => {
    autoBlock = !autoBlock;
    $('#auto-block-switch').classList.toggle('on', autoBlock);
    $('#auto-block-hint').textContent = autoBlock ? '已开启：超阈值自动封禁该 IP' : '已关闭：只记录不封禁';
  });

  let userProvidersOpen = s.userProvidersOpen;
  $('#user-providers-switch')?.addEventListener('click', () => {
    userProvidersOpen = !userProvidersOpen;
    $('#user-providers-switch').classList.toggle('on', userProvidersOpen);
    $('#user-providers-hint').textContent = userProvidersOpen
      ? '已开放：用户可在「设置 → 算力接入」里添加自己的 API'
      : '暂未开放：入口置灰，点击提示等待后续版本';
  });
  state._secPolicy = () => ({ autoBlock, userProvidersOpen });

  /* 用户搜索 */
  $('#sec-user-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#sec-user-rows tr').forEach((tr) => {
      tr.style.display = !q || tr.dataset.email.includes(q) ? '' : 'none';
    });
  });

  state.bcImage = null;
  state.announceImage = null;
  state.announceKeepImage = null;
  state.announceRemoveImage = false;
  state.announceEditingId = null;
  state.announceEnabled = true;
  resetAnnouncementForm();
  $('#announce-enabled')?.addEventListener('click', () => {
    state.announceEnabled = !state.announceEnabled;
    $('#announce-enabled')?.classList.toggle('on', state.announceEnabled);
    const hint = $('#announce-enabled-hint');
    if (hint) hint.textContent = state.announceEnabled ? '已启用：用户会看到这条公告' : '已停用：不会对用户展示';
  });
  loadBroadcastJobs();
}

/* ── 全体邮件通知 ─────────────────────────────────────── */

const BC_STATUS = {
  queued: '排队中',
  sending: '发送中',
  done: '已完成',
  canceled: '已取消',
  failed: '失败',
};

function broadcastStatusBadge(status) {
  const cls = status === 'done' ? ' badge-ok' : status === 'failed' ? ' badge-err' : '';
  return `<span class="badge${cls}">${BC_STATUS[status] || status}</span>`;
}

async function loadBroadcastJobs() {
  const box = $('#bc-history');
  if (!box) return;
  try {
    const r = await api('/api/admin/broadcast');
    state.bcRecipientCount = r.recipientCount;
    const badge = $('#bc-recipient-badge');
    if (badge) badge.textContent = `${r.recipientCount} 个已注册邮箱`;
    if (!r.jobs.length) {
      box.innerHTML = '<div class="empty-inline">还没有发送记录</div>';
      return;
    }
    box.innerHTML = `<table class="table compact">
      <thead><tr><th>时间</th><th>主题</th><th>进度</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
      <tbody>${r.jobs
        .map(
          (j) => `<tr>
            <td class="mono">${fmtTime(j.created_at)}</td>
            <td>${esc(j.subject)}</td>
            <td class="mono">${j.sent}/${j.total}${
              j.failed ? ` · <span style="color:var(--danger)">失败 ${j.failed}</span>` : ''
            }</td>
            <td>${broadcastStatusBadge(j.status)}</td>
            <td style="text-align:right">${
              ['queued', 'sending'].includes(j.status)
                ? `<button class="btn btn-sm btn-ghost" data-act="bc-cancel" data-id="${j.id}">取消</button>`
                : ''
            }</td>
          </tr>`
        )
        .join('')}</tbody>
    </table>`;

    // 页面刷新后自动接上正在发送的任务
    const active = r.jobs.find((j) => ['queued', 'sending'].includes(j.status));
    if (active) {
      renderBroadcastJob(active);
      pollBroadcastJob(active.id);
    }
  } catch (err) {
    box.innerHTML = `<div class="empty-inline">${esc(err.message)}</div>`;
  }
}

async function uploadBroadcastImage(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('请选择图片文件', 'error');
  if (file.size > 5 * 1024 * 1024) return toast('图片不能超过 5MB', 'error');
  const nameEl = $('#bc-image-name');
  if (nameEl) nameEl.textContent = '上传中…';
  try {
    const res = await fetch(apiPath(`/api/admin/broadcast/image?name=${encodeURIComponent(file.name)}`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) throw new Error(json?.error?.message || '上传失败');
    state.bcImage = json.image;
    if (nameEl) nameEl.textContent = `${json.image.name} · ${Math.round(json.image.size / 1024)}KB`;
    const preview = $('#bc-image-preview');
    if (preview) preview.innerHTML = `<img src="${json.image.url}" alt="配图预览" />`;
    const clear = document.querySelector('#sec-broadcast [data-act="bc-clear-image"]');
    clear?.removeAttribute('hidden');
  } catch (err) {
    if (nameEl) nameEl.textContent = '未选择';
    toast(err.message, 'error');
  }
}

function renderBroadcastJob(job) {
  const box = $('#bc-job');
  if (!box) return;
  const done = (job.sent || 0) + (job.failed || 0);
  const pct = job.total ? Math.round((done / job.total) * 100) : 0;
  box.innerHTML = `<div class="bc-job">
    <div class="bc-job-head"><b>${esc(job.subject)}</b>${broadcastStatusBadge(job.status)}</div>
    <div class="bc-progress"><i style="width:${pct}%"></i></div>
    <div class="hint">
      已发送 ${job.sent} / ${job.total}${job.failed ? ` · 失败 ${job.failed}` : ''}${
        job.status === 'sending' ? ' · 正在逐封发送，可以离开本页' : ''
      }
    </div>
    ${
      job.failures?.length
        ? `<details class="bc-failures"><summary>最近的失败原因</summary><ul>${job.failures
            .map((f) => `<li>${esc(f.email)}：${esc(f.error || '未知错误')}</li>`)
            .join('')}</ul></details>`
        : ''
    }
    ${
      ['queued', 'sending'].includes(job.status)
        ? `<div class="form-actions" style="margin-top:10px"><button class="btn btn-sm btn-ghost" data-act="bc-cancel" data-id="${job.id}">取消发送</button></div>`
        : ''
    }
  </div>`;
}

function pollBroadcastJob(id) {
  clearInterval(state.bcJobTimer);
  const step = async () => {
    if (!$('#bc-job')) {
      clearInterval(state.bcJobTimer);
      state.bcJobTimer = null;
      return;
    }
    try {
      const r = await api(`/api/admin/broadcast/${id}`);
      renderBroadcastJob(r.job);
      if (!['queued', 'sending'].includes(r.job.status)) {
        clearInterval(state.bcJobTimer);
        state.bcJobTimer = null;
        if (r.job.status === 'done') {
          toast(`发送完成：成功 ${r.job.sent} 封${r.job.failed ? `，失败 ${r.job.failed} 封` : ''}`);
        }
        loadBroadcastJobs();
      }
    } catch (err) {
      clearInterval(state.bcJobTimer);
      state.bcJobTimer = null;
      toast(err.message, 'error');
    }
  };
  step();
  state.bcJobTimer = setInterval(step, 2000);
}

async function sendBroadcast(form) {
  const subject = form.subject.value.trim();
  const content = form.content.value.trim();
  if (!subject) return toast('请填写邮件主题', 'error');
  if (!content) return toast('请填写正文', 'error');
  const count = state.bcRecipientCount ?? '全部';
  if (!confirm(`确认给 ${count} 个已注册邮箱发送《${subject}》？发送后无法撤回。`)) return;

  const btn = $('#bc-send-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '提交中…';
  }
  try {
    const r = await api('/api/admin/broadcast', {
      method: 'POST',
      body: { subject, content, imageId: state.bcImage?.id || null },
    });
    toast(`已开始发送：共 ${r.job.total} 封`);
    renderBroadcastJob(r.job);
    pollBroadcastJob(r.job.id);
    loadBroadcastJobs();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '发送给全部账号';
    }
  }
}

async function previewBroadcast(form) {
  const subject = form.subject.value.trim();
  const content = form.content.value.trim();
  if (!subject || !content) return toast('请先填写主题和正文', 'error');
  try {
    await api('/api/admin/broadcast/preview', {
      method: 'POST',
      body: { subject, content, imageId: state.bcImage?.id || null },
    });
    toast('预览邮件已发到你的邮箱');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function secUserRow(u) {
  return `<tr data-email="${esc(String(u.email).toLowerCase())}">
    <td class="email">${esc(u.email)}</td>
    <td>${u.role === 'admin' ? '<span class="badge badge-brand">管理员</span>' : '普通用户'}</td>
    <td>${statusBadge(u)}</td>
    <td class="mono">${esc(u.lastIp || '—')}</td>
    <td class="mono">${u.lastLoginAt ? fmtTime(u.lastLoginAt) : '—'}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-sm btn-ghost" data-act="sec-detail" data-id="${u.id}">详情</button>
      ${
        u.ban
          ? `<button class="btn btn-sm" data-act="sec-unban" data-id="${u.id}">解封</button>`
          : `<button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-act="sec-ban" data-id="${u.id}">封禁</button>`
      }
      <button class="btn btn-sm btn-ghost" style="color:var(--danger)" data-act="del-user" data-id="${u.id}">删除</button>
    </td>
  </tr>`;
}

function loginKindText(kind) {
  return (
    {
      login: '验证码登录',
      code_send: '发送验证码',
      code_verify: '验证码校验',
      password_login: '密码登录',
      logout: '登出',
    }[kind] || kind
  );
}

function eventKindText(kind) {
  return (
    {
      traffic_spike: '异常流量',
      crawler_trap: '触发反爬蜜罐',
      ip_block_auto: '自动封禁 IP',
      ip_block_manual: '手动封禁 IP',
      ip_block_trap: '蜜罐封禁',
      ip_unblock: '解除 IP 封禁',
      user_registered: '新用户注册',
      banned_login_attempt: '封禁账号尝试登录',
      code_send_flood: '验证码请求异常',
      security_settings_updated: '安全策略变更',
      security_purge: '日志清理',
    }[kind] || kind
  );
}

/* ── 通用弹窗 ─────────────────────────────────────────── */

/* ── 角色卡广场 ─────────────────────────────────────── */
const MARKET_TAGS = ['全部', '角色扮演', '拟人', '陪伴型', '二次元', '原创', '模板'];

function marketCardHtml(c) {
  return `<button class="market-card" data-act="market-card" data-id="${c.id}">
    <b>${esc(c.title)}</b>
    <span class="mc-meta">${esc(c.author || '匿名')} · ${c.copyCount || 0} 次使用</span>
    <span class="mc-tags">${esc(c.tags || '')}</span>
    <span class="mc-open">查看内容 ›</span>
  </button>`;
}

function marketModalHtml(s) {
  const m = s.market;
  const detail = m.detail;
  let body = '';
  if (detail) {
    body = `<div class="market-detail">
      <div class="mc-detail-meta">${esc(detail.author || '匿名')} · ${esc(detail.tags || '')} · ${detail.copyCount || 0} 次使用</div>
      <div class="market-content">${esc(detail.content || (m.detailLoading ? '正在加载…' : ''))}</div>
      <div class="market-actions">
        <button class="btn btn-sm" data-act="market-back">返回列表</button>
        <button class="btn btn-primary btn-sm" data-act="market-add" data-id="${detail.id}">添加到我的角色</button>
      </div>
    </div>`;
  } else {
    body = `<div class="market-search">
      <span class="ms-icon">${icon('search', 14)}</span>
      <input class="input" id="market-q" value="${esc(m.q || '')}" placeholder="搜索角色卡标题，如：鱼仔" autocomplete="off" />
      ${m.q ? `<button class="ms-clear" data-act="market-clear-q" title="清空">${icon('x', 12)}</button>` : ''}
    </div>
    <div class="market-tags">${MARKET_TAGS.map(
      (t) => `<button class="chip-toggle${t === m.tag ? ' on' : ''}" data-act="market-tag" data-tag="${t}">${t}</button>`
    ).join('')}</div>
      ${
        m.error
          ? `<div class="empty-inline">${esc(m.error)}</div>`
          : `<div class="market-grid">${
              m.items.length
                ? m.items.map(marketCardHtml).join('')
                : m.loading
                  ? '<div class="empty-inline">正在加载角色卡…</div>'
                  : m.q
                    ? `<div class="empty-inline">没有找到包含「${esc(m.q)}」的角色卡，换个关键词试试</div>`
                    : '<div class="empty-inline">这个分类下暂时没有角色卡</div>'
            }</div>`
      }
      <div class="market-foot">
        ${
          m.hasMore && !m.loading
            ? '<button class="btn btn-sm" data-act="market-more">加载更多</button>'
            : m.loading
              ? '<span class="hint"><span class="spin" style="width:12px;height:12px"></span> 加载中…</span>'
              : ''
        }
      </div>`;
  }

  return `<div class="modal wide market-modal">
    <div class="modal-head">
      <span class="modal-icon">${icon('store', 16)}</span>
      <span>${detail ? esc(detail.title) : `角色卡广场${m.cached ? ` · 已收录 ${m.cached} 张` : ''}`}</span>
      <button class="icon-btn market-close" data-act="close-market" title="关闭">${icon('x', 16)}</button>
    </div>
    <div class="modal-body no-indent">${body}</div>
  </div>`;
}

function renderMarket() {
  let mask = document.getElementById('market-mask');
  if (!state.market.open) {
    if (mask) mask.remove();
    return;
  }
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'market-mask';
    mask.className = 'modal-mask';
    mask.addEventListener('click', (e) => {
      if (e.target === mask) closeMarket();
    });
    document.body.appendChild(mask);
  }
  const hadFocus = document.activeElement?.id === 'market-q';
  mask.innerHTML = marketModalHtml(state);
  if (hadFocus) {
    const input = mask.querySelector('#market-q');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function closeMarket() {
  state.market.open = false;
  state.market.detail = null;
  renderMarket();
}

async function loadMarket(reset = false) {
  const m = state.market;
  if (m.loading) return;
  m.loading = true;
  m.error = '';
  if (reset) {
    m.items = [];
    m.nextCursor = null;
    m.hasMore = false;
  }
  renderMarket();
  try {
    const qs =
      `tag=${encodeURIComponent(m.tag)}` +
      (m.q ? `&q=${encodeURIComponent(m.q)}` : '') +
      (m.nextCursor ? `&cursor=${m.nextCursor}` : '');
    const r = await api(`/api/market/personas?${qs}`);
    m.items = reset ? r.items || [] : m.items.concat(r.items || []);
    m.cached = Number(r.cached) || 0;
    m.hasMore = Boolean(r.hasMore);
    m.nextCursor = r.nextCursor || null;
  } catch (err) {
    m.error = err.message;
  }
  m.loading = false;
  renderMarket();
}

async function openMarket() {
  state.market.open = true;
  state.market.detail = null;
  renderMarket();
  if (!state.market.items.length) await loadMarket(true);
}

async function openMarketCard(id) {
  const m = state.market;
  m.detail = { id, title: '加载中…', content: '', author: '', tags: '', copyCount: 0 };
  m.detailLoading = true;
  renderMarket();
  try {
    const r = await api(`/api/market/personas/${id}`);
    m.detail = r.card || r;
  } catch (err) {
    m.detail = null;
    m.error = err.message;
    toast(err.message, 'error');
  }
  m.detailLoading = false;
  renderMarket();
}

async function addMarketCard(el) {
  const card = state.market.detail;
  if (!card) return;
  const sameName = (state.personas.own || []).filter((p) => p.name === card.title).length;
  const suggested = sameName ? card.title + ' ' + (sameName + 1) : card.title;
  const name = await askPersonaName(suggested);
  if (!name) return;
  el.disabled = true;
  el.textContent = '添加中…';
  try {
    await api('/api/personas', {
      method: 'POST',
      body: {
        name: name.slice(0, 60),
        prompt: String(card.content || '').slice(0, 200000),
        description: '来自角色卡广场 · ' + (card.author || '匿名'),
      },
    });
    await loadPersonas();
    toast('已添加「' + name + '」');
    state.market.detail = null;
    renderMarket();
  } catch (err) {
    toast(err.message, 'error');
    el.disabled = false;
    el.textContent = '添加到我的角色';
  }
}


/* ── 用户反馈 ───────────────────────────────────────── */
function feedbackImageUrl(name) {
  const path = `/api/feedback/images/${encodeURIComponent(name)}`;
  return typeof apiPath === 'function' ? apiPath(path) : path;
}

let fbPollTimer = null;

function startFeedbackPolling() {
  clearInterval(fbPollTimer);
  const started = Date.now();
  fbPollTimer = setInterval(() => {
    const input = document.getElementById('fb-images');
    if (!input) return;
    if (input.files && input.files.length) {
      clearInterval(fbPollTimer);
      const picked = [...input.files];
      input.value = '';
      pickFeedbackImages(picked);
      return;
    }
    if (Date.now() - started > 120000) clearInterval(fbPollTimer);
  }, 600);
}

function askPersonaName(initial) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal" style="max-width:400px">
      <div class="modal-head"><span class="modal-icon">${icon('user', 16)}</span><span>添加到我的角色</span></div>
      <div class="modal-body no-indent">
        <div class="field">
          <label>角色名称</label>
          <input class="input" id="persona-name-input" maxlength="60" value="${esc(initial)}" />
        </div>
        <p class="hint" style="margin-top:8px">可以换成别的名字，同一个角色也能重复添加多份。</p>
      </div>
      <div class="modal-foot">
        <button class="btn" data-name-cancel>取消</button>
        <button class="btn btn-primary" data-name-ok>添加</button>
      </div>
    </div>`;
    const close = (value) => {
      mask.remove();
      resolve(value);
    };
    mask.addEventListener('click', (e) => {
      if (e.target === mask) close('');
    });
    mask.querySelector('[data-name-cancel]').onclick = () => close('');
    mask.querySelector('[data-name-ok]').onclick = () => {
      const value = mask.querySelector('#persona-name-input').value.trim();
      if (!value) return;
      close(value);
    };
    mask.querySelector('#persona-name-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        mask.querySelector('[data-name-ok]').click();
      }
    });
    document.body.appendChild(mask);
    setTimeout(() => {
      const input = mask.querySelector('#persona-name-input');
      if (input) {
        input.focus();
        input.select();
      }
    }, 60);
  });
}

async function compressFeedbackImage(file) {
  const fileType = (file.type || '').toLowerCase();
  const byExt = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name || '');
  if (fileType ? !fileType.startsWith('image/') && !byExt : !byExt && !file.size) {
    throw new Error('请选择图片文件');
  }
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
  let source = null;
  let objectUrl = '';
  try {
    source = await createImageBitmap(file);
  } catch {
    try {
      objectUrl = URL.createObjectURL(file);
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = objectUrl;
      });
    } catch {
      source = null;
    }
  }
  if (!source) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    return file;
  }

  const w = source.width || source.naturalWidth || 0;
  const h = source.height || source.naturalHeight || 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let best = null;

  try {
    // 服务器 nginx 限制约 1MB，逐级压缩到 900KB 以内
    for (const [max, quality] of [[1400, 0.82], [1200, 0.75], [1000, 0.7], [820, 0.6]]) {
      const scale = Math.min(1, max / Math.max(w || 1, h || 1));
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob) continue;
      best = blob;
      if (blob.size <= 900 * 1024) break;
    }
    return best || file;
  } catch {
    return file;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function uploadFeedbackImage(file) {
  const blob = await compressFeedbackImage(file);
  const res = await fetch(apiPath('/api/feedback/images'), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-File-Type': blob.type || 'image/jpeg' },
    body: blob,
  });
  if (res.status === 413) throw new Error('图片太大，超过服务器 1MB 限制，请裁剪后再试');
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new Error(json?.error?.message || (res.status ? '图片上传失败（' + res.status + '）' : '图片上传失败'));
  }
  return json;
}

async function pickFeedbackImages(files) {
  const list = [...(files || [])].slice(0, 3 - state.feedback.images.length);
  if (!list.length) return;
  state.feedback.uploading = true;
  state.feedback.error = '';
  renderFeedback();
  for (const file of list) {
    try {
      const r = await uploadFeedbackImage(file);
      state.feedback.images.push({ name: r.name, url: r.url });
      renderFeedback();
    } catch (err) {
      state.feedback.error = err.message;
      toast(err.message, 'error');
    }
  }
  state.feedback.uploading = false;
  renderFeedback();
}

function feedbackModalHtml() {
  const f = state.feedback;
  return `<div class="modal feedback-modal">
    <div class="modal-head">
      <span class="modal-icon">${icon('message', 16)}</span>
      <span>意见反馈</span>
      <button class="icon-btn market-close" data-act="close-feedback" title="关闭">${icon('x', 16)}</button>
    </div>
    <div class="modal-body no-indent">
      <p class="panel-desc" style="margin-top:0">遇到 BUG，或者希望增加什么功能，都可以在这里告诉我们。可以附上截图。</p>
      <textarea class="input feedback-text" id="fb-text" rows="5" maxlength="4000" placeholder="描述一下遇到的问题或想要的功能…">${esc(f.content)}</textarea>
      <div class="fb-attach">
        <label class="btn btn-sm${f.images.length >= 3 || f.uploading ? ' is-disabled' : ''}" for="fb-images">＋ 添加截图</label>
        <span class="hint">最多 3 张，${f.images.length}/3</span>
        <input type="file" id="fb-images" class="fb-file-input" accept="image/*" multiple />
      </div>
      <div class="fb-previews">
        ${f.images
          .map(
            (img) => `<span class="fb-preview"><img src="${esc(feedbackImageUrl(img.name))}" alt="" /><button data-act="fb-remove" data-name="${esc(
              img.name
            )}" title="移除">${icon('x', 11)}</button></span>`
          )
          .join('')}
        ${f.uploading ? '<span class="fb-preview uploading"><span class="spin" style="width:14px;height:14px"></span></span>' : ''}
      </div>
      ${f.error ? `<div class="fb-error">${esc(f.error)}</div>` : ''}
      <div class="fb-foot">
        <span class="hint">提交后会出现在管理员的反馈收件箱里</span>
        <button class="btn btn-primary btn-sm" data-act="fb-submit" ${f.sending || f.uploading ? 'disabled' : ''}>${f.sending ? '提交中…' : '提交反馈'}</button>
      </div>
    </div>
  </div>`;
}

function renderFeedback() {
  let mask = document.getElementById('feedback-mask');
  if (!state.feedback.open) {
    if (mask) mask.remove();
    return;
  }
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'feedback-mask';
    mask.className = 'modal-mask';
    mask.addEventListener('click', (e) => {
      if (e.target === mask) closeFeedback();
    });
    document.body.appendChild(mask);
  }
  mask.innerHTML = feedbackModalHtml();
  mask.querySelector('label[for="fb-images"]')?.addEventListener('click', startFeedbackPolling);
  const ta = mask.querySelector('#fb-text');
  if (ta && document.activeElement !== ta) ta.focus();
}

function closeFeedback() {
  state.feedback.open = false;
  renderFeedback();
}

async function submitFeedback(el) {
  const f = state.feedback;
  const text = String(document.getElementById('fb-text')?.value || '').trim();
  if (!text && !f.images.length) return toast('请写点什么或上传截图', 'error');
  f.sending = true;
  renderFeedback();
  try {
    await api('/api/feedback', {
      method: 'POST',
      body: { content: text, images: f.images.map((i) => i.name) },
    });
    toast('反馈已提交，谢谢！');
    f.open = false;
    f.content = '';
    f.images = [];
    f.sending = false;
    renderFeedback();
  } catch (err) {
    f.sending = false;
    renderFeedback();
    toast(err.message, 'error');
  }
}

function showModal({ title, body, footer = '', iconName = 'shield', wide = false }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `<div class="modal${wide ? ' wide' : ''}">
    <div class="modal-head"><span class="modal-icon">${icon(iconName, 16)}</span><span>${esc(title)}</span></div>
    <div class="modal-body no-indent">${body}</div>
    <div class="modal-foot">${footer}</div>
  </div>`;
  document.body.appendChild(mask);
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-modal-close]')) mask.remove();
  });
  return mask;
}

/* ── 站点公告弹窗 ─────────────────────────────────────── */
function announcementKey(a) {
  return `announcement:${a.id}:${a.updatedAt}`;
}

/* ── 安卓 App 下载 ───────────────────────────────────── */
async function loadAppInfo(force = false) {
  const now = Date.now();
  if (!force && state.appInfo && now - state.appInfoAt < 5 * 60 * 1000) return state.appInfo;
  try {
    const r = await api('/api/app/version');
    state.appInfo = r.latest || {};
  } catch {
    state.appInfo = state.appInfo || {};
  }
  state.appInfoAt = now;
  return state.appInfo;
}

function apkUrlOf(info) {
  const url = (info && info.url) || '/downloads/anno-ai.apk';
  if (/^https?:/i.test(url)) return url;
  return location.origin + (url.startsWith('/') ? url : '/' + url);
}

async function openAppSheet() {
  // 先用缓存/默认值把弹窗画出来，再异步补一次最新版本，避免点下去没反应
  const info = state.appInfo || {};
  const mask = buildAppSheet(info);
  const fresh = await loadAppInfo(true);
  if (fresh && fresh.versionName && fresh.versionName !== info.versionName) {
    const tag = mask.querySelector('[data-app-version]');
    if (tag) tag.textContent = '版本 v' + fresh.versionName;
  }
}

function buildAppSheet(info) {
  const url = apkUrlOf(info);
  const version = esc(info.versionName || '1.1.0');
  const mask = document.createElement('div');
  mask.className = 'announce-mask';
  mask.innerHTML = `<div class="announce-card app-card" role="dialog" aria-modal="true">
      <button class="announce-close" data-app-close title="关闭">${icon('x', 16)}</button>
      <div class="announce-badge">${icon('phone', 14)} 安卓客户端</div>
      <h2 class="announce-title">把爱音装进口袋</h2>
      <p class="app-lead">和网页端共用同一个账号、同一份数据：对话记录、角色、额度都实时同步，换设备接着聊。</p>
      <div class="app-meta">
        <span data-app-version>版本 v${version}</span>
        <span>Android 7.0+</span>
        <span>约 0.1 MB</span>
      </div>
      <a class="btn btn-primary app-dl" href="${esc(url)}" download="anno-ai.apk" rel="noopener">${icon(
        'download',
        15
      )} 下载 APK 安装包</a>
      <div class="app-aux"><button class="btn btn-ghost btn-sm" data-app-copy>复制下载链接</button></div>
      <ol class="app-steps">
        <li>点上面的按钮下载 APK，保存到手机里</li>
        <li>首次安装时允许浏览器或文件管理器「安装未知应用」</li>
        <li>打开 App，用现在的账号登录就能接着聊</li>
      </ol>
      <div class="announce-sign">—— 千早爱音</div>
    </div>`;
  document.body.appendChild(mask);
  const close = () => {
    mask.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', async (e) => {
    if (e.target === mask || e.target.closest('[data-app-close]')) return close();
    if (e.target.closest('[data-app-copy]')) {
      try {
        await navigator.clipboard.writeText(url);
        toast('下载链接已复制');
      } catch {
        toast('复制失败，长按下载按钮也能复制链接', 'error');
      }
    }
  });
  return mask;
}

async function maybeShowAnnouncement() {
  if (!state.user || state._announcementChecked) return;
  state._announcementChecked = true;
  try {
    const r = await api('/api/announcements/active');
    const a = r.announcement;
    if (!a) return;
    if (localStorage.getItem(announcementKey(a)) === '1') return;
    if (sessionStorage.getItem('announcement-shown') === announcementKey(a)) return;
    showAnnouncement(a);
  } catch {
    /* 公告失败不影响主流程 */
  }
}

function showAnnouncement(a) {
  sessionStorage.setItem('announcement-shown', announcementKey(a));
  const mask = document.createElement('div');
  mask.className = 'announce-mask';
  const tone = ['info', 'important', 'success'].includes(a.tone) ? a.tone : 'info';
  mask.innerHTML = `<div class="announce-card tone-${tone}" role="dialog" aria-modal="true">
    <button class="announce-close" data-announce-close title="关闭">${icon('x', 16)}</button>
    <div class="announce-badge">${icon('bell', 14)} 来自千早爱音的公告</div>
    <h2 class="announce-title">${esc(a.title)}</h2>
    <div class="announce-content">${esc(a.content).replace(/\n/g, '<br />')}</div>
    ${
      a.imageUrl
        ? `<div class="announce-img"><img src="${esc(a.imageUrl)}" alt="公告配图" loading="lazy" /></div>`
        : ''
    }
    <div class="announce-foot">
      <button class="btn btn-primary" data-announce-ok>知道啦</button>
      <button class="btn btn-ghost" data-announce-never>不再提示这条</button>
    </div>
    <div class="announce-sign">—— 千早爱音</div>
  </div>`;
  document.body.appendChild(mask);
  const close = () => {
    mask.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.closest('[data-announce-close]') || e.target.closest('[data-announce-ok]')) {
      close();
      return;
    }
    if (e.target.closest('[data-announce-never]')) {
      localStorage.setItem(announcementKey(a), '1');
      toast('好，这条公告不再提示');
      close();
    }
  });
  setTimeout(() => mask.querySelector('[data-announce-ok]')?.focus(), 60);
}

function showBanDialog(user) {
  const mask = showModal({
    title: `封禁 ${user.email}`,
    body: `<div class="field"><label>封禁时长</label>
        <select class="input" name="hours">
          <option value="1">1 小时</option>
          <option value="24" selected>1 天</option>
          <option value="168">7 天</option>
          <option value="720">30 天</option>
          <option value="0">永久封禁</option>
        </select>
      </div>
      <div class="field" style="margin-top:12px"><label>封禁原因（会展示给该用户）</label>
        <textarea class="textarea" name="reason" rows="3" placeholder="例如：发布违规内容 / 恶意刷接口"></textarea>
      </div>
      <div class="hint" style="margin-top:8px">封禁后该账号立即无法调用接口，登录或刷新时只会看到封禁告知页；到期自动解封。</div>`,
    footer: `<button class="btn" data-modal-close>取消</button><button class="btn btn-danger" data-modal-ok>确认封禁</button>`,
    iconName: 'alert',
  });
  mask.querySelector('[data-modal-ok]').onclick = async () => {
    const hours = Number(mask.querySelector('[name="hours"]').value);
    const reason = mask.querySelector('[name="reason"]').value.trim();
    const btn = mask.querySelector('[data-modal-ok]');
    btn.disabled = true;
    try {
      await api(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { ban: { hours, reason, permanent: hours === 0 } },
      });
      mask.remove();
      toast('已封禁该账号');
      renderSecurity();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  };
}

async function showUserDetail(id) {
  try {
    const d = await api(`/api/admin/users/${id}/detail`);
    const mask = showModal({
      title: `账号详情 · ${d.user.email}`,
      wide: true,
      body: `<div class="detail-grid">
          <div><span>角色</span><b>${d.user.role === 'admin' ? '超级管理员' : '普通用户'}</b></div>
          <div><span>状态</span><b>${d.user.ban ? '封禁中' : d.user.status === 'active' ? '正常' : '停用'}</b></div>
          <div><span>注册时间</span><b>${fmtTime(d.user.createdAt)}</b></div>
          <div><span>最近登录</span><b>${d.user.lastLoginAt ? fmtTime(d.user.lastLoginAt) : '—'}</b></div>
          <div><span>最近 IP</span><b class="mono">${esc(d.user.lastIp || '—')}</b></div>
          <div><span>活跃会话</span><b>${d.sessions.length}</b></div>
        </div>
        ${d.user.ban ? `<div class="ban-reason"><span>封禁原因</span><p>${esc(d.user.ban.reason || '—')}</p></div>` : ''}
        <h4 class="sub-title">登录设备</h4>
        ${
          d.sessions.length
            ? `<table class="table compact"><thead><tr><th>设备</th><th>IP</th><th>最近活跃</th><th>到期</th></tr></thead><tbody>
                ${d.sessions
                  .map(
                    (x) => `<tr><td class="mono">${esc(x.deviceId || '—')}</td><td class="mono">${esc(
                      x.ip || '—'
                    )}</td><td class="mono">${fmtTime(x.lastSeenAt)}</td><td class="mono">${fmtTime(x.expiresAt)}</td></tr>`
                  )
                  .join('')}
              </tbody></table>`
            : '<div class="empty-inline">没有活跃会话</div>'
        }
        <h4 class="sub-title">最近登录记录</h4>
        ${
          d.logins.length
            ? `<table class="table compact"><thead><tr><th>时间</th><th>类型</th><th>结果</th><th>IP</th></tr></thead><tbody>
                ${d.logins
                  .map(
                    (l) => `<tr><td class="mono">${fmtTime(l.created_at)}</td><td>${esc(
                      loginKindText(l.kind)
                    )}</td><td>${l.ok ? '成功' : esc(l.reason || '失败')}</td><td class="mono">${esc(l.ip || '—')}</td></tr>`
                  )
                  .join('')}
              </tbody></table>`
            : '<div class="empty-inline">暂无记录</div>'
        }`,
      footer: `<button class="btn" data-modal-close>关闭</button>
        <button class="btn btn-danger" data-kick>强制下线</button>
        ${d.user.ban ? '<button class="btn btn-primary" data-unban>解封</button>' : '<button class="btn btn-danger" data-ban>封禁</button>'}`,
      iconName: 'user',
    });
    mask.querySelector('[data-kick]').onclick = async () => {
      try {
        await api(`/api/admin/users/${id}/sessions`, { method: 'DELETE' });
        mask.remove();
        toast('已强制下线该账号的全部会话');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    mask.querySelector('[data-unban]')?.addEventListener('click', async () => {
      try {
        await api(`/api/admin/users/${id}`, { method: 'PATCH', body: { unban: true } });
        mask.remove();
        toast('已解封');
        renderSecurity();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    mask.querySelector('[data-ban]')?.addEventListener('click', () => {
      mask.remove();
      const u = state.adminUsers.find((x) => x.id === id);
      if (u) showBanDialog(u);
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

/** 拉取并渲染「云端额度核对」 */
async function refreshCloud(id) {
  const box = document.querySelector(`[data-cloud-box][data-id="${id}"]`);
  const body = box?.querySelector('[data-cloud-body]');
  if (!body) return;
  body.textContent = '正在查询云端账单…';
  try {
    const r = await api(`/api/admin/providers/parse/${id}/cloud`);
    const c = r.cloud || {};
    const money = (n, cur) => `${cur === 'USD' ? '$' : '¥'}${Number(n || 0).toFixed(2)}`;
    let html = `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px">
      <span>本地计量（按官方计费口径）</span>
      <span><b>${r.used}</b> / ${r.monthly} ${esc(r.unitLabel)} · 剩余 ${r.remaining}</span></div>`;
    if (c.supported) {
      html += c.charged
        ? `<div style="margin-top:8px;font-size:13px;color:var(--danger)"><b>云端已产生后付费 ${money(c.amount, c.currency)}</b>，免费额度已用完</div>
           <div style="margin-top:10px"><button type="button" class="btn btn-danger btn-sm" data-act="toggle-provider" data-scope="admin" data-cat="parse" data-id="${id}" data-enabled="1">立即停用该接口</button></div>`
        : '<div style="margin-top:8px;font-size:13px;color:var(--ok)"><b>云端暂无扣费</b>，仍在免费额度内</div>';
      html += `<div class="hint">${esc(c.note || '')}</div>`;
      if (c.packages?.length) {
        html += `<div class="hint">资源包：${c.packages
          .map((p) => `${esc(p.name)}（剩余 ${p.remaining ?? '?'} / ${p.total ?? '?'} ${esc(p.unit || '')}）`)
          .join('、')}</div>`;
      }
    } else {
      html += `<div class="hint" style="color:var(--danger)">云端查询失败：${esc(c.error || '未知原因')}</div>`;
    }
    html += `<div class="hint">查询时间：${new Date(c.checkedAt || Date.now()).toLocaleString()}</div>`;
    body.innerHTML = html;
    const sum = box.querySelector('[data-cloud-summary]');
    if (sum) sum.textContent = `本地 ${r.used}/${r.monthly}`;
  } catch (err) {
    body.textContent = err.message;
  }
}

/* ── 统一事件处理 ─────────────────────────────────────── */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) {
    let changed = false;
    if (state.menuOpen && !e.target.closest('.sidebar-foot')) {
      state.menuOpen = false;
      changed = true;
    }
    if (state.convMenuOpen && !e.target.closest('.tb-menu-wrap')) {
      state.convMenuOpen = false;
      changed = true;
    }
    if (
      state.personaPickerOpen &&
      !e.target.closest('.persona-pop') &&
      !e.target.closest('[data-act="pick-persona"]')
    ) {
      state.personaPickerOpen = false;
      changed = true;
    }
    if (state.modelPickerOpen && !e.target.closest('.model-picker-wrap')) {
      state.modelPickerOpen = false;
      changed = true;
    }
    if (changed && state.route === '/') rerenderChat();
    return;
  }
  const act = el.dataset.act;
  const s = state;

  switch (act) {
    /* 登录 */
    case 'login-method':
      switchLoginMethod(el.dataset.method);
      break;
    case 'auth-tab':
      switchAuthMode(el.dataset.mode);
      break;
    case 'refresh-captcha':
      refreshCaptcha();
      break;
    case 'reload':
      location.reload();
      break;
    case 'send-code':
      sendCode();
      break;
    case 'fill-code': {
      const input = $('#login-form')?.code;
      if (input && s.devCode) input.value = s.devCode;
      break;
    }

    case 'app-download':
      s.menuOpen = false;
      openAppSheet();
      break;
    /* 导航 */
    case 'go':
      s.menuOpen = false;
      navigate(el.dataset.to);
      break;
    case 'toggle-menu':
      s.menuOpen = !s.menuOpen;
      renderChat();
      break;
    case 'toggle-sidebar':
      s.sidebarOpen = !s.sidebarOpen;
      renderChat();
      break;
    case 'logout':
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      s.user = null;
      s.banned = null;
      s.convs = [];
      s.messages = [];
      s.activeId = null;
      navigate('/');
      render();
      break;

    /* 会话 */
    case 'clear-search':
      s.convQuery = '';
      renderChat();
      break;
    case 'toggle-conv-menu':
      s.convMenuOpen = !s.convMenuOpen;
      rerenderChat();
      break;
    case 'rename-conv': {
      const conv = s.convs.find((c) => c.id === s.activeId);
      if (!conv) break;
      const input = prompt('重命名对话', conv.title);
      if (input === null) break;
      const t = input.trim();
      if (!t) {
        toast('标题不能为空', 'error');
        break;
      }
      try {
        await api(`/api/conversations/${conv.id}`, { method: 'PATCH', body: { title: t } });
        await loadConversations();
        s.convMenuOpen = false;
        rerenderChat();
        toast('已重命名');
      } catch (err) {
        showErrorDialog({ title: '重命名失败', message: err.message });
      }
      break;
    }
    case 'export-conv': {
      if (!s.activeId) break;
      try {
        const res = await fetch(apiPath(`/api/conversations/${s.activeId}/export`), { credentials: 'same-origin' });
        if (!res.ok) throw new Error('导出失败（' + res.status + '）');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation-${s.activeId}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        toast('已导出当前对话');
      } catch (err) {
        showErrorDialog({ title: '导出失败', message: err.message });
      }
      break;
    }
    case 'del-active-conv': {
      const id = s.activeId;
      if (!id) break;
      if (!confirm('删除当前对话？此操作不可恢复。')) break;
      try {
        await api(`/api/conversations/${id}`, { method: 'DELETE' });
        s.convs = s.convs.filter((c) => c.id !== id);
        s.activeId = null;
        s.messages = [];
        s.convMenuOpen = false;
        await loadConversations();
        renderChat();
      } catch (err) {
        showErrorDialog({ title: '删除失败', message: err.message });
      }
      break;
    }

    case 'new-chat':
      if (abortCtrl) abortCtrl.abort();
      s.activeId = null;
      s.messages = [];
      s.alertMsg = null;
      s.attachments = [];
      s.menuOpen = false;
      s.persona = null;
      s.currentPersonaName = null;
      s.personaPickerOpen = false;
      s.convMenuOpen = false;
      if (window.innerWidth <= 860) s.sidebarOpen = false;
      renderChat();
      break;
    case 'open-conv':
      await openConversation(Number(el.dataset.id));
      break;
    case 'del-conv': {
      e.stopPropagation();
      const id = Number(el.dataset.id);
      if (!confirm('删除这个对话？')) return;
      try {
        await api(`/api/conversations/${id}`, { method: 'DELETE' });
        s.convs = s.convs.filter((c) => c.id !== id);
        if (s.activeId === id) {
          s.activeId = null;
          s.messages = [];
        }
        renderChat();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }

    /* 输入区 */
    case 'open-feedback':
      state.feedback.open = true;
      renderFeedback();
      break;
    case 'close-feedback':
      closeFeedback();
      break;
    case 'fb-pick':
      document.getElementById('fb-images')?.click();
      break;
    case 'fb-remove':
      state.feedback.images = state.feedback.images.filter((i) => i.name !== el.dataset.name);
      renderFeedback();
      break;
    case 'fb-submit':
      await submitFeedback(el);
      break;
    case 'fb-view':
      window.open(el.dataset.url, '_blank', 'noopener');
      break;
    case 'market-sync':
      startMarketSync();
      break;
    case 'market-sync-stop':
      state.marketSync.running = false;
      clearTimeout(state.marketSync.timer);
      refreshMarketSyncPanel();
      break;
    case 'fb-toggle': {
      const id = Number(el.dataset.id);
      const status = el.dataset.status === 'resolved' ? 'resolved' : 'open';
      try {
        await api(`/api/admin/feedback/${id}`, { method: 'PATCH', body: { status } });
        const item = (state.adminFeedback.groups || [])
          .flatMap((g) => g.items)
          .find((x) => x.id === id);
        if (item) item.status = status;
        refreshFeedbackPanel();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'fb-delete': {
      const id = Number(el.dataset.id);
      if (!confirm('删除这条反馈？截图也会一起删除。')) break;
      try {
        await api(`/api/admin/feedback/${id}`, { method: 'DELETE' });
        state.adminFeedback.groups = (state.adminFeedback.groups || [])
          .map((g) => ({ ...g, items: g.items.filter((x) => x.id !== id) }))
          .filter((g) => g.items.length);
        state.adminFeedback.total = Math.max(0, (state.adminFeedback.total || 1) - 1);
        refreshFeedbackPanel();
        toast('已删除');
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'open-market':
      await openMarket();
      break;
    case 'close-market':
      closeMarket();
      break;
    case 'market-tag':
      s.market.tag = el.dataset.tag || '角色扮演';
      s.market.detail = null;
      s.market.nextCursor = null;
      await loadMarket(true);
      break;
    case 'market-clear-q':
      s.market.q = '';
      s.market.nextCursor = null;
      await loadMarket(true);
      break;
    case 'market-more':
      await loadMarket(false);
      break;
    case 'market-card':
      await openMarketCard(Number(el.dataset.id));
      break;
    case 'market-back':
      s.market.detail = null;
      renderMarket();
      break;
    case 'market-add':
      await addMarketCard(el);
      break;
    case 'toggle-model-picker':
      s.modelPickerOpen = !s.modelPickerOpen;
      s.personaPickerOpen = false;
      rerenderChat();
      requestAnimationFrame(positionModelPop);
      break;
    case 'pick-model': {
      const picked = el.dataset.model || '';
      if (!picked) break;
      s.model = picked;
      s.modelPickerOpen = false;
      try {
        localStorage.setItem('anon.model', picked);
      } catch {
        /* 隐私模式忽略 */
      }
      rerenderChat();
      toast(`已切换到 ${picked}`);
      break;
    }
    case 'toggle-thinking':
      s.thinking = !s.thinking;
      el.classList.toggle('on', s.thinking);
      break;
    case 'pick-persona':
      if (s.messages.length > 0) return;
      s.personaPickerOpen = !s.personaPickerOpen;
      rerenderChat();
      break;
    case 'choose-persona': {
      if (s.messages.length > 0) return;
      const id = Number(el.dataset.id);
      if (id === 0) {
        s.persona = { id: 0, name: '不使用角色' };
      } else {
        const all = [...(s.personas.global || []), ...(s.personas.own || [])];
        const picked = all.find((x) => x.id === id);
        if (!picked) return;
        s.persona = { id: picked.id, name: picked.name };
      }
      s.personaPickerOpen = false;
      rerenderChat();
      break;
    }
    case 'toggle-search':
      s.search = !s.search;
      el.classList.toggle('on', s.search);
      break;
    case 'pick-file':
      $('#file-input')?.click();
      break;
    case 'rm-attach':
      s.attachments = s.attachments.filter((a) => a.id !== Number(el.dataset.id));
      renderAttachArea();
      break;
    case 'use-suggestion': {
      const ta = $('#composer-input');
      if (ta) {
        ta.value = el.dataset.text;
        ta.focus();
        ta.dispatchEvent(new Event('input'));
      }
      break;
    }
    case 'send':
      sendMessage();
      break;
    case 'stop':
      if (abortCtrl) abortCtrl.abort();
      break;

    /* 消息操作 */
    case 'copy-msg': {
      const m = s.messages.find((x) => String(x.id) === String(el.dataset.id));
      if (!m) return;
      try {
        await navigator.clipboard.writeText(m.content);
        toast('已复制');
      } catch {
        toast('复制失败', 'error');
      }
      break;
    }
    case 'speak':
      speak(el.dataset.id, el);
      break;

    /* 设置 */
    case 'export-convs':
      exportConversations();
      break;
    case 'import-convs':
      $('#import-file')?.click();
      break;
    case 'clear-convs': {
      if (!confirm('确定清空全部对话？此操作不可恢复，建议先导出备份。')) break;
      try {
        await api('/api/conversations', { method: 'DELETE' });
        state.convs = [];
        state.activeId = null;
        state.messages = [];
        toast('已清空全部对话');
        renderSettings();
      } catch (err) {
        showErrorDialog({ title: '清空失败', message: err.message });
      }
      break;
    }

    case 'scroll-panel': {
      const target = el.dataset.target;
      const panel = target ? document.getElementById(target) : null;
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $$('.page-nav a').forEach((a) => a.classList.toggle('on', a === el));
      break;
    }

    case 'set-pref':
      try {
        await api('/api/me/preference', {
          method: 'PATCH',
          body: { providerPreference: el.dataset.pref },
        });
        s.pref = el.dataset.pref;
        $$('.seg button[data-act="set-pref"]').forEach((b) =>
          b.classList.toggle('on', b.dataset.pref === s.pref)
        );
        toast('已更新优先策略');
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    case 'set-theme':
      localStorage.setItem('theme-pref', el.dataset.theme);
      applyTheme(el.dataset.theme);
      $$('.seg button[data-act="set-theme"]').forEach((b) =>
        b.classList.toggle('on', b.dataset.theme === el.dataset.theme)
      );
      break;

    /* ── 能力配置 ───────────────────────────────────── */
    case 'provider-coming-soon':
      toast('用户自建 API 功能将在后续版本开放，当前请使用管理员共享的算力');
      break;
    case 'add-provider': {
      const key = `${el.dataset.scope}:${el.dataset.cat}`;
      s.newCard = s.newCard === key ? null : key;
      s.openCard = `${key}:new`;
      el.dataset.scope === 'admin' ? renderAdmin() : renderSettings();
      break;
    }
    case 'set-routing': {
      const mode = el.dataset.mode;
      if (!mode) break;
      const scope = el.dataset.scope;
      const cat = el.dataset.cat;
      const base = scope === 'admin' ? '/api/admin/providers' : '/api/me/providers';
      try {
        await api(`${base}/${cat}/routing`, { method: 'PATCH', body: { mode } });
        $$(`.seg[data-act="set-routing"][data-scope="${scope}"][data-cat="${cat}"] button`).forEach((b) =>
          b.classList.toggle('on', b.dataset.mode === mode)
        );
        toast(mode === 'round_robin' ? '已切换为轮询' : '已切换为失败切换');
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'fetch-models': {
      const form = el.closest('form');
      if (!form) break;
      const scope = form.dataset.scope;
      const cat = form.dataset.cat;
      const base = scope === 'admin' ? '/api/admin/providers' : '/api/me/providers';
      let extra = {};
      try {
        extra = form.extra?.value.trim() ? JSON.parse(form.extra.value) : {};
      } catch {
        /* 忽略非法 JSON，服务端会用默认值 */
      }
      const baseUrl = form.baseUrl.value.trim();
      if (!baseUrl) return toast('请先填写接口地址', 'error');
      el.disabled = true;
      el.textContent = '获取中…';
      try {
        const r = await api(`${base}/${cat}/models`, {
          method: 'POST',
          body: {
            baseUrl,
            apiKey: form.apiKey?.value.trim() || '',
            providerId: form.dataset.id ? Number(form.dataset.id) : undefined,
            extra,
          },
        });
        // 拉取上游模型时保留已勾选的集合，新出现的模型默认不勾选
        const current = new Set(
          Array.from(form.querySelectorAll('input[name="modelPick"]'))
            .filter((b) => b.checked)
            .map((b) => b.value)
        );
        renderModelPicks(form, r.models, current);
        toast(`已获取 ${r.count} 个模型，勾选后保存`);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        el.disabled = false;
        el.textContent = '从上游获取模型';
      }
      break;
    }
    case 'toggle-all-models': {
      const form = el.closest('form');
      const boxes = Array.from(form?.querySelectorAll('input[name="modelPick"]') || []);
      if (!boxes.length) return toast('请先获取模型列表', 'error');
      const anyUnchecked = boxes.some((b) => !b.checked);
      boxes.forEach((b) => {
        b.checked = anyUnchecked;
      });
      updateModelCount(form);
      break;
    }
    case 'add-key': {
      const form = el.closest('form');
      if (!form) break;
      const scope = el.dataset.scope;
      const cat = el.dataset.cat;
      const id = el.dataset.id;
      const base = scope === 'admin' ? '/api/admin/providers' : '/api/me/providers';
      const key = form.newKeyValue.value.trim();
      if (!key) return toast('请填写要添加的 Key', 'error');
      el.disabled = true;
      try {
        await api(`${base}/${cat}/${id}/keys`, {
          method: 'POST',
          body: { key, label: form.newKeyLabel.value.trim() },
        });
        toast('Key 已添加');
        state.openCard = `${scope}:${cat}:${id}`;
        scope === 'admin' ? renderAdmin() : renderSettings();
      } catch (err) {
        toast(err.message, 'error');
        el.disabled = false;
      }
      break;
    }
    case 'del-key': {
      const scope = el.dataset.scope;
      const cat = el.dataset.cat;
      const base = scope === 'admin' ? '/api/admin/providers' : '/api/me/providers';
      if (!confirm('移除这把 Key？')) break;
      try {
        await api(`${base}/${cat}/${el.dataset.id}/keys/${el.dataset.key}`, { method: 'DELETE' });
        toast('已移除');
        state.openCard = `${scope}:${cat}:${el.dataset.id}`;
        scope === 'admin' ? renderAdmin() : renderSettings();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'test-provider': {
      const scope = el.dataset.scope;
      const cat = el.dataset.cat;
      const base = scope === 'admin' ? '/api/admin/providers' : '/api/me/providers';
      el.disabled = true;
      el.textContent = '探测中…';
      try {
        const r = await api(`${base}/${cat}/${el.dataset.id}/test`, { method: 'POST' });
        if (r.result.ok) toast(`连通正常（${r.result.ms}ms）${r.result.sample ? ' · ' + r.result.sample : ''}`);
        else toast(`探测失败：${r.result.error || '未知原因'}`, 'error');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        el.disabled = false;
        el.textContent = '连通测试';
      }
      break;
    }
    case 'cloud-refresh':
      await refreshCloud(el.dataset.id);
      break;
    case 'calibrate-usage': {
      const id = el.dataset.id;
      const input = document.querySelector(`[data-calibrate-input="${id}"]`);
      const units = Number(input?.value);
      if (!Number.isFinite(units) || units < 0) return toast('请输入控制台显示的本月已用页数', 'error');
      el.disabled = true;
      try {
        await api(`/api/admin/providers/parse/${id}/calibrate`, { method: 'POST', body: { units } });
        toast(`已把本月总用量校准为 ${units} 页`);
        await refreshCloud(id);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        el.disabled = false;
      }
      break;
    }
    case 'toggle-provider': {
      const scope = el.dataset.scope;
      const cat = el.dataset.cat;
      const id = el.dataset.id;
      const enable = el.dataset.enabled !== '1';
      const base = scope === 'admin' ? '/api/admin/providers' : '/api/me/providers';
      el.disabled = true;
      try {
        await api(`${base}/${cat}/${id}`, { method: 'PUT', body: { enabled: enable } });
        toast(enable ? '已启用该接口' : '已停用该接口');
        state.openCard = `${scope}:${cat}:${id}`;
        scope === 'admin' ? renderAdmin() : renderSettings();
      } catch (err) {
        toast(err.message, 'error');
        el.disabled = false;
      }
      break;
    }
    case 'del-provider': {
      const scope = el.dataset.scope;
      const cat = el.dataset.cat;
      const base = scope === 'admin' ? '/api/admin/providers' : '/api/me/providers';
      if (!confirm('确定删除这条 API 配置？该条下的附加 Key 会一并删除。')) break;
      try {
        await api(`${base}/${cat}/${el.dataset.id}`, { method: 'DELETE' });
        toast('已删除');
        state.openCard = null;
        scope === 'admin' ? renderAdmin() : renderSettings();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }

    /* ── 安全管理 ───────────────────────────────────── */
    case 'sec-ban': {
      const u = s.adminUsers.find((x) => x.id === Number(el.dataset.id));
      if (u) showBanDialog(u);
      break;
    }
    case 'sec-unban':
      try {
        await api(`/api/admin/users/${el.dataset.id}`, { method: 'PATCH', body: { unban: true } });
        toast('已解封');
        renderSecurity();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    case 'sec-detail':
      showUserDetail(el.dataset.id);
      break;
    case 'sec-unblock':
      try {
        await api(`/api/admin/security/block/${encodeURIComponent(el.dataset.ip)}`, { method: 'DELETE' });
        toast('已解除封禁');
        renderSecurity();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    case 'sec-block-quick': {
      const ip = el.dataset.ip;
      if (!confirm(`封禁 ${ip} 60 分钟？`)) break;
      try {
        await api('/api/admin/security/block', { method: 'POST', body: { ip, minutes: 60, reason: '手动封禁' } });
        toast('已封禁');
        renderSecurity();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'disable-scope': {
      const scope = el.dataset.scope;
      if (!confirm('关闭该配额组下的全部接口？关闭后这些 API 不再可用，用户会看到算力不足提示。')) break;
      try {
        const r = await api('/api/admin/usage/disable', { method: 'POST', body: { scope } });
        state.usage = r;
        toast('已关闭 ' + r.disabled + ' 个接口');
        renderAdmin();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'reset-usage': {
      const scope = el.dataset.scope;
      if (!confirm('重置该配额组本月的用量统计？不会影响接口本身。')) break;
      try {
        const r = await api('/api/admin/usage/reset', { method: 'POST', body: { scope } });
        state.usage = r;
        toast('已重置本月用量');
        renderAdmin();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'sec-purge':
      if (!confirm('清理 7 天前的登录与安全日志？')) break;
      try {
        await api('/api/admin/security/purge', { method: 'POST' });
        toast('已清理');
        renderSecurity();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;

    case 'bc-pick-image':
      $('#bc-image-input')?.click();
      break;
    case 'bc-clear-image': {
      state.bcImage = null;
      const input = $('#bc-image-input');
      if (input) input.value = '';
      const nameEl = $('#bc-image-name');
      if (nameEl) nameEl.textContent = '未选择';
      const preview = $('#bc-image-preview');
      if (preview) preview.innerHTML = '';
      el.setAttribute('hidden', '');
      break;
    }
    case 'bc-send-test': {
      const form = $('#sec-broadcast-form');
      if (form) await previewBroadcast(form);
      break;
    }
    case 'bc-cancel': {
      if (!confirm('取消这次全体邮件？已经发出的部分不会撤回。')) break;
      try {
        await api(`/api/admin/broadcast/${el.dataset.id}/cancel`, { method: 'POST' });
        toast('已取消');
        loadBroadcastJobs();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }

    case 'announce-edit': {
      fillAnnouncementForm(Number(el.dataset.id));
      break;
    }
    case 'announce-toggle': {
      const item = (state.announcements || []).find((x) => x.id === Number(el.dataset.id));
      if (!item) break;
      try {
        await api(`/api/admin/announcements/${item.id}`, {
          method: 'PUT',
          body: {
            title: item.title,
            content: item.content,
            tone: item.tone,
            enabled: !item.enabled,
            imageId: item.image_id || null,
          },
        });
        toast(item.enabled ? '公告已停用' : '公告已启用');
        await refreshAnnouncements();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'announce-del': {
      const item = (state.announcements || []).find((x) => x.id === Number(el.dataset.id));
      if (!item) break;
      if (!confirm(`删除公告《${item.title}》？删除后用户不会再看到。`)) break;
      try {
        await api(`/api/admin/announcements/${item.id}`, { method: 'DELETE' });
        toast('公告已删除');
        if (state.announceEditingId === item.id) resetAnnouncementForm();
        await refreshAnnouncements();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'announce-reset':
      resetAnnouncementForm();
      break;
    case 'announce-remove-image': {
      state.announceImage = null;
      state.announceKeepImage = null;
      state.announceRemoveImage = true;
      const preview = $('#announce-image-preview');
      if (preview) preview.innerHTML = '';
      const name = $('#announce-image-name');
      if (name) name.textContent = '未选择';
      el.hidden = true;
      break;
    }
    case 'chatlog-refresh': {
      const uid = Number($('#chatlog-user')?.value || 0);
      if (uid) await loadChatLogConversations(uid);
      else toast('请先选择用户');
      break;
    }
    case 'chatlog-open':
      await openChatLog(Number(el.dataset.uid), Number(el.dataset.cid));
      break;

    case 'del-persona': {
      const scope = el.dataset.scope;
      const base = scope === 'admin' ? '/api/admin/personas' : '/api/personas';
      if (!confirm('确定删除这个角色？已开始的对话不受影响。')) return;
      try {
        await api(`${base}/${el.dataset.id}`, { method: 'DELETE' });
        toast('已删除');
        await loadPersonas();
        scope === 'admin' ? renderAdmin() : renderSettings();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }

    /* 后台 */
    case 'mail-verify':
      try {
        const r = await api('/api/admin/mail/verify', { method: 'POST' });
        toast(r.result.ok ? 'SMTP 连接正常' : `SMTP 异常：${r.result.error || '未知'}`, r.result.ok ? 'info' : 'error');
        renderAdmin();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    case 'mail-test': {
      const to = $('#test-mail-to')?.value.trim();
      if (!to) return toast('请填写收件邮箱', 'error');
      try {
        await api('/api/admin/mail/test', { method: 'POST', body: { to } });
        toast('测试邮件已发送');
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'group-order-up':
    case 'group-order-down': {
      const groups = state.adminModels?.groups;
      if (!Array.isArray(groups)) break;
      const i = Number(el.dataset.index);
      const j = el.dataset.act === 'group-order-up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || i >= groups.length || j >= groups.length) break;
      const tmp = groups[i];
      groups[i] = groups[j];
      groups[j] = tmp;
      const host = $('#model-order-list');
      if (host) {
        host.innerHTML = modelOrderGroupsHtml(groups);
        host.querySelector(`[data-act="${el.dataset.act}"][data-index="${j}"]`)?.focus();
      }
      break;
    }
    case 'model-order-up':
    case 'model-order-down': {
      const groups = state.adminModels?.groups;
      if (!Array.isArray(groups)) break;
      const gi = Number(el.dataset.gi);
      const g = groups[gi];
      if (!g) break;
      const i = Number(el.dataset.index);
      const j = el.dataset.act === 'model-order-up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || i >= g.models.length || j >= g.models.length) break;
      const tmp = g.models[i];
      g.models[i] = g.models[j];
      g.models[j] = tmp;
      const host = $('#model-order-list');
      if (host) {
        host.innerHTML = modelOrderGroupsHtml(groups);
        host
          .querySelector(`[data-act="${el.dataset.act}"][data-gi="${gi}"][data-index="${j}"]`)
          ?.focus();
      }
      break;
    }
    case 'model-order-save': {
      const groups = state.adminModels?.groups || [];
      if (!groups.length) break;
      el.disabled = true;
      el.textContent = '保存中…';
      try {
        const payload = { providers: [], models: {} };
        for (const g of groups) {
          payload.providers.push(g.providerId);
          payload.models[g.providerId] = g.models.map((x) => x.model);
        }
        const r = await api('/api/admin/models/order', { method: 'PUT', body: payload });
        state.adminModels = r;
        const host = $('#model-order-list');
        if (host) host.innerHTML = modelOrderGroupsHtml(r.groups || []);
        toast('模型顺序已保存');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        el.disabled = false;
        el.textContent = '保存顺序';
      }
      break;
    }
    case 'toggle-user': {
      try {
        await api(`/api/admin/users/${el.dataset.id}`, {
          method: 'PATCH',
          body: { status: el.dataset.status === 'active' ? 'disabled' : 'active' },
        });
        toast('已更新');
        renderAdmin();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'del-user': {
      if (!confirm('删除该用户？其所有对话将一并删除。')) return;
      try {
        await api(`/api/admin/users/${el.dataset.id}`, { method: 'DELETE' });
        toast('已删除');
        state.route === '/security' ? renderSecurity() : renderAdmin();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
  }
});

/* 表单提交（能力配置 / 角色） */
document.addEventListener('submit', async (e) => {
  const announceForm = e.target.closest('#announce-form');
  if (announceForm) {
    e.preventDefault();
    return submitAnnouncementForm(announceForm);
  }

  /* 安全管理：全体邮件 */
  const broadcastForm = e.target.closest('#sec-broadcast-form');
  if (broadcastForm) {
    e.preventDefault();
    return sendBroadcast(broadcastForm);
  }

  /* 安全管理：策略 */
  const policyForm = e.target.closest('#sec-policy-form');
  if (policyForm) {
    e.preventDefault();
    const f = policyForm;
    const modes = state._secPolicy ? state._secPolicy() : {};
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/api/admin/security/settings', {
        method: 'PUT',
        body: {
          registerGroupNumbers: f.groups.value,
          rateLimit: Number(f.rateLimit.value),
          autoBlock: Boolean(modes.autoBlock),
          autoBlockMinutes: Number(f.autoBlockMinutes.value),
          userProvidersOpen: Boolean(modes.userProvidersOpen),
          banNotice: f.banNotice.value,
        },
      });
      toast('安全设置已保存');
      renderSecurity();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
    return;
  }

  /* 安全管理：新增账号 */
  const addUserForm = e.target.closest('#sec-add-user');
  if (addUserForm) {
    e.preventDefault();
    const f = addUserForm;
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: { email: f.email.value.trim(), role: f.role.value },
      });
      toast('账号已创建');
      renderSecurity();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
    return;
  }

  /* 安全管理：封禁 IP */
  const blockForm = e.target.closest('#sec-block-form');
  if (blockForm) {
    e.preventDefault();
    const f = blockForm;
    try {
      await api('/api/admin/security/block', {
        method: 'POST',
        body: { ip: f.ip.value.trim(), minutes: Number(f.minutes.value), reason: f.reason.value.trim() },
      });
      toast('已封禁该 IP');
      renderSecurity();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  const personaForm = e.target.closest('[data-form="persona"]');
  if (personaForm) {
    e.preventDefault();
    return savePersona(personaForm);
  }

  const form = e.target.closest('[data-form="provider"]');
  if (!form) {
    if (e.target.tagName === 'FORM') e.preventDefault();
    return;
  }
  e.preventDefault();
  const scope = form.dataset.scope;
  const cat = form.dataset.cat;
  const base = scope === 'admin' ? '/api/admin/providers' : '/api/me/providers';
  let extra = {};
  try {
    extra = form.extra.value.trim() ? JSON.parse(form.extra.value) : {};
  } catch {
    return toast('高级配置不是合法 JSON', 'error');
  }
  if (!form.baseUrl.value.trim()) return toast('请填写接口地址', 'error');
  const picks = Array.from(form.querySelectorAll('input[name="modelPick"]'));
  if (picks.length) {
    extra.models = picks.filter((b) => b.checked).map((b) => b.value);
  }
  // 只保存被采用模型的参数，避免白名单外的旧配置一直留着
  const cfgRows = Array.from(form.querySelectorAll('[data-model-cfg]'));
  const modelConfig = {};
  for (const row of cfgRows) {
    const name = row.dataset.modelCfg;
    if (extra.models && !extra.models.includes(name)) continue;
    const effort = row.querySelector('[name="effort"]')?.value || '';
    const label = (row.querySelector('[name="label"]')?.value || '').trim().slice(0, 8);
    const labelColor = row.querySelector('[name="labelColor"]')?.value || '';
    const ctx = parseCtxTokens(row.querySelector('[name="ctx"]')?.value || 0);
    if (effort || label || ctx > 0) {
      modelConfig[name] = {
        ...(label ? { label } : {}),
        ...(label && labelColor ? { labelColor } : {}),
        ...(effort ? { effort } : {}),
        ...(ctx > 0 ? { context: ctx } : {}),
      };
    }
  }
  if (Object.keys(modelConfig).length) extra.modelConfig = modelConfig;
  else delete extra.modelConfig;
  if (form.parseMode) {
    if (form.parseMode.value === 'docmind') extra.mode = 'docmind';
    else delete extra.mode;
  }
  if (form.quotaGroup) {
    extra.quota = {
      group: form.quotaGroup.value.trim(),
      monthly: Number(form.quotaMonthly.value) || 0,
      unit: form.quotaUnit.value,
      price: Number(form.quotaPrice.value) || 0,
      currency: form.quotaCurrency.value,
      warnAt: Number(form.quotaWarn.value) || 90,
    };
    if (!extra.quota.group) delete extra.quota.group;
  }
  const defaultModel = form.model?.value.trim() || '';
  if (defaultModel && Array.isArray(extra.models) && !extra.models.includes(defaultModel)) {
    extra.models.push(defaultModel);
  }

  const payload = {
    name: form.name.value.trim(),
    baseUrl: form.baseUrl.value.trim(),
    model: defaultModel,
    extra,
    enabled: true,
    errorMessage: form.errorMessage?.value.trim() || '',
  };
  if (form.apiKey.value.trim()) payload.apiKey = form.apiKey.value.trim();

  const id = form.dataset.id;
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    if (id) await api(`${base}/${cat}/${id}`, { method: 'PUT', body: payload });
    else await api(`${base}/${cat}`, { method: 'POST', body: payload });
    toast(id ? '已保存' : '已添加');
    state.openCard = null;
    state.newCard = null;
    scope === 'admin' ? renderAdmin() : renderSettings();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = '保存';
  }
});

function renderModelPicks(form, models, checked) {
  const box = form.querySelector('[data-model-list]');
  if (!box) return;
  const adopted = checked || new Set();
  // 已勾选但这次上游没返回的模型也保留下来，避免刷新列表时丢失
  const known = new Set(models.map((m) => m.id));
  const merged = [...models, ...[...adopted].filter((id) => !known.has(id)).map((id) => ({ id }))];
  box.innerHTML = merged
    .map(
      (m) =>
        `<label class="mk" data-name="${esc(m.id.toLowerCase())}"><input type="checkbox" name="modelPick" value="${esc(
          m.id
        )}"${adopted.has(m.id) ? ' checked' : ''} /><span>${esc(m.id)}</span></label>`
    )
    .join('');
  // 上游如果返回了 context_length，就作为该模型的默认上下文
  if (models.some((m) => Number(m.context) > 0)) {
    form.querySelectorAll('[data-model-cfg]').forEach((row) => {
      const hit = models.find((m) => m.id === row.dataset.modelCfg && Number(m.context) > 0);
      const input = row.querySelector('[name="ctx"]');
      if (hit && input && (!input.value || input.value === '128K')) input.value = fmtCtxTokens(hit.context);
    });
  }
  const dl = form.querySelector('datalist');
  if (dl) dl.innerHTML = merged.map((m) => `<option value="${esc(m.id)}"></option>`).join('');
  updateModelCount(form);
}

function syncModelCounts() {
  document.querySelectorAll('form[data-form="provider"]').forEach((f) => updateModelCount(f));
}

function updateModelCount(form) {
  const boxes = Array.from(form.querySelectorAll('input[name="modelPick"]'));
  const on = boxes.filter((b) => b.checked).length;
  const el = form.querySelector('[data-mb-count]');
  if (el) el.textContent = `已采用 ${on} / ${boxes.length} 个`;
}

/* 模型筛选 */
document.addEventListener('input', (e) => {
  if (e.target.id === 'market-q') {
    state.market.q = e.target.value.trim();
    clearTimeout(state.marketTimer);
    state.marketTimer = setTimeout(() => {
      state.market.nextCursor = null;
      loadMarket(true);
    }, 400);
    return;
  }
  if (e.target.id === 'fb-text') {
    state.feedback.content = e.target.value;
    return;
  }
  const filter = e.target.closest('[data-model-filter]');
  if (!filter) return;
  const form = filter.closest('form');
  const q = filter.value.trim().toLowerCase();
  form.querySelectorAll('.model-list .mk').forEach((node) => {
    node.style.display = !q || node.dataset.name.includes(q) ? '' : 'none';
  });
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'modelPick') updateModelCount(e.target.closest('form'));
  if (e.target.name === 'parseMode') applyParseMode(e.target);
  if (e.target.id === 'bc-image-input') uploadBroadcastImage(e.target.files?.[0]);
  if (e.target.id === 'fb-images') {
    pickFeedbackImages(e.target.files);
    e.target.value = '';
  }
});

// <details> 的 toggle 不冒泡，用捕获阶段监听；第一次展开时自动查云端账单
document.addEventListener(
  'toggle',
  (e) => {
    const box = e.target;
    if (box?.matches?.('[data-cloud-box]') && box.open && box.dataset.loaded !== '1') {
      box.dataset.loaded = '1';
      refreshCloud(box.dataset.id);
    }
  },
  true
);

/** 切换「通用 HTTP / 阿里云文档智能」时，联动 Key 提示、地址与额度默认值 */
function applyParseMode(select) {
  const form = select.closest('form');
  if (!form) return;
  const docmind = select.value === 'docmind';
  const hint = form.querySelector('[data-docmind-hint]');
  if (hint) hint.hidden = !docmind;

  const keyInput = form.apiKey;
  if (keyInput && keyInput.dataset.keep !== '1') {
    keyInput.placeholder = docmind ? 'AccessKeyId:AccessKeySecret' : 'sk-...';
  }
  const url = form.baseUrl;
  if (docmind && url && !url.value.trim()) url.value = 'https://docmind-api.cn-hangzhou.aliyuncs.com';

  // 新卡片切到阿里云时，顺手把官方计费口径填好，避免用户漏配额
  if (docmind && !form.dataset.id && form.quotaMonthly && !Number(form.quotaMonthly.value)) {
    if (form.quotaGroup && !form.quotaGroup.value.trim()) form.quotaGroup.value = 'aliyun-docmind';
    form.quotaMonthly.value = '3000';
    if (form.quotaPrice) form.quotaPrice.value = '0.02';
    if (form.quotaUnit) form.quotaUnit.value = 'page';
    if (form.quotaCurrency) form.quotaCurrency.value = 'CNY';
  }
}

/* 保存 / 新建角色 */
async function savePersona(form) {
  const scope = form.dataset.scope;
  const id = form.dataset.id;
  const name = form.name.value.trim();
  const prompt = form.prompt.value.trim();
  if (!name) return toast('请填写角色名称', 'error');
  if (!prompt) return toast('请填写角色提示词', 'error');

  const payload = { name, description: form.description.value.trim(), prompt };
  const base = scope === 'admin' ? '/api/admin/personas' : '/api/personas';
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    if (id) await api(`${base}/${id}`, { method: 'PUT', body: payload });
    else await api(base, { method: 'POST', body: payload });
    toast(id ? '已保存' : '角色已创建');
    await loadPersonas();
    scope === 'admin' ? renderAdmin() : renderSettings();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = id ? '保存' : '创建';
  }
}

/* 后台角色切换 */
document.addEventListener('change', async (e) => {
  if (e.target.id === 'import-file') {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importConversations(file);
    return;
  }
  if (e.target.id === 'announce-image') {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) uploadAnnouncementImage(file);
    return;
  }
  if (e.target.id === 'chatlog-user') {
    const uid = Number(e.target.value || 0);
    if (uid) loadChatLogConversations(uid);
    else {
      const box = $('#chatlog-convs');
      if (box) box.innerHTML = '<div class="empty-inline">选择用户后加载会话</div>';
      const view = $('#chatlog-view');
      if (view) view.innerHTML = '<div class="empty-inline">选择左侧会话查看消息</div>';
    }
    return;
  }
  if (e.target.id === 'tts-voice-select') {
    localStorage.setItem('tts-voice', e.target.value);
    toast('已切换朗读音色');
    return;
  }
  const sel = e.target.closest('[data-act="set-role"]');
  if (!sel) return;
  try {
    await api(`/api/admin/users/${sel.dataset.id}`, { method: 'PATCH', body: { role: sel.value } });
    toast('角色已更新');
    renderAdmin();
  } catch (err) {
    toast(err.message, 'error');
    renderAdmin();
  }
});

/* ── 启动 ─────────────────────────────────────────────── */
function maybeOpenAppDeepLink() {
  if (IS_APP_WEBVIEW || state._appSheetOpened) return;
  const byQuery = new URLSearchParams(location.search).has('app');
  const byHash = currentRoute() === '/app';
  if (!byQuery && !byHash) return;
  state._appSheetOpened = true;
  openAppSheet();
}

async function bootstrap() {
  initTheme();
  try {
    const [me, boot] = await Promise.all([
      api('/api/auth/me'),
      api('/api/bootstrap'),
    ]);
    state.user = me.user;
    state.banned = me.banned || null;
    state.boot = boot;
    if (boot.siteName) document.title = boot.siteName;
    if (state.user) await Promise.all([loadConversations(), loadPersonas(), loadCapabilities()]);
  } catch (err) {
    appEl.innerHTML = `<div class="loading-screen" style="flex-direction:column;gap:10px">
      <div>${esc(err.message)}</div>
      <button class="btn" data-act="reload">重试</button>
    </div>`;
    return;
  }
  state.ready = true;
  const deep = currentRoute().match(/^\/c\/(\d+)$/);
  if (deep && state.user) {
    await openConversation(Number(deep[1]));
    return;
  }
  render();
  maybeOpenAppDeepLink();
}

window.addEventListener('hashchange', () => {
  state.menuOpen = false;
  render();
  maybeOpenAppDeepLink();
});

window.addEventListener('resize', () => {
  if (state.modelPickerOpen) positionModelPop();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.personaPickerOpen || state.modelPickerOpen) {
    state.personaPickerOpen = false;
    state.modelPickerOpen = false;
    if (state.route === '/') rerenderChat();
  }
  if (state.market.open) closeMarket();
  if (state.feedback.open) closeFeedback();
});

bootstrap();
