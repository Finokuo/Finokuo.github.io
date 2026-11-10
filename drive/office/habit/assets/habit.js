/* =====================================================
 * Fuo Tools · 习惯打卡逻辑（office/habit/ 专用）
 * 数据：office_data(kind='habit') payload =
 *   { habits: [{id,name,color}], days: { 'YYYY-MM-DD': [habitId,…] } }
 * 热力图：最近 15 周（105 天），GitHub 式 4 级色阶
 * ===================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var input = $('hb-input');
  var listEl = $('hb-list');
  var toastEl = $('toast');

  var habits = [];
  var days = {};
  var COLORS = ['#2dd4bf', '#fb7185', '#fbbf24', '#c084fc', '#34d399', '#fb923c', '#38bdf8'];

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.hidden = true; }, 2000);
  }

  function persist() {
    if (window.FUO_OFFICE) window.FUO_OFFICE.save('habit', { habits: habits, days: days });
  }

  if (window.FUO_OFFICE) {
    window.FUO_OFFICE.onStatus(function (s) {
      var chip = $('hb-sync');
      var txt = $('hb-sync-txt');
      if (!chip || !txt) return;
      chip.className = 'of-sync is-' + s;
      txt.textContent = s === 'cloud' ? '云同步 ✓'
        : s === 'saving' ? '同步中…'
        : s === 'error' ? '云端暂不可达 · 本地已保存'
        : '仅本机 · 执行 supabase-v6.sql 开启云同步';
    });
  }

  /* ---------- 日期工具 ---------- */
  function fmt(d) {
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (day.length < 2 ? '0' + day : day);
  }
  function todayStr() { return fmt(new Date()); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

  function markOf(dateStr, habitId) {
    var list = days[dateStr];
    return !!(list && list.indexOf(habitId) !== -1);
  }
  function toggleMark(dateStr, habitId) {
    var list = days[dateStr];
    if (!list) list = days[dateStr] = [];
    var i = list.indexOf(habitId);
    if (i === -1) list.push(habitId);
    else list.splice(i, 1);
    if (!list.length) delete days[dateStr];
  }

  /* 连续打卡天数（从今天往前数；今天没打则从昨天起算） */
  function streak(habitId) {
    var n = 0;
    var d = new Date();
    if (!markOf(fmt(d), habitId)) d = addDays(d, -1); // 今天还没打不打断连续
    while (markOf(fmt(d), habitId)) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }

  /* ---------- 渲染 ---------- */
  var WEEKS = 15;

  function heatCell(date, habitId, color) {
    var cell = document.createElement('span');
    cell.className = 'hb-cell';
    var on = markOf(fmt(date), habitId);
    if (on) cell.classList.add('is-l4');
    if (date > new Date()) cell.classList.add('is-future');
    cell.title = fmt(date) + (on ? ' · 已打卡' : '');
    if (on) cell.style.background = color; // 用习惯自己的颜色
    return cell;
  }

  function render() {
    listEl.innerHTML = '';

    if (!habits.length) {
      var e = document.createElement('p');
      e.className = 'of-empty';
      e.textContent = '还没有习惯。从一件小事开始，比如「每天喝 8 杯水」。';
      listEl.appendChild(e);
      return;
    }

    var today = new Date();
    today.setHours(23, 59, 59, 999);

    habits.forEach(function (h) {
      var card = document.createElement('div');
      card.className = 'hb-card';

      /* 头部：色点 + 名字 + 连续天数 + 今日打卡 + 删除 */
      var head = document.createElement('div');
      head.className = 'hb-head';

      var dot = document.createElement('span');
      dot.className = 'hb-dot';
      dot.style.background = h.color;
      dot.setAttribute('aria-hidden', 'true');

      var name = document.createElement('span');
      name.className = 'hb-name';
      name.textContent = h.name;

      var st = streak(h.id);
      var meta = document.createElement('span');
      meta.className = 'hb-meta mono';
      meta.innerHTML = '连续 <b>' + st + '</b> 天' + (st >= 7 ? ' 🔥' : '');

      var doneToday = markOf(todayStr(), h.id);
      var check = document.createElement('button');
      check.type = 'button';
      check.className = 'hb-check' + (doneToday ? ' is-done' : '');
      check.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        (doneToday ? '今日已打卡' : '打卡');
      check.setAttribute('aria-pressed', String(doneToday));
      check.addEventListener('click', function () {
        toggleMark(todayStr(), h.id);
        persist();
        render();
        if (!doneToday) showToast('打卡成功：' + h.name);
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'hb-del';
      del.setAttribute('aria-label', '删除习惯 ' + h.name);
      del.title = '删除习惯';
      del.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      del.addEventListener('click', function () {
        habits = habits.filter(function (x) { return x.id !== h.id; });
        // 清理该习惯的所有打卡记录
        Object.keys(days).forEach(function (k) {
          days[k] = (days[k] || []).filter(function (id) { return id !== h.id; });
          if (!days[k].length) delete days[k];
        });
        persist();
        render();
        showToast('已删除习惯「' + h.name + '」');
      });

      head.appendChild(dot);
      head.appendChild(name);
      head.appendChild(meta);
      head.appendChild(check);
      head.appendChild(del);
      card.appendChild(head);

      /* 热力图：最近 15 周，列 = 周，行 = 一~日 */
      var heat = document.createElement('div');
      heat.className = 'hb-heat';
      var cols = document.createElement('div');
      cols.className = 'hb-heat-cols';

      // 从 15 周前的周一开始
      var end = new Date();
      var start = addDays(end, -(WEEKS * 7 - 1));
      start = addDays(start, -((start.getDay() + 6) % 7)); // 回到周一

      var monthRow = [];
      var lastMonth = -1;
      for (var w = 0; w < WEEKS; w++) {
        var col = document.createElement('div');
        col.className = 'hb-heat-col';
        for (var dow = 0; dow < 7; dow++) {
          var date = addDays(start, w * 7 + dow);
          col.appendChild(heatCell(date, h.id, h.color));
          if (dow === 0) {
            var m = date.getMonth();
            monthRow.push(m !== lastMonth
              ? (m + 1) + '月'
              : '');
            lastMonth = m;
          }
        }
        cols.appendChild(col);
      }
      heat.appendChild(cols);
      card.appendChild(heat);

      /* 月份标签 */
      var months = document.createElement('div');
      months.className = 'hb-months mono';
      monthRow.forEach(function (label) {
        var s = document.createElement('span');
        s.textContent = label;
        months.appendChild(s);
      });
      card.appendChild(months);

      /* 图例 */
      var legend = document.createElement('div');
      legend.className = 'hb-legend mono';
      legend.innerHTML =
        '<span>少</span>' +
        '<span class="hb-cell"></span>' +
        '<span class="hb-cell is-l1"></span>' +
        '<span class="hb-cell is-l2"></span>' +
        '<span class="hb-cell is-l3"></span>' +
        '<span class="hb-cell is-l4"></span>' +
        '<span>多</span>';
      card.appendChild(legend);

      listEl.appendChild(card);
    });
  }

  /* ---------- 添加 ---------- */
  function add() {
    var v = input.value.trim();
    if (!v) { input.focus(); return; }
    if (habits.length >= 12) { showToast('最多 12 个习惯，先删掉一个吧'); return; }
    habits.push({
      id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: v.slice(0, 30),
      color: COLORS[habits.length % COLORS.length],
    });
    input.value = '';
    persist();
    render();
    input.focus();
  }

  $('hb-add').addEventListener('click', add);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });

  var back = $('hb-back');
  if (back) back.href = (window.FUO_PATHS && window.FUO_PATHS.OFFICE) || '../';

  /* ---------- 启动 ---------- */
  var booted = false;
  function boot(data) {
    habits = (data && Array.isArray(data.habits)) ? data.habits : [];
    days = (data && data.days && typeof data.days === 'object') ? data.days : {};
    if (booted) { render(); return; }
    booted = true;
    render();
  }
  if (window.FUO_OFFICE) {
    window.FUO_OFFICE.load('habit', { habits: [], days: {} }, boot);
  } else {
    boot({ habits: [], days: {} });
  }
})();
