/* =====================================================
 * Fuo Tools · 共享侧栏 + 可点击面包屑 + 折叠 + 公告（/drive 全部子页面复用）
 *
 * 用法（页面里只需一个空壳，由本脚本填充）：
 *   <aside class="sidebar" id="sidebar" data-active="tools" data-guard="1" hidden></aside>
 *   <nav class="crumbs mono" id="tc-crumb" aria-label="页面路径"></nav>
 *   <script src="…/config.js"></script>
 *   <script src="…/sidebar.js"></script>
 *
 * data-active：home | tools | favorites | settings |（空 = 无高亮，如公开主页）
 * data-guard="1"：承担子页面登录守卫（未登录 → 送回主页；被封禁 → 登出踢回）。
 *                 工作台原生侧栏（drive/index.html）不设该属性：守卫由 app.js 负责。
 * G2：侧栏「收藏」计数徽标（fuo-fav-count 本地缓存即时显示 + 服务端复核，0/未登录隐藏）。
 * 折叠：侧栏底部「«」按钮 → 纯图标迷你列（72px），状态存 localStorage，全站同步。
 * 抽屉：≤560px 顶栏汉堡按钮 → 侧栏变离屏抽屉 + 遮罩，Esc/遮罩关闭、焦点管理、锁滚动。
 * G5：面包屑中文化 —— body[data-page/data-tool] → 中文层级映射（去英文路径段）。
 * 公告：登录后拉取最新一条 announcements（v5 表），未读则顶栏下方横幅展示，
 *       可关闭并记忆已读（localStorage fuo-read-ann）；表未建时静默跳过。
 * 附带：本脚本同时负责加载 palette.js（Ctrl+K 命令面板，同目录）与
 *       注册 sw.js（PWA 离线壳，仅 https 下生效）——全站只改这一处。
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS || {};
  var PREVIEW = !!(window.FUO_PREVIEW || window.location.search.indexOf('preview=1') !== -1); // v0.9.5：读全局记忆，整站漫游
  var sb = null;
  var MINI_KEY = 'fuo-sidebar-mini';

  /* 本脚本自身 URL（推算同目录 palette.js / 上一级 sw.js 用） */
  var SELF_BASE = '';
  try {
    if (document.currentScript && document.currentScript.src) {
      SELF_BASE = String(document.currentScript.src).replace(/[^/]*$/, '');
    }
  } catch (e) { /* ignore */ }

  /* ---------- 全站附带：命令面板 + 反馈挂件 + Service Worker ---------- */
  function loadSidecars() {
    if (!SELF_BASE) return;
    // Ctrl+K 命令面板（palette.js 自带去重，重复注入无害）
    if (!window.__FUO_PALETTE__) {
      window.__FUO_PALETTE__ = true;
      var s = document.createElement('script');
      s.src = SELF_BASE + 'palette.js?v=6';
      document.head.appendChild(s);
    }
    // v0.9.5：全站反馈挂件（feedback.js 自带去重，右下角悬浮按钮）
    if (!window.__FUO_FEEDBACK__ && !document.querySelector('script[data-fb-js]')) {
      var f = document.createElement('script');
      f.src = SELF_BASE + 'feedback.js?v=3';
      f.setAttribute('data-fb-js', '1');
      document.head.appendChild(f);
    }
    // PWA Service Worker（仅 https / localhost；scope = /drive/）
    try {
      if ('serviceWorker' in navigator &&
          (location.protocol === 'https:' || location.hostname === 'localhost')) {
        var root = SELF_BASE.replace(/assets\/js\/$/, '');
        navigator.serviceWorker.register(root + 'sw.js?v=5').catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- 面包屑 ---------- */
  /* G5：中文层级映射 —— 分区键 + 工具 slug / 办公子页；
   * 映射缺失时保留原值（不强行汉化未知项）；分隔符仍用现有 .crumbs 的「/」mono 样式。 */
  var PAGE_ZH = {
    drive: '工作台', 'tool-cluster': '工具集', office: '办公集', favorites: '收藏',
    settings: '设置', recycle: '回收站', admin: '管理台', wgzx: '温故知新',
    u: '个人展示', n: '笔记分享',
    notes: '云笔记', // notes：工具集内的云笔记工作区（页title即「云笔记」）
  };
  var TOOL_ZH = {
    json: 'JSON 格式化', color: '颜色工具', password: '密码生成器',
    textstats: '文本统计', timestamp: '时间戳转换', base64: 'Base64 编解码',
    uuid: 'UUID 生成器', diff: '文本 Diff', regex: '正则测试器',
    qrcode: '二维码生成器', hash: '哈希计算', url: 'URL 编解码',
    imgcom: '图片压缩', jwt: 'JWT 解码器', radix: '进制转换',
    lorem: 'Lorem 占位文本', terminal: 'Terminal',
    // 办公集子页
    todo: '待办清单', habit: '习惯打卡', pomodoro: '番茄钟',
  };

  function crumbLink(label, href) {
    var a = document.createElement('a');
    a.className = 'crumb-link mono';
    a.href = href;
    a.textContent = label;
    return a;
  }
  function crumbSep() {
    var s = document.createElement('span');
    s.className = 'crumb-sep';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = '/';
    return s;
  }
  function crumbCur(label) {
    var s = document.createElement('span');
    s.className = 'crumb-cur mono';
    s.setAttribute('aria-current', 'page');
    s.textContent = label;
    return s;
  }

  /* G5：面包屑层级补全 —— 英文路径段换中文；
   * 工具页「工具集 / JSON 格式化」（去 drive 前缀，同方案示例），
   * 分区页保留「工作台 / …」层级；未知页面维持现状（隐藏 crumbs）。 */
  function renderCrumb() {
    var el = document.getElementById('tc-crumb');
    if (!el) return;
    var body = document.body;
    var page = body.getAttribute('data-page') || '';
    var slug = body.getAttribute('data-tool') || '';
    var zone = body.getAttribute('data-zone') || ''; // office 工具页专用
    var drive = PATHS.DRIVE || '../';
    var cluster = PATHS.TOOL_CLUSTER || '../tool-cluster/';
    var office = PATHS.OFFICE || '../office/';

    var zhTool = TOOL_ZH[slug] || slug; // 未知 slug 保留原文，不强行汉化

    var chain = [];
    if (slug && zone === 'office') {
      // 办公集工具页：办公集 / 待办清单
      chain = [crumbLink(PAGE_ZH.office, office), crumbSep(),
               crumbCur(zhTool)];
    } else if (slug) {
      // 工具独立页（body[data-tool]，无 data-page）：工具集 / JSON 格式化
      chain = [crumbLink(PAGE_ZH['tool-cluster'], cluster), crumbSep(),
               crumbCur(zhTool)];
    } else if (page === 'cluster') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(), crumbCur(PAGE_ZH['tool-cluster'])];
    } else if (page === 'office') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(), crumbCur(PAGE_ZH.office)];
    } else if (page === 'notes') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(),
               crumbLink(PAGE_ZH['tool-cluster'], cluster), crumbSep(),
               crumbCur(PAGE_ZH.notes)];
    } else if (page === 'recycle') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(),
               crumbLink(PAGE_ZH['tool-cluster'], cluster), crumbSep(),
               crumbLink(PAGE_ZH.notes, PATHS.NOTES || cluster + 'notes/'), crumbSep(),
               crumbCur(PAGE_ZH.recycle)];
    } else if (page === 'favorites') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(), crumbCur(PAGE_ZH.favorites)];
    } else if (page === 'settings') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(), crumbCur(PAGE_ZH.settings)];
    } else if (page === 'profile') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(), crumbCur(PAGE_ZH.u)];
    } else if (page === 'share') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(), crumbCur(PAGE_ZH.n)];
    } else if (page === 'admin') {
      chain = [crumbLink(PAGE_ZH.drive, drive), crumbSep(), crumbCur(PAGE_ZH.admin)];
    } else {
      el.hidden = true;
      return;
    }
    el.innerHTML = '';
    chain.forEach(function (n) { el.appendChild(n); });
  }

  /* ---------- 侧栏 ---------- */
  /* G2：收藏计数本地缓存（fuo-fav-count）—— sidebar.js 与 app.js（drive 首页）共用同一键：
   * 服务端查询成功后由双方回写；读取失败 / 无记录返回 0（徽标隐藏不占位）。 */
  function favCacheCount() {
    try {
      var n = parseInt(localStorage.getItem('fuo-fav-count') || '', 10);
      return isNaN(n) ? 0 : n;
    } catch (e) { return 0; }
  }
  function favCacheSave(n) {
    try { localStorage.setItem('fuo-fav-count', String(n)); } catch (e) { /* ignore */ }
  }

  var IC = {
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4.5 4.5 0 0 0-6.09 5.9L3 17.8V21h3.2l5.6-5.61a4.5 4.5 0 0 0 5.9-6.09l-2.8 2.8-2.11-.7-.7-2.11 2.61-2.99Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>',
    brief: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7" width="17" height="12.5" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5C10.6 5.1 8.6 4.5 6.1 4.5c-.9 0-1.6.7-1.6 1.6v11.3c0 .9.7 1.6 1.6 1.6 2.5 0 4.5.6 5.9 2 1.4-1.4 3.4-2 5.9-2 .9 0 1.6-.7 1.6-1.6V6.1c0-.9-.7-1.6-1.6-1.6-2.5 0-4.5.6-5.9 2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M12 6.7v14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5 14.3 9.3 19.5 10 15.7 13.6 16.6 19 12 16.4 7.4 19 8.3 13.6 4.5 10 9.7 9.3 12 4.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M10 12h10M17 9l3 3-3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  };

  function navItem(key, active, href, icon, label, badge) {
    return '<a class="side-item' + (key === active ? ' is-active' : '') + '"' +
      (key === active ? ' aria-current="page"' : '') +
      ' href="' + href + '" title="' + label + '">' + icon + ' ' + label + (badge || '') + '</a>';
  }

  function buildSidebar(active) {
    var aside = document.getElementById('sidebar');
    if (!aside) return;
    var drive = PATHS.DRIVE || '../';
    var cluster = PATHS.TOOL_CLUSTER || '../tool-cluster/';
    var office = PATHS.OFFICE || '../office/';
    var favorites = PATHS.FAVORITES || '../favorites/';
    var settings = PATHS.SETTINGS || '../settings/';
    var wgzx = PATHS.WGZX || '../../wgzx/';

    aside.innerHTML =
      '<a class="brand" href="' + drive + '" title="返回工作台" aria-label="返回工作台">' +
        '<span class="brand-mark" aria-hidden="true">' +
          '<svg viewBox="0 0 32 32" width="17" height="17" fill="none"><path d="M11 23V9h10M11 16h8.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>' +
        '</span>' +
        '<span class="brand-name">Fuo Tools</span>' +
      '</a>' +
      '<nav class="side-nav" aria-label="工作台导航">' +
        navItem('home', active, drive, IC.grid, '工作台', '') +
        navItem('tools', active, cluster, IC.wrench, '工具集', '<i class="mono">17 款</i>') +
        navItem('office', active, office, IC.brief, '办公集', '<i class="mono">4 款</i>') +
        navItem('wgzx', active, wgzx, IC.book, '温故知新', '') +
        navItem('favorites', active, favorites, IC.star, '收藏', '<i class="mono" id="sb-fav-count" data-fav-count hidden></i>') +
        navItem('settings', active, settings, IC.gear, '设置', '') +
      '</nav>' +
      '<div class="side-user">' +
        '<span class="avatar" id="sb-avatar" title="查看我的展示页">F</span>' +
        '<span class="side-user-meta">' +
          '<b id="sb-name">…</b>' +
          '<small id="sb-state" class="mono">—</small>' +
        '</span>' +
        '<button class="side-logout" id="sb-logout" type="button" title="退出登录" aria-label="退出登录">' + IC.out + '</button>' +
      '</div>';
    aside.hidden = false;
    /* G2：收藏徽标先用本地缓存即时填充（登录态下上次已知数量）；
     * 预览态 / 无缓存 / 0 保持 hidden 不占位，服务端复核在 loadFavCount。 */
    if (!PREVIEW) {
      var cached = favCacheCount();
      if (cached > 0) {
        var favBadge = document.getElementById('sb-fav-count');
        if (favBadge) { favBadge.textContent = String(cached); favBadge.hidden = false; }
      }
    }
    initAvatarLink(aside);
  }

  /* ---------- 头像可点击：直达个人展示页 /drive/u/?u=<username> ---------- */
  var currentUsername = '';
  function initAvatarLink(aside) {
    var el = aside ? aside.querySelector('#sb-avatar') : document.getElementById('sb-avatar');
    if (!el || el.getAttribute('data-jump') === '1') return;
    el.setAttribute('data-jump', '1');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', '查看我的展示页');
    el.style.cursor = 'pointer';
    function jump() {
      if (!currentUsername) return; // 用户名尚未就绪时不跳转
      window.location.href = (PATHS.U || '../../u/') + '?u=' + encodeURIComponent(currentUsername);
    }
    el.addEventListener('click', jump);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
    });
  }

  /* ---------- 折叠（迷你列）：状态全站同步（localStorage） ---------- */
  function initCollapse(aside) {
    if (aside.querySelector('.side-collapse')) return;
    var shell = aside.closest('.shell') || document.body;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'side-collapse';
    btn.setAttribute('aria-label', '收起或展开侧栏');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">' +
      '<path d="m14 6-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function apply(mini) {
      shell.classList.toggle('is-mini', !!mini);
      btn.classList.toggle('is-mini', !!mini);
      btn.title = mini ? '展开侧栏' : '收起侧栏';
      btn.setAttribute('aria-expanded', String(!mini));
    }
    var saved = false;
    try { saved = localStorage.getItem(MINI_KEY) === '1'; } catch (e) { /* ignore */ }
    apply(saved);

    btn.addEventListener('click', function () {
      var next = !shell.classList.contains('is-mini');
      try { localStorage.setItem(MINI_KEY, next ? '1' : '0'); } catch (e) { /* ignore */ }
      apply(next);
    });
    aside.appendChild(btn);
  }

  /* ---------- 移动端抽屉导航（E2/E3：≤560px 汉堡 + 离屏侧栏 + 遮罩） ----------
   * 工作台原生侧栏与子页面空壳注入两种情况都走这里：只对 aside#sidebar 加状态类、
   * 向 .topbar 注入汉堡与遮罩，抽屉显隐交由 CSS（≤560px 媒体查询）控制。 */
  function initDrawer(aside) {
    if (!aside || aside.getAttribute('data-drawer-bound') === '1') return;
    aside.setAttribute('data-drawer-bound', '1');

    var topbar = document.querySelector('.topbar');
    if (!topbar) return; // 无顶栏的页面（如公开工具页）不注入抽屉入口

    /* 汉堡按钮：≥44×44 触控目标，三横线与全站 stroke 图标同风格 */
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drawer-btn';
    btn.setAttribute('aria-label', '打开导航菜单');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'sidebar');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">' +
      '<path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

    /* 全屏遮罩：点击关闭 */
    var mask = document.createElement('div');
    mask.className = 'drawer-mask';
    mask.setAttribute('aria-hidden', 'true');

    topbar.insertBefore(btn, topbar.firstChild); // 主题切换等既有 topbar 元素不动
    document.body.appendChild(mask);

    var mq = window.matchMedia('(max-width: 560px)');

    function isOpen() { return document.body.classList.contains('is-drawer-open'); }
    function focusables() {
      return aside.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    }

    function openDrawer() {
      if (isOpen()) return;
      document.body.classList.add('is-drawer-open'); // CSS：抽屉滑入 + 遮罩显现 + 锁页面滚动
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', '关闭导航菜单');
      document.addEventListener('keydown', onKeydown); // Esc 仅在打开时监听
      // 焦点移入抽屉（rAF 等一帧，确保可见性已切换、可聚焦）
      window.requestAnimationFrame(function () {
        var f = focusables();
        if (f.length) f[0].focus({ preventScroll: true });
      });
    }

    function closeDrawer(refocus) {
      if (!isOpen()) return;
      document.body.classList.remove('is-drawer-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', '打开导航菜单');
      document.removeEventListener('keydown', onKeydown);
      // 焦点还给汉堡按钮（导航链接点击关闭时不必归还，页面即将跳转）
      if (refocus !== false && !btn.contains(document.activeElement)) {
        btn.focus({ preventScroll: true });
      }
    }

    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDrawer(true);
        return;
      }
      if (e.key === 'Tab') {
        // 轻量焦点圈定：Tab 循环留在抽屉内，不落到遮罩背后的页面内容
        var f = focusables();
        if (!f.length) return;
        var first = f[0];
        var last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !aside.contains(document.activeElement))) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !aside.contains(document.activeElement))) {
          e.preventDefault(); first.focus();
        }
      }
    }

    btn.addEventListener('click', function () {
      if (isOpen()) closeDrawer(true); else openDrawer();
    });
    mask.addEventListener('click', function () { closeDrawer(true); });

    // 点抽屉内导航项先收抽屉再跳转（对 href="#" 的项也能正确复位）
    aside.addEventListener('click', function (e) {
      if (!isOpen() || !e.target || !e.target.closest) return;
      if (e.target.closest('.side-item')) closeDrawer(false);
    });

    // 跨过 560px 断点时强制复位，避免滚动锁 / 遮罩 / Esc 监听残留
    function onMq(m) { if (!m.matches) closeDrawer(false); }
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else if (mq.addListener) mq.addListener(onMq); // 旧 Safari
  }

  /* ---------- 预览模式（v0.9.5：全站记忆，可自由漫游） ---------- */
  /* 退出预览：清记忆 + 重载，恢复正常登录守卫。挂在状态小字上，可点/可键盘触发 */
  function bindPreviewExit(el) {
    if (!el || el.getAttribute('data-exit-bound') === '1') return;
    el.setAttribute('data-exit-bound', '1');
    el.textContent = '退出预览';
    el.title = '退出预览：清除预览记忆并恢复正常登录守卫';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.style.cursor = 'pointer';
    el.style.textDecoration = 'underline dashed';
    el.style.textUnderlineOffset = '2px';
    function exit() {
      try { localStorage.removeItem('fuo-preview'); } catch (e) { /* ignore */ }
      var q = window.location.search;
      if (q.indexOf('preview=1') !== -1) {
        // 入口 URL 自带 preview=1：去掉参数再重载，避免重新写入
        window.location.replace(
          window.location.pathname +
          q.replace(/([?&])preview=(0|1)(&|$)/, function (_m, a, _b, c) {
            return (a === '?' && c === '') ? '' : a;
          }) + window.location.hash);
        return;
      }
      window.location.reload();
    }
    el.addEventListener('click', exit);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); exit(); }
    });
  }
  /* 暴露给 app.js（drive 首页原生用户卡也用同一退出逻辑） */
  window.FUO_PREVIEW_EXIT_BIND = bindPreviewExit;

  /* ---------- 会话：守卫 + 用户信息 ---------- */
  /* v0.9.1：登录后回到来源页的 next 值（交给主页 app.js 解析） */
  function nextKey() {
    var slug = document.body.getAttribute('data-tool') || '';
    if (slug) return 'tool:' + slug;
    var page = document.body.getAttribute('data-page') || '';
    if (page === 'office') return 'office';
    return 'tools';
  }

  function loadSession() {
    if (PREVIEW) {
      var nameEl0 = document.getElementById('sb-name');
      var stateEl0 = document.getElementById('sb-state');
      if (nameEl0) nameEl0.textContent = '预览模式';
      bindPreviewExit(stateEl0); // 状态小字 → 「退出预览」可点
      return;
    }
    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) return; // 无法校验：放行，由页面逻辑兜底
    try {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    } catch (e) { return; }

    sb.auth.getSession().then(function (_a) {
      var session = _a.data && _a.data.session;
      if (!session) {
        // v0.9.1：免登录试用工具（JSON / Base64）不送回主页，以游客身份放行
        var slug = document.body.getAttribute('data-tool') || '';
        if (slug && window.FUO_TRIAL_TOOLS && window.FUO_TRIAL_TOOLS[slug]) {
          var gName = document.getElementById('sb-name');
          var gState = document.getElementById('sb-state');
          if (gName) gName.textContent = '游客';
          if (gState) gState.textContent = '试用模式';
          return;
        }
        window.location.replace((PATHS.MAIN || '../../') + '?next=' + encodeURIComponent(nextKey()));
        return;
      }
      fillUser(session.user);
      banCheck(session.user);
      loadFavCount(session.user);
      loadAnnouncement();
      sb.auth.onAuthStateChange(function (event) {
        if (event === 'SIGNED_OUT') {
          window.location.replace(PATHS.MAIN || '../../');
        }
      });
    });

    var btn = document.getElementById('sb-logout');
    if (btn) {
      btn.addEventListener('click', function () {
        if (!sb) { window.location.replace(PATHS.MAIN || '../../'); return; }
        btn.disabled = true;
        sb.auth.signOut().then(function () {
          window.location.replace(PATHS.MAIN || '../../');
        });
      });
    }
  }

  function fillUser(u) {
    var nameEl = document.getElementById('sb-name');
    var stateEl = document.getElementById('sb-state');
    var avatar = document.getElementById('sb-avatar');
    if (stateEl) stateEl.textContent = '在线';
    // 修复：不再先显示邮箱再覆盖 —— 保持「…」占位，等 profiles 用户名就绪后一次性填入，
    // 拿不到用户名时（旧表/网络失败）才回退到邮箱前缀，避免邮箱→用户名的闪烁
    sb.from('profiles').select('username,status').eq('id', u.id).maybeSingle()
      .then(function (_b) {
        var p = _b.data;
        var name = (p && p.username) ||
          (u.user_metadata && u.user_metadata.username) ||
          (u.email || '').split('@')[0] || '用户';
        currentUsername = String(name);
        if (nameEl) nameEl.textContent = name;
        if (avatar) avatar.textContent = (name[0] || 'F').toUpperCase();
      })
      .catch(function () {
        var fb = (u.user_metadata && u.user_metadata.username) ||
          (u.email || '').split('@')[0] || '已登录';
        currentUsername = String(fb);
        if (nameEl) nameEl.textContent = fb;
        if (avatar) avatar.textContent = (fb[0] || 'F').toUpperCase();
      });
  }

  function banCheck(u) {
    sb.from('profiles').select('status').eq('id', u.id).maybeSingle()
      .then(function (_a) {
        if (_a.data && _a.data.status === 'banned') {
          sb.auth.signOut().then(function () {
            window.location.replace((PATHS.MAIN || '../../') + '?banned=1');
          });
        }
      });
  }

  /* 收藏计数徽标：服务端复核并回写缓存（G2：查询失败静默降级为本地缓存值） */
  function loadFavCount(u) {
    var badge = document.getElementById('sb-fav-count');
    if (!badge || !sb) return;
    sb.from('favorites').select('id').eq('user_id', u.id)
      .then(function (_a) {
        if (_a.error) return; // 查询失败：保留缓存 / 现状，不闪藏
        var rows = (_a.data && _a.data.length) || 0;
        favCacheSave(rows);
        if (rows > 0) {
          badge.textContent = String(rows);
          badge.hidden = false;
        } else {
          badge.hidden = true; // 真实 0：隐藏不占位
        }
      });
  }

  /* ---------- 公告横幅（announcements 表，v5；未建表/无公告静默） ---------- */
  function loadAnnouncement() {
    if (!sb) return;
    sb.from('announcements')
      .select('id,content,created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(function (_a) {
        if (_a.error || !_a.data || !_a.data.length) return; // 表未建 / 出错：静默
        var a = _a.data[0];
        var readId = null;
        try { readId = localStorage.getItem('fuo-read-ann'); } catch (e) { /* ignore */ }
        if (String(a.id) === String(readId)) return; // 已读
        showAnnBar(a);
      });
  }

  function showAnnBar(a) {
    var wrap = document.querySelector('.main-wrap');
    if (!wrap || document.getElementById('fuo-ann')) return;

    var bar = document.createElement('div');
    bar.className = 'ann-bar';
    bar.id = 'fuo-ann';

    var ic = document.createElement('span');
    ic.className = 'ann-ic';
    ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 10v4a1.5 1.5 0 0 0 1.5 1.5H7l3.6 3.2a1 1 0 0 0 1.7-.8V6.1a1 1 0 0 0-1.7-.8L7 8.5H5.5A1.5 1.5 0 0 0 4 10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M16.5 9.5a3.6 3.6 0 0 1 0 5M19 7a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

    var text = document.createElement('div');
    text.className = 'ann-text';
    var tag = document.createElement('b');
    tag.textContent = '公告';
    var body = document.createElement('span');
    body.textContent = a.content || '';
    text.appendChild(tag);
    text.appendChild(body);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'ann-close';
    close.setAttribute('aria-label', '关闭公告');
    close.title = '知道了';
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    close.addEventListener('click', function () {
      try { localStorage.setItem('fuo-read-ann', String(a.id)); } catch (e) { /* ignore */ }
      bar.remove();
    });

    bar.appendChild(ic);
    bar.appendChild(text);
    bar.appendChild(close);

    var topbar = wrap.querySelector('.topbar');
    wrap.insertBefore(bar, topbar ? topbar.nextSibling : wrap.firstChild);
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var aside = document.getElementById('sidebar');
    if (!aside) return;
    // 空壳才注入模板；工作台原生侧栏（已有子元素）只挂折叠按钮
    if (!aside.firstChild) buildSidebar(aside.getAttribute('data-active') || 'tools');
    initCollapse(aside);
    initDrawer(aside);
    renderCrumb();
    loadSidecars();
    if (aside.getAttribute('data-guard') === '1') {
      loadSession(); // 守卫 + 用户信息 + 公告
      return;
    }
    // 工作台原生侧栏：守卫由 app.js 负责；这里只补公告（轻量会话检查）
    if (!PREVIEW && window.supabase && CFG && CFG.SUPABASE_URL && !sb) {
      try {
        sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
        sb.auth.getSession().then(function (_a) {
          if (_a.data && _a.data.session) {
            fillUser(_a.data.session.user); // 公开页也显示用户名（如 /u/ 主页）
            loadAnnouncement();
            loadFavCount(_a.data.session.user); // G2：公开页注入侧栏的收藏徽标同样服务端复核
          } else {
            // G2：未登录不占位 —— 清掉可能的缓存预填，徽标回归隐藏
            var favBadge = document.getElementById('sb-fav-count');
            if (favBadge) favBadge.hidden = true;
          }
        });
      } catch (e) { /* ignore */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
