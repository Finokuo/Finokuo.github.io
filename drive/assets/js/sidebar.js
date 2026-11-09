/* =====================================================
 * Fuo Tools · 共享侧栏 + 可点击面包屑 + 折叠（/drive 全部子页面复用）
 *
 * 用法（页面里只需一个空壳，由本脚本填充）：
 *   <aside class="sidebar" id="sidebar" data-active="tools" data-guard="1" hidden></aside>
 *   <nav class="crumbs mono" id="tc-crumb" aria-label="页面路径"></nav>
 *   <script src="…/config.js"></script>
 *   <script src="…/sidebar.js"></script>
 *
 * data-active：home | tools | favorites | settings
 * data-guard="1"：承担子页面登录守卫（未登录 → 送回主页；被封禁 → 登出踢回）。
 *                 工作台原生侧栏（drive/index.html）不设该属性：守卫由 app.js 负责。
 * 折叠：侧栏底部「«」按钮 → 纯图标迷你列（68px），状态存 localStorage，全站同步。
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS || {};
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;
  var sb = null;
  var MINI_KEY = 'fuo-sidebar-mini';

  /* ---------- 面包屑 ---------- */
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

  function renderCrumb() {
    var el = document.getElementById('tc-crumb');
    if (!el) return;
    var body = document.body;
    var page = body.getAttribute('data-page') || '';
    var slug = body.getAttribute('data-tool') || '';
    var drive = PATHS.DRIVE || '../';
    var cluster = PATHS.TOOL_CLUSTER || '../tool-cluster/';

    var chain = [];
    if (slug) {
      // 工具独立页（body[data-tool]，无 data-page）
      chain = [crumbLink('drive', drive), crumbSep(),
               crumbLink('tool-cluster', cluster), crumbSep(),
               crumbCur(slug)];
    } else if (page === 'cluster') {
      chain = [crumbLink('drive', drive), crumbSep(), crumbCur('tool-cluster')];
    } else if (page === 'notes') {
      chain = [crumbLink('drive', drive), crumbSep(),
               crumbLink('tool-cluster', cluster), crumbSep(),
               crumbCur('notes')];
    } else if (page === 'favorites') {
      chain = [crumbLink('drive', drive), crumbSep(), crumbCur('favorites')];
    } else if (page === 'settings') {
      chain = [crumbLink('drive', drive), crumbSep(), crumbCur('settings')];
    } else {
      el.hidden = true;
      return;
    }
    el.innerHTML = '';
    chain.forEach(function (n) { el.appendChild(n); });
  }

  /* ---------- 侧栏 ---------- */
  var IC = {
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4.5 4.5 0 0 0-6.09 5.9L3 17.8V21h3.2l5.6-5.61a4.5 4.5 0 0 0 5.9-6.09l-2.8 2.8-2.11-.7-.7-2.11 2.61-2.99Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/></svg>',
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
    var favorites = PATHS.FAVORITES || '../favorites/';
    var settings = PATHS.SETTINGS || '../settings/';

    aside.innerHTML =
      '<a class="brand" href="' + drive + '" title="返回工作台" aria-label="返回工作台">' +
        '<span class="brand-mark" aria-hidden="true">' +
          '<svg viewBox="0 0 32 32" width="17" height="17" fill="none"><path d="M11 23V9h10M11 16h8.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>' +
        '</span>' +
        '<span class="brand-name">Fuo Tools</span>' +
      '</a>' +
      '<nav class="side-nav" aria-label="工作台导航">' +
        navItem('home', active, drive, IC.grid, '工作台', '') +
        navItem('tools', active, cluster, IC.wrench, '工具集', '<i class="mono">9 款</i>') +
        navItem('favorites', active, favorites, IC.star, '收藏', '<i class="mono" id="sb-fav-count" hidden></i>') +
        navItem('settings', active, settings, IC.gear, '设置', '') +
      '</nav>' +
      '<div class="side-user">' +
        '<span class="avatar" id="sb-avatar" aria-hidden="true">F</span>' +
        '<span class="side-user-meta">' +
          '<b id="sb-name">…</b>' +
          '<small id="sb-state" class="mono">—</small>' +
        '</span>' +
        '<button class="side-logout" id="sb-logout" type="button" title="退出登录" aria-label="退出登录">' + IC.out + '</button>' +
      '</div>';
    aside.hidden = false;
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

  /* ---------- 会话：守卫 + 用户信息 ---------- */
  function loadSession() {
    if (PREVIEW) {
      var nameEl0 = document.getElementById('sb-name');
      var stateEl0 = document.getElementById('sb-state');
      if (nameEl0) nameEl0.textContent = '预览模式';
      if (stateEl0) stateEl0.textContent = 'preview';
      return;
    }
    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) return; // 无法校验：放行，由页面逻辑兜底
    try {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    } catch (e) { return; }

    sb.auth.getSession().then(function (_a) {
      var session = _a.data && _a.data.session;
      if (!session) {
        window.location.replace((PATHS.MAIN || '../../') + '?next=tools');
        return;
      }
      fillUser(session.user);
      banCheck(session.user);
      loadFavCount(session.user);
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
    if (nameEl) {
      nameEl.textContent = (u.email || '').split('@')[0] || '已登录';
      nameEl.title = u.email || '';
    }
    if (avatar) avatar.textContent = ((u.email || 'F')[0] || 'F').toUpperCase();
    // 用户名异步覆盖（profiles）
    sb.from('profiles').select('username,status').eq('id', u.id).maybeSingle()
      .then(function (_b) {
        var p = _b.data;
        var name = (p && p.username) ||
          (u.user_metadata && u.user_metadata.username) ||
          (u.email || '').split('@')[0] || '用户';
        if (nameEl) nameEl.textContent = name;
        if (avatar) avatar.textContent = (name[0] || 'F').toUpperCase();
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

  /* 收藏计数徽标：侧栏「收藏」项右上角数字 */
  function loadFavCount(u) {
    var badge = document.getElementById('sb-fav-count');
    if (!badge || !sb) return;
    sb.from('favorites').select('id').eq('user_id', u.id)
      .then(function (_a) {
        var rows = (_a.data && _a.data.length) || 0;
        if (rows > 0) {
          badge.textContent = String(rows);
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }
      });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var aside = document.getElementById('sidebar');
    if (!aside) return;
    // 空壳才注入模板；工作台原生侧栏（已有子元素）只挂折叠按钮
    if (!aside.firstChild) buildSidebar(aside.getAttribute('data-active') || 'tools');
    initCollapse(aside);
    renderCrumb();
    if (aside.getAttribute('data-guard') !== '1') return; // drive 原生侧栏：守卫由 app.js 负责
    loadSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
