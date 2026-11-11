/* =====================================================
 * Fuo Tools · AI 管理大师 —— 桌面版门槛页逻辑（v2）
 *
 * v0.9.0 起，AI 管理大师的完整功能迁往桌面版 EXE：
 *   · 网页端此页只做引导（下载入口 + 说明）
 *   · 完整实现（扫描 / 派发 / 回收 / office_data 云同步）
 *     已随桌面版开发迁出，不再在浏览器中运行
 * 本脚本职责：接好两个跳转（下载页 / 办公集 / 工作台）。
 * ===================================================== */
(function () {
  'use strict';

  function boot() {
    var PATHS = window.FUO_PATHS || {};

    // 大按钮 → /fuotool/ 下载页
    var cta = document.getElementById('ai-goto-download');
    if (cta) {
      cta.href = PATHS.FUOTOOL || '../../../fuotool/';
      cta.target = '_self';
    }

    // 返回办公集 / 工作台
    var backOffice = document.getElementById('ai-back-office');
    if (backOffice) backOffice.href = PATHS.OFFICE || '../';
    var back = document.getElementById('ai-back');
    if (back) back.href = PATHS.DRIVE || '../../';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
