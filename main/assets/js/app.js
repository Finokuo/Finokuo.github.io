/* =====================================================
 * Fuo Tools · 主页逻辑（登录 / 注册 / 已登录跳转）
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;
  var sb = null;
  var mode = 'login'; // 'login' | 'signup'
  var busy = false;

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var modal = $('auth-modal');
  var tabLogin = $('tab-login');
  var tabSignup = $('tab-signup');
  var authTitle = $('auth-title');
  var authSub = $('auth-sub');
  var form = $('auth-form');
  var emailInput = $('auth-email');
  var pwdInput = $('auth-password');
  var msg = $('auth-msg');
  var submitBtn = $('auth-submit');
  var submitText = $('auth-submit-text');
  var spinner = $('auth-spinner');
  var toast = $('toast');

  /* ---------- 工具函数 ---------- */
  var COPY = {
    login: { title: '欢迎回来', sub: '登录后进入你的工作台', btn: '登录' },
    signup: { title: '创建你的工作台', sub: '一分钟注册，永久免费', btn: '创建账号' },
  };

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function setMode(next) {
    mode = next;
    tabLogin.classList.toggle('is-active', mode === 'login');
    tabSignup.classList.toggle('is-active', mode === 'signup');
    tabLogin.setAttribute('aria-selected', String(mode === 'login'));
    tabSignup.setAttribute('aria-selected', String(mode === 'signup'));
    authTitle.textContent = COPY[mode].title;
    authSub.textContent = COPY[mode].sub;
    submitText.textContent = COPY[mode].btn;
    pwdInput.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    hideMsg();
  }

  function showMsg(kind, text) {
    msg.className = 'auth-msg is-' + kind;
    msg.textContent = text;
    msg.hidden = false;
  }
  function hideMsg() { msg.hidden = true; }

  function setBusy(v) {
    busy = v;
    submitBtn.disabled = v;
    spinner.hidden = !v;
    submitText.textContent = v ? '请稍候…' : COPY[mode].btn;
  }

  function openModal(next) {
    setMode(next);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { emailInput.focus(); }, 60);
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    hideMsg();
  }

  /* ---------- Supabase 初始化 ---------- */
  function initSupabase() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      showMsg('error', 'SDK 未就绪：assets/vendor/supabase.min.js 缺失或被拦截，请确认文件完整后刷新。');
      return null;
    }
    if (!CFG.SUPABASE_URL || CFG.SUPABASE_ANON_KEY.indexOf('在此粘贴') !== -1) {
      showMsg('error', '尚未配置 Supabase：请编辑 assets/js/config.js 填入 Publishable Key。');
      return null;
    }
    return window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  }

  /* ---------- 错误文案映射 ---------- */
  function friendlyError(err) {
    var m = (err && err.message) || String(err);
    if (/already registered/i.test(m)) return '该邮箱已注册，请直接登录。';
    if (/at least 6 characters/i.test(m)) return '密码至少需要 6 位。';
    if (/invalid login credentials/i.test(m)) return '邮箱或密码不正确。';
    if (/email not confirmed/i.test(m)) return '请先查收验证邮件，完成邮箱验证后再登录。';
    if (/rate limit/i.test(m)) return '触发频控：注册人数较多或邮件额度用尽，请一小时后再试。';
    if (/failed to fetch|network/i.test(m)) return '网络连接失败，请检查网络后重试。';
    if (/valid email/i.test(m)) return '请输入正确的邮箱地址。';
    if (/is invalid/i.test(m)) return '该邮箱无法用于注册（域名可能无法收信），请更换一个真实邮箱。';
    return '出错了：' + m;
  }

  /* ---------- 认证动作 ---------- */
  function gotoDrive() {
    showToast('登录成功，正在进入工作台…');
    setTimeout(function () { window.location.replace(PATHS.DRIVE); }, 500);
  }

  function handleSignup(email, password) {
    sb.auth
      .signUp({ email: email, password: password })
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) { setBusy(false); showMsg('error', friendlyError(error)); return; }
        if (data.session) { gotoDrive(); return; }
        // 项目开启了「邮箱验证」：需要用户先去邮箱点击确认
        setBusy(false);
        showMsg('success', '验证邮件已发送到你的邮箱，请查收并点击确认链接，之后回来登录即可。（若未收到，可能触发了每小时邮件限额，请稍后再试）');
      })
      .catch(function (err) { setBusy(false); showMsg('error', friendlyError(err)); });
  }

  function handleLogin(email, password) {
    sb.auth
      .signInWithPassword({ email: email, password: password })
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) { setBusy(false); showMsg('error', friendlyError(error)); return; }
        if (data.session) { gotoDrive(); return; }
        setBusy(false);
        showMsg('error', '登录未完成，请稍后再试。');
      })
      .catch(function (err) { setBusy(false); showMsg('error', friendlyError(err)); });
  }

  /* ---------- 事件绑定 ---------- */
  $('btn-login').addEventListener('click', function () { openModal('login'); });
  $('btn-signup').addEventListener('click', function () { openModal('signup'); });
  $('hero-signup').addEventListener('click', function () { openModal('signup'); });
  $('cta-signup').addEventListener('click', function () { openModal('signup'); });

  tabLogin.addEventListener('click', function () { setMode('login'); });
  tabSignup.addEventListener('click', function () { setMode('signup'); });

  modal.addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  $('pw-toggle').addEventListener('click', function () {
    pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    if (!sb) { sb = initSupabase(); if (!sb) return; }

    var email = emailInput.value.trim();
    var password = pwdInput.value;
    if (!email || email.indexOf('@') === -1) { showMsg('error', '请输入正确的邮箱地址。'); return; }
    if (password.length < 6) { showMsg('error', '密码至少需要 6 位。'); return; }

    hideMsg();
    setBusy(true);
    if (mode === 'signup') handleSignup(email, password);
    else handleLogin(email, password);
  });

  /* ---------- 启动 ---------- */
  sb = initSupabase();

  // 已登录访客访问主页 → 直接进入工作台
  if (sb) {
    sb.auth.getSession().then(function (_a) {
      var data = _a.data;
      if (data && data.session) gotoDrive();
    });
    // 在别的标签页登出时，本页也同步感知
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') showToast('已退出登录');
    });
  }
})();
