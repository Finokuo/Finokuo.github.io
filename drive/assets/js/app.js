/* =====================================================
 * Fuo Tools · 仪表盘逻辑
 * 登录守卫 / 问候 / 用户名（加载 + 修改） / 云同步笔记
 * 工具快捷入口（跳转 tool-cluster） / 最近使用 / 账号 / 登出
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;

  /* ?preview=1 → 预览模式：跳过登录跳转，仅展示外壳（无真实数据） */
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;

  var sb = null;
  var user = null;
  var noteTimer = null;
  var noteRow = null;
  var profile = null; // { username } 来自 profiles 表

  var $ = function (id) { return document.getElementById(id); };
  var banner = $('banner');
  var toast = $('toast');

  var QUOTES = [
    '把复杂留给工具，把时间留给自己。',
    '好的工具不需要说明书。',
    '少配置，多创造。',
    '每一次保存，都是给未来的自己。',
    '工具的意义，是让你忘记工具。',
  ];
  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function showBanner(kind, text) {
    banner.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'is-' + kind;
    box.textContent = text;
    banner.appendChild(box);
    banner.hidden = false;
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { return '—'; }
  }

  function isMissingTable(error) {
    if (!error) return false;
    var m = error.message || '';
    return error.code === '42P01' || error.code === 'PGRST205' ||
      /relation .* does not exist/i.test(m) ||
      /could not find the table/i.test(m) ||
      /schema cache/i.test(m);
  }

  /* ---------- 预览模式（未登录外壳） ---------- */
  function enterPreviewMode() {
    showBanner('info', '预览模式：登录后这里会显示你的真实数据。');
    $('user-email').textContent = '未登录（预览）';
    $('user-state').textContent = 'preview';
    $('note-status').textContent = '预览模式';
    $('note-input').disabled = true;
    $('note-input').placeholder = '登录后即可使用云同步笔记…';
    $('acc-username').textContent = '—（登录后显示）';
    $('acc-email').textContent = '—（登录后显示）';
    $('acc-uid').textContent = '—';
    $('acc-created').textContent = '—';
    $('stat-days').textContent = '–';
    $('stat-notes').textContent = '–';
    renderToolCount();
    renderRecent();
    renderGreeting(null);
    bindCommon();
  }

  /* ---------- 未配置 Supabase ---------- */
  function configMissing() {
    return !CFG.SUPABASE_URL || String(CFG.SUPABASE_ANON_KEY).indexOf('在此粘贴') !== -1;
  }

  /* ---------- 渲染 ---------- */
  function displayName() {
    if (profile && profile.username) return profile.username;
    var meta = user && user.user_metadata;
    if (meta && meta.username) return meta.username;
    return user && user.email ? user.email.split('@')[0] : '';
  }

  function renderName() {
    var name = displayName();
    if (!name) return;
    var h = new Date().getHours();
    var word = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    $('hello-title').textContent = word + '，' + name;
    $('user-email').textContent = name;
    $('user-email').title = user.email || '';
    $('user-avatar').textContent = (name[0] || 'F').toUpperCase();
    $('acc-username').textContent = name;
  }

  function renderGreeting(u) {
    var h = new Date().getHours();
    var word = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    var title = u ? word + '，' + (u.email || '').split('@')[0] : word;
    $('hello-title').textContent = title;
    $('hello-sub').textContent = QUOTES[Math.floor(Date.now() / 86400000) % QUOTES.length];
    $('topbar-date').textContent = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
  }

  function renderUser(u) {
    var email = u.email || '未知邮箱';
    // 用户名异步加载后再覆盖显示（loadProfile → renderName）
    $('user-email').textContent = email;
    $('user-email').title = email;
    $('user-state').textContent = '在线';
    $('user-avatar').textContent = (email[0] || 'F').toUpperCase();
    $('acc-username').textContent = (u.user_metadata && u.user_metadata.username) || '加载中…';
    $('acc-email').textContent = email;
    $('acc-uid').textContent = (u.id || '').slice(0, 8) || '—';
    $('acc-created').textContent = u.created_at ? fmtDate(u.created_at) : '—';

    var days = u.created_at
      ? Math.max(1, Math.ceil((Date.now() - new Date(u.created_at).getTime()) / 86400000))
      : '–';
    $('stat-days').textContent = days;
  }

  /* ---------- 用户名：加载 + 修改 ---------- */
  function loadProfile() {
    sb.from('profiles')
      .select('username,status')
      .eq('id', user.id)
      .maybeSingle()
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (!error) profile = data || null;
        // 被封禁：立即登出送回主页（数据库触发器保证无法自行解封）
        if (data && data.status === 'banned') {
          sb.auth.signOut().then(function () {
            window.location.replace(PATHS.MAIN + '?banned=1');
          });
          return;
        }
        // 无论 profiles 是否就绪，都用当前最佳名字（profile → 元数据 → 邮箱前缀）统一渲染
        renderName();
      });
  }

  var unModal = $('username-modal');
  var unInput = $('un-input');
  var unMsg = $('un-msg');
  var unSave = $('un-save');
  var USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
  var unBusy = false;

  function unShowMsg(kind, text) {
    unMsg.className = 'tf-msg' + (kind === 'error' ? ' is-err' : '');
    unMsg.textContent = text;
    unMsg.hidden = false;
  }

  function openUsernameModal() {
    unInput.value = (profile && profile.username) ||
      (user.user_metadata && user.user_metadata.username) ||
      (user.email || '').split('@')[0] || '';
    unMsg.hidden = true;
    unModal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { unInput.focus(); unInput.select(); }, 60);
  }
  function closeUsernameModal() {
    unModal.hidden = true;
    document.body.style.overflow = '';
    unBusy = false;
    unSave.disabled = false;
    unSave.textContent = '保存';
  }

  function saveUsername() {
    if (unBusy) return;
    var name = unInput.value.trim();
    if (!USERNAME_RE.test(name)) {
      unShowMsg('error', '用户名需为 3-20 位，仅限字母、数字和下划线。');
      return;
    }
    if (profile && profile.username === name) {
      unShowMsg('error', '这就是你现在的用户名。');
      return;
    }
    unBusy = true;
    unSave.disabled = true;
    unSave.textContent = '保存中…';
    unMsg.hidden = true;

    sb.from('profiles')
      .update({ username: name })
      .eq('id', user.id)
      .then(function (_a) {
        var error = _a.error;
        if (error) {
          unBusy = false;
          unSave.disabled = false;
          unSave.textContent = '保存';
          if (error.code === '23505' || /duplicate key/i.test(error.message || '')) {
            unShowMsg('error', '该用户名已被占用，换一个试试。');
          } else if (isMissingTable(error)) {
            unShowMsg('error', 'profiles 表不存在：请先在 Supabase 执行最新的 supabase-setup.sql。');
          } else {
            unShowMsg('error', '保存失败：' + (error.message || '未知错误'));
          }
          return;
        }
        // 同步写入 auth 元数据（供登录前等场景回退显示）
        return sb.auth.updateUser({ data: { username: name } }).then(function () {
          profile = profile || {};
          profile.username = name;
          renderName();
          closeUsernameModal();
          showToast('用户名已更新为 ' + name);
        });
      })
      .catch(function () {
        unBusy = false;
        unSave.disabled = false;
        unSave.textContent = '保存';
        unShowMsg('error', '网络异常，请稍后再试。');
      });
  }

  /* ---------- 云同步笔记 ---------- */
  function setNoteStatus(kind, text) {
    var chip = $('note-status');
    chip.className = 'chip' + (kind ? ' is-' + kind : '');
    chip.textContent = text;
  }

  function loadNote() {
    setNoteStatus('', '加载中…');
    sb.from('notes')
      .select('content')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) {
          if (isMissingTable(error)) {
            setNoteStatus('error', '未就绪');
            showBanner('warn', '数据库尚未初始化：请在 Supabase SQL Editor 执行 supabase-setup.sql 后刷新。');
          } else {
            setNoteStatus('error', '加载失败');
          }
          return;
        }
        noteRow = data || null;
        var content = (data && data.content) || '';
        $('note-input').value = content;
        $('note-count').textContent = content.length + ' 字';
        setNoteStatus('synced', '已同步 ✓');
      });
  }

  function saveNote() {
    var content = $('note-input').value;
    setNoteStatus('saving', '保存中…');
    sb.from('notes')
      .upsert({ user_id: user.id, content: content }, { onConflict: 'user_id' })
      .then(function (_a) {
        var error = _a.error;
        if (error) {
          setNoteStatus('error', '保存失败');
          if (isMissingTable(error)) {
            showBanner('warn', '数据库尚未初始化：请在 Supabase SQL Editor 执行 supabase-setup.sql 后刷新。');
          }
          return;
        }
        setNoteStatus('synced', '已同步 ✓');
        $('stat-notes').textContent = content.length;
      });
  }

  /* ---------- 最近使用（工具页/跳转时写入） ---------- */
  var TOOL_TONES = {
    json: 'tone-teal', color: 'tone-fuchsia', password: 'tone-emerald',
    textstats: 'tone-amber', timestamp: 'tone-cyan', base64: 'tone-violet',
    uuid: 'tone-orange', diff: 'tone-rose',
  };
  var TOOL_GLYPHS = {
    json: '{ }', color: '●', password: '***', textstats: 'Aa',
    timestamp: '13:37', base64: '64', uuid: 'ID', diff: '±',
  };
  var TOOL_NAMES = {
    json: 'JSON 格式化', color: '颜色工具', password: '密码生成器',
    textstats: '文本统计', timestamp: '时间戳转换', base64: 'Base64 编解码',
    uuid: 'UUID 生成器', diff: '文本 Diff',
  };

  function recordTool(id) {
    var name = TOOL_NAMES[id] || id;
    try {
      var list = JSON.parse(localStorage.getItem('fuo-recent-tools') || '[]');
      if (!Array.isArray(list)) list = [];
      list = list.filter(function (x) { return x && x.id !== id; });
      list.unshift({ id: id, name: name, at: Date.now() });
      localStorage.setItem('fuo-recent-tools', JSON.stringify(list.slice(0, 12)));

      var count = parseInt(localStorage.getItem('fuo-tool-count') || '0', 10) || 0;
      localStorage.setItem('fuo-tool-count', String(count + 1));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function toolTotal() {
    try { return parseInt(localStorage.getItem('fuo-tool-count') || '0', 10) || 0; }
    catch (e) { return 0; }
  }

  function renderRecent() {
    var list = [];
    try {
      list = JSON.parse(localStorage.getItem('fuo-recent-tools') || '[]');
      if (!Array.isArray(list)) list = [];
    } catch (e) { list = []; }

    var ul = $('recent-list');
    if (!list.length) return; // 保留空状态
    ul.innerHTML = '';
    list.slice(0, 6).forEach(function (item) {
      var li = document.createElement('li');
      var tone = TOOL_TONES[item.id] || 'tone-teal';
      var icon = document.createElement('i');
      icon.className = 'recent-ic ' + tone;
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = TOOL_GLYPHS[item.id] || '»';
      var name = document.createElement('span');
      name.textContent = item.name || String(item);
      var time = document.createElement('small');
      time.textContent = item.at ? new Date(item.at).toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }) : '';
      li.appendChild(icon); li.appendChild(name); li.appendChild(time);
      ul.appendChild(li);
    });
  }

  function renderToolCount() {
    $('stat-tools').textContent = toolTotal();
  }

  /* ---------- 公共交互 ---------- */
  function bindCommon() {
    // 工具跳转入口：记录使用 → 跳到 /drive/tool-cluster/<slug>/
    document.querySelectorAll('[data-tool-link]').forEach(function (a) {
      var slug = a.getAttribute('data-tool-link');
      if (window.FUO_TOOL_URL) a.href = window.FUO_TOOL_URL(slug);
      a.addEventListener('click', function () {
        recordTool(slug);
      });
    });

    // 侧栏「工具集」→ 目录页
    var navTools = $('nav-tools');
    if (navTools && PATHS.TOOL_CLUSTER) navTools.href = PATHS.TOOL_CLUSTER;

    document.querySelectorAll('[data-soon]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        showToast(el.getAttribute('data-soon'));
      });
    });

    function doLogout() {
      if (!sb) { window.location.replace(PATHS.MAIN); return; }
      sb.auth.signOut().then(function () {
        window.location.replace(PATHS.MAIN);
      });
    }
    $('btn-logout').addEventListener('click', doLogout);
    $('btn-logout-2').addEventListener('click', doLogout);
  }

  /* ---------- 登录后初始化 ---------- */
  function enterApp(session) {
    user = session.user;
    renderGreeting(user);
    renderUser(user);
    loadProfile();
    renderRecent();
    renderToolCount();
    loadNote();

    $('note-input').addEventListener('input', function () {
      var v = $('note-input').value;
      $('note-count').textContent = v.length + ' 字';
      clearTimeout(noteTimer);
      setNoteStatus('saving', '编辑中…');
      noteTimer = setTimeout(saveNote, 900);
    });

    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') window.location.replace(PATHS.MAIN);
    });

    bindCommon();

    // 修改用户名弹窗
    $('btn-edit-username').addEventListener('click', openUsernameModal);
    unModal.addEventListener('click', function (e) {
      // closest：点在 ✕ 按钮内的 SVG 图标上也能命中
      if (e.target.closest && e.target.closest('[data-user-close]')) closeUsernameModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !unModal.hidden) closeUsernameModal();
    });
    unSave.addEventListener('click', saveUsername);
    unInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveUsername(); }
    });
  }

  /* ---------- 启动 ---------- */
  if (configMissing()) {
    showBanner('warn', '尚未配置 Supabase：请编辑 assets/js/config.js 填入 Publishable Key。');
  }

  sb = (window.supabase && CFG.SUPABASE_URL)
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY)
    : null;

  if (PREVIEW) {
    enterPreviewMode();
  } else if (!window.supabase) {
    showBanner('warn', 'SDK 未就绪：assets/vendor/supabase.min.js 缺失或被拦截，请确认文件完整后刷新。');
    bindCommon();
  } else if (!sb) {
    // 无法初始化 SDK/配置：停在原地并提示，避免跳转死循环
    showBanner('warn', '无法连接 Supabase，请检查网络与 config.js 配置后刷新。');
    bindCommon();
  } else {
    sb.auth.getSession().then(function (_a) {
      var data = _a.data;
      var session = data && data.session;
      if (!session) {
        window.location.replace(PATHS.MAIN + '?next=drive'); // 未登录 → 主页
        return;
      }
      enterApp(session);
    });
  }
})();
