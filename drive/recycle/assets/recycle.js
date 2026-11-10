/* =====================================================
 * Fuo Tools · 回收站页逻辑（recycle/index.html 专用）
 * 列出软删除笔记（deleted_at 非空）· 剩余天数进度条
 * 单条/批量恢复 · 彻底删除 · 清空 · 到期懒清理
 * 旧表（未执行 v5 SQL）→ 降级提示页
 * ===================================================== */
(function () {
  'use strict';

  var CFG = window.FUO_CONFIG;
  var PATHS = window.FUO_PATHS || {};
  var PREVIEW = window.location.search.indexOf('preview=1') !== -1;

  var sb = null;
  var user = null;
  var bin = [];       // [{id, title, deleted_at, folder_id}]
  var folders = [];   // [{id, name}]（恢复提示里显示原文件夹）

  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('rc-list');
  var toastEl = $('toast');

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.hidden = true; }, 2400);
  }

  function client() {
    if (sb) return sb;
    if (window.supabase && CFG && CFG.SUPABASE_URL) {
      try { sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY); } catch (e) { /* ignore */ }
    }
    return sb;
  }

  function isMissingCol(err) {
    return err && (err.code === 'PGRST204' || err.code === '42703' ||
      /could not find the column|does not exist/i.test(err.message || ''));
  }
  function isMissingTable(err) {
    if (!err) return false;
    var m = err.message || '';
    return err.code === '42P01' || err.code === 'PGRST205' ||
      /relation .* does not exist/i.test(m) || /schema cache/i.test(m);
  }

  /* ---------- 守卫 ---------- */
  function guard() {
    if (PREVIEW) { user = { id: 'preview' }; load(); return; }
    var c = client();
    if (!c) { renderMiss('无法连接', 'SDK 未就绪，请刷新重试。'); return; }
    c.auth.getSession().then(function (_a) {
      var session = _a.data && _a.data.session;
      if (!session) {
        window.location.replace((PATHS.MAIN || '../') + '?next=tools');
        return;
      }
      user = session.user;
      c.from('profiles').select('status').eq('id', user.id).maybeSingle()
        .then(function (_b) {
          if (_b.data && _b.data.status === 'banned') {
            c.auth.signOut().then(function () {
              window.location.replace((PATHS.MAIN || '../') + '?banned=1');
            });
            return;
          }
          load();
        });
    });
  }

  /* ---------- 数据 ---------- */
  function load() {
    if (PREVIEW) {
      bin = [
        { id: 'p1', title: '会议纪要草稿（演示）', deleted_at: new Date(Date.now() - 2 * 86400000).toISOString() },
        { id: 'p2', title: '旧版方案 v1（演示）', deleted_at: new Date(Date.now() - 26 * 86400000).toISOString() },
      ];
      folders = [];
      render();
      return;
    }
    var c = client();
    Promise.all([
      c.from('notes').select('id,title,deleted_at,folder_id').not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false }),
      c.from('folders').select('id,name').order('created_at', { ascending: true }),
    ]).then(function (res) {
      var nErr = res[0].error, fErr = res[1].error;
      if (nErr && isMissingCol(nErr)) {
        renderMiss('回收站尚未就绪',
          '数据库还没有 notes.deleted_at 列：请在 Supabase SQL Editor 执行 supabase-v5.sql（或最新 supabase-v6.sql）后刷新本页。',
          '// need supabase-v5.sql');
        return;
      }
      if (nErr && isMissingTable(nErr)) {
        renderMiss('数据库尚未初始化', '请先在 Supabase 执行 supabase-setup.sql。', '// missing notes table');
        return;
      }
      if (nErr) { renderMiss('加载失败', nErr.message || '未知错误', ''); return; }
      bin = res[0].data || [];
      folders = (!fErr && res[1].data) ? res[1].data : [];
      purgeExpired();
      render();
    });
  }

  /* 到期（>30 天）懒清理 */
  function purgeExpired() {
    if (PREVIEW || !bin.length) return;
    var cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    var expired = bin.filter(function (n) { return n.deleted_at < cutoff; });
    if (!expired.length) return;
    var ids = expired.map(function (n) { return n.id; });
    bin = bin.filter(function (n) { return ids.indexOf(n.id) === -1; });
    var c = client();
    c.from('notes').delete().in('id', ids).then(function () { /* 忽略 */ });
    c.from('favorites').delete().eq('user_id', user.id).eq('kind', 'note').in('ref', ids)
      .then(function () { /* 忽略 */ });
  }

  /* ---------- 渲染 ---------- */
  function daysLeft(iso) {
    var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return Math.max(0, 30 - days);
  }
  function fmtDeleted(iso) {
    try {
      return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) +
        ' ' + new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return '—'; }
  }
  function folderName(id) {
    for (var i = 0; i < folders.length; i++) if (folders[i].id === id) return folders[i].name;
    return '未分类';
  }

  function renderMiss(title, desc, hint) {
    listEl.innerHTML = '';
    var p = document.createElement('div');
    p.className = 'rc-empty';
    p.innerHTML = '<b style="font-size:16px;display:block;margin-bottom:8px"></b>' +
      '<span style="opacity:.7"></span>' +
      (hint ? '<p class="mono" style="margin-top:14px;font-size:11px;opacity:.5"></p>' : '');
    p.querySelector('b').textContent = title;
    p.querySelector('span').textContent = desc;
    if (hint) p.querySelector('p.mono').textContent = hint;
    listEl.appendChild(p);
    $('rc-restore-all').disabled = true;
    $('rc-clear').disabled = true;
  }

  function render() {
    listEl.innerHTML = '';
    $('rc-restore-all').disabled = !bin.length;
    $('rc-clear').disabled = !bin.length;

    if (!bin.length) {
      var e = document.createElement('p');
      e.className = 'rc-empty';
      e.textContent = '回收站是空的。删除的笔记会在这里保留 30 天。';
      listEl.appendChild(e);
      return;
    }

    bin.forEach(function (n) {
      var left = daysLeft(n.deleted_at);
      var row = document.createElement('div');
      row.className = 'rc-row';

      var info = document.createElement('div');
      info.className = 'rc-info';
      var t = document.createElement('p');
      t.className = 'rc-title';
      t.textContent = n.title || '未命名笔记';
      var sub = document.createElement('div');
      sub.className = 'rc-sub mono';
      var spans = [
        '删除于 ' + fmtDeleted(n.deleted_at),
        '原位置 ' + folderName(n.folder_id),
      ];
      spans.forEach(function (s) {
        var sp = document.createElement('span');
        sp.textContent = s;
        sub.appendChild(sp);
      });
      info.appendChild(t);
      info.appendChild(sub);

      var life = document.createElement('div');
      life.className = 'rc-life';
      var bar = document.createElement('div');
      bar.className = 'rc-life-bar';
      var fill = document.createElement('i');
      fill.style.width = Math.max(3, Math.round(left / 30 * 100)) + '%';
      fill.className = left <= 3 ? 'is-low' : left <= 10 ? 'is-mid' : '';
      bar.appendChild(fill);
      var txt = document.createElement('div');
      txt.className = 'rc-life-txt mono';
      txt.textContent = left > 0 ? '剩 ' + left + ' 天自动清理' : '即将清理';
      life.appendChild(bar);
      life.appendChild(txt);

      var ops = document.createElement('div');
      ops.className = 'rc-ops';
      var bRes = document.createElement('button');
      bRes.type = 'button';
      bRes.className = 'tbtn';
      bRes.textContent = '恢复';
      bRes.addEventListener('click', function () { restoreOne(n); });
      var bDel = document.createElement('button');
      bDel.type = 'button';
      bDel.className = 'tbtn rc-danger';
      bDel.textContent = '彻底删除';
      bDel.addEventListener('click', function () { askConfirm('del', n); });
      ops.appendChild(bRes);
      ops.appendChild(bDel);

      row.appendChild(info);
      row.appendChild(life);
      row.appendChild(ops);
      listEl.appendChild(row);
    });
  }

  /* ---------- 操作 ---------- */
  function restoreOne(n) {
    if (PREVIEW) { showToast('预览模式：登录后即可恢复'); return; }
    client().from('notes').update({ deleted_at: null }).eq('id', n.id)
      .then(function (_a) {
        if (_a.error) { showToast('恢复失败：' + (_a.error.message || '未知错误')); return; }
        bin = bin.filter(function (x) { return x.id !== n.id; });
        render();
        showToast('已恢复「' + (n.title || '未命名笔记') + '」');
      });
  }

  function restoreAll() {
    if (PREVIEW) { showToast('预览模式：登录后即可恢复'); return; }
    if (!bin.length) { showToast('回收站已经是空的'); return; }
    askConfirm('restore-all');
  }

  function doRestoreAll() {
    var ids = bin.map(function (n) { return n.id; });
    client().from('notes').update({ deleted_at: null }).in('id', ids)
      .then(function (_a) {
        if (_a.error) { showToast('恢复失败：' + (_a.error.message || '未知错误')); return; }
        bin = [];
        render();
        showToast('已恢复全部 ' + ids.length + ' 篇笔记');
      });
  }

  function hardDelete(n) {
    if (PREVIEW) { showToast('预览模式：登录后即可删除'); return; }
    client().from('notes').delete().eq('id', n.id)
      .then(function (_a) {
        if (_a.error) {
          var msg = _a.error.message || '';
          if (/FUO_QUICK_PINNED/.test(msg)) { showToast('快捷笔记无法删除'); return; }
          showToast('删除失败：' + (msg || '未知错误'));
          return;
        }
        bin = bin.filter(function (x) { return x.id !== n.id; });
        client().from('favorites').delete().eq('user_id', user.id).eq('kind', 'note').eq('ref', n.id)
          .then(function () { /* 忽略 */ });
        render();
        showToast('已彻底删除「' + (n.title || '未命名笔记') + '」');
      });
  }

  function clearAll() {
    if (PREVIEW) { showToast('预览模式：登录后即可清空'); return; }
    if (!bin.length) { showToast('回收站已经是空的'); return; }
    askConfirm('clear');
  }

  function doClearAll() {
    var ids = bin.map(function (n) { return n.id; });
    client().from('notes').delete().in('id', ids)
      .then(function (_a) {
        if (_a.error) { showToast('清空失败：' + (_a.error.message || '未知错误')); return; }
        bin = [];
        client().from('favorites').delete().eq('user_id', user.id).eq('kind', 'note').in('ref', ids)
          .then(function () { /* 忽略 */ });
        render();
        showToast('回收站已清空');
      });
  }

  /* ---------- 确认弹窗 ---------- */
  var confirmAct = null; // {kind, note}

  function askConfirm(kind, note) {
    confirmAct = { kind: kind, note: note };
    var text = '';
    if (kind === 'del') text = '确定彻底删除「' + (note.title || '未命名笔记') + '」吗？此操作不可恢复。';
    else if (kind === 'restore-all') text = '确定恢复回收站里的全部 ' + bin.length + ' 篇笔记吗？';
    else if (kind === 'clear') text = '确定清空回收站吗？其中 ' + bin.length + ' 篇笔记将被彻底删除，不可恢复。';
    $('rc-confirm-text').textContent = text;
    $('rc-confirm').hidden = false;
  }

  /* ---------- 绑定 ---------- */
  $('rc-refresh').addEventListener('click', function () {
    if (PREVIEW) { showToast('预览模式：演示数据'); return; }
    listEl.innerHTML = '<p class="rc-empty mono">读取中…</p>';
    load();
  });
  $('rc-restore-all').addEventListener('click', restoreAll);
  $('rc-clear').addEventListener('click', clearAll);

  $('rc-confirm-ok').addEventListener('click', function () {
    if (!confirmAct) { $('rc-confirm').hidden = true; return; }
    var act = confirmAct;
    confirmAct = null;
    $('rc-confirm').hidden = true;
    if (act.kind === 'del') hardDelete(act.note);
    else if (act.kind === 'restore-all') doRestoreAll();
    else if (act.kind === 'clear') doClearAll();
  });
  $('rc-confirm').addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-rc-cancel]')) {
      $('rc-confirm').hidden = true;
      confirmAct = null;
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('rc-confirm').hidden) {
      $('rc-confirm').hidden = true;
      confirmAct = null;
    }
  });

  var back = $('rc-back');
  if (back) back.href = PATHS.NOTES || '../tool-cluster/notes/';

  guard();
})();
