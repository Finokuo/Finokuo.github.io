/* =====================================================
 * Fuo Tools · 主题（暗色 / 亮色）
 * 在 <head> 中同步加载：先于 CSS 设置 data-theme，避免闪白。
 * 选择持久化到 localStorage（key: fu-theme），默认暗色。
 * ===================================================== */
(function () {
  'use strict';

  var KEY = 'fu-theme';
  var root = document.documentElement;

  function get() {
    try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; }
    catch (e) { return 'dark'; }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
  }

  function toggle() {
    var next = get() === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, next); } catch (e) { /* 隐私模式忽略 */ }
    apply(next);
  }

  // 立即应用（本脚本位于 <head>，早于首帧渲染）
  apply(get());

  // 暴露给其他脚本（备用）
  window.FUO_THEME = { get: get, toggle: toggle };

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
