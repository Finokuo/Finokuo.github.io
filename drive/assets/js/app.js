/* =====================================================
 * Fuo Tools · 仪表盘逻辑
 * 登录守卫 / 问候 / 云同步笔记 / 最近使用 / 账号 / 登出
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

  /* ---------- 预览模式（未登录外壳） ---------- */
  function enterPreviewMode() {
    showBanner('info', '预览模式：登录后这里会显示你的真实数据。');
    $('user-email').textContent = '未登录（预览）';
    $('user-state').textContent = 'preview';
    $('note-status').textContent = '预览模式';
    $('note-input').disabled = true;
    $('note-input').placeholder = '登录后即可使用云同步笔记…';
    $('acc-email').textContent = '—（登录后显示）';
    $('acc-uid').textContent = '—';
    $('acc-created').textContent = '—';
    $('stat-days').textContent = '–';
    $('stat-notes').textContent = '–';
    renderGreeting(null);
    bindCommon();
  }

  /* ---------- 未配置 Supabase ---------- */
  function configMissing() {
    return !CFG.SUPABASE_URL || String(CFG.SUPABASE_ANON_KEY).indexOf('在此粘贴') !== -1;
  }

  /* ---------- 渲染 ---------- */
  function renderGreeting(u) {
    var h = new Date().getHours();
    var word = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    var title = u ? word + '，' + u.email.split('@')[0] : word;
    $('hello-title').textContent = title;
    $('hello-sub').textContent = QUOTES[Math.floor(Date.now() / 86400000) % QUOTES.length];
    $('topbar-date').textContent = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
  }

  function renderUser(u) {
    var email = u.email || '未知邮箱';
    $('user-email').textContent = email;
    $('user-email').title = email;
    $('user-state').textContent = '在线';
    $('user-avatar').textContent = (email[0] || 'F').toUpperCase();
    $('acc-email').textContent = email;
    $('acc-uid').textContent = (u.id || '').slice(0, 8) || '—';
    $('acc-created').textContent = u.created_at ? fmtDate(u.created_at) : '—';

    var days = u.created_at
      ? Math.max(1, Math.ceil((Date.now() - new Date(u.created_at).getTime()) / 86400000))
      : '–';
    $('stat-days').textContent = days;
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
          if (error.code === '42P01' || /relation .* does not exist/i.test(error.message || '')) {
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
          if (error.code === '42P01' || /relation .* does not exist/i.test(error.message || '')) {
            showBanner('warn', '数据库尚未初始化：请在 Supabase SQL Editor 执行 supabase-setup.sql 后刷新。');
          }
          return;
        }
        setNoteStatus('synced', '已同步 ✓');
        $('stat-notes').textContent = content.length;
      });
  }

  /* ---------- 最近使用（本地记录，供后续工具页写入） ---------- */
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
      var icon = document.createElement('span');
      icon.className = 'mono';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '»';
      var name = document.createElement('span');
      name.textContent = item.name || String(item);
      var time = document.createElement('small');
      time.textContent = item.at ? new Date(item.at).toLocaleDateString('zh-CN') : '';
      li.appendChild(icon); li.appendChild(name); li.appendChild(time);
      ul.appendChild(li);
    });
  }

  /* ---------- 公共交互 ---------- */
  function bindCommon() {
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
    renderRecent();
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
