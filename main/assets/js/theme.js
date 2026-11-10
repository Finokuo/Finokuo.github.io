/* =====================================================
 * Fuo Tools · 主题（暗色 / 亮色 / 跟随系统）
 * 在 <head> 中同步加载：先于 CSS 设置 data-theme，避免闪白。
 * 选择持久化到 localStorage（key: fu-theme，可选 dark/light/system，默认暗色）。
 *
 * 切换动效（element-plus 同款工艺，全站统一，新页面直接沿用）：
 *   路径 A · 支持 View Transitions 的浏览器（Chrome/Edge 111+、Safari 18+）：
 *     快照圆形裁剪 —— 切亮色：新快照从点击处【扩散】（裁 ::view-transition-new）
 *                     切暗色：旧快照向点击处【收起】（裁 ::view-transition-old）
 *   路径 B · 其余浏览器（Firefox / 旧 Safari 等）DOM 兜底：
 *     在点击处生成一个目标主题背景色的纯色圆，扩大盖满全屏后切换主题。
 *     效果与路径 A 一致，全平台可见。
 *   无轮廓；约 0.5s；键盘/程序触发时圆心退化为按钮中心。
 *   prefers-reduced-motion 时保持直接切换（尊重系统设置）。
 * ===================================================== */
(function () {
  'use strict';

  var KEY = 'fu-theme';
  var ACCENT_KEY = 'fuo-accent'; // v0.8：主题色（teal/orange/rose/violet/emerald/amber）
  var ACCENTS = ['teal', 'orange', 'rose', 'violet', 'emerald', 'amber'];
  var root = document.documentElement;
  var DUR = 500;

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

  /* 系统主题偏好解析（themeMode = system 时用） */
  function systemPrefersLight() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: light)').matches);
    } catch (e) { return false; }
  }

  function get() {
    var v = 'dark';
    try { v = localStorage.getItem(KEY) || 'dark'; } catch (e) { v = 'dark'; }
    if (v === 'system') return systemPrefersLight() ? 'light' : 'dark';
    return v === 'light' ? 'light' : 'dark';
  }

  function storedMode() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark';
    } catch (e) { return 'dark'; }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
  }

  /* v0.8：主题色（与主题模式独立，存 fuo-accent；teal = 默认，不设属性） */
  function storedAccent() {
    try {
      var v = localStorage.getItem(ACCENT_KEY);
      return ACCENTS.indexOf(v) !== -1 ? v : 'teal';
    } catch (e) { return 'teal'; }
  }
  function applyAccent(a) {
    if (a === 'teal') root.removeAttribute('data-accent');
    else root.setAttribute('data-accent', a);
  }

  /* 扩散/收起半径：从圆心到最远角落 */
  function endRadiusOf(x, y) {
    return Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );
  }

  function reduced() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /* 路径 A：View Transitions 快照裁剪 */
  function vtRipple(x, y, next) {
    var trans = document.startViewTransition(function () { apply(next); });
    var endRadius = endRadiusOf(x, y);

    trans.ready.then(function () {
      // element-plus 同款方向性（clipPath 两帧：起点帧 → 终点帧）
      //  · 切到亮色：new 快照 circle(0)→circle(半径)，从点击处扩散
      //  · 切到暗色：old 快照 circle(半径)→circle(0)，向点击处收起
      //    （old 需置顶，见 CSS :root[data-theme='dark']::view-transition-old）
      var clip = [
        'circle(0px at ' + x + 'px ' + y + 'px)',
        'circle(' + endRadius + 'px at ' + x + 'px ' + y + 'px)'
      ];
      document.documentElement.animate(
        { clipPath: next === 'dark' ? clip.slice().reverse() : clip },
        {
          duration: DUR,
          easing: 'ease-in-out',
          pseudoElement: next === 'dark'
            ? '::view-transition-old(root)'
            : '::view-transition-new(root)'
        }
      );
    }).catch(function () { /* 连点等导致 transition 被跳过：忽略 */ });
  }

  /* 路径 B：DOM 兜底 —— 纯色圆（目标主题背景色）扩大盖满后切主题 */
  function domRipple(x, y, next, current) {
    var endRadius = endRadiusOf(x, y);
    var d = endRadius * 2;

    // 同一 JS 任务内临时换主题读目标背景色（不渲染，无闪烁）
    var color = '';
    try {
      root.setAttribute('data-theme', next);
      color = (getComputedStyle(root).getPropertyValue('--bg') || '').trim();
    } catch (e) { /* ignore */ }
    root.setAttribute('data-theme', current);

    var el = document.createElement('div');
    el.setAttribute('data-fuo-ripple', '');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;left:' + x + 'px;top:' + y + 'px;' +
      'width:' + d + 'px;height:' + d + 'px;margin:0;padding:0;' +
      'border-radius:50%;pointer-events:none;z-index:2147483647;' +
      'transform:translate(-50%,-50%) scale(0);' +
      'background:' + (color || (next === 'dark' ? '#07080a' : '#f4f5f6')) + ';';
    document.body.appendChild(el);

    // 极老浏览器连 WAAPI 都没有：直接切换
    if (!el.animate) {
      if (el.parentNode) el.parentNode.removeChild(el);
      apply(next);
      return;
    }

    var anim = el.animate(
      [{ transform: 'translate(-50%,-50%) scale(0)' },
       { transform: 'translate(-50%,-50%) scale(1)' }],
      { duration: DUR, easing: 'ease-in-out', fill: 'forwards' }
    );
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      apply(next); // 圆已盖满：此刻切换无跳变
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    anim.onfinish = finish;
    setTimeout(finish, DUR + 100); // onfinish 事件丢失兜底
  }

  /* 圆形换肤（x, y = 圆心像素坐标；目标主题由当前状态推导） */
  function toggleAt(x, y) {
    var current = get();
    var next = current === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (e) { /* 隐私模式忽略 */ }

    // 坐标无效（外部调用未传）→ 退化为视口上方中心
    if (!isFinite(x) || !isFinite(y)) { x = window.innerWidth / 2; y = 60; }

    if (reduced()) { apply(next); return; } // 尊重系统减少动效
    if (!settingOn('themeRipple', true)) { apply(next); return; } // 设置里关闭了切换动画

    if (typeof document.startViewTransition === 'function') {
      vtRipple(x, y, next);   // 路径 A
    } else {
      domRipple(x, y, next, current); // 路径 B（全兼容）
    }
  }

  /* 按钮点击 → 真实指针点击用鼠标位置为圆心，否则用按钮中心 */
  function toggle(e) {
    var x, y;
    var el = e && e.currentTarget;
    if (el && el.getBoundingClientRect) {
      var r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    // e.detail > 0 表示真实指针点击（键盘/程序 click 的 detail 为 0）
    if (e && e.detail > 0 && isFinite(e.clientX) && isFinite(e.clientY) &&
        (e.clientX !== 0 || e.clientY !== 0)) {
      x = e.clientX;
      y = e.clientY;
    }
    toggleAt(x, y);
  }

  // 立即应用（本脚本位于 <head>，早于首帧渲染）
  apply(get());
  applyAccent(storedAccent());

  // 暴露给其他脚本（设置页等）：
  //   get()          → 当前已解析主题（dark/light）
  //   mode()         → 存储模式（dark/light/system）
  //   toggle(x,y)    → 圆形扩散切换
  //   set(mode)      → 直接设置模式（dark/light/system，无动画）
  //   accent()       → 当前主题色 key（v0.8）
  //   accents        → 可选主题色列表（v0.8）
  //   setAccent(key) → 切换主题色（v0.8，立即生效）
  window.FUO_THEME = {
    get: get,
    mode: storedMode,
    toggle: toggleAt,
    accent: storedAccent,
    accents: ACCENTS.slice(),
    setAccent: function (key) {
      var a = ACCENTS.indexOf(key) !== -1 ? key : 'teal';
      try { localStorage.setItem(ACCENT_KEY, a); } catch (e) { /* ignore */ }
      applyAccent(a);
    },
    set: function (mode) {
      try { localStorage.setItem(KEY, mode); } catch (e) { /* ignore */ }
      apply(get());
    },
  };

  // 跟随系统模式：系统偏好变化时实时跟随
  try {
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      var onChange = function () {
        if (storedMode() === 'system') apply(get());
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  } catch (e) { /* ignore */ }

  // 绑定所有切换按钮
  function bind() {
    var btns = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', toggle);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
