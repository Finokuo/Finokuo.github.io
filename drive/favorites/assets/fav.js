/* =====================================================
 * Fuo Tools · 收藏页逻辑（favorites/index.html 专用）
 * 数据：favorites 表（kind='tool' ref=slug / kind='note' ref=uuid）
 * 操作：跳转直达（工具页 / 云笔记?note=）、取消收藏
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;
  var sb = null;
  var user = null;

  var $ = function (id) { return document.getElementById(id); };
  var toolGrid = $('fv-tool-grid');
  var noteList = $('fv-note-list');
  var toolCount = $('fv-tool-count');
  var noteCount = $('fv-note-count');
  var toast = $('toast');

  /* 工具元数据（与 tool-page.js 的 TOOLS 注册表一致；这里只读展示） */
  var META = {
    json:      { name: 'JSON 格式化',   tone: 'tone-teal',     desc: '格式化 · 压缩 · 校验，本地运行不上传',
      svg: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
    color:     { name: '颜色工具',      tone: 'tone-fuchsia',  desc: 'HEX / RGB / HSL 互转，点击任意值复制',
      svg: '<path d="M12 3.5S6 10.2 6 14.2a6 6 0 0 0 12 0C18 10.2 12 3.5 12 3.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>' },
    password:  { name: '密码生成器',    tone: 'tone-emerald',  desc: '加密安全随机，生成后立即复制',
      svg: '<circle cx="8" cy="12" r="3.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M11.5 12H21M18 12v3.2M15 12v2.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' },
    textstats: { name: '文本统计',      tone: 'tone-amber',    desc: '字数 · 行数 · 频率，一贴即出',
      svg: '<path d="M4.5 6h15M4.5 12h10M4.5 18h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' },
    timestamp: { name: '时间戳转换',    tone: 'tone-cyan',     desc: 'Unix 时间戳 ⇄ 日期，双向即时换算',
      svg: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
    base64:    { name: 'Base64 编解码', tone: 'tone-violet',   desc: '编码 / 解码，支持 Unicode 中文',
      svg: '<path d="M5 9h14M5 15h14M9.5 4l-2 16M16.5 4l-2 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' },
    uuid:      { name: 'UUID 生成器',   tone: 'tone-orange',   desc: 'v4 随机 UUID，批量生成一键复制',
      svg: '<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="8" cy="12" r="2" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M13 10h4.5M13 14h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' },
    diff:      { name: '文本 Diff',     tone: 'tone-rose',     desc: '两段文本逐行对比，增删一目了然',
      svg: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 4.5v15M7 12h2.5M15 12h2.5M16.2 9.8v4.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' },
    regex:     { name: '正则测试器',    tone: 'tone-rose',    desc: '实时匹配高亮 · 捕获组 · 替换预览',
      svg: '<path d="M8.5 4.5 4.5 19.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M15 7.5v9M11.3 9.7l7.4 4.6M18.7 9.7l-7.4 4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/><circle cx="20.2" cy="19" r="1.3" fill="currentColor"/>' },
    qrcode:    { name: '二维码生成',    tone: 'tone-cyan',    desc: '本地生成可下载 PNG · 支持中文与长文本',
      svg: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M14 14h2.6M19.2 14h1.3M14 17.6v2.4M17.6 17.6h2.9M14 21h1.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' },
    hash:      { name: '哈希计算',      tone: 'tone-emerald', desc: 'SHA-1 / 256 / 384 / 512 · 文本与文件',
      svg: '<path d="M9.5 4 8 20M16.5 4 15 20M4.5 9h15M3.8 15h15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>' },
    url:       { name: 'URL 编解码',    tone: 'tone-amber',   desc: '编码 / 解码 / 链接解析（参数表）',
      svg: '<path d="M10.2 13.8a4.2 4.2 0 0 0 6 0l3-3a4.24 4.24 0 0 0-6-6l-1.2 1.2M13.8 10.2a4.2 4.2 0 0 0-6 0l-3 3a4.24 4.24 0 0 0 6 6l1.2-1.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
    imgcom:    { name: '图片压缩',      tone: 'tone-orange',  desc: '质量 / 尺寸 / 格式可控 · 纯本地不上传',
      svg: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" stroke-width="1.8" fill="none"/><circle cx="9" cy="9.5" r="1.7" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M4.5 17.5 9 13l3 2.5 3.5-4 4 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
  };

  var NOTE_SVG = '<path d="M6 4h9l4 4v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V5.5A1.5 1.5 0 0 1 6.5 4H6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M14.5 4v4.5H19M8.5 13h7M8.5 16.5h4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>';

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, 2400);
  }

  function client() {
    if (sb) return sb;
    if (window.supabase && CFG && CFG.SUPABASE_URL) {
      sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    }
    return sb;
  }

  function svgWrap(inner, size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" aria-hidden="true">' + inner + '</svg>';
  }

  /* ---------- 守卫 ---------- */
  function guard() {
    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) return;
    var c = client();
    if (!c) return;
    c.auth.getSession().then(function (_a) {
      var session = _a.data && _a.data.session;
      if (!session) {
        window.location.replace((PATHS.MAIN || '../../') + '?next=favorites');
        return;
      }
      user = session.user;
      c.from('profiles').select('status').eq('id', user.id).maybeSingle()
        .then(function (_b) {
          if (_b.data && _b.data.status === 'banned') {
            c.auth.signOut().then(function () {
              window.location.replace((PATHS.MAIN || '../../') + '?banned=1');
            });
            return;
          }
          load();
        });
    });
    c.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') window.location.replace(PATHS.MAIN || '../../');
    });
  }

  /* ---------- 数据 ---------- */
  function load() {
    var c = client();
    c.from('favorites')
      .select('id,kind,ref,title,created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(function (_a) {
        if (_a.error) { renderEmpty(); return; }
        var rows = _a.data || [];
        var tools = rows.filter(function (r) { return r.kind === 'tool'; });
        var notes = rows.filter(function (r) { return r.kind === 'note'; });
        renderTools(tools);
        renderNotes(notes, tools);
      });
  }

  function renderEmpty() {
    toolGrid.innerHTML = '';
    noteList.innerHTML = '';
    toolCount.textContent = '0';
    noteCount.textContent = '0';
    var box = document.createElement('div');
    box.className = 'fv-empty';
    box.innerHTML = '<p class="mono">// NOTHING YET</p>' +
      '<b>收藏夹还是空的</b>' +
      '<p>去「工具集」给常用工具点 ★，或在「云笔记」里收藏重要笔记，' +
      '它们都会集中在这里，方便一键直达。</p>';
    toolGrid.appendChild(box);
  }

  /* ---------- 工具收藏 ---------- */
  function renderTools(rows) {
    toolGrid.innerHTML = '';
    toolCount.textContent = String(rows.length);
    if (!rows.length) return;

    rows.forEach(function (r, i) {
      var m = META[r.ref] || { name: r.title || r.ref, tone: 'tone-teal', desc: '打开这个工具', svg: '' };
      var a = document.createElement('a');
      a.className = 'fv-tool';
      a.href = window.FUO_TOOL_URL ? window.FUO_TOOL_URL(r.ref) : '../tool-cluster/' + r.ref + '/index.html';
      a.setAttribute('aria-label', '打开' + m.name);
      a.style.setProperty('--i', String(i));

      var ic = document.createElement('i');
      ic.className = 'fv-ic ' + m.tone;
      ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = svgWrap(m.svg, 18);

      var txt = document.createElement('div');
      var b = document.createElement('b');
      b.textContent = m.name;
      var p = document.createElement('p');
      p.textContent = m.desc;
      txt.appendChild(b); txt.appendChild(p);

      var go = document.createElement('span');
      go.className = 'fv-go mono';
      go.textContent = '打开 →';

      var unstar = document.createElement('button');
      unstar.type = 'button';
      unstar.className = 'fv-unstar';
      unstar.setAttribute('aria-label', '取消收藏 ' + m.name);
      unstar.title = '取消收藏';
      unstar.innerHTML = svgWrap('<path d="M12 4.5 14.3 9.3 19.5 10 15.7 13.6 16.6 19 12 16.4 7.4 19 8.3 13.6 4.5 10 9.7 9.3 12 4.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>', 15);
      unstar.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        unstarFav(r.id, m.name, function () { a.remove(); bumpCounts(); });
      });

      a.appendChild(ic); a.appendChild(txt); a.appendChild(go); a.appendChild(unstar);
      toolGrid.appendChild(a);
    });
  }

  /* ---------- 笔记收藏 ---------- */
  function renderNotes(rows, tools) {
    noteList.innerHTML = '';
    noteCount.textContent = String(rows.length);
    if (!rows.length && !tools.length) { renderEmpty(); return; }
    if (!rows.length) return;

    var c = client();
    var ids = rows.map(function (r) { return r.ref; });
    // 实时取笔记标题与时间（改名后保持最新；查不到时退回收藏时的冗余标题）
    c.from('notes').select('id,title,updated_at').in('id', ids)
      .then(function (_a) {
        var live = {};
        if (!_a.error) (_a.data || []).forEach(function (n) { live[n.id] = n; });

        rows.forEach(function (r, i) {
          var n = live[r.ref];
          var title = (n && n.title) || r.title || '已删除的笔记';
          var gone = !n; // 笔记已被删除
          var when = n && n.updated_at ? new Date(n.updated_at).toLocaleString('zh-CN', {
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
          }) : '—';

          var a = document.createElement('a');
          a.className = 'fv-note';
          a.href = gone ? PATHS.NOTES : PATHS.NOTES + '?note=' + encodeURIComponent(r.ref);
          a.style.setProperty('--i', String(i));
          a.title = gone ? '原笔记已删除，点击打开云笔记' : '打开这篇笔记';

          var ic = document.createElement('i');
          ic.className = 'fv-ic tone-teal';
          ic.setAttribute('aria-hidden', 'true');
          ic.innerHTML = svgWrap(NOTE_SVG, 16);

          var meta = document.createElement('span');
          meta.className = 'fv-note-meta';
          var b = document.createElement('b');
          b.textContent = title + (gone ? '（原笔记已删除）' : '');
          var small = document.createElement('small');
          small.className = 'mono';
          small.textContent = '最近保存 ' + when;
          meta.appendChild(b); meta.appendChild(small);

          var go = document.createElement('span');
          go.className = 'fv-go mono';
          go.textContent = gone ? '去云笔记 →' : '打开 →';

          var unstar = document.createElement('button');
          unstar.type = 'button';
          unstar.className = 'fv-unstar';
          unstar.style.position = 'static';
          unstar.setAttribute('aria-label', '取消收藏 ' + title);
          unstar.title = '取消收藏';
          unstar.innerHTML = svgWrap('<path d="M12 4.5 14.3 9.3 19.5 10 15.7 13.6 16.6 19 12 16.4 7.4 19 8.3 13.6 4.5 10 9.7 9.3 12 4.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>', 15);
          unstar.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            unstarFav(r.id, title, function () {
              a.remove();
              bumpCounts();
              if (!noteList.children.length && !toolGrid.querySelector('.fv-tool')) renderEmpty();
            });
          });

          a.appendChild(ic); a.appendChild(meta); a.appendChild(go); a.appendChild(unstar);
          noteList.appendChild(a);
        });
      });
  }

  function bumpCounts() {
    toolCount.textContent = String(toolGrid.querySelectorAll('.fv-tool').length);
    noteCount.textContent = String(noteList.querySelectorAll('.fv-note').length);
  }

  function unstarFav(favId, name, done) {
    client().from('favorites').delete().eq('id', favId).eq('user_id', user.id)
      .then(function (_a) {
        if (_a.error) { showToast('取消收藏失败'); return; }
        showToast('已取消收藏「' + name + '」');
        done && done();
      });
  }

  guard();
})();
