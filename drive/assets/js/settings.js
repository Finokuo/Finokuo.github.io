/* =====================================================
 * Fuo Tools · 用户设置存储（全站小模块，无依赖）
 * 存储键：fuo-settings（localStorage JSON）
 * 读取方：theme.js / fx.js / notes.js / tool-page.js 各自内嵌
 *        同款 settingOn() 兜底读取，互不依赖、顺序无关。
 *
 * 全部开关与默认值（settings 页可视化编辑）：
 *   themeMode     'dark' | 'light' | 'system'  主题模式（存 fu-theme）
 *   themeRipple   true    切换主题时的圆形扩散动画
 *   fxSpot        true    卡片光斑跟随鼠标
 *   fxReveal      true    内容滚动入场动画
 *   noteAutosave  true    云笔记自动保存（关=手动 Ctrl+S / 点状态条）
 *   noteOpenQuick false   进入云笔记页自动打开快捷笔记
 *   showWordCount true    显示字数统计
 *   confirmDelete true    删除笔记/文件夹前二次确认
 *   toolHistory   true    记录工具使用（最近使用列表 + 次数）
 * ===================================================== */
(function () {
  'use strict';

  var KEY = 'fuo-settings';

  var DEFAULTS = {
    themeMode: 'dark',   // 实际存 fu-theme；此处仅占位说明
    themeRipple: true,
    fxSpot: true,
    fxReveal: true,
    noteAutosave: true,
    noteOpenQuick: false,
    showWordCount: true,
    confirmDelete: true,
    toolHistory: true,
  };

  function all() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      var o = JSON.parse(raw);
      var out = Object.assign({}, DEFAULTS);
      if (o && typeof o === 'object') {
        Object.keys(DEFAULTS).forEach(function (k) {
          if (o[k] !== undefined) out[k] = o[k];
        });
      }
      return out;
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function get(key) {
    return all()[key];
  }

  function set(key, value) {
    var o = all();
    o[key] = value;
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 隐私模式 */ }
    return o;
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  window.FUO_SETTINGS = { KEY: KEY, DEFAULTS: DEFAULTS, all: all, get: get, set: set, reset: reset };
})();
