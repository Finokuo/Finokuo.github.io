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
      c.from('notes').select('id,folder_id,title,content,is_quick,updated_at')
        .order('updated_at', { ascending: false }),
    ]).then(function (res) {
      var fErr = res[0].error, nErr = res[1].error;
      if (isMissingTable(fErr) || isMissingTable(nErr)) {
        showToast('数据库尚未就绪：请先执行 supabase-notes.sql');
      }
      state.folders = (res[0].data && !fErr) ? res[0].data : [];
      state.notes = (res[1].data && !nErr) ? res[1].data : [];
      ensureQuick(function () {
        loadFavs(function () { done && done(); });
      });
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
        showToast('已删除「' + n.title + '」');
        renderFolders(); renderList(); renderEditor();
        var rows = filteredNotes().filter(function (x) { return !x.is_quick; });
        if (rows.length) select(rows[0].id);
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

  function createNote() {
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
      { id: 'n1', folder_id: 'f1', title: '欢迎来到云笔记', content: '这是云同步的多笔记空间：\n\n· 左侧可以搜索、新建笔记和文件夹\n· 点标题可以改名\n· 编辑自动保存（可在设置里关闭改为手动）\n· 星标收藏后可在「收藏」页看到', is_quick: false, updated_at: new Date(Date.now() - 3600000).toISOString() },
      { id: 'n2', folder_id: 'f2', title: '待办清单', content: '□ 试用文件夹整理\n□ 把常用笔记加入收藏\n□ 在设置页调一下开关', is_quick: false, updated_at: new Date(Date.now() - 86400000).toISOString() },
    ];
    state.favs = { n1: true };
    renderFolders(); renderList(); renderPath();
    select('q');
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var c = client();
    if (!c || !user) return;
    loadAll(function () {
      renderFolders(); renderList();
      // 深链：?note=<id>
      var m = window.location.search.match(/[?&]note=([\w-]+)/);
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
  if (PREVIEW) bootPreview();
  else guard();      // 正式模式：先过登录守卫 → boot()
})();
