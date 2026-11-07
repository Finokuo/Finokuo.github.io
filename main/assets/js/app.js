/* =====================================================
 * Fuo Tools · 主页逻辑（登录 / 注册 / 已登录跳转）
 * 注册：用户名 + 邮箱 + 密码（Supabase Auth + profiles 表）
 * 登录：用户名 或 邮箱 + 密码（用户名经 profiles 反查邮箱）
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;
  var sb = null;
  var mode = 'login'; // 'login' | 'signup'
  var busy = false;

  /* 用户名规则：3-20 位，字母 / 数字 / 下划线 */
  var USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var modal = $('auth-modal');
  var tabLogin = $('tab-login');
  var tabSignup = $('tab-signup');
  var authTitle = $('auth-title');
  var authSub = $('auth-sub');
  var form = $('auth-form');
  var fieldUsername = $('field-username');
  var usernameInput = $('auth-username');
  var emailInput = $('auth-email');
  var pwdInput = $('auth-password');
  var msg = $('auth-msg');
  var submitBtn = $('auth-submit');
  var submitText = $('auth-submit-text');
  var spinner = $('auth-spinner');
  var toast = $('toast');

  /* ---------- 工具函数 ---------- */
  var COPY = {
    login: { title: '欢迎回来', sub: '用户名或邮箱 + 密码登录', btn: '登录' },
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
    // 注册显示用户名字段；登录隐藏，且第一栏接受「用户名或邮箱」
    fieldUsername.hidden = mode !== 'signup';
    emailInput.type = mode === 'signup' ? 'email' : 'text';
    emailInput.autocomplete = mode === 'signup' ? 'email' : 'username';
    emailInput.placeholder = mode === 'signup' ? 'you@example.com' : '用户名或邮箱';
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
    setTimeout(function () {
      (mode === 'signup' ? usernameInput : emailInput).focus();
    }, 60);
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
    if (/invalid login credentials/i.test(m)) return '账号或密码不正确。';
    if (/email not confirmed/i.test(m)) return '请先查收验证邮件，完成邮箱验证后再登录。';
    if (/rate limit/i.test(m)) return '触发频控：注册人数较多或邮件额度用尽，请一小时后再试。';
    if (/failed to fetch|network/i.test(m)) return '网络连接失败，请检查网络后重试。';
    if (/valid email/i.test(m)) return '请输入正确的邮箱地址。';
    if (/is invalid/i.test(m)) return '该邮箱无法用于注册（域名可能无法收信），请更换一个真实邮箱。';
    if (/database error saving/i.test(m) || /duplicate key/i.test(m) || err && err.code === '23505') {
      return '用户名可能已被占用，请换一个用户名再试。';
    }
    return '出错了：' + m;
  }

  /* ---------- 用户名 ⇄ 邮箱 ---------- */
  var SQL_HINT = '数据库尚未初始化：请在 Supabase 控制台 SQL Editor 执行最新的 supabase-setup.sql（用户名功能依赖 profiles 表）。';

  function isMissingTable(error) {
    if (!error) return false;
    var m = error.message || '';
    return error.code === '42P01' || error.code === 'PGRST205' ||
      /relation .* does not exist/i.test(m) ||
      /could not find the table/i.test(m) ||
      /schema cache/i.test(m);
  }

  /* 登录输入可能是用户名 → 查 profiles 拿邮箱；是邮箱 → 原样返回 */
  function resolveIdentifier(identifier) {
    if (identifier.indexOf('@') !== -1) return Promise.resolve(identifier);
    return sb.from('profiles')
      .select('email')
      .eq('username', identifier)
      .maybeSingle()
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) {
          if (isMissingTable(error)) {
            var e = new Error(SQL_HINT); e.isSql = true; throw e;
          }
          var e2 = new Error('查询用户失败，请检查网络后重试。'); throw e2;
        }
        if (!data || !data.email) {
          throw new Error('用户名不存在，请检查拼写，或改用邮箱登录。');
        }
        return data.email;
      });
  }

  /* 注册前重名预检（数据库唯一约束兜底） */
  function checkUsernameFree(username) {
    return sb.from('profiles')
      .select('username')
      .eq('username', username)
      .maybeSingle()
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) {
          if (isMissingTable(error)) {
            var e = new Error(SQL_HINT); e.isSql = true; throw e;
          }
          var e2 = new Error('检查用户名时出错，请稍后再试。'); throw e2;
        }
        if (data) throw new Error('该用户名已被占用，换一个试试。');
        return true;
      });
  }

  /* ---------- 认证动作 ---------- */
  function gotoDrive() {
    showToast('登录成功，正在进入工作台…');
    setTimeout(function () { window.location.replace(PATHS.DRIVE); }, 500);
  }

  function handleSignup(username, email, password) {
    checkUsernameFree(username)
      .then(function () {
        return sb.auth.signUp({
          email: email,
          password: password,
          options: { data: { username: username } },
        });
      })
      .then(function (_a) {
        if (!_a) return; // 上一步已抛错
        var data = _a.data, error = _a.error;
        if (error) { setBusy(false); showMsg('error', friendlyError(error)); return; }
        if (data.session) { gotoDrive(); return; }
        // 项目开启了「邮箱验证」：需要用户先去邮箱点击确认
        setBusy(false);
        showMsg('success', '验证邮件已发送到你的邮箱，请查收并点击确认链接，之后回来登录即可。（若未收到，可能触发了每小时邮件限额，请稍后再试）');
      })
      .catch(function (err) {
        setBusy(false);
        showMsg('error', err.isSql ? err.message : friendlyError(err));
      });
  }

  function handleLogin(identifier, password) {
    resolveIdentifier(identifier)
      .then(function (email) {
        return sb.auth.signInWithPassword({ email: email, password: password });
      })
      .then(function (_a) {
        if (!_a) return;
        var data = _a.data, error = _a.error;
        if (error) { setBusy(false); showMsg('error', friendlyError(error)); return; }
        if (data.session) { gotoDrive(); return; }
        setBusy(false);
        showMsg('error', '登录未完成，请稍后再试。');
      })
      .catch(function (err) {
        setBusy(false);
        showMsg('error', err.isSql ? err.message : friendlyError(err));
      });
  }

  /* ---------- 事件绑定 ---------- */
  $('btn-login').addEventListener('click', function () { openModal('login'); });
  $('btn-signup').addEventListener('click', function () { openModal('signup'); });
  $('hero-signup').addEventListener('click', function () { openModal('signup'); });
  $('cta-signup').addEventListener('click', function () { openModal('signup'); });

  tabLogin.addEventListener('click', function () { setMode('login'); });
  tabSignup.addEventListener('click', function () { setMode('signup'); });

  // 可用工具 chip：进入工作台（未登录会先经过登录流程）
  document.querySelectorAll('[data-goto-drive]').forEach(function (el) {
    el.addEventListener('click', function () {
      showToast('进入工作台使用工具…');
      setTimeout(function () { window.location.href = PATHS.DRIVE; }, 300);
    });
  });

  modal.addEventListener('click', function (e) {
    // 用 closest 向上查找：点在关闭按钮内的 SVG 图标上（e.target 是 svg/path）也能命中
    if (e.target.closest && e.target.closest('[data-close]')) closeModal();
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

    if (mode === 'signup') {
      var username = usernameInput.value.trim();
      if (!USERNAME_RE.test(username)) {
        showMsg('error', '用户名需为 3-20 位，仅限字母、数字和下划线。');
        return;
      }
      if (!email || email.indexOf('@') === -1) { showMsg('error', '请输入正确的邮箱地址。'); return; }
      if (password.length < 6) { showMsg('error', '密码至少需要 6 位。'); return; }
      hideMsg();
      setBusy(true);
      handleSignup(username, email, password);
    } else {
      if (!email) { showMsg('error', '请输入用户名或邮箱。'); return; }
      if (password.length < 6) { showMsg('error', '密码至少需要 6 位。'); return; }
      hideMsg();
      setBusy(true);
      handleLogin(email, password);
    }
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
