/* =====================================================
 * Fuo Tools · Ctrl+K 命令面板（全站）
 *
 * 唤起：Ctrl+K / Cmd+K，或点顶栏搜索按钮（自动注入到 .topbar-actions）
 * 数据源：
 *   · 页面（工作台 / 工具集 / 云笔记 / 收藏 / 设置）
 *   · 13 款工具 + 云笔记
 *   · 操作（切换主题 / 折叠侧栏 / 新建笔记）
 *   · 笔记标题异步搜索（登录后可用，防抖 220ms）
 * 键盘：↑↓ 选择 · Enter 打开 · Esc 关闭
 * 预览模式（?preview=1）：工具/页面可跳（自动带 preview=1），
 *   笔记搜索与写操作以 toast 提示代替。
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS || {};
  /* v0.9 兜底：旧缓存 config.js（v3）没有 FUOTOOL 路径时本地补算，
   * 规则与 config.js 完全一致（线上无前缀 / 沙盒预览带 /fuo + /index.html） */
  if (!PATHS.FUOTOOL) {
    var _p = window.location.pathname;
    var _inFuo = _p.indexOf('/fuo/') !== -1;
    var _base = _inFuo ? _p.slice(0, _p.indexOf('/fuo/')) + '/fuo' : '';
    PATHS.FUOTOOL = _base + '/fuotool' + (_inFuo ? '/index.html' : '/');
  }
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;

  /* 工具元数据（与 tool-page.js 注册表保持一致；独立携带避免加载顺序依赖） */
  var TOOLS_META = [
    { slug: 'json',      name: 'JSON 格式化', kw: 'json format 校验 压缩' },
    { slug: 'color',     name: '颜色工具',    kw: 'color hex rgb hsl 取色' },
    { slug: 'password',  name: '密码生成器',  kw: 'password 随机 强度' },
    { slug: 'textstats', name: '文本统计',    kw: 'text 字数 词数 阅读' },
    { slug: 'timestamp', name: '时间戳转换',  kw: 'timestamp unix 日期' },
    { slug: 'base64',    name: 'Base64 编解码', kw: 'base64 编码 解码' },
    { slug: 'uuid',      name: 'UUID 生成器', kw: 'uuid v4 随机 id' },
    { slug: 'diff',      name: '文本 Diff',   kw: 'diff 对比 比较' },
    { slug: 'regex',     name: '正则测试器',  kw: 'regex regexp 正则 匹配 替换' },
    { slug: 'qrcode',    name: '二维码生成',  kw: 'qrcode 二维码 qr' },
    { slug: 'hash',      name: '哈希计算',    kw: 'hash sha256 sha1 摘要 文件' },
    { slug: 'url',       name: 'URL 编解码',  kw: 'url encode decode 链接 参数' },
    { slug: 'imgcom',    name: '图片压缩',    kw: 'image 图片 压缩 webp jpeg' },
    { slug: 'jwt',       name: 'JWT 解码器',  kw: 'jwt token 令牌 过期 exp' },
    { slug: 'radix',     name: '进制转换',    kw: 'radix 进制 二进制 十六进制 bigint' },
    { slug: 'lorem',     name: 'Lorem 占位文本', kw: 'lorem 占位 假文 placeholder' },
  ];

  /* v0.8：办公集工具（drive/office/） */
  var OFFICE_META = [
    { slug: 'ai',       name: 'AI 管理大师（桌面版）', kw: 'ai 人工智能 指挥 派发 扫描 助手 大师 command 桌面 desktop exe 下载' },
    { slug: 'todo',     name: '待办清单', kw: 'todo 待办 任务 清单 事项' },
    { slug: 'habit',    name: '习惯打卡', kw: 'habit 习惯 打卡 热力图 坚持' },
    { slug: 'pomodoro', name: '番茄钟',   kw: 'pomodoro 番茄 专注 计时 25' },
  ];

  var PAGES = [
    { label: '工作台', hint: 'drive',   url: PATHS.DRIVE,        kw: 'home 仪表盘 欢迎回来', previewable: true },
    { label: '工具集', hint: 'tools',   url: PATHS.TOOL_CLUSTER, kw: 'tools 全部工具 目录', previewable: true },
    { label: '办公集', hint: 'office',  url: PATHS.OFFICE,       kw: 'office 办公 待办 习惯 番茄 ai 指挥', previewable: true },
    { label: '桌面版下载', hint: 'fuotool', url: PATHS.FUOTOOL,  kw: 'fuotool desktop 桌面 exe 下载 安装 ai 管理大师', previewable: false },
    { label: '云笔记', hint: 'notes',   url: PATHS.NOTES,        kw: 'notes 笔记 markdown 编辑', previewable: true },
    { label: '回收站', hint: 'recycle', url: PATHS.RECYCLE,      kw: 'recycle 回收站 恢复 删除 bin', previewable: true },
    { label: '收藏',   hint: 'favorites', url: PATHS.FAVORITES,  kw: 'favorites star 收藏夹', previewable: false },
    { label: '设置',   hint: 'settings',  url: PATHS.SETTINGS,   kw: 'settings 设置 密码 开关 主题色', previewable: false },
  ];

  var SEARCH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /* ---------- 工具函数 ---------- */
  function withPreview(url) {
    if (!PREVIEW || !url) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'preview=1';
  }
  function toolUrl(slug) {
    var base = window.FUO_TOOL_URL
      ? window.FUO_TOOL_URL(slug)
      : (PATHS.TOOL_CLUSTER || '') + slug + '/';
    return withPreview(base);
  }
  function officeUrl(slug) {
    var base = window.FUO_OFFICE_URL
      ? window.FUO_OFFICE_URL(slug)
      : (PATHS.OFFICE || '') + slug + '/';
    return withPreview(base);
  }
  function notesUrl(extra) {
    var base = PATHS.NOTES || '';
    if (!extra) return withPreview(base);
    return base + (base.indexOf('?') === -1 ? '?' : '&') + extra;
  }

  /* ---------- DOM（首次打开时才构建） ---------- */
  var root = null, input = null, listEl = null, footEl = null;
  var items = [];        // 当前可选项 [{group,label,hint,icon,run}]
  var activeIdx = -1;

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'pal';
    root.id = 'fuo-palette';
    root.hidden = true;
    root.innerHTML =
      '<div class="pal-mask" data-pal-close></div>' +
      '<div class="pal-panel" role="dialog" aria-modal="true" aria-label="全局搜索">' +
        '<div class="pal-input-row">' +
          SEARCH_SVG +
          '<input id="pal-q" type="text" placeholder="搜索工具、笔记、页面…（Enter 打开）" autocomplete="off" spellcheck="false" aria-label="搜索" />' +
          '<kbd class="mono">ESC</kbd>' +
        '</div>' +
        '<div class="pal-list" id="pal-list" role="listbox" aria-label="结果"></div>' +
        '<div class="pal-foot mono">' +
          '<span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>' +
          '<span><kbd>↵</kbd> 打开</span>' +
          '<span class="pal-foot-brand">FUO PALETTE</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    input = root.querySelector('#pal-q');
    listEl = root.querySelector('#pal-list');

    input.addEventListener('input', function () { onQuery(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    root.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-pal-close]')) { close(); return; }
      var item = e.target.closest && e.target.closest('[data-pal-idx]');
      if (item) {
        activeIdx = parseInt(item.getAttribute('data-pal-idx'), 10);
        runActive();
      }
    });
    listEl.addEventListener('mousemove', function (e) {
      var item = e.target.closest && e.target.closest('[data-pal-idx]');
      if (item) {
        var idx = parseInt(item.getAttribute('data-pal-idx'), 10);
        if (idx !== activeIdx) { setActive(idx); }
      }
    });
  }

  /* ---------- 开 / 关 ---------- */
  function open() {
    build();
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    input.value = '';
    onQuery('');
    setTimeout(function () { input.focus(); }, 30);
  }
  function close() {
    if (!root) return;
    root.hidden = true;
    document.body.style.overflow = '';
    noteAbort(); // 取消在途笔记搜索
  }
  function isOpen() { return !!root && !root.hidden; }

  /* ---------- 渲染 ---------- */
  function iconSvg(kind) {
    var inner = '';
    if (kind === 'page') {
      inner = '<rect x="4" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="13" y="4" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="4" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="13" y="13" width="7" height="7" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/>';
    } else if (kind === 'tool') {
      inner = '<path d="M14.7 6.3a4.5 4.5 0 0 0-6.09 5.9L3 17.8V21h3.2l5.6-5.61a4.5 4.5 0 0 0 5.9-6.09l-2.8 2.8-2.11-.7-.7-2.11 2.61-2.99Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>';
    } else if (kind === 'note') {
      inner = '<path d="M6 4h9l4 4v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5.5A1.5 1.5 0 0 1 6.5 4H6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M14.5 4v4.5H19M8.5 13h7M8.5 16.5h4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>';
    } else if (kind === 'act') {
      inner = '<path d="M13.5 4.5 19 10l-5.5 5.5M19 10H8.5A5.5 5.5 0 0 0 3 15.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    } else if (kind === 'recent') {
      inner = '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>';
  }

  function pushItem(arr, group, label, hint, iconKind, run) {
    arr.push({ group: group, label: label, hint: hint, icon: iconSvg(iconKind), run: run });
  }

  function go(url) { window.location.href = url; }
  function toast(text) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2200);
  }

  function collectStatic(q) {
    var out = [];
    var ql = q.trim().toLowerCase();

    /* 空查询：最近使用 → 页面 → 操作 */
    if (!ql) {
      try {
        var recent = JSON.parse(localStorage.getItem('fuo-recent-tools') || '[]');
        if (Array.isArray(recent)) {
          recent.slice(0, 5).forEach(function (r) {
            var known = null;
            TOOLS_META.forEach(function (t) { if (t.slug === r.id) known = t; });
            if (known) {
              var heat = '';
              try {
                var hm = JSON.parse(localStorage.getItem('fuo-tool-heat') || '{}');
                if (hm && hm[known.slug]) heat = ' ×' + hm[known.slug];
              } catch (e) { /* ignore */ }
              pushItem(out, '最近使用', known.name, relativeTime(r.at) + heat, 'recent', function () { go(toolUrl(known.slug)); });
            }
          });
        }
      } catch (e) { /* ignore */ }
      PAGES.forEach(function (p) {
        pushItem(out, '页面', p.label, p.hint, 'page', function () {
          if (PREVIEW && !p.previewable) { toast('预览模式：登录后可用「' + p.label + '」'); return; }
          go(withPreview(p.url));
        });
      });
      pushItem(out, '操作', '新建笔记', 'notes', 'act', function () {
        if (PREVIEW) { toast('预览模式：登录后即可创建笔记'); return; }
        go(notesUrl('note=new'));
      });
      pushItem(out, '操作', '切换主题（亮 / 暗）', 'theme', 'act', function () {
        if (window.FUO_THEME && window.FUO_THEME.toggle) window.FUO_THEME.toggle(window.innerWidth / 2, 90);
      });
      pushItem(out, '操作', '折叠 / 展开侧栏', 'sidebar', 'act', function () {
        var b = document.querySelector('.side-collapse');
        if (b) b.click(); else toast('当前页面没有可折叠的侧栏');
      });
      return out;
    }

    /* 有关键词：页面 + 工具 + 操作 */
    function hit(label, kw) {
      if (label.toLowerCase().indexOf(ql) !== -1) return 2;
      if (kw && kw.toLowerCase().indexOf(ql) !== -1) return 1;
      return 0;
    }
    PAGES.forEach(function (p) {
      if (hit(p.label, p.kw)) {
        pushItem(out, '页面', p.label, p.hint, 'page', function () {
          if (PREVIEW && !p.previewable) { toast('预览模式：登录后可用「' + p.label + '」'); return; }
          go(withPreview(p.url));
        });
      }
    });
    TOOLS_META.forEach(function (t) {
      if (hit(t.name, t.kw + ' ' + t.slug)) {
        pushItem(out, '工具', t.name, t.slug, 'tool', function () { go(toolUrl(t.slug)); });
      }
    });
    OFFICE_META.forEach(function (t) {
      if (hit(t.name, t.kw + ' ' + t.slug)) {
        pushItem(out, '办公', t.name, t.slug, 'act', function () { go(officeUrl(t.slug)); });
      }
    });
    if (hit('新建笔记', 'new note 创建')) {
      pushItem(out, '操作', '新建笔记', 'notes', 'act', function () {
        if (PREVIEW) { toast('预览模式：登录后即可创建笔记'); return; }
        go(notesUrl('note=new'));
      });
    }
    if (hit('切换主题', 'theme dark light 主题')) {
      pushItem(out, '操作', '切换主题（亮 / 暗）', 'theme', 'act', function () {
        if (window.FUO_THEME && window.FUO_THEME.toggle) window.FUO_THEME.toggle(window.innerWidth / 2, 90);
      });
    }
    if (hit('折叠侧栏', 'sidebar mini 侧栏 展开')) {
      pushItem(out, '操作', '折叠 / 展开侧栏', 'sidebar', 'act', function () {
        var b = document.querySelector('.side-collapse');
        if (b) b.click(); else toast('当前页面没有可折叠的侧栏');
      });
    }
    return out.slice(0, 14);
  }

  function relativeTime(at) {
    var diff = Date.now() - (at || 0);
    if (diff < 3600000) return '刚刚';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    return Math.floor(diff / 86400000) + ' 天前';
  }

  function render(rows, noteRows) {
    items = [];
    listEl.innerHTML = '';
    var all = rows.concat(noteRows || []);

    if (!all.length) {
      var empty = document.createElement('div');
      empty.className = 'pal-empty mono';
      empty.textContent = '// 没有匹配的结果';
      listEl.appendChild(empty);
      return;
    }

    var lastGroup = null;
    all.forEach(function (it) {
      var idx = items.length;
      items.push(it);
      if (it.group !== lastGroup) {
        lastGroup = it.group;
        var g = document.createElement('div');
        g.className = 'pal-group mono';
        g.textContent = it.group;
        listEl.appendChild(g);
      }
      var row = document.createElement('div');
      row.className = 'pal-item';
      row.setAttribute('data-pal-idx', String(idx));
      row.setAttribute('role', 'option');
      row.innerHTML = '<i class="pal-ic" aria-hidden="true">' + it.icon + '</i>' +
        '<span class="pal-label">' + escapeHtml(it.label) + '</span>' +
        '<span class="pal-hint mono">' + escapeHtml(it.hint || '') + '</span>';
      listEl.appendChild(row);
    });
    setActive(all.length ? 0 : -1);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setActive(idx) {
    activeIdx = idx;
    var rows = listEl.querySelectorAll('.pal-item');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('is-active');
    var el = listEl.querySelector('.pal-item[data-pal-idx="' + idx + '"]');
    if (el) {
      el.classList.add('is-active');
      if (el.scrollIntoView) {
        try { el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 旧浏览器 */ }
      }
    }
  }
  function move(dir) {
    if (!items.length) return;
    var next = activeIdx + dir;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    setActive(next);
  }
  function runActive() {
    var it = items[activeIdx];
    if (!it) return;
    close();
    try { it.run(); } catch (e) { /* ignore */ }
  }

  /* ---------- 笔记异步搜索（登录后） ---------- */
  var sb = null;
  var sessionState = 'unknown'; // unknown | yes | no
  var binColOk = null;          // deleted_at 列是否可用（null=未探测）
  var noteTimer = null;
  var noteSeq = 0;

  function noteClient() {
    if (sb) return sb;
    if (window.supabase && CFG && CFG.SUPABASE_URL) {
      try { sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); } catch (e) { /* ignore */ }
    }
    return sb;
  }
  function noteAbort() {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
    noteSeq++;
  }

  function searchNotes(q, cb) {
    var c = noteClient();
    if (!c) return;
    if (sessionState === 'no') return cb([]);
    if (sessionState === 'unknown') {
      c.auth.getSession().then(function (_a) {
        var s = _a.data && _a.data.session;
        sessionState = s ? 'yes' : 'no';
        if (s) doSearch(c, s.user, q, cb);
        else cb([]);
      });
      return;
    }
    doSearch(c, null, q, cb);
  }

  function doSearch(c, user, q, cb) {
    var seq = ++noteSeq;
    var like = '%' + q.replace(/[%_"]/g, '') + '%';
    var ql = q.toLowerCase();
    // PostgREST or() 语法：值用双引号包裹，避免查询词里的逗号破坏解析
    var orCond = 'title.ilike."' + like + '",content.ilike."' + like + '"';

    function buildReq(cols) {
      return c.from('notes').select(cols).limit(6);
    }
    function baseReq(cols) {
      var req = buildReq(cols).or(orCond);
      if (binColOk !== false) req = req.is('deleted_at', null);
      return req;
    }

    baseReq('id,title,content')
      .then(function (_a) {
        if (seq !== noteSeq) return; // 已被更新的输入取代
        var err = _a.error;
        if (err && (err.code === 'PGRST204' || err.code === '42703' || /could not find the column|does not exist/i.test(err.message || '')) && binColOk !== false) {
          // 旧表没有 deleted_at 列：标记后不带该过滤重查
          binColOk = false;
          buildReq('id,title,content').or(orCond)
            .then(function (_b) {
              if (seq !== noteSeq) return;
              cb((_b.error || !_b.data) ? [] : _b.data);
            });
          return;
        }
        if (binColOk === null && !err) binColOk = true;
        if (err || !_a.data) return cb([]);

        // v0.8：全文搜索 —— 标题命中优先，内容命中带上下文片段
        var rows = _a.data;
        rows.forEach(function (n) {
          var t = (n.title || '').toLowerCase();
          var body = (n.content || '');
          var bl = body.toLowerCase();
          var idx = bl.indexOf(ql);
          if (idx === -1) {
            n._snippet = (t.indexOf(ql) !== -1 && body) ? body.replace(/\s+/g, ' ').slice(0, 42) : '';
          } else {
            var start = Math.max(0, idx - 14);
            var frag = body.slice(start, idx + ql.length + 28).replace(/\s+/g, ' ');
            n._snippet = (start > 0 ? '…' : '') + frag + '…';
          }
        });
        // 标题命中的排前面
        rows.sort(function (a, b) {
          var at = (a.title || '').toLowerCase().indexOf(ql) !== -1 ? 0 : 1;
          var bt = (b.title || '').toLowerCase().indexOf(ql) !== -1 ? 0 : 1;
          return at - bt;
        });
        cb(rows.slice(0, 6));
      });
  }

  /* ---------- 查询入口 ---------- */
  function onQuery(q) {
    var rows = collectStatic(q);
    var ql = q.trim().toLowerCase();

    if (!ql || PREVIEW || ql.length < 1 || sessionState === 'no') {
      render(rows, []);
      return;
    }
    // 先渲染静态结果，再异步补笔记
    render(rows, []);
    noteAbort();
    noteTimer = setTimeout(function () {
      searchNotes(ql, function (notes) {
        if (!notes || !notes.length || !isOpen()) return;
        var noteRows = [];
        notes.forEach(function (n) {
          pushItem(noteRows, '笔记', n.title || '未命名笔记', n._snippet || 'note', 'note', function () {
            go(notesUrl('note=' + encodeURIComponent(n.id)));
          });
        });
        // 与当前静态结果合并重新渲染
        var merged = collectStatic(input ? input.value : q);
        render(merged.slice(0, 8), noteRows);
      });
    }, 220);
  }

  /* ---------- 全局快捷键 + 顶栏按钮 ---------- */
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (isOpen()) close(); else open();
    } else if (e.key === 'Escape' && isOpen()) {
      close();
    }
  });

  function initTrigger() {
    var exist = document.getElementById('pal-open');
    if (exist) {
      exist.addEventListener('click', function () { open(); });
      return;
    }
    var box = document.querySelector('.topbar-actions');
    if (!box) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pal-trigger';
    btn.id = 'pal-open';
    btn.title = '全局搜索（Ctrl + K）';
    btn.setAttribute('aria-label', '打开全局搜索面板');
    btn.innerHTML = SEARCH_SVG;
    box.insertBefore(btn, box.firstChild);
    btn.addEventListener('click', function () { open(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTrigger);
  } else {
    initTrigger();
  }
})();
