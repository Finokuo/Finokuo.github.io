/* =====================================================
 * Fuo Tools · 待办清单逻辑（office/todo/ 专用）
 * 数据：office_data(kind='todo') payload = { items:[...] }
 *   item = { id, text, done, pri(0-3), due('YYYY-MM-DD'|''), created, doneAt }
 * ===================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var input = $('td-input');
  var listEl = $('td-list');
  var toastEl = $('toast');

  var items = [];
  var filter = 'all';

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.hidden = true; }, 2000);
  }

  function persist() {
    if (window.FUO_OFFICE) window.FUO_OFFICE.save('todo', { items: items });
  }

  /* ---------- 同步状态徽标 ---------- */
  if (window.FUO_OFFICE) {
    window.FUO_OFFICE.onStatus(function (s) {
      var chip = $('td-sync');
      var txt = $('td-sync-txt');
      if (!chip || !txt) return;
      chip.className = 'of-sync is-' + s;
      txt.textContent = s === 'cloud' ? '云同步 ✓'
        : s === 'saving' ? '同步中…'
        : s === 'error' ? '云端暂不可达 · 本地已保存'
        : '仅本机 · 执行 supabase-v6.sql 开启云同步';
    });
  }

  /* ---------- 工具 ---------- */
  function uid() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }

  var PRI_ORDER = { 3: 0, 2: 1, 1: 2, 0: 3 };
  function sortItems(arr) {
    return arr.slice().sort(function (a, b) {
      var ad = a.done ? 1 : 0, bd = b.done ? 1 : 0;
      if (ad !== bd) return ad - bd;              // 未完成在前
      var ap = PRI_ORDER[a.pri || 0], bp = PRI_ORDER[b.pri || 0];
      if (ap !== bp) return ap - bp;              // 高优先级在前
      return (b.created || 0) - (a.created || 0); // 新的在前
    });
  }

  function visibleItems() {
    var today = todayStr();
    return sortItems(items.filter(function (it) {
      if (filter === 'open') return !it.done;
      if (filter === 'done') return it.done;
      if (filter === 'today') {
        // 今日 = 截止日是今天或已过期且未完成
        return !it.done && it.due && it.due <= today;
      }
      return true;
    }));
  }

  /* ---------- 渲染 ---------- */
  function renderCounts() {
    var today = todayStr();
    var cAll = items.length;
    var cOpen = 0, cDone = 0, cToday = 0;
    items.forEach(function (it) {
      if (it.done) cDone++;
      else {
        cOpen++;
        if (it.due && it.due <= today) cToday++;
      }
    });
    $('td-c-all').textContent = cAll;
    $('td-c-open').textContent = cOpen;
    $('td-c-done').textContent = cDone;
    $('td-c-today').textContent = cToday;
    $('td-clear-done').style.visibility = cDone ? 'visible' : 'hidden';
  }

  function render() {
    renderCounts();
    var rows = visibleItems();
    listEl.innerHTML = '';

    if (!rows.length) {
      var li = document.createElement('li');
      li.className = 'of-empty';
      li.textContent = filter === 'all' && !items.length
        ? '还没有待办。写下第一件事吧。'
        : '这个筛选下没有条目。';
      listEl.appendChild(li);
      return;
    }

    var today = todayStr();
    rows.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'td-item' + (it.done ? ' is-done' : '');

      // 勾选圈
      var check = document.createElement('button');
      check.type = 'button';
      check.className = 'td-check';
      check.setAttribute('aria-label', it.done ? '标记为未完成' : '标记为已完成');
      check.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      check.addEventListener('click', function () {
        it.done = !it.done;
        it.doneAt = it.done ? Date.now() : null;
        persist();
        render();
      });

      // 优先级
      var pri = document.createElement('button');
      pri.type = 'button';
      pri.className = 'td-pri' + (it.pri ? ' p' + it.pri : '');
      pri.title = '优先级：' + (it.pri === 3 ? '高' : it.pri === 2 ? '中' : it.pri === 1 ? '低' : '无') + '（点击切换）';
      pri.setAttribute('aria-label', pri.title);
      pri.addEventListener('click', function () {
        it.pri = ((it.pri || 0) + 1) % 4; // 无→低→中→高→无
        persist();
        render();
      });

      // 文本（点击进入编辑）
      var text = document.createElement('span');
      text.className = 'td-text';
      text.textContent = it.text;
      text.title = '点击编辑';
      text.addEventListener('click', function () { startEdit(it, li, text); });

      // 截止日
      var due = document.createElement('span');
      due.className = 'td-due';
      var dueIn = document.createElement('input');
      dueIn.type = 'date';
      dueIn.value = it.due || '';
      dueIn.setAttribute('aria-label', '截止日期');
      if (it.due) {
        if (it.due < today && !it.done) { due.className = 'td-due is-overdue'; dueIn.title = '已过期'; }
        else if (it.due === today) { due.className = 'td-due is-today'; dueIn.title = '今天截止'; }
      }
      dueIn.addEventListener('change', function () {
        it.due = dueIn.value || '';
        persist();
        render();
      });
      due.appendChild(dueIn);

      // 删除
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'td-del';
      del.setAttribute('aria-label', '删除这条待办');
      del.title = '删除';
      del.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      del.addEventListener('click', function () {
        items = items.filter(function (x) { return x.id !== it.id; });
        persist();
        render();
      });

      li.appendChild(check);
      li.appendChild(pri);
      li.appendChild(text);
      li.appendChild(due);
      li.appendChild(del);
      listEl.appendChild(li);
    });
  }

  function startEdit(it, li, textEl) {
    var edit = document.createElement('input');
    edit.type = 'text';
    edit.className = 'td-text-edit';
    edit.value = it.text;
    edit.maxLength = 120;
    textEl.replaceWith(edit);
    edit.focus();
    edit.select();

    function commit() {
      var v = edit.value.trim();
      if (v && v !== it.text) {
        it.text = v;
        persist();
      }
      render();
    }
    edit.addEventListener('blur', commit);
    edit.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); render(); }
    });
  }

  /* ---------- 添加 ---------- */
  function add() {
    var v = input.value.trim();
    if (!v) { input.focus(); return; }
    // 支持 "!" 前缀快速设高优先级
    var pri = 0;
    if (v.charAt(0) === '!') { pri = 3; v = v.slice(1).trim(); }
    if (!v) { input.value = ''; return; }
    items.unshift({
      id: uid(), text: v, done: false, pri: pri,
      due: '', created: Date.now(), doneAt: null,
    });
    input.value = '';
    persist();
    render();
    input.focus();
  }

  $('td-add').addEventListener('click', add);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });

  /* ---------- 筛选 ---------- */
  document.querySelectorAll('.td-filter').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-f');
      document.querySelectorAll('.td-filter').forEach(function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-selected', String(on));
      });
      render();
    });
  });

  $('td-clear-done').addEventListener('click', function () {
    var n = items.filter(function (x) { return x.done; }).length;
    if (!n) return;
    items = items.filter(function (x) { return !x.done; });
    persist();
    render();
    showToast('已清除 ' + n + ' 条已完成待办');
  });

  var back = $('td-back');
  if (back) back.href = (window.FUO_PATHS && window.FUO_PATHS.OFFICE) || '../';

  /* ---------- 启动 ---------- */
  var booted = false;
  function boot(data) {
    items = (data && Array.isArray(data.items)) ? data.items : [];
    if (booted) { render(); return; } // 云端数据到达：重渲染
    booted = true;
    render();
  }
  if (window.FUO_OFFICE) {
    window.FUO_OFFICE.load('todo', { items: [] }, boot);
  } else {
    boot({ items: [] });
  }
})();
