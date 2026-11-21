/* =====================================================
 * Fuo Tools · 全站反馈挂件（web v0.9.6）
 *
 * 用法（页面只需一行，样式与 SDK 由本脚本按需注入）：
 *   <script src="…/drive/assets/js/feedback.js?v=1"></script>
 *   （/drive 各页由 sidebar.js 统一注入，无需手写）
 *
 * 行为：
 *   · 右下角「反馈」悬浮按钮 → 弹层提交（类型 / 正文 / 可选联系方式）
 *   · 已登录：自动附带 user_id + username；游客：匿名提交
 *   · 数据表：public.feedback（建表脚本 supabase-feedback.sql）
 *     RLS：人人可插入（限流经 security definer 函数 can_submit_feedback()
 *     执行）；仅 System 可查看 / 删除（管理台「反馈」面板）
 *   · 42P17「infinite recursion」＝服务器 SQL 是旧版（策略自引用），
 *     在 Supabase 重跑最新版 supabase-feedback.sql 即可
 *   · 前端节流：60 秒一条（登录用户另有数据库层防刷）
 *   · 表未创建：给出明确提示（执行 supabase-feedback.sql）
 * ===================================================== */
(function () {
  'use strict';

  if (window.__FUO_FEEDBACK__) return; // 幂等：防重复注入
  window.__FUO_FEEDBACK__ = true;

  /* 与全站 config.js 同一套公开配置；无 config 的页面（如 /fuotool）走兜底常量 */
  var CFG = window.FUO_CONFIG || {
    SUPABASE_URL: 'https://mxvlyuteecnyencjebyt.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_wfnd9vfQ-_7BsyG56p20Ew_9L_j02oA',
  };

  var SELF_BASE = '';
  try {
    if (document.currentScript && document.currentScript.src) {
      SELF_BASE = String(document.currentScript.src).replace(/[^/]*$/, '');
    }
  } catch (e) { /* ignore */ }

  var CSS_URL = SELF_BASE + '../css/feedback.css?v=2';
  var SDK_URL = SELF_BASE + '../vendor/supabase.min.js';
  var MAXLEN = 1000;
  var COOLDOWN = 60; // 秒

  var KINDS = [
    { v: 'bug', t: '缺陷' },
    { v: 'suggestion', t: '建议' },
    { v: 'other', t: '其他' },
  ];

  var sb = null;        // supabase client（惰性）
  var sdkLoading = false;
  var openState = false;
  var kind = 'suggestion';

  /* ---------- 样式注入 ---------- */
  function injectCss() {
    if (document.getElementById('fb-style')) return;
    if (document.querySelector('link[data-fb-css]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = CSS_URL;
    l.setAttribute('data-fb-css', '1');
    document.head.appendChild(l);
  }

  /* ---------- SDK 惰性加载（打开弹层时才拉） ---------- */
  function ensureSdk(cb) {
    if (window.supabase) return cb(true);
    if (sdkLoading) { setTimeout(function () { ensureSdk(cb); }, 120); return; }
    if (!SELF_BASE) return cb(false);
    sdkLoading = true;
    var s = document.createElement('script');
    s.src = SDK_URL;
    s.onload = function () { sdkLoading = false; cb(!!window.supabase); };
    s.onerror = function () { sdkLoading = false; cb(false); };
    document.head.appendChild(s);
  }

  function client() {
    if (sb) return sb;
    if (window.supabase && CFG && CFG.SUPABASE_URL) {
      try { sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); } catch (e) { sb = null; }
    }
    return sb;
  }

  /* ---------- toast（挂件自带，避免依赖页面实现） ---------- */
  var toastEl = null, toastT = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'fb-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('is-in');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-in'); }, 3200);
  }

  /* ---------- 节流 ---------- */
  function cooldownLeft() {
    try {
      var last = parseInt(localStorage.getItem('fuo-fb-last') || '0', 10);
      var left = COOLDOWN - Math.floor((Date.now() - last) / 1000);
      return left > 0 ? left : 0;
    } catch (e) { return 0; }
  }

  /* ---------- 会话信息（提交时读取，可选） ---------- */
  function whoAmI(cb) {
    var c = client();
    if (!c) return cb(null, null);
    c.auth.getSession().then(function (_a) {
      var u = _a && _a.data && _a.data.session && _a.data.session.user;
      if (!u) return cb(null, null);
      c.from('profiles').select('username').eq('id', u.id).maybeSingle()
        .then(function (_b) {
          var name = (_b && _b.data && _b.data.username) ||
            (u.user_metadata && u.user_metadata.username) || null;
          cb(u.id, name ? String(name) : null);
        })
        .catch(function () { cb(u.id, null); });
    }).catch(function () { cb(null, null); });
  }

  /* ---------- 构建 DOM ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  var fab = null, modal = null;
  var areaEl = null, countEl = null, contactEl = null, sendBtn = null;

  function buildFab() {
    fab = el('button', 'fb-fab');
    fab.type = 'button';
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.title = '提交反馈';
    fab.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">' +
      '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-4.1 3.6a.6.6 0 0 1-.9-.5V6.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M8.5 9h7M8.5 12.5h4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '<span class="fb-fab-t">反馈</span>';
    fab.addEventListener('click', open);
    document.body.appendChild(fab);
  }

  function buildModal() {
    modal = el('div', 'fb-modal');
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'fb-title');

    var mask = el('div', 'fb-mask');
    mask.addEventListener('click', close);
    modal.appendChild(mask);

    var card = el('div', 'fb-card');

    /* 头部 */
    var head = el('div', 'fb-head');
    var hwrap = el('div');
    var h1 = el('h2', 'fb-title', '一句话，让 Fuo Tools 更好用');
    h1.id = 'fb-title';
    var sub = el('p', 'fb-sub', '发现缺陷、想要功能、随便聊聊都行。登录用户会附带走你的用户名，也可以匿名提交。');
    hwrap.appendChild(h1); hwrap.appendChild(sub);
    var x = el('button', 'fb-close');
    x.type = 'button';
    x.setAttribute('aria-label', '关闭');
    x.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    x.addEventListener('click', close);
    head.appendChild(hwrap); head.appendChild(x);
    card.appendChild(head);

    /* 类型 chips */
    var kinds = el('div', 'fb-kinds');
    kinds.setAttribute('role', 'radiogroup');
    kinds.setAttribute('aria-label', '反馈类型');
    KINDS.forEach(function (k) {
      var b = el('button', 'fb-kind' + (k.v === kind ? ' is-on' : ''), k.t);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(k.v === kind));
      b.setAttribute('data-kind', k.v);
      b.addEventListener('click', function () {
        kind = k.v;
        Array.prototype.forEach.call(kinds.querySelectorAll('.fb-kind'), function (x2) {
          var on = x2 === b;
          x2.classList.toggle('is-on', on);
          x2.setAttribute('aria-checked', String(on));
        });
      });
      kinds.appendChild(b);
    });
    card.appendChild(kinds);

    /* 正文 */
    var field = el('div', 'fb-field');
    var label = el('label', 'fb-label');
    label.textContent = '反馈内容';
    var em = el('em', null, '（必填，≤1000 字）');
    label.appendChild(em);
    label.setAttribute('for', 'fb-area');
    areaEl = el('textarea', 'fb-area');
    areaEl.id = 'fb-area';
    areaEl.maxLength = MAXLEN;
    areaEl.placeholder = '比如：JSON 工具粘贴大文件时卡顿 / 希望云笔记支持导出 Word…';
    countEl = el('span', 'fb-count', '0 / 1000');
    areaEl.addEventListener('input', function () {
      countEl.textContent = areaEl.value.length + ' / ' + MAXLEN;
      countEl.classList.toggle('is-max', areaEl.value.length >= MAXLEN);
    });
    field.appendChild(label);
    field.appendChild(areaEl);
    field.appendChild(countEl);
    card.appendChild(field);

    /* 联系方式（可选） */
    var f2 = el('div', 'fb-field');
    var l2 = el('label', 'fb-label');
    l2.textContent = '联系方式';
    var em2 = el('em', null, '（选填：邮箱 / 微信 / 任意能找到你的方式）');
    l2.appendChild(em2);
    l2.setAttribute('for', 'fb-contact');
    contactEl = el('input', 'fb-input');
    contactEl.id = 'fb-contact';
    contactEl.maxLength = 80;
    contactEl.placeholder = '不填就当匿名处理';
    contactEl.autocomplete = 'off';
    f2.appendChild(l2);
    f2.appendChild(contactEl);
    card.appendChild(f2);

    /* 底部 */
    var foot = el('div', 'fb-foot');
    var note = el('p', 'fb-note', '提交即视为同意反馈内容被 Fuo Tools 查看（仅 System 可见）。反馈不会被公开。');
    sendBtn = el('button', 'fb-send', '提交反馈');
    sendBtn.type = 'button';
    sendBtn.addEventListener('click', submit);
    foot.appendChild(note);
    foot.appendChild(sendBtn);
    card.appendChild(foot);

    modal.appendChild(card);
    document.body.appendChild(modal);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openState) close();
    });
  }

  function open() {
    injectCss();
    if (!modal) buildModal();
    openState = true;
    modal.hidden = false;
    if (document.body.style) document.body.style.overflow = 'hidden';
    setTimeout(function () { if (areaEl) areaEl.focus(); }, 80);
    ensureSdk(function (ok) {
      if (!ok) toast('网络受限：SDK 加载失败，反馈暂时无法提交');
    });
  }

  function close() {
    if (!modal) return;
    openState = false;
    modal.hidden = true;
    if (document.body.style) document.body.style.overflow = '';
  }

  function isMissingTable(err) {
    if (!err) return false;
    var m = err.message || '';
    return err.code === '42P01' || err.code === 'PGRST205' ||
      /relation .* does not exist/i.test(m) || /schema cache/i.test(m);
  }

  function submit() {
    var text = (areaEl.value || '').trim();
    var contact = (contactEl.value || '').trim();

    if (!text) { toast('反馈内容不能为空'); areaEl.focus(); return; }
    if (text.length < 2) { toast('再多写两个字吧，太短没法定位问题'); return; }

    var left = cooldownLeft();
    if (left > 0) { toast('刚提交过反馈，' + left + ' 秒后可以再发一条'); return; }
    if (!client()) { toast('网络受限：无法连接服务，请稍后再试'); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = '提交中…';

    whoAmI(function (uid, uname) {
      var payload = {
        kind: kind,
        content: text.slice(0, MAXLEN),
        page: String(window.location.pathname || '').slice(0, 120),
        user_agent: String(navigator.userAgent || '').slice(0, 180),
        user_id: uid || null,
        username: uname || null,
      };
      if (contact) payload.username = uname ? uname + ' · ' + contact.slice(0, 60) : contact.slice(0, 80);

      client().from('feedback').insert(payload)
        .then(function (_r) {
          sendBtn.disabled = false;
          sendBtn.textContent = '提交反馈';
          if (_r.error) {
            if (isMissingTable(_r.error)) {
              toast('反馈表尚未创建：请先在 Supabase 执行 supabase-feedback.sql');
            } else if (_r.error.code === '42P17' || /infinite recursion/i.test(_r.error.message || '')) {
              toast('服务器 SQL 是旧版（策略无限递归）：请在 Supabase 重新执行最新版 supabase-feedback.sql');
            } else if (_r.error.code === '42501') {
              toast('提交被安全策略拦截：登录用户 60 秒内限发一条，稍后再试');
            } else {
              toast('提交失败：' + (_r.error.message || '未知错误'));
            }
            return;
          }
          try { localStorage.setItem('fuo-fb-last', String(Date.now())); } catch (e) { /* ignore */ }
          areaEl.value = '';
          contactEl.value = '';
          countEl.textContent = '0 / ' + MAXLEN;
          close();
          toast('已收到，感谢反馈！');
        });
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    injectCss();
    buildFab();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
