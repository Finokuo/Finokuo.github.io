/* =====================================================
 * Fuo Tools · 主页逻辑（登录 / 注册 / 已登录跳转）
 * 注册：用户名 + 邮箱 + 密码（Supabase Auth + profiles 表）
 *       邮箱仅作账号标识，不发送、不等待任何验证邮件：
 *       用户名查重 → 邮箱查重 → signUp → 拿到 session 直接进工作台
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
    if (/email not confirmed/i.test(m)) return '该账号邮箱未验证：请在 Supabase 控制台 Authentication → Users 手动确认该用户后再登录。';
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

  /* 抛出带 friendly 标记的错误：catch 里直接展示原文，不再包「出错了：」前缀 */
  function friendlyErr(text) {
    var e = new Error(text);
    e.friendly = true;
    return e;
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
          var e2 = friendlyErr('查询用户失败，请检查网络后重试。'); throw e2;
        }
        if (!data || !data.email) {
          throw friendlyErr('用户名不存在，请检查拼写，或改用邮箱登录。');
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
          var e2 = friendlyErr('检查用户名时出错，请稍后再试。'); throw e2;
        }
        if (data) throw friendlyErr('该用户名已被占用，换一个试试。');
        return true;
      });
  }

  /* 注册前邮箱预检：profiles 里已存在该邮箱 → 直接拦下，不发注册请求 */
  function checkEmailFree(email) {
    return sb.from('profiles')
      .select('email')
      .eq('email', email.toLowerCase()) // Supabase 存储邮箱统一小写，避免大小写不一致漏检
      .limit(1)
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) {
          if (isMissingTable(error)) {
            var e = new Error(SQL_HINT); e.isSql = true; throw e;
          }
          var e2 = friendlyErr('检查邮箱时出错，请稍后再试。'); throw e2;
        }
        if (data && data.length) throw friendlyErr('该邮箱已注册，请直接登录。');
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
        // 用户名可用 → 再查邮箱是否已被注册（查重通过即发起注册，不发任何验证邮件）
        return checkEmailFree(email);
      })
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

        // 走到这里 = 没拿到 session。分两种情况：
        var user = data && data.user;
        var taken = user && Array.isArray(user.identities) && user.identities.length === 0;
        setBusy(false);
        if (taken) {
          // Supabase 返回「假用户」（identities 为空）：该邮箱在 auth 里已有账号占位。
          // 常见原因：之前注册过但卡在 Waiting for verification（这种账号在 profiles 表里
          // 没有记录，上面的邮箱预检拦不住它，只能在这里接住）。
          showMsg('error', '该邮箱已被 Supabase 里的旧账号占用（多半是之前没验证成功的注册）。两种解决：① 若旧账号是你的，直接用邮箱登录；② 收不到验证邮件的话，到 Supabase 控制台 Authentication → Users 找到该邮箱 → 右侧 ⋮ → Delete user 删除，回来重新注册即可。');
          return;
        }
        if (user) {
          // 真用户但无 session：项目又把「Confirm email」开回来了，注册被挂起等验证。
          showMsg('success', '注册已提交，但该项目仍开着「Confirm email」。请在 Supabase 控制台 Authentication → Sign In / Providers 关闭 Confirm email，并在 Authentication → Users 删除这个未确认账号后重新注册（否则邮箱会被占用）。');
          return;
        }
        showMsg('error', '注册未完成，请稍后再试。');
      })
      .catch(function (err) {
        setBusy(false);
        showMsg('error', (err.isSql || err.friendly) ? err.message : friendlyError(err));
      });
  }

  /* 登录后封禁检查：banned → 立即登出并拦截（status 列不存在/查询失败时放行，不影响登录）
   * onDeny：被拦时的回调（弹窗内提示 / 首页 toast） */
  function checkBannedThenEnter(user, onDeny) {
    sb.from('profiles')
      .select('status')
      .eq('id', user.id)
      .maybeSingle()
      .then(function (_a) {
        var data = _a.data;
        if (data && data.status === 'banned') {
          sb.auth.signOut().then(function () {
            setBusy(false);
            if (onDeny) onDeny();
          });
          return;
        }
        gotoDrive();
      }, function () { gotoDrive(); });
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
        if (data.session) {
          // 登录成功 → 先查封禁状态，再放行进工作台
          checkBannedThenEnter(data.session.user, function () {
            showMsg('error', '该账号已被封禁，如有疑问请联系管理员。');
          });
          return;
        }
        setBusy(false);
        showMsg('error', '登录未完成，请稍后再试。');
      })
      .catch(function (err) {
        setBusy(false);
        showMsg('error', (err.isSql || err.friendly) ? err.message : friendlyError(err));
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

  // 从工作台/工具页被踢回时（?banned=1）给出提示
  if (window.location.search.indexOf('banned=1') !== -1) {
    showToast('该账号已被封禁，如有疑问请联系管理员。');
  }

  // 已登录访客访问主页 → 先查封禁，正常则直接进入工作台
  if (sb) {
    sb.auth.getSession().then(function (_a) {
      var data = _a.data;
      if (data && data.session) {
        checkBannedThenEnter(data.session.user, function () {
          showToast('该账号已被封禁，如有疑问请联系管理员。');
        });
      }
    });
    // 在别的标签页登出时，本页也同步感知
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') showToast('已退出登录');
    });
  }
})();
