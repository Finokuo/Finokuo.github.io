/* =====================================================
 * Fuo Tools · 仪表盘逻辑
 * 登录守卫 / 问候 / 用户名（加载 + 修改） / 云同步笔记
 * 工具快捷入口（G3：8 高频磁贴 + 全部工具，跳转 tool-cluster）
 * G1 新手引导浮层 / G2 收藏徽标 / G4 统计零值（详见各「G：」注释）
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;

  /* ?preview=1 → 预览模式：跳过登录跳转，仅展示外壳（无真实数据） */
  var PREVIEW = !!(window.FUO_PREVIEW || window.location.search.indexOf('preview=1') !== -1); // v0.9.4：读全局记忆，整站漫游

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
  /* H2：toast 支持 duration 参数（默认 2600ms；复制类反馈统一传 1600ms。
     当前工作台暂无复制类调用点（grep 核实），参数先行对齐全站规范） */
  function showToast(text, duration) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, duration || 2600);
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
    showBanner('info', '预览模式：免登录漫游全站，登录后这里会显示你的真实数据。侧栏「退出预览」可退出。');
    $('user-email').textContent = '未登录（预览）';
    if (window.FUO_PREVIEW_EXIT_BIND) window.FUO_PREVIEW_EXIT_BIND($('user-state'));
    else $('user-state').textContent = 'preview';
    $('note-status').textContent = '预览模式';
    $('note-input').disabled = true;
    $('note-input').placeholder = '登录后即可使用云同步笔记…';
    $('acc-username').textContent = '—（登录后显示）';
    $('acc-email').textContent = '—（登录后显示）';
    $('acc-uid').textContent = '—';
    $('acc-created').textContent = '—';
    $('stat-days').textContent = '—'; // G4：预览态未登录，加入天数/云笔记字数记为「未统计」
    $('stat-notes').textContent = '—';
    renderToolCount();
    renderRecent();
    renderGreeting(null);
    renderQuickGrid(); // G3：8 高频磁贴 + 全部工具入口（须在 bindCommon 之前渲染，[data-tool-link] 才能绑上）
    bindCommon();
    renderOnboarding(); // 预览模式同样展示首访引导（须在 bindCommon 之后）
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
    // 修复闪烁：不再先用邮箱前缀拼问候，保持纯问候词；
    // loadProfile 就绪后 renderName() 会带上用户名一次性更新
    $('hello-title').textContent = word;
    $('hello-sub').textContent = QUOTES[Math.floor(Date.now() / 86400000) % QUOTES.length];
    $('topbar-date').textContent = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
  }

  function renderUser(u) {
    var email = u.email || '未知邮箱';
    // 修复闪烁：侧栏用户名保持「…」占位，等 loadProfile → renderName 用真实用户名填入；
    // 这里只填充不涉及姓名展示的字段（邮箱/ID/注册时间属于账号信息，本就该展示）
    $('user-email').textContent = '…';
    $('user-email').title = '';
    $('user-state').textContent = '在线';
    $('user-avatar').textContent = '…';
    $('acc-username').textContent = '加载中…';
    $('acc-email').textContent = email;
    $('acc-uid').textContent = (u.id || '').slice(0, 8) || '—';
    $('acc-created').textContent = u.created_at ? fmtDate(u.created_at) : '—';

    var days = u.created_at
      ? Math.max(1, Math.ceil((Date.now() - new Date(u.created_at).getTime()) / 86400000))
      : '—'; // G4：无注册时间 → 未统计「—」（真实天数则如实显示）
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

  /* ---------- 云同步笔记（读写 notes 表里 is_quick=true 那一行，与云笔记页打通） ---------- */
  function setNoteStatus(kind, text) {
    var chip = $('note-status');
    chip.className = 'chip' + (kind ? ' is-' + kind : '');
    chip.textContent = text;
  }

  function loadNote() {
    setNoteStatus('', '加载中…');
    sb.from('notes')
      .select('id,content')
      .eq('user_id', user.id)
      .eq('is_quick', true)
      .maybeSingle()
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) {
          if (isMissingTable(error)) {
            setNoteStatus('error', '未就绪');
            showBanner('warn', '数据库尚未初始化：请在 Supabase SQL Editor 执行 supabase-notes.sql 后刷新。');
          } else if (error.code === 'PGRST204' || error.code === '42703' || /is_quick|does not exist/i.test(error.message || '')) {
            // notes 表还是旧结构（没有 is_quick 列）
            setNoteStatus('error', '需升级');
            showBanner('warn', 'notes 表需要升级到 v4：请在 Supabase SQL Editor 执行 supabase-notes.sql 后刷新（云笔记多行化 + 文件夹 + 收藏）。');
          } else {
            setNoteStatus('error', '加载失败');
          }
          return;
        }
        noteRow = data || null;
        var content = (data && data.content) || '';
        $('note-input').value = content;
        $('note-count').textContent = content.length + ' 字';
        $('stat-notes').textContent = String(content.length); // G4：加载即回填真实字数（0 也如实显示 0，不再留「—」）
        setNoteStatus('synced', '已同步 ✓');
      });
  }

  function saveNote() {
    var content = $('note-input').value;
    setNoteStatus('saving', '保存中…');
    var req;
    if (noteRow && noteRow.id) {
      req = sb.from('notes').update({ content: content }).eq('id', noteRow.id);
    } else {
      // 快捷笔记行缺失时补建（正常情况下 setup/notes.sql 已回填）
      req = sb.from('notes').insert({ user_id: user.id, title: '快捷笔记', content: content, is_quick: true });
    }
    req.then(function (_a) {
      var error = _a.error;
      if (error) {
        setNoteStatus('error', '保存失败');
        if (isMissingTable(error)) {
          showBanner('warn', '数据库尚未初始化：请在 Supabase SQL Editor 执行 supabase-notes.sql 后刷新。');
        }
        return;
      }
      if (!noteRow && _a.data && _a.data[0]) noteRow = _a.data[0];
      setNoteStatus('synced', '已同步 ✓');
      $('stat-notes').textContent = content.length;
    });
  }

  /* ---------- 最近使用（工具页/跳转时写入） ---------- */
  var TOOL_TONES = {
    json: 'tone-teal', color: 'tone-violet', password: 'tone-green',
    textstats: 'tone-amber', timestamp: 'tone-teal', base64: 'tone-violet',
    uuid: 'tone-amber', diff: 'tone-rose', regex: 'tone-rose',
    qrcode: 'tone-teal', hash: 'tone-green', url: 'tone-amber',
    imgcom: 'tone-amber', jwt: 'tone-violet', radix: 'tone-teal', lorem: 'tone-amber',
    // v0.8 办公集
    todo: 'tone-teal', habit: 'tone-rose', pomodoro: 'tone-amber',
    // G3：云笔记（工具集成员 tool-cluster/notes/，工作台高频磁贴之一）
    notes: 'tone-teal',
  };
  var TOOL_GLYPHS = {
    json: '{ }', color: '●', password: '***', textstats: 'Aa',
    timestamp: '13:37', base64: '64', uuid: 'ID', diff: '±',
    regex: '.*', qrcode: '▣', hash: '#', url: '⇄', imgcom: '↘',
    jwt: '⟐', radix: '⇄2', lorem: '¶',
    todo: '☑', habit: '❤', pomodoro: '🍅',
    notes: '✎', // G3：云笔记字形（最近使用列表用）
  };
  var TOOL_NAMES = {
    json: 'JSON 格式化', color: '颜色工具', password: '密码生成器',
    textstats: '文本统计', timestamp: '时间戳转换', base64: 'Base64 编解码',
    uuid: 'UUID 生成器', diff: '文本 Diff', regex: '正则测试器',
    qrcode: '二维码生成', hash: '哈希计算', url: 'URL 编解码',
    imgcom: '图片压缩', jwt: 'JWT 解码器', radix: '进制转换', lorem: 'Lorem 占位文本',
    // v0.8 办公集
    todo: '待办清单', habit: '习惯打卡', pomodoro: '番茄钟',
    // G3：云笔记（磁贴 / 最近使用统一中文名）
    notes: '云笔记',
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

  /* ---------- G3：工作台高频磁贴（8 款 + 全部工具入口，替代原 16 静态磁贴） ----------
   * 容器在 index.html #quick-grid；tone / SVG 从原磁贴原样复制，默认序 = 高频序；
   * notes 原无磁贴形态：云笔记页是工具集成员（PATHS.NOTES），图标沿用快捷笔记卡头图标。 */
  var QUICK_TOOLS = [
    { id: 'json', label: 'JSON', tone: 'tone-teal', aria: '打开 JSON 格式化工具',
      icon: '<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' },
    { id: 'color', label: '颜色', tone: 'tone-violet', aria: '打开颜色工具',
      icon: '<svg viewBox="0 0 24 24"><path d="M12 3.5S6 10.2 6 14.2a6 6 0 0 0 12 0C18 10.2 12 3.5 12 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>' },
    { id: 'password', label: '密码', tone: 'tone-green', aria: '打开密码生成器',
      icon: '<svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M11.5 12H21M18 12v3.2M15 12v2.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>' },
    { id: 'timestamp', label: '时间戳', tone: 'tone-teal', aria: '打开时间戳转换工具',
      icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>' },
    { id: 'base64', label: 'Base64', tone: 'tone-violet', aria: '打开 Base64 编解码工具',
      icon: '<svg viewBox="0 0 24 24"><path d="M5 9h14M5 15h14M9.5 4l-2 16M16.5 4l-2 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>' },
    { id: 'uuid', label: 'UUID', tone: 'tone-amber', aria: '打开 UUID 生成器',
      icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="8" cy="12" r="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M13 10h4.5M13 14h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>' },
    { id: 'qrcode', label: '二维码', tone: 'tone-teal', aria: '打开二维码生成器',
      icon: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M14 14h2.6M19.2 14h1.3M14 17.6v2.4M17.6 17.6h2.9M14 21h1.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>' },
    { id: 'notes', label: '云笔记', tone: 'tone-teal', aria: '打开云笔记',
      icon: '<svg viewBox="0 0 24 24"><path d="M6 4h9l4 4v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5.5A1.5 1.5 0 0 1 6.5 4H6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M14.5 4v4.5H19M8.5 13h7M8.5 16.5h4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>' },
  ];

  /* G3：磁贴排序 —— 最近使用时间优先（fuo-recent-tools，recordTool 写入），
   * 频次其次（fuo-tool-heat，tool-page.js / 命令面板同源），两者皆无时回默认序。
   * 只在 8 款内部重排，不增删条目。 */
  function quickOrder() {
    var at = {};
    var heat = {};
    try {
      var list = JSON.parse(localStorage.getItem('fuo-recent-tools') || '[]');
      if (Array.isArray(list)) {
        list.forEach(function (x) {
          if (x && x.id && (at[x.id] === undefined || (x.at || 0) > at[x.id])) at[x.id] = x.at || 0;
        });
      }
    } catch (e) { /* 隐私模式忽略 */ }
    try { heat = JSON.parse(localStorage.getItem('fuo-tool-heat') || '{}') || {}; }
    catch (e) { heat = {}; }
    return QUICK_TOOLS.slice().sort(function (a, b) {
      var ta = at[a.id] || 0, tb = at[b.id] || 0;
      if (ta !== tb) return tb - ta; // 最近使用优先
      var ha = heat[a.id] || 0, hb = heat[b.id] || 0;
      if (ha !== hb) return hb - ha; // 频次次序
      return QUICK_TOOLS.indexOf(a) - QUICK_TOOLS.indexOf(b); // 默认序兜底
    });
  }

  function renderQuickGrid() {
    var grid = $('quick-grid');
    if (!grid) return;
    var cluster = (PATHS && PATHS.TOOL_CLUSTER) || '../tool-cluster/';
    var toolUrl = function (id) {
      return window.FUO_TOOL_URL ? window.FUO_TOOL_URL(id) : cluster;
    };
    var build = function () {
      grid.innerHTML = '';
      quickOrder().forEach(function (t) {
        var a = document.createElement('a');
        a.className = 'tool';
        a.setAttribute('data-tool-link', t.id); // bindCommon 统一记录使用 + 修正 href
        a.setAttribute('aria-label', t.aria);
        var b = document.createElement('b');
        b.className = 't-ic ' + t.tone;
        b.setAttribute('aria-hidden', 'true');
        b.innerHTML = t.icon;
        var span = document.createElement('span');
        span.textContent = t.label;
        a.appendChild(b);
        a.appendChild(span);
        grid.appendChild(a);
      });
      // 尾部追加「全部工具 →」入口卡（虚化/描边风格，见 .tool-more）
      var more = document.createElement('a');
      more.className = 'tool tool-more';
      more.href = cluster;
      more.setAttribute('aria-label', '打开工具集目录');
      var mb = document.createElement('b');
      mb.className = 't-ic';
      mb.setAttribute('aria-hidden', 'true');
      mb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12h16m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
      var mspan = document.createElement('span');
      mspan.textContent = '全部工具 →';
      more.appendChild(mb);
      more.appendChild(mspan);
      grid.appendChild(more);
    };
    try {
      build();
    } catch (e) {
      // 渲染失败兜底：退化为纯文字磁贴，保证入口可用（仅用本文件常量拼装，无用户数据）
      try {
        grid.innerHTML = quickOrder().map(function (t) {
          return '<a class="tool" href="' + toolUrl(t.id) + '" aria-label="' + t.aria + '">' + t.label + '</a>';
        }).join('') +
          '<a class="tool tool-more" href="' + cluster + '" aria-label="打开工具集目录">全部工具 →</a>';
      } catch (e2) { /* 连兜底都失败：保持空容器，不阻塞首屏 */ }
    }
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
    $('stat-tools').textContent = toolTotal(); // G4：本机真实计数（无记录即真实 0，如实显示「0」）
  }

  /* G1：新手引导 —— 原首屏引导卡改为「首次访问 modal 浮层」（工作台首屏只留问候 +
   * 快捷磁贴 + 快捷笔记 + 最近使用）。
   * 复用站内 .modal / .modal-mask / .modal-card 弹层语言：Esc 关闭 + 点遮罩关闭 +
   * 打开时焦点入浮层、关闭后焦点还原 + role=dialog/aria-modal + 轻量 Tab 圈定；
   * 展示时机不变：fuo-onboarded 旗标首次访问展示一次（用过工具的熟手不再打扰），
   * 预览模式同样生效（renderOnboarding 仍在 bindCommon 之后调用）。 */
  function renderOnboarding() {
    var flag = '0';
    try { flag = localStorage.getItem('fuo-onboarded') || '0'; } catch (e) { /* ignore */ }
    if (flag === '1' || toolTotal() > 0) {
      try { localStorage.setItem('fuo-onboarded', '1'); } catch (e) { /* ignore */ }
      return;
    }
    if (document.getElementById('onboard-modal')) return; // 幂等：同一页面只建一次

    function markDone() {
      try { localStorage.setItem('fuo-onboarded', '1'); } catch (e) { /* ignore */ }
    }

    var wrap = document.createElement('div');
    wrap.className = 'modal onboard-modal';
    wrap.id = 'onboard-modal';
    wrap.hidden = true;

    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.setAttribute('data-onboard-close', '');

    var card = document.createElement('div');
    card.className = 'modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'ob-title');

    var head = document.createElement('div');
    head.className = 'modal-head';
    var h2 = document.createElement('h2');
    h2.className = 'modal-title';
    h2.id = 'ob-title';
    h2.textContent = '第一次来？三步上手';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('data-onboard-close', '');
    closeBtn.setAttribute('aria-label', '关闭新手引导');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    head.appendChild(h2);
    head.appendChild(closeBtn);

    // 三步文案沿用原引导卡
    var grid = document.createElement('div');
    grid.className = 'onboard-grid';
    var items = [
      { no: '01', title: '试试免登录工具', desc: 'JSON 格式化：粘贴 JSON 一键排版校验，无需注册。', href: window.FUO_TOOL_URL ? window.FUO_TOOL_URL('json') : PATHS.DRIVE, tool: 'json' },
      { no: '02', title: '记下第一条笔记', desc: '云笔记多端自动同步，换设备也不丢。', href: PATHS.NOTES || PATHS.TOOL_CLUSTER, tool: '' },
      { no: '03', title: '保持专注', desc: '番茄钟 + 待办 + 习惯打卡，办公集一站备齐。', href: PATHS.OFFICE || PATHS.DRIVE, tool: '' },
    ];
    items.forEach(function (it) {
      var a = document.createElement('a');
      a.className = 'onboard-item';
      a.href = it.href;
      if (it.tool) a.setAttribute('data-tool-link', it.tool); // 与磁贴同款使用记录
      var b = document.createElement('b');
      var no = document.createElement('span');
      no.className = 'onboard-no mono';
      no.textContent = it.no;
      b.appendChild(no);
      b.appendChild(document.createTextNode(it.title));
      var p = document.createElement('p');
      p.textContent = it.desc;
      a.appendChild(b);
      a.appendChild(p);
      // 点步骤卡视为已引导：跳转前先记忆，返回后不再打扰
      if (it.tool) a.addEventListener('click', function () { recordTool(it.tool); });
      a.addEventListener('click', markDone);
      grid.appendChild(a);
    });

    var foot = document.createElement('div');
    foot.className = 'onboard-foot';
    var ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'tbtn is-primary';
    ok.setAttribute('data-onboard-close', '');
    ok.textContent = '知道了';
    foot.appendChild(ok);

    card.appendChild(head);
    card.appendChild(grid);
    card.appendChild(foot);
    wrap.appendChild(mask);
    wrap.appendChild(card);

    var lastFocus = null;
    function focusables() {
      return card.querySelectorAll('a[href], button:not([disabled])');
    }
    function close() {
      if (wrap.hidden) return;
      wrap.hidden = true;
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKeydown);
      markDone();
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); // 焦点还原
    }
    function onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        // 轻量焦点圈定：Tab 循环留在浮层内（与抽屉导航同一做法）
        var f = focusables();
        if (!f.length) return;
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !card.contains(document.activeElement))) {
          e.preventDefault(); first.focus();
        }
      }
    }
    wrap.addEventListener('click', function (e) {
      // closest：点在 ✕ 按钮内的 SVG 图标上也能命中（与用户名弹窗同一做法）
      if (e.target.closest && e.target.closest('[data-onboard-close]')) close();
    });

    document.body.appendChild(wrap);
    // 打开：锁滚动 + 焦点入浮层（节奏与修改用户名弹窗一致）
    lastFocus = document.activeElement;
    wrap.hidden = false;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeydown);
    setTimeout(function () {
      var f = focusables();
      if (f.length) f[0].focus({ preventScroll: true });
    }, 60);
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

    // 侧栏导航：工具集 / 办公集 / 收藏 / 设置
    var navTools = $('nav-tools');
    if (navTools && PATHS.TOOL_CLUSTER) navTools.href = PATHS.TOOL_CLUSTER;
    var navOffice = $('nav-office');
    if (navOffice && PATHS.OFFICE) navOffice.href = PATHS.OFFICE;
    var navWgzx = $('nav-wgzx');
    if (navWgzx && PATHS.WGZX) navWgzx.href = PATHS.WGZX;
    var officeMore = $('office-more');
    if (officeMore && PATHS.OFFICE) officeMore.href = PATHS.OFFICE;
    var navFav = $('nav-favorites');
    if (navFav && PATHS.FAVORITES) navFav.href = PATHS.FAVORITES;
    var navSettings = $('nav-settings');
    if (navSettings && PATHS.SETTINGS) navSettings.href = PATHS.SETTINGS;

    // v0.8：办公集快捷入口（跳转 drive/office/<slug>/，同样计入使用记录）
    document.querySelectorAll('[data-office-link]').forEach(function (a) {
      var slug = a.getAttribute('data-office-link');
      if (window.FUO_OFFICE_URL) a.href = window.FUO_OFFICE_URL(slug);
      a.addEventListener('click', function () {
        recordTool(slug);
      });
    });

    // v0.9：AI 管理大师 → /fuotool/ 桌面版下载页（网页端只做下载引导）
    document.querySelectorAll('[data-fuotool-link]').forEach(function (a) {
      if (PATHS.FUOTOOL) a.href = PATHS.FUOTOOL;
    });

    // v0.9：点头像直达个人展示页 /drive/u/?u=<username>
    var avatarEl = $('user-avatar');
    if (avatarEl) {
      avatarEl.title = '查看我的展示页';
      avatarEl.setAttribute('role', 'button');
      avatarEl.setAttribute('tabindex', '0');
      avatarEl.setAttribute('aria-label', '查看我的展示页');
      function jumpProfile() {
        var name = displayName();
        if (!name) return;
        window.location.href = (PATHS.U || 'u/') + '?u=' + encodeURIComponent(name);
      }
      avatarEl.addEventListener('click', jumpProfile);
      avatarEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpProfile(); }
      });
    }

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

  /* G2：侧栏「收藏」徽标 —— 数据链路：本地缓存 fuo-fav-count 即时显示 → 服务端复核
   * （app.js 与 sidebar.js 共用同一缓存键，双方查询成功后都回写）；
   * 查询失败静默保留本地值；0 / 未登录 / 预览态徽标隐藏不占位。 */
  function favCacheCount() {
    try {
      var n = parseInt(localStorage.getItem('fuo-fav-count') || '', 10);
      return isNaN(n) ? 0 : n;
    } catch (e) { return 0; }
  }
  function favCacheSave(n) {
    try { localStorage.setItem('fuo-fav-count', String(n)); } catch (e) { /* ignore */ }
  }

  function loadFavBadge() {
    var badge = $('nav-fav-count');
    if (!badge) return;
    var cached = favCacheCount();
    if (cached > 0) { badge.textContent = String(cached); badge.hidden = false; }
    if (!sb || !user) return; // 未登录 / 客户端未就绪：只用本地值
    sb.from('favorites').select('id').eq('user_id', user.id)
      .then(function (_a) {
        if (_a.error) return; // 查询失败：静默降级为本地缓存值
        var n = (_a.data && _a.data.length) || 0;
        favCacheSave(n);
        if (n > 0) { badge.textContent = String(n); badge.hidden = false; }
        else { badge.hidden = true; } // 真实 0：隐藏不占位
      });
  }

  /* ---------- 登录后初始化 ---------- */
  function enterApp(session) {
    user = session.user;
    renderGreeting(user);
    renderUser(user);
    loadProfile();
    renderRecent();
    renderToolCount();
    renderQuickGrid(); // G3：8 高频磁贴 + 全部工具入口（须在 bindCommon 之前渲染，[data-tool-link] 才能绑上）
    loadNote();
    loadFavBadge();

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
    renderOnboarding(); // G1：首访引导浮层（在 bindCommon 之后，浮层内磁贴/步骤卡的交互不依赖 bindCommon 顺序）

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
