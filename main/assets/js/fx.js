/* =====================================================
 * Fuo Tools · 页面特效
 * 1) 卡片光斑跟随鼠标（--mx / --my CSS 变量）
 * 2) 滚动入场动画（IntersectionObserver + [data-reveal]）
 * 无 JS 时页面正常显示（.fx 类由本脚本添加）。
 * ===================================================== */
(function () {
  'use strict';

  document.documentElement.classList.add('fx');

  var reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* 老浏览器忽略 */ }

  /* ---------- 鼠标光斑跟随 ---------- */
  function initSpotlight() {
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
    if (reduced || !('IntersectionObserver' in window)) {
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
