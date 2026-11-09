/* =====================================================
 * Fuo Tools · 页面特效
 * 1) 卡片光斑跟随鼠标（--mx / --my CSS 变量）
 * 2) 滚动入场动画（IntersectionObserver + [data-reveal]）
 * 无 JS 时页面正常显示（.fx 类由本脚本添加）。
 * 两个特效均可到 设置页 关闭（fuo-settings: fxSpot / fxReveal）。
 * ===================================================== */
(function () {
  'use strict';

  document.documentElement.classList.add('fx');

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

  var reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* 老浏览器忽略 */ }

  /* ---------- 鼠标光斑跟随 ---------- */
  function initSpotlight() {
    if (!settingOn('fxSpot', true)) return; // 设置里关闭了光斑跟随
    // 触屏设备没有鼠标悬浮，跳过
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;
    var cards = document.querySelectorAll(
      '.feature-card, .step, .cta-banner, .tool-chip, .card, .tool'
    );
    Array.prototype.forEach.call(cards, function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ---------- 滚动入场 ---------- */
  function initReveal() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    if (reduced || !settingOn('fxReveal', true) || !('IntersectionObserver' in window)) {
      // 设置关闭 / 系统减少动效 / 老浏览器：直接展示，不播入场
      Array.prototype.forEach.call(els, function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
    Array.prototype.forEach.call(els, function (el, i) {
      if (el.tagName === 'SPAN' || el.classList.contains('tool-chip')) {
        el.style.transitionDelay = (i % 5) * 55 + 'ms'; // chips 交错入场
      } else {
        el.style.transitionDelay = (i % 3) * 70 + 'ms';
      }
      io.observe(el);
    });
  }

  function boot() {
    initSpotlight();
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
