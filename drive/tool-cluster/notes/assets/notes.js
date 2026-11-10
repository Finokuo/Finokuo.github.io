/* =====================================================
 * Fuo Tools · 云笔记引擎（notes/index.html 专用）
 * 多笔记 + 文件夹 + 快捷笔记（固定不可删）+ 搜索 + 收藏
 * 后端：Supabase（notes / folders / favorites 表，RLS 仅本人）
 * 设置：noteAutosave / noteOpenQuick / showWordCount / confirmDelete
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS;
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;

  /* 设置开关兜底读取（与 settings.js 同键，无依赖、顺序无关） */
  function settingOn(key, dflt) {
    try {
      var raw = localStorage.getItem('fuo-settings');
      if (!raw) return dflt;
      var o = JSON.parse(raw);
      if (o && o[key] !== undefined) return !!o[key];
      return dflt;
    } catch (e) { return dflt; }
  }

  var sb = null;
  var user = null;

  var state = {
    folders: [],       // [{id, name}]
    notes: [],         // [{id, folder_id, title, content, is_quick, updated_at}]
    cur: null,         // 当前选中笔记
    folder: 'all',     // 边栏过滤：'all' | folderId
    q: '',             // 搜索词（按笔记名）
    favs: {},          // noteId → true
    dirty: false,
    saveTimer: null,
    bin: [],           // 回收站：[{id, title, deleted_at}]
    softDel: false,    // notes.deleted_at 列是否可用（v5；旧表降级硬删除）
  };

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var qInput = $('nb-q');
  var folderList = $('nb-folder-list');
  var listEl = $('nb-list');
  var noteCount = $('nb-note-count');
  var quickItem = $('nb-quick-item');
  var pathEl = $('nb-path');
  var titleEl = $('nb-title');
  var titleInput = $('nb-title-input');
  var bodyEl = $('nb-content');
  var emptyEl = $('nb-empty');
  var starBtn = $('nb-star');
  var moveSel = $('nb-move');
  var delBtn = $('nb-delete');
  var countInfo = $('nb-count-info');
  var saveState = $('nb-save-state');
  var updatedEl = $('nb-updated');
  var toast = $('toast');
  var binBtn = $('nb-bin-btn');
  var binCountEl = $('nb-bin-count');
  var binListEl = $('nb-bin-list');
  var previewEl = $('nb-preview');
  var editorEl = document.querySelector('.nb-editor');
  var viewBox = $('nb-view');

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

  function isMissingTable(error) {
    if (!error) return false;
    var m = error.message || '';
    return error.code === '42P01' || error.code === 'PGRST205' || /schema cache/i.test(m);
  }

  /* ---------- 登录守卫 ---------- */
  function guard() {
    if (PREVIEW) return;
    if (!window.supabase || !CFG || !CFG.SUPABASE_URL) return;
    var c = client();
    if (!c) return;
    c.auth.getSession().then(function (_a) {
      var session = _a.data && _a.data.session;
      if (!session) {
        window.location.replace((PATHS.MAIN || '../../../') + '?next=tools');
        return;
      }
      user = session.user;
      c.from('profiles').select('status').eq('id', user.id).maybeSingle()
        .then(function (_b) {
          if (_b.data && _b.data.status === 'banned') {
            c.auth.signOut().then(function () {
              window.location.replace((PATHS.MAIN || '../../../') + '?banned=1');
            });
            return;
          }
          boot();
        });
    });
  }

  /* ---------- 数据加载 ---------- */
  function loadAll(done) {
    var c = client();
    Promise.all([
      c.from('folders').select('id,name').order('created_at', { ascending: true }),
      loadNotesQuery(c),
    ]).then(function (res) {
      var fErr = res[0].error, nErr = res[1].error;
      if (isMissingTable(fErr) || isMissingTable(nErr)) {
        showToast('数据库尚未就绪：请先执行 supabase-notes.sql');
      }
      state.folders = (res[0].data && !fErr) ? res[0].data : [];
      state.notes = (res[1].data && !nErr) ? res[1].data : [];
      purgeBin();          // 过期（>30 天）回收站项自动清理
      renderBinBadge();
      ensureQuick(function () {
        loadFavs(function () { done && done(); });
      });
    });
  }

  /* notes 查询：v5 表带 deleted_at（本地拆分在册/回收站）；
     旧表报 PGRST204 → 降级不带该列（回收站不可用，删除回退硬删） */
  function loadNotesQuery(c) {
    return c.from('notes')
      .select('id,folder_id,title,content,is_quick,updated_at,deleted_at')
      .order('updated_at', { ascending: false })
      .then(function (r) {
        if (r.error && (r.error.code === 'PGRST204' || r.error.code === '42703' || /could not find the column|does not exist/i.test(r.error.message || ''))) {
          state.softDel = false;
          state.bin = [];
          return c.from('notes')
            .select('id,folder_id,title,content,is_quick,updated_at')
            .order('updated_at', { ascending: false });
        }
        if (!r.error) {
          state.softDel = true;
          var bin = [];
          (r.data || []).forEach(function (n) {
            if (n.deleted_at) bin.push({ id: n.id, title: n.title, deleted_at: n.deleted_at });
          });
          state.bin = bin;
          r.data = (r.data || []).filter(function (n) { return !n.deleted_at; });
        }
        return r;
      });
  }

  /* 快捷笔记兜底（新用户触发器已建；这里兜存量/异常） */
  function ensureQuick(done) {
    var quick = state.notes.filter(function (n) { return n.is_quick; })[0];
    if (quick) { done(); return; }
    var c = client();
    c.from('notes')
      .insert({ user_id: user.id, title: '快捷笔记', content: '', is_quick: true })
      .select('id,folder_id,title,content,is_quick,updated_at')
      .then(function (_a) {
        if (_a.data && _a.data[0]) state.notes.unshift(_a.data[0]);
        done();
      });
  }

  function loadFavs(done) {
    var c = client();
    c.from('favorites').select('ref').eq('user_id', user.id).eq('kind', 'note')
      .then(function (_a) {
        if (!_a.error) {
          state.favs = {};
          (_a.data || []).forEach(function (r) { state.favs[r.ref] = true; });
        }
        done();
      });
  }

  function refresh(done) {
    loadAll(done);
  }

  /* ---------- 渲染：边栏 ---------- */
  function filteredNotes() {
    return state.notes.filter(function (n) {
      if (state.folder === 'all') { /* 全部 */ }
      else if (n.folder_id !== state.folder) return false;
      if (state.q) {
        return (n.title || '').toLowerCase().indexOf(state.q.toLowerCase()) !== -1;
      }
      return true;
    });
  }

  function folderCount(id) {
    return state.notes.filter(function (n) { return n.folder_id === id; }).length;
  }

  function renderFolders() {
    folderList.innerHTML = '';

    // 「全部笔记」伪项
    var all = document.createElement('button');
    all.type = 'button';
    all.className = 'nb-item nb-folder all' + (state.folder === 'all' ? ' is-active' : '');
    all.innerHTML = '<span class="f-dot" aria-hidden="true"></span>' +
      '<span class="f-name">全部笔记</span>' +
      '<span class="f-count mono">' + state.notes.length + '</span>';
    all.addEventListener('click', function () { setFolder('all'); });
    folderList.appendChild(all);

    state.folders.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'nb-item nb-folder' + (state.folder === f.id ? ' is-active' : '');
      row.style.display = 'flex';

      var dot = document.createElement('span');
      dot.className = 'f-dot'; dot.setAttribute('aria-hidden', 'true');

      var name = document.createElement('span');
      name.className = 'f-name';
      name.textContent = f.name;
      name.title = f.name + '（双击重命名）';

      var count = document.createElement('span');
      count.className = 'f-count mono';
      count.textContent = String(folderCount(f.id));

      var ops = document.createElement('span');
      ops.className = 'f-ops';

      var ren = document.createElement('button');
      ren.type = 'button'; ren.className = 'f-op'; ren.textContent = '✎';
      ren.title = '重命名文件夹';
      ren.setAttribute('aria-label', '重命名文件夹 ' + f.name);
      ren.addEventListener('click', function (e) { e.stopPropagation(); renameFolder(f); });

      var del = document.createElement('button');
      del.type = 'button'; del.className = 'f-op is-del'; del.textContent = '🗑';
      del.title = '删除文件夹（其中笔记移到未分类）';
      del.setAttribute('aria-label', '删除文件夹 ' + f.name);
      del.addEventListener('click', function (e) { e.stopPropagation(); deleteFolder(f); });

      ops.appendChild(ren); ops.appendChild(del);
      row.appendChild(dot); row.appendChild(name); row.appendChild(count); row.appendChild(ops);
      row.addEventListener('click', function () { setFolder(f.id); });
      row.addEventListener('dblclick', function () { renameFolder(f); });
      folderList.appendChild(row);
    });
  }

  function relativeTime(iso) {
    try {
      var d = new Date(iso);
      var diff = Date.now() - d.getTime();
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
      if (diff < 86400000 * 7) return Math.floor(diff / 86400000) + ' 天前';
      return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    } catch (e) { return '—'; }
  }

  function renderList() {
    var rows = filteredNotes().filter(function (n) { return !n.is_quick; });
    listEl.innerHTML = '';
    noteCount.textContent = String(rows.length);

    if (!rows.length) {
      var empty = document.createElement('p');
      empty.className = 'nb-empty-list';
      empty.textContent = state.q
        ? '没有匹配「' + state.q + '」的笔记'
        : '这里还没有笔记。点上方「＋ 新建笔记」写一篇。';
      listEl.appendChild(empty);
      return;
    }

    rows.forEach(function (n) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'nb-item nb-note' + (state.cur && state.cur.id === n.id ? ' is-active' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(!!(state.cur && state.cur.id === n.id)));

      var row1 = document.createElement('span');
      row1.className = 'n-row';
      var title = document.createElement('span');
      title.className = 'n-title';
      title.textContent = n.title || '未命名笔记';
      title.title = n.title;
      row1.appendChild(title);
      if (state.favs[n.id]) {
        var st = document.createElement('span');
        st.className = 'n-star'; st.textContent = '★';
        st.title = '已收藏';
        row1.appendChild(st);
      }

      var row2 = document.createElement('span');
      row2.className = 'n-row';
      var time = document.createElement('span');
      time.className = 'n-time mono';
      time.textContent = relativeTime(n.updated_at);
      row2.appendChild(time);

      item.appendChild(row1); item.appendChild(row2);
      item.addEventListener('click', function () { select(n.id); });
      listEl.appendChild(item);
    });
  }

  function setFolder(id) {
    state.folder = id;
    renderFolders(); renderList(); renderPath();
  }

  /* =====================================================
   * Markdown 预览（零依赖，XSS 安全：先整体转义再白名单变换）
   * 支持：标题 / 粗斜体 / 删除线 / 行内码 / 代码块（带语言标签）/ 引用 /
   *       分隔线 / 有序·无序·嵌套列表 / 表格 / 链接与图片（仅 http(s)）/ 裸链接
   * ===================================================== */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function mdInline(s) {
    // s 已经过 escapeHtml
    s = s.replace(/`([^`]+)`/g, function (m, c) { return '<code class="md-code-inline">' + c + '</code>'; });
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![\w*])/g, '$1<i>$2</i>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    // 图片与链接（仅 http/https，阻断 javascript: 等协议）
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
      if (!/^https?:\/\//i.test(url)) return m;
      return '<img src="' + url + '" alt="' + alt + '" loading="lazy" />';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, txt, url) {
      if (!/^https?:\/\//i.test(url)) return m;
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + '</a>';
    });
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, function (m, pre, url) {
      return pre + '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>';
    });
    return s;
  }

  function md2html(src) {
    if (!src) return '';
    var codes = [];
    src = String(src).replace(/```([^\n]*)\n([\s\S]*?)```/g, function (m, lang, code) {
      codes.push({ lang: String(lang).trim(), code: code.replace(/\n$/, '') });
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    var lines = escapeHtml(src).split('\n');
    var html = [];
    var para = [];
    var i = 0;

    function flushPara() {
      if (para.length) { html.push('<p>' + para.join('<br>') + '</p>'); para = []; }
    }
    function splitRow(l) {
      var t = l.trim();
      if (t.charAt(0) === '|') t = t.slice(1);
      if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
      return t.split('|').map(function (c) { return c.trim(); });
    }

    while (i < lines.length) {
      var line = lines[i];
      var codeM = line.match(/^\u0000C(\d+)\u0000$/);
      if (codeM) {
        flushPara();
        var cb = codes[parseInt(codeM[1], 10)] || { lang: '', code: '' };
        html.push('<pre class="md-code"><b class="md-lang mono">' + (cb.lang ? escapeHtml(cb.lang) : 'code') + '</b><code>' + escapeHtml(cb.code) + '</code></pre>');
        i++;
        continue;
      }
      var hh = line.match(/^(#{1,6})\s+(.*)$/);
      if (hh) {
        flushPara();
        var lv = hh[1].length;
        html.push('<h' + lv + '>' + mdInline(hh[2]) + '</h' + lv + '>');
        i++;
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); html.push('<hr>'); i++; continue; }

      var q = line.match(/^&gt;\s?(.*)$/);
      if (q) {
        flushPara();
        var qbuf = [q[1]];
        i++;
        while (i < lines.length) {
          var q2 = lines[i].match(/^&gt;\s?(.*)$/);
          if (!q2) break;
          qbuf.push(q2[1]);
          i++;
        }
        html.push('<blockquote>' + qbuf.map(mdInline).join('<br>') + '</blockquote>');
        continue;
      }

      // 表格：当前行含 | 且下一行是 |---|---| 分隔行
      if (line.indexOf('|') !== -1 && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
        flushPara();
        var head = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          rows.push(splitRow(lines[i]));
          i++;
        }
        html.push('<div class="md-table-wrap"><table><thead><tr>' +
          head.map(function (c) { return '<th>' + mdInline(c) + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>');
        continue;
      }

      // 列表（支持一层嵌套：缩进 2 空格）
      var li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (li) {
        flushPara();
        var ordered2 = /\d/.test(li[2]);
        var items = [];
        while (i < lines.length) {
          var m2 = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (!m2) break;
          items.push({
            indent: Math.floor(m2[1].replace(/\t/g, '  ').length / 2),
            text: m2[3],
          });
          i++;
        }
        var depth = 0;
        var out = ordered2 ? '<ol>' : '<ul>';
        items.forEach(function (it) {
          while (it.indent > depth) { out += '<li><' + (ordered2 ? 'ol' : 'ul') + '>'; depth++; }
          while (it.indent < depth) { out += '</' + (ordered2 ? 'ol' : 'ul') + '></li>'; depth--; }
          out += '<li>' + mdInline(it.text) + '</li>';
        });
        while (depth > 0) { out += '</' + (ordered2 ? 'ol' : 'ul') + '></li>'; depth--; }
        out += '</' + (ordered2 ? 'ol' : 'ul') + '>';
        html.push(out);
        continue;
      }

      if (line.trim() === '') { flushPara(); i++; continue; }
      para.push(mdInline(line));
      i++;
    }
    flushPara();
    return html.join('\n');
  }

  /* ---------- 视图模式：编辑 / 分屏 / 预览 ---------- */
  var VIEW_KEY = 'fuo-note-view';
  var viewMode = 'edit';
  try {
    var _vm = localStorage.getItem(VIEW_KEY);
    if (_vm === 'edit' || _vm === 'split' || _vm === 'preview') viewMode = _vm;
  } catch (e) { /* ignore */ }

  var previewTimer = null;
  function renderPreview() {
    if (!previewEl) return;
    previewEl.innerHTML = md2html(state.cur ? state.cur.content : '');
  }
  function renderPreviewSoon() {
    if (!previewEl) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 120);
  }

  function setView(mode) {
    viewMode = mode;
    try { localStorage.setItem(VIEW_KEY, mode); } catch (e) { /* ignore */ }
    if (editorEl) editorEl.setAttribute('data-view', mode);
    if (viewBox) {
      var btns = viewBox.querySelectorAll('button');
      Array.prototype.forEach.call(btns, function (b) {
        var on = b.getAttribute('data-view') === mode;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
    }
    renderPreview();
  }

  /* ---------- 渲染：编辑器 ---------- */
  function renderEditor() {
    var n = state.cur;
    if (!n) {
      titleEl.hidden = true;
      bodyEl.hidden = true;
      emptyEl.hidden = false;
      updatedEl.textContent = '—';
      countInfo.textContent = '0 字';
      setSaveState('', '—');
      starBtn.style.display = 'none';
      moveSel.disabled = true;
      delBtn.style.display = 'none';
      renderMoveOptions();
      renderPreview();
      return;
    }
    titleEl.hidden = false;
    bodyEl.hidden = false;
    emptyEl.hidden = true;
    starBtn.style.display = '';
    moveSel.disabled = false;
    delBtn.style.display = n.is_quick ? 'none' : '';

    titleEl.textContent = n.title || '未命名笔记';
    bodyEl.value = n.content || '';
    countInfo.textContent = (n.content || '').length + ' 字';
    updatedEl.textContent = '保存于 ' + relativeTime(n.updated_at);
    setSaveState('is-synced', '已同步 ✓');
    starBtn.classList.toggle('is-on', !!state.favs[n.id]);
    starBtn.setAttribute('aria-pressed', String(!!state.favs[n.id]));
    renderMoveOptions();
    renderPath();
    renderPreview();
  }

  function renderMoveOptions() {
    var n = state.cur;
    moveSel.innerHTML = '';
    var none = document.createElement('option');
    none.value = ''; none.textContent = '未分类';
    moveSel.appendChild(none);
    state.folders.forEach(function (f) {
      var o = document.createElement('option');
      o.value = f.id; o.textContent = f.name;
      moveSel.appendChild(o);
    });
    moveSel.value = n ? (n.folder_id || '') : '';
  }

  function renderPath() {
    pathEl.innerHTML = '';
    var n = state.cur;

    var root = document.createElement('span');
    root.className = 'p-link';
    root.textContent = '全部笔记';
    root.title = '查看全部笔记';
    root.addEventListener('click', function () { setFolder('all'); });
    pathEl.appendChild(root);

    if (!n) { pathEl.appendChild(sep()); return; }

    var folder = null;
    for (var i = 0; i < state.folders.length; i++) {
      if (state.folders[i].id === n.folder_id) { folder = state.folders[i]; break; }
    }
    if (folder) {
      pathEl.appendChild(sep());
      var fLink = document.createElement('span');
      fLink.className = 'p-link';
      fLink.textContent = folder.name;
      fLink.title = '查看文件夹「' + folder.name + '」';
      fLink.addEventListener('click', function () { setFolder(folder.id); });
      pathEl.appendChild(fLink);
    }
    pathEl.appendChild(sep());
    var cur = document.createElement('span');
    cur.className = 'p-cur';
    cur.textContent = n.title || '未命名笔记';
    pathEl.appendChild(cur);

    function sep() {
      var s = document.createElement('span');
      s.className = 'p-sep'; s.textContent = '/'; s.setAttribute('aria-hidden', 'true');
      return s;
    }
  }

  function setSaveState(cls, text) {
    saveState.className = 'nb-foot-save' + (cls ? ' ' + cls : '');
    saveState.textContent = text;
  }

  /* ---------- 选择 ---------- */
  function select(id) {
    flushPendingSave();
    for (var i = 0; i < state.notes.length; i++) {
      if (state.notes[i].id === id) { state.cur = state.notes[i]; break; }
    }
    renderList(); renderEditor();
  }

  function flushPendingSave() {
    if (state.dirty && state.cur) saveNow();
  }

  /* ---------- 保存 ---------- */
  function onContentInput() {
    if (!state.cur) return;
    state.cur.content = bodyEl.value;
    countInfo.textContent = bodyEl.value.length + ' 字';
    renderPreviewSoon();
    state.dirty = true;
    if (settingOn('noteAutosave', true)) {
      setSaveState('is-saving', '保存中…');
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(saveNow, 900);
    } else {
      setSaveState('is-dirty', '未保存 · 点击或 Ctrl+S');
    }
  }

  function saveNow() {
    clearTimeout(state.saveTimer);
    var n = state.cur;
    if (!n) return;
    if (PREVIEW) { state.dirty = false; setSaveState('is-synced', '已同步（预览）'); return; }
    state.dirty = false;
    setSaveState('is-saving', '保存中…');
    client().from('notes')
      .update({ content: n.content })
      .eq('id', n.id)
      .then(function (_a) {
        if (_a.error) {
          setSaveState('is-error', '保存失败');
          showToast('保存失败：' + (_a.error.message || '未知错误'));
          return;
        }
        n.updated_at = new Date().toISOString();
        setSaveState('is-synced', '已同步 ✓');
        updatedEl.textContent = '保存于 ' + relativeTime(n.updated_at);
        renderList();
      });
  }

  /* ---------- 改名 ---------- */
  function startRename() {
    var n = state.cur;
    if (!n) return;
    titleEl.hidden = true;
    titleInput.hidden = false;
    titleInput.value = n.title || '';
    titleInput.focus();
    titleInput.select();
  }

  function commitRename(cancel) {
    var n = state.cur;
    titleInput.hidden = true;
    titleEl.hidden = false;
    if (!n || cancel) { return; }
    var next = titleInput.value.trim();
    if (!next) { titleInput.value = n.title; return; }
    if (next === n.title) return;
    var oldTitle = n.title;
    n.title = next;
    titleEl.textContent = next;
    renderPath();
    if (PREVIEW) {
      renderList();
      showToast('[预览] 演示改名：登录后实时保存到云端');
      return;
    }

    client().from('notes').update({ title: next }).eq('id', n.id)
      .then(function (_a) {
        if (_a.error) {
          n.title = oldTitle;
          titleEl.textContent = oldTitle;
          showToast('改名失败：' + (_a.error.message || '未知错误'));
          renderPath();
          return;
        }
        n.updated_at = new Date().toISOString();
        showToast('已重命名为「' + next + '」');
        renderList();
        syncFavTitle(n); // 收藏里的显示名同步更新
      });
  }

  function syncFavTitle(n) {
    if (!state.favs[n.id]) return;
    client().from('favorites')
      .update({ title: n.title })
      .eq('user_id', user.id).eq('kind', 'note').eq('ref', n.id)
      .then(function () { /* 同步失败不影响主流程 */ });
  }

  /* ---------- 收藏 ---------- */
  function toggleStar() {
    var n = state.cur;
    if (!n) return;
    var c = client();
    if (state.favs[n.id]) {
      c.from('favorites')
        .delete()
        .eq('user_id', user.id).eq('kind', 'note').eq('ref', n.id)
        .then(function (_a) {
          if (_a.error) { showToast('取消收藏失败'); return; }
          delete state.favs[n.id];
          starBtn.classList.remove('is-on');
          starBtn.setAttribute('aria-pressed', 'false');
          showToast('已取消收藏「' + n.title + '」');
          renderList();
        });
    } else {
      c.from('favorites')
        .insert({ user_id: user.id, kind: 'note', ref: n.id, title: n.title })
        .then(function (_a) {
          if (_a.error) {
            if (_a.error.code === '23505') { showToast('已在收藏中'); return; }
            showToast('收藏失败：' + (_a.error.message || '未知错误'));
            return;
          }
          state.favs[n.id] = true;
          starBtn.classList.add('is-on');
          starBtn.setAttribute('aria-pressed', 'true');
          showToast('已收藏「' + n.title + '」，可在侧栏「收藏」查看');
          renderList();
        });
    }
  }

  /* ---------- 移动 ---------- */
  function moveTo(folderId) {
    var n = state.cur;
    if (!n) return;
    client().from('notes')
      .update({ folder_id: folderId || null })
      .eq('id', n.id)
      .then(function (_a) {
        if (_a.error) { showToast('移动失败：' + (_a.error.message || '未知错误')); renderMoveOptions(); return; }
        n.folder_id = folderId || null;
        n.updated_at = new Date().toISOString();
        showToast(folderId ? '已移动到「' + folderName(folderId) + '」' : '已移到未分类');
        state.folder = folderId || 'all';
        renderFolders(); renderList(); renderPath();
      });
  }

  function folderName(id) {
    for (var i = 0; i < state.folders.length; i++) {
      if (state.folders[i].id === id) return state.folders[i].name;
    }
    return '未分类';
  }

  /* ---------- 删除笔记 ---------- */
  var confirmCtx = null; // {type:'note'|'folder', note, folder}

  function askDeleteNote() {
    var n = state.cur;
    if (!n || n.is_quick) return; // 快捷笔记：按钮已隐藏，双保险
    if (!settingOn('confirmDelete', true)) { doDeleteNote(n); return; }
    confirmCtx = { type: 'note', note: n };
    $('nb-confirm-text').textContent = '确定要删除「' + n.title + '」吗？此操作不可撤销。';
    $('nb-confirm').hidden = false;
  }

  function doDeleteNote(n) {
    if (!state.softDel) {
      // 旧表（未执行 v5 SQL）：保持硬删除，并提示可升级
      client().from('notes').delete().eq('id', n.id)
        .then(function (_a) {
          $('nb-confirm').hidden = true;
          if (_a.error) {
            var code = _a.error.code || '';
            var msg = _a.error.message || '';
            if (/FUO_QUICK_PINNED/.test(msg)) { showToast('快捷笔记无法删除'); return; }
            showToast('删除失败：' + (msg || '未知错误') + (code ? ' (' + code + ')' : ''));
            return;
          }
          state.notes = state.notes.filter(function (x) { return x.id !== n.id; });
          delete state.favs[n.id];
          client().from('favorites')
            .delete().eq('user_id', user.id).eq('kind', 'note').eq('ref', n.id)
            .then(function () { /* 收藏清理失败不阻塞 */ });
          state.cur = null;
          showToast('已删除「' + n.title + '」（执行 supabase-v5.sql 后可获得回收站）');
          renderFolders(); renderList(); renderEditor();
          var rows = filteredNotes().filter(function (x) { return !x.is_quick; });
          if (rows.length) select(rows[0].id);
        });
      return;
    }

    // v5：软删除 → 回收站（30 天可恢复）
    client().from('notes').update({ deleted_at: new Date().toISOString() }).eq('id', n.id)
      .then(function (_a) {
        $('nb-confirm').hidden = true;
        if (_a.error) {
          showToast('删除失败：' + (_a.error.message || '未知错误'));
          return;
        }
        state.notes = state.notes.filter(function (x) { return x.id !== n.id; });
        delete state.favs[n.id];
        client().from('favorites')
          .delete().eq('user_id', user.id).eq('kind', 'note').eq('ref', n.id)
          .then(function () { /* 收藏清理失败不阻塞 */ });
        state.bin.unshift({ id: n.id, title: n.title, deleted_at: new Date().toISOString() });
        state.cur = null;
        showToast('已移入回收站（30 天内可恢复）');
        renderFolders(); renderList(); renderEditor();
        renderBinBadge();
        var rows = filteredNotes().filter(function (x) { return !x.is_quick; });
        if (rows.length) select(rows[0].id);
      });
  }

  /* ---------- 回收站 ---------- */
  function purgeBin() {
    // 到期（>30 天）项懒清理：本地先移除，后台删除，失败不影响使用
    if (!state.softDel || !state.bin.length) return;
    var cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    var expired = state.bin.filter(function (n) { return n.deleted_at < cutoff; });
    if (!expired.length) return;
    var ids = expired.map(function (n) { return n.id; });
    state.bin = state.bin.filter(function (n) { return ids.indexOf(n.id) === -1; });
    client().from('notes').delete().in('id', ids)
      .then(function () { /* 忽略 */ });
    client().from('favorites').delete().eq('user_id', user.id).eq('kind', 'note').in('ref', ids)
      .then(function () { /* 忽略 */ });
  }

  function binDaysLeft(iso) {
    var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return Math.max(0, 30 - days);
  }

  function renderBinBadge() {
    if (!binBtn) return;
    if (!state.softDel) { binBtn.hidden = true; return; }
    binBtn.hidden = false;
    if (state.bin.length) {
      binCountEl.textContent = String(state.bin.length);
      binCountEl.hidden = false;
    } else {
      binCountEl.hidden = true;
    }
  }

  function openBin() {
    renderBinList();
    $('nb-bin').hidden = false;
  }
  function closeBin() {
    $('nb-bin').hidden = true;
  }

  function renderBinList() {
    binListEl.innerHTML = '';
    if (!state.bin.length) {
      var p = document.createElement('p');
      p.className = 'nb-empty-list';
      p.textContent = '回收站是空的。删除的笔记会在这里保留 30 天。';
      binListEl.appendChild(p);
      return;
    }
    state.bin.forEach(function (n) {
      var row = document.createElement('div');
      row.className = 'nb-bin-row';

      var info = document.createElement('div');
      info.className = 'nb-bin-info';
      var b = document.createElement('b');
      b.textContent = n.title || '未命名笔记';
      var small = document.createElement('small');
      small.className = 'mono';
      small.textContent = '剩 ' + binDaysLeft(n.deleted_at) + ' 天';
      info.appendChild(b);
      info.appendChild(small);

      var ops = document.createElement('div');
      ops.className = 'nb-bin-ops';
      var restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'tbtn';
      restore.textContent = '恢复';
      restore.addEventListener('click', function () { restoreNote(n.id); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'tbtn nb-confirm-danger';
      del.textContent = '彻底删除';
      del.addEventListener('click', function () { hardDeleteNote(n.id); });
      ops.appendChild(restore);
      ops.appendChild(del);

      row.appendChild(info);
      row.appendChild(ops);
      binListEl.appendChild(row);
    });
  }

  function restoreNote(id) {
    if (PREVIEW) { showToast('预览模式：登录后即可恢复'); return; }
    client().from('notes').update({ deleted_at: null }).eq('id', id)
      .then(function (_a) {
        if (_a.error) { showToast('恢复失败：' + (_a.error.message || '未知错误')); return; }
        closeBin();
        showToast('已恢复，回到笔记列表');
        refresh(function () {
          renderFolders(); renderList(); renderBinBadge();
          var rows = filteredNotes().filter(function (x) { return !x.is_quick; });
          if (rows.length) select(rows[0].id);
        });
      });
  }

  function hardDeleteNote(id) {
    if (PREVIEW) { showToast('预览模式：登录后即可删除'); return; }
    client().from('notes').delete().eq('id', id)
      .then(function (_a) {
        if (_a.error) {
          var msg = _a.error.message || '';
          if (/FUO_QUICK_PINNED/.test(msg)) { showToast('快捷笔记无法删除'); return; }
          showToast('删除失败：' + (msg || '未知错误'));
          return;
        }
        state.bin = state.bin.filter(function (x) { return x.id !== id; });
        client().from('favorites').delete().eq('user_id', user.id).eq('kind', 'note').eq('ref', id)
          .then(function () { /* 忽略 */ });
        renderBinList();
        renderBinBadge();
        showToast('已彻底删除');
      });
  }

  function clearBin() {
    if (PREVIEW) { showToast('预览模式：登录后即可清空'); return; }
    if (!state.bin.length) { showToast('回收站已经是空的'); return; }
    if (!settingOn('confirmDelete', true)) { doClearBin(); return; }
    confirmCtx = { type: 'bin' };
    $('nb-confirm-text').textContent =
      '确定清空回收站吗？其中 ' + state.bin.length + ' 篇笔记将被彻底删除，不可恢复。';
    $('nb-confirm').hidden = false;
  }

  function doClearBin() {
    var ids = state.bin.map(function (n) { return n.id; });
    client().from('notes').delete().in('id', ids)
      .then(function (_a) {
        $('nb-confirm').hidden = true;
        if (_a.error) { showToast('清空失败：' + (_a.error.message || '未知错误')); return; }
        state.bin = [];
        client().from('favorites').delete().eq('user_id', user.id).eq('kind', 'note').in('ref', ids)
          .then(function () { /* 忽略 */ });
        renderBinList();
        renderBinBadge();
        showToast('回收站已清空');
      });
  }

  /* ---------- 文件夹：新建 / 重命名 / 删除 ---------- */
  var modalCb = null;

  function openInputModal(title, label, value, cb) {
    $('nb-modal-title').textContent = title;
    $('nb-modal-label').textContent = label;
    var input = $('nb-modal-input');
    input.value = value || '';
    $('nb-modal-msg').hidden = true;
    modalCb = cb;
    $('nb-modal').hidden = false;
    setTimeout(function () { input.focus(); input.select(); }, 60);
  }

  function modalOk() {
    var input = $('nb-modal-input');
    var val = input.value.trim();
    if (!val) { showMsg('名称不能为空。'); return; }
    var cb = modalCb;
    modalCb = null;
    $('nb-modal').hidden = true;
    if (cb) cb(val);
  }

  function showMsg(text) {
    var m = $('nb-modal-msg');
    m.textContent = text;
    m.hidden = false;
  }

  var lastCreate = 0;
  function createNote() {
    var now = Date.now();
    if (now - lastCreate < 800) return; // 连点/双击防抖：不重复建笔记
    lastCreate = now;
    var c = client();
    var folderId = (state.folder !== 'all') ? state.folder : null;
    c.from('notes')
      .insert({ user_id: user.id, title: '未命名笔记', content: '', folder_id: folderId })
      .select('id,folder_id,title,content,is_quick,updated_at')
      .then(function (_a) {
        if (_a.error) { showToast('创建失败：' + (_a.error.message || '未知错误')); return; }
        var n = _a.data[0];
        state.notes.unshift(n);
        if (folderId) state.folder = folderId;
        renderFolders(); renderList();
        select(n.id);
        setTimeout(startRename, 80); // 新建后直接改名
        showToast('已创建笔记，给它起个名字吧');
      });
  }

  function createFolder() {
    openInputModal('新建文件夹', '文件夹名', '', function (name) {
      client().from('folders')
        .insert({ user_id: user.id, name: name })
        .then(function (_a) {
          if (_a.error) {
            if (_a.error.code === '23505') { showToast('同名文件夹已存在'); return; }
            showToast('创建失败：' + (_a.error.message || '未知错误'));
            return;
          }
          showToast('已创建文件夹「' + name + '」');
          refresh(function () { renderFolders(); renderList(); });
        });
    });
  }

  function renameFolder(f) {
    openInputModal('重命名文件夹', '新名称', f.name, function (name) {
      if (name === f.name) return;
      client().from('folders').update({ name: name }).eq('id', f.id)
        .then(function (_a) {
          if (_a.error) {
            if (_a.error.code === '23505') { showToast('同名文件夹已存在'); return; }
            showToast('重命名失败：' + (_a.error.message || '未知错误'));
            return;
          }
          showToast('文件夹已重命名为「' + name + '」');
          refresh(function () { renderFolders(); renderList(); renderPath(); renderEditor(); });
        });
    });
  }

  function deleteFolder(f) {
    var n = folderCount(f.id);
    var tip = n ? '文件夹「' + f.name + '」里有 ' + n + ' 篇笔记，删除后它们会移到未分类。确定删除文件夹吗？'
                : '确定要删除文件夹「' + f.name + '」吗？';
    if (!settingOn('confirmDelete', true)) { doDeleteFolder(f); return; }
    confirmCtx = { type: 'folder', folder: f };
    $('nb-confirm-text').textContent = tip;
    $('nb-confirm').hidden = false;
  }

  function doDeleteFolder(f) {
    client().from('folders').delete().eq('id', f.id)
      .then(function (_a) {
        $('nb-confirm').hidden = true;
        if (_a.error) { showToast('删除失败：' + (_a.error.message || '未知错误')); return; }
        showToast('已删除文件夹「' + f.name + '」');
        if (state.folder === f.id) state.folder = 'all';
        refresh(function () {
          // folder_id 由 FK on delete set null 置空，本地同步
          state.notes.forEach(function (n) { if (n.folder_id === f.id) n.folder_id = null; });
          renderFolders(); renderList(); renderPath(); renderEditor();
        });
      });
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    qInput.addEventListener('input', function () {
      state.q = qInput.value.trim();
      renderList();
    });
    quickItem.addEventListener('click', function () {
      var quick = state.notes.filter(function (n) { return n.is_quick; })[0];
      if (quick) select(quick.id);
    });
    $('nb-new-note').addEventListener('click', function () {
      if (PREVIEW) { showToast('预览模式：登录后即可创建笔记'); return; }
      createNote();
    });
    $('nb-new-folder').addEventListener('click', function () {
      if (PREVIEW) { showToast('预览模式：登录后即可创建文件夹'); return; }
      createFolder();
    });

    titleEl.addEventListener('click', startRename);
    titleInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(false); }
      if (e.key === 'Escape') { e.preventDefault(); commitRename(true); }
    });
    titleInput.addEventListener('blur', function () { if (!titleInput.hidden) commitRename(false); });

    bodyEl.addEventListener('input', onContentInput);
    bodyEl.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveNow();
      }
    });
    countInfo.addEventListener('click', saveNow); // 手动保存入口
    countInfo.style.cursor = 'pointer';
    countInfo.title = '点击立即保存（Ctrl+S）';

    // 视图模式：编辑 / 分屏 / 预览
    if (viewBox) {
      Array.prototype.forEach.call(viewBox.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
      });
    }

    // 回收站
    if (binBtn) binBtn.addEventListener('click', openBin);
    $('nb-bin').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-nb-binclose]')) closeBin();
    });
    $('nb-bin-clear').addEventListener('click', clearBin);

    starBtn.addEventListener('click', function () {
      if (PREVIEW) { showToast('预览模式：登录后即可收藏'); return; }
      toggleStar();
    });
    moveSel.addEventListener('change', function () {
      if (PREVIEW) { renderMoveOptions(); showToast('预览模式：登录后即可整理'); return; }
      moveTo(moveSel.value);
    });
    delBtn.addEventListener('click', function () {
      if (PREVIEW) { showToast('预览模式：登录后即可删除'); return; }
      askDeleteNote();
    });

    // 输入弹窗
    $('nb-modal-ok').addEventListener('click', modalOk);
    $('nb-modal-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); modalOk(); }
    });
    $('nb-modal').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-nb-close]')) {
        $('nb-modal').hidden = true;
        modalCb = null;
      }
    });

    // 确认弹窗
    $('nb-confirm-ok').addEventListener('click', function () {
      if (!confirmCtx) { $('nb-confirm').hidden = true; return; }
      if (confirmCtx.type === 'note') doDeleteNote(confirmCtx.note);
      else if (confirmCtx.type === 'folder') doDeleteFolder(confirmCtx.folder);
      else if (confirmCtx.type === 'bin') doClearBin();
      confirmCtx = null;
    });
    $('nb-confirm').addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-nb-cancel]')) {
        $('nb-confirm').hidden = true;
        confirmCtx = null;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!$('nb-modal').hidden) { $('nb-modal').hidden = true; modalCb = null; }
        else if (!$('nb-confirm').hidden) { $('nb-confirm').hidden = true; confirmCtx = null; }
        else if (!$('nb-bin').hidden) closeBin();
      }
    });
  }

  /* ---------- 预览模式（演示数据） ---------- */
  function bootPreview() {
    state.folders = [
      { id: 'f1', name: '工作文档' },
      { id: 'f2', name: '个人灵感' },
    ];
    state.notes = [
      { id: 'q', folder_id: null, title: '快捷笔记', content: '随手记点什么…\n这行内容可以修改，但这条笔记永远删不掉。', is_quick: true, updated_at: new Date().toISOString() },
      { id: 'n1', folder_id: 'f1', title: '欢迎来到云笔记', content: '# 欢迎来到云笔记\n\n这是云同步的多笔记空间，**支持 Markdown**：\n\n- 左侧可以搜索、新建笔记和文件夹\n- 点标题可以改名，点「预览」看渲染效果\n- 编辑自动保存（可在设置里改为手动）\n- 星标收藏后可在「收藏」页看到\n\n> 试试右上角的「分屏」模式，边写边看。\n\n```js\n// 代码块也支持\nconsole.log("hello fuo");\n```\n\n| 功能 | 状态 |\n| --- | --- |\n| 多笔记 | ✓ |\n| 文件夹 | ✓ |\n| 回收站 | ✓ |', is_quick: false, updated_at: new Date(Date.now() - 3600000).toISOString() },
      { id: 'n2', folder_id: 'f2', title: '待办清单', content: '## 待办\n\n1. 试用文件夹整理\n2. 把常用笔记加入收藏\n3. 在设置页调一下开关\n4. 试试 Ctrl+K 全局搜索', is_quick: false, updated_at: new Date(Date.now() - 86400000).toISOString() },
    ];
    state.favs = { n1: true };
    state.softDel = true;
    state.bin = [
      { id: 'b1', title: '旧草稿（演示）', deleted_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    ];
    renderFolders(); renderList(); renderPath();
    renderBinBadge();
    select('q');
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var c = client();
    if (!c || !user) return;
    loadAll(function () {
      renderFolders(); renderList();
      // 深链：?note=new → 直接新建；?note=<id> → 直达该笔记
      var m = window.location.search.match(/[?&]note=([\w-]+)/);
      if (m && m[1] === 'new') { createNote(); return; }
      if (m && state.notes.some(function (n) { return n.id === m[1]; })) {
        var target = null;
        state.notes.forEach(function (n) { if (n.id === m[1]) target = n; });
        if (target && target.folder_id) state.folder = target.folder_id;
        renderFolders(); renderList();
        select(target.id);
        return;
      }
      // 打开快捷笔记（可在设置里关闭）
      var quick = state.notes.filter(function (n) { return n.is_quick; })[0];
      if (quick && settingOn('noteOpenQuick', false)) { select(quick.id); return; }
      var rows = filteredNotes().filter(function (n) { return !n.is_quick; });
      if (rows.length) select(rows[0].id);
      else if (quick) select(quick.id);
      else renderEditor();
    });
    c.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') window.location.replace(PATHS.MAIN || '../../../');
    });
  }

  bind();            // 事件只绑一次（preview / 正式模式共用）
  setView(viewMode); // 初始化视图模式（编辑 / 分屏 / 预览）
  if (PREVIEW) bootPreview();
  else guard();      // 正式模式：先过登录守卫 → boot()
})();
