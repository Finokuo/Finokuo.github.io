/* =====================================================
 * Fuo Tools · 主页逻辑（登录 / 注册 / 重置密码 / 已登录跳转）
 * 注册：用户名 + 邮箱 + 密码（Supabase Auth + profiles 表）
 *       邮箱仅作账号标识，不发送、不等待任何验证邮件：
 *       用户名查重 → 邮箱查重 → signUp → 拿到 session 直接进工作台
 * 登录：用户名 或 邮箱 + 密码（用户名经 profiles 反查邮箱）
 *
 * 安全策略（改进方案 P0）：
 *   - 注册密码至少 8 位 + 实时强度提示 + 不能与用户名相同
 *   - 注册需勾选同意《服务条款》与《隐私政策》（terms.html / privacy.html）
 *   - 登录连续失败 5 次锁定 15 分钟（前端软限制，服务端由 Supabase 频控兜底）
 *   - 忘记密码：resetPasswordForEmail 发送重置邮件，邮件链接回到本页
 *     （URL hash 带 type=recovery）后进入「设置新密码」模式
 * 精准回跳：登录 / 注册成功后按 ?next= 参数回到来源页
 *   （drive | tools | tool:<slug> | office，默认工作台首页）
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;
  var sb = null;
  var mode = 'login'; // 'login' | 'signup' | 'reset'
  var busy = false;
  var recoveryEmail = '';

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
  var emailLabel = $('auth-email-label');
  var pwdInput = $('auth-password');
  var pwdLabel = $('auth-pwd-label');
  var meter = $('pw-meter');
  var meterHint = $('pw-hint');
  var forgotRow = $('forgot-row');
  var forgotBtn = $('pw-forgot');
  var agreeRow = $('agree-row');
  var agreeInput = $('auth-agree');
  var msg = $('auth-msg');
  var submitBtn = $('auth-submit');
  var submitText = $('auth-submit-text');
  var spinner = $('auth-spinner');
  var toast = $('toast');

  /* ---------- 工具函数 ---------- */
  var COPY = {
    login: { title: '欢迎回来', sub: '用户名或邮箱 + 密码登录', btn: '登录' },
    signup: { title: '创建你的工作台', sub: '一分钟注册，永久免费', btn: '创建账号' },
    reset: { title: '设置新密码', sub: '邮箱验证成功，请输入新密码', btn: '保存新密码' },
  };

  function getQueryParam(name) {
    try {
      if (window.URLSearchParams) {
        return new URLSearchParams(window.location.search).get(name) || '';
      }
    } catch (e) { /* ignore */ }
    var m = window.location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* 登录成功后的去向：优先按 ?next= 回到来源页 */
  function nextTarget() {
    var n = getQueryParam('next');
    if (n === 'drive') return PATHS.DRIVE;
    if (n === 'tools' && PATHS.TOOL_CLUSTER) return PATHS.TOOL_CLUSTER;
    if (n === 'office') {
      return (window.FUO_BASE || '') + '/drive/office' + (window.FUO_SUFFIX || '/');
    }
    if (n && n.indexOf('tool:') === 0) {
      var slug = n.slice(5);
      if (window.FUO_TOOL_URL) {
        try { return window.FUO_TOOL_URL(decodeURIComponent(slug)); } catch (e) { /* ignore */ }
      }
    }
    return PATHS.DRIVE;
  }

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function setMode(next) {
    mode = next;
    var isReset = mode === 'reset';
    tabLogin.classList.toggle('is-active', mode === 'login');
    tabSignup.classList.toggle('is-active', mode === 'signup');
    tabLogin.setAttribute('aria-selected', String(mode === 'login'));
    tabSignup.setAttribute('aria-selected', String(mode === 'signup'));
    var copy = COPY[mode] || COPY.login;
    authTitle.textContent = copy.title;
    authSub.textContent = copy.sub;
    submitText.textContent = copy.btn;

    // 用户名栏：仅注册显示
    fieldUsername.hidden = mode !== 'signup';

    // 邮箱栏：注册=邮箱；登录=用户名或邮箱；重置=只读的账号邮箱
    emailInput.type = mode === 'signup' ? 'email' : 'text';
    emailInput.autocomplete = mode === 'signup' ? 'email' : 'username';
    emailInput.placeholder = mode === 'signup' ? 'you@example.com' : (isReset ? '—' : '用户名或邮箱');
    emailLabel.textContent = mode === 'signup' ? '邮箱' : (isReset ? '账号邮箱' : '用户名或邮箱');
    emailInput.disabled = isReset;
    if (isReset && recoveryEmail) emailInput.value = recoveryEmail;

    // 密码栏文案随模式变化
    pwdLabel.textContent = isReset ? '新密码' : '密码';
    pwdInput.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    pwdInput.placeholder = isReset
      ? '至少 8 位，建议混合字母、数字与符号'
      : (mode === 'signup' ? '至少 8 位' : '输入密码');

    // 登录显示「忘记密码」；注册显示条款勾选；重置都不显示
    forgotRow.hidden = mode !== 'login';
    agreeRow.hidden = mode !== 'signup';
    paintMeter();
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
    submitText.textContent = v ? '请稍候…' : (COPY[mode] || COPY.login).btn;
  }

  function openModal(next) {
    setMode(next);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      (mode === 'signup' ? usernameInput : (mode === 'reset' ? pwdInput : emailInput)).focus();
    }, 60);
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    hideMsg();
  }

  /* ---------- 密码强度提示（注册 / 重置模式） ---------- */
  function pwdStrength(v) {
    if (!v) return { score: 0, label: '' };
    var score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[a-zA-Z]/.test(v) && /\d/.test(v)) score++;
    if (/[^A-Za-z0-9]/.test(v)) score++;
    return { score: score, label: score <= 1 ? '弱' : (score === 2 ? '中' : '强') };
  }

  function paintMeter() {
    var show = (mode === 'signup' || mode === 'reset') && pwdInput.value.length > 0;
    meter.hidden = !show;
    if (!show) return;
    var st = pwdStrength(pwdInput.value);
    var bars = meter.querySelectorAll('i');
    for (var i = 0; i < bars.length; i++) {
      bars[i].className = i < st.score ? 'on' : '';
    }
    meter.setAttribute('data-lv', st.score <= 1 ? 'weak' : (st.score === 2 ? 'mid' : 'strong'));
    meterHint.textContent = '强度：' + st.label;
  }

  /* ---------- 登录失败锁定（前端软限制） ---------- */
  var LOCK_KEY = 'fuo-login-lock';
  function readLock() {
    try {
      return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}') || {};
    } catch (e) { return {}; }
  }
  /* 返回 'locked' = 刚触发锁定；'ok' = 仅计数 */
  function registerLockFail() {
    var s = readLock();
    s.count = (s.count || 0) + 1;
    if (s.count >= 5) {
      s.until = Date.now() + 15 * 60 * 1000;
      s.count = 0;
      try { localStorage.setItem(LOCK_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
      return 'locked';
    }
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    return 'ok';
  }
  function clearLock() {
    try { localStorage.removeItem(LOCK_KEY); } catch (e) { /* ignore */ }
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
    if (/at least \d+ characters?/i.test(m)) return '密码长度不符合要求：至少需要 8 位。';
    if (/invalid login credentials/i.test(m)) return '账号或密码不正确。';
    if (/email not confirmed/i.test(m)) return '该账号邮箱未验证：请在 Supabase 控制台 Authentication → Users 手动确认该用户后再登录。';
    if (/rate limit/i.test(m)) return '触发频控：操作过于频繁，请一小时后再试。';
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
    showToast('登录成功，正在进入…');
    setTimeout(function () { window.location.replace(nextTarget()); }, 500);
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
        if (data.session) { clearLock(); gotoDrive(); return; }

        // 走到这里 = 没拿到 session。分两种情况：
        var user = data && data.user;
        var taken = user && Array.isArray(user.identities) && user.identities.length === 0;
        setBusy(false);
        if (taken) {
          // Supabase 返回「假用户」（identities 为空）：该邮箱在 auth 里已有账号占位。
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
        clearLock();
        gotoDrive();
      }, function () { clearLock(); gotoDrive(); });
  }

  function handleLogin(identifier, password) {
    resolveIdentifier(identifier)
      .then(function (email) {
        return sb.auth.signInWithPassword({ email: email, password: password });
      })
      .then(function (_a) {
        if (!_a) return;
        var data = _a.data, error = _a.error;
        if (error) {
          // 连续失败 5 次 → 前端锁定 15 分钟（服务端另有 Supabase 频控兜底）
          var isBadCreds = /invalid login credentials/i.test(error.message || '');
          var lockResult = isBadCreds ? registerLockFail() : 'ok';
          setBusy(false);
          if (lockResult === 'locked') {
            showMsg('error', '连续失败次数过多，已锁定 15 分钟，请稍后再试。');
          } else {
            showMsg('error', friendlyError(error));
          }
          return;
        }
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

  /* ---------- 重置密码（邮件链接回到本页后设置新密码） ---------- */
  function handleResetPassword(password) {
    sb.auth.updateUser({ password: password })
      .then(function (_r) {
        var error = _r.error;
        if (error) {
          setBusy(false);
          var m = error.message || '';
          showMsg('error', (error.status === 401 || /session|expired|not found/i.test(m))
            ? '重置链接已失效：请回到登录页重新点击「忘记密码」获取新邮件。'
            : friendlyError(error));
          return;
        }
        showToast('密码已更新，正在进入…');
        setTimeout(function () { window.location.replace(nextTarget()); }, 600);
      })
      .catch(function (err) {
        setBusy(false);
        showMsg('error', friendlyError(err));
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

  // 免登录试用工具（JSON / Base64）：从主页直达工具页
  document.querySelectorAll('[data-goto-tool]').forEach(function (el) {
    el.addEventListener('click', function () {
      var slug = el.getAttribute('data-goto-tool');
      var url = window.FUO_TOOL_URL
        ? window.FUO_TOOL_URL(slug)
        : (window.FUO_BASE || '') + '/drive/tool-cluster/' + encodeURIComponent(slug) + (window.FUO_SUFFIX || '/');
      showToast('打开工具…');
      setTimeout(function () { window.location.href = url; }, 200);
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

  pwdInput.addEventListener('input', paintMeter);
  // 注册模式切到其它栏时也要刷新可见性
  emailInput.addEventListener('input', function () { /* placeholder 由 setMode 管理 */ });

  /* 忘记密码：向第一栏填写的邮箱发送重置邮件 */
  forgotBtn.addEventListener('click', function () {
    if (!sb) { sb = initSupabase(); if (!sb) return; }
    var email = emailInput.value.trim();
    if (!email || email.indexOf('@') === -1) {
      showMsg('info', '请先在第一栏输入你的注册邮箱，再点击「忘记密码」。');
      emailInput.focus();
      return;
    }
    setBusy(true);
    var backTo = window.location.origin + (window.FUO_BASE || '') +
      '/main' + (window.FUO_SUFFIX || '/');
    sb.auth.resetPasswordForEmail(email, { redirectTo: backTo })
      .then(function (_r) {
        setBusy(false);
        if (_r.error) { showMsg('error', friendlyError(_r.error)); return; }
        showMsg('success', '重置邮件已发送（可能需要几分钟，记得翻垃圾箱）。打开邮件里的链接，即可回到本页设置新密码。');
      })
      .catch(function (err) {
        setBusy(false);
        showMsg('error', friendlyError(err));
      });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    if (!sb) { sb = initSupabase(); if (!sb) return; }

    var email = emailInput.value.trim();
    var password = pwdInput.value;

    if (mode === 'reset') {
      if (password.length < 8) { showMsg('error', '新密码至少需要 8 位，建议混合字母、数字与符号。'); return; }
      if (recoveryEmail && password === (recoveryEmail.split('@')[0] || '')) {
        showMsg('error', '新密码不能与用户名相同。');
        return;
      }
      hideMsg();
      setBusy(true);
      handleResetPassword(password);
      return;
    }

    if (mode === 'signup') {
      var username = usernameInput.value.trim();
      if (!USERNAME_RE.test(username)) {
        showMsg('error', '用户名需为 3-20 位，仅限字母、数字和下划线。');
        return;
      }
      if (!email || email.indexOf('@') === -1) { showMsg('error', '请输入正确的邮箱地址。'); return; }
      if (password.length < 8) { showMsg('error', '密码至少需要 8 位，建议混合字母、数字与符号。'); return; }
      if (password === username) { showMsg('error', '密码不能与用户名相同。'); return; }
      if (!agreeInput.checked) {
        showMsg('error', '请先阅读并勾选同意《服务条款》与《隐私政策》。');
        return;
      }
      hideMsg();
      setBusy(true);
      handleSignup(username, email, password);
    } else {
      // 登录：前端软锁定检查
      var lock = readLock();
      if (lock.until && Date.now() < lock.until) {
        showMsg('error', '尝试次数过多，请约 ' + Math.max(1, Math.ceil((lock.until - Date.now()) / 60000)) + ' 分钟后再试。');
        return;
      }
      if (!email) { showMsg('error', '请输入用户名或邮箱。'); return; }
      if (!password) { showMsg('error', '请输入密码。'); return; }
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

  // 邮件重置链接回到本页（URL hash 带 type=recovery）→ 直接进入「设置新密码」
  if (/type=recovery/i.test(window.location.hash || '')) {
    openModal('reset');
    if (sb) {
      // SDK 会自动消费 hash 中的令牌；稍候拉取用户邮箱回填只读栏
      setTimeout(function () {
        sb.auth.getUser().then(function (_g) {
          var u = _g.data && _g.data.user;
          if (u && u.email) {
            recoveryEmail = u.email;
            emailInput.value = u.email;
          }
        });
      }, 400);
    }
  }

  // 已登录访客访问主页 → 先查封禁，正常则按 ?next= 精准回跳
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
