/* =====================================================
 * Fuo Tools · 番茄钟逻辑（office/pomodoro/ 专用，纯本地）
 * · 专注/休息两模式，时长可调（1-120 分钟）
 * · SVG 圆环进度 + 标题栏倒计时
 * · 结束提示音（WebAudio 合成，零音频文件）+ 可选桌面通知
 * · 今日统计：完成番茄数 / 专注分钟（localStorage fuo-pomo-stats）
 * ===================================================== */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var toastEl = $('toast');

  var RING_LEN = 2 * Math.PI * 88; // r=88

  var mode = 'focus';          // 'focus' | 'break'
  var running = false;
  var totalSec = 25 * 60;      // 当前阶段总秒数
  var leftSec = 25 * 60;       // 剩余秒数
  var tick = null;             // interval
  var baseTitle = document.title;

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toastEl.hidden = true; }, 2400);
  }

  /* ---------- 设置持久化 ---------- */
  var LS_KEY = 'fuo-pomo-cfg';
  var cfg = { focus: 25, break: 5, notify: false };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && typeof saved === 'object') cfg = saved;
  } catch (e) { /* ignore */ }
  function saveCfg() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }

  /* ---------- 今日统计 ---------- */
  var ST_KEY = 'fuo-pomo-stats';
  function stats() {
    var today = new Date().toISOString().slice(0, 10);
    var s = { date: today, count: 0, minutes: 0, total: 0 };
    try {
      var raw = JSON.parse(localStorage.getItem(ST_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        s.total = raw.total || 0;
        if (raw.date === today) {
          s.count = raw.count || 0;
          s.minutes = raw.minutes || 0;
        }
      }
    } catch (e) { /* ignore */ }
    return s;
  }
  function saveStats(s) {
    try { localStorage.setItem(ST_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function renderStats() {
    var s = stats();
    $('pm-st-count').textContent = s.count;
    $('pm-st-min').textContent = s.minutes;
    $('pm-st-total').textContent = s.total;
  }

  /* ---------- 提示音（WebAudio，零文件） ---------- */
  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      [0, 0.18, 0.36].forEach(function (delay, i) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = mode === 'focus' ? 880 : 660; // 完成专注高音 / 休息结束中音
        g.gain.setValueAtTime(0.001, ctx.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + delay + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.16);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + delay);
        o.stop(ctx.currentTime + delay + 0.2);
      });
    } catch (e) { /* ignore */ }
  }

  function notify(title, body) {
    if (!cfg.notify) return;
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'granted') {
        new Notification(title, { body: body, silent: true });
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- 渲染 ---------- */
  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function render() {
    $('pm-time').textContent = fmtTime(leftSec);
    $('pm-state').textContent = running
      ? (mode === 'focus' ? '专注中…' : '休息中…')
      : (leftSec === totalSec ? '准备开始' : '已暂停');

    var ring = $('pm-ring');
    var pct = totalSec ? leftSec / totalSec : 0;
    ring.style.strokeDashoffset = String(RING_LEN * (1 - pct));

    var timer = $('pm-timer');
    timer.className = 'pm-timer' +
      (mode === 'break' ? ' is-break' : '') +
      (running ? ' is-running' : '');

    $('pm-mode-focus').classList.toggle('is-on', mode === 'focus');
    $('pm-mode-break').classList.toggle('is-on', mode === 'break');
    $('pm-mode-focus').setAttribute('aria-checked', String(mode === 'focus'));
    $('pm-mode-break').setAttribute('aria-checked', String(mode === 'break'));

    $('pm-start').textContent = running ? '⏸ 暂停' : (leftSec === totalSec ? '▶ 开始' : '▶ 继续');

    document.title = running
      ? fmtTime(leftSec) + ' · ' + (mode === 'focus' ? '专注' : '休息') + ' · 番茄钟'
      : baseTitle;
  }

  /* ---------- 计时 ---------- */
  function start() {
    if (running) { pause(); return; }
    running = true;
    tick = setInterval(function () {
      leftSec--;
      if (leftSec <= 0) {
        leftSec = 0;
        finishPhase();
      }
      render();
    }, 1000);
    render();
  }

  function pause() {
    running = false;
    clearInterval(tick);
    render();
  }

  function reset(silent) {
    running = false;
    clearInterval(tick);
    leftSec = totalSec;
    if (!silent) render();
  }

  function finishPhase() {
    running = false;
    clearInterval(tick);
    beep();

    if (mode === 'focus') {
      // 记一笔统计
      var s = stats();
      s.count += 1;
      s.minutes += Math.round(totalSec / 60);
      s.total += 1;
      saveStats(s);
      renderStats();

      notify('🍅 专注完成！', '休息 ' + cfg.break + ' 分钟，眼睛看看远处。');
      showToast('🍅 完成 ' + Math.round(totalSec / 60) + ' 分钟专注！进入休息');
      switchMode('break', true);
    } else {
      notify('⏰ 休息结束', '开始新的一轮专注吧。');
      showToast('休息结束，开始新的一轮专注');
      switchMode('focus', true);
    }
  }

  function switchMode(next, autoStart) {
    mode = next;
    totalSec = (mode === 'focus' ? cfg.focus : cfg.break) * 60;
    leftSec = totalSec;
    if (autoStart) {
      running = true;
      tick = setInterval(function () {
        leftSec--;
        if (leftSec <= 0) {
          leftSec = 0;
          finishPhase();
        }
        render();
      }, 1000);
    }
    render();
  }

  /* ---------- 事件 ---------- */
  $('pm-start').addEventListener('click', start);
  $('pm-reset').addEventListener('click', function () { reset(); });
  $('pm-skip').addEventListener('click', function () {
    // 跳过：专注跳过不记统计
    switchMode(mode === 'focus' ? 'break' : 'focus', false);
    showToast('已跳到' + (mode === 'focus' ? '专注' : '休息'));
  });
  $('pm-timer').addEventListener('click', start); // 点圆环也能开始/暂停

  $('pm-mode-focus').addEventListener('click', function () { switchMode('focus', false); });
  $('pm-mode-break').addEventListener('click', function () { switchMode('break', false); });

  $('pm-len-focus').value = cfg.focus;
  $('pm-len-break').value = cfg.break;
  $('pm-notify').checked = !!cfg.notify;

  $('pm-len-focus').addEventListener('change', function () {
    var v = Math.max(1, Math.min(120, parseInt(this.value, 10) || 25));
    this.value = v;
    cfg.focus = v;
    saveCfg();
    if (mode === 'focus') { totalSec = v * 60; reset(); }
  });
  $('pm-len-break').addEventListener('change', function () {
    var v = Math.max(1, Math.min(60, parseInt(this.value, 10) || 5));
    this.value = v;
    cfg.break = v;
    saveCfg();
    if (mode === 'break') { totalSec = v * 60; reset(); }
  });
  $('pm-notify').addEventListener('change', function () {
    cfg.notify = this.checked;
    saveCfg();
    if (cfg.notify && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(function (p) {
        if (p !== 'granted') {
          cfg.notify = false;
          $('pm-notify').checked = false;
          saveCfg();
          showToast('浏览器未授权通知，已自动关闭');
        } else {
          showToast('已开启桌面通知');
        }
      });
    }
  });

  var back = $('pm-back');
  if (back) back.href = (window.FUO_PATHS && window.FUO_PATHS.OFFICE) || '../';

  /* 页面切走时暂停标题计时恢复 */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) render(); // 回来时刷新标题
  });

  /* ---------- 启动 ---------- */
  renderStats();
  totalSec = cfg.focus * 60;
  leftSec = totalSec;
  render();
})();
