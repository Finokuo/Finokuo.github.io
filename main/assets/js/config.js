/* =====================================================
 * Fuo Tools · 全局配置
 * 说明：SUPABASE_ANON_KEY（Publishable Key）本就是设计给
 * 前端公开使用的，配合数据库 RLS 行级安全策略可安全暴露。
 * ⚠️ 千万不要把 sb_secret_ 开头的 Secret Key 放进任何前端文件！
 * ===================================================== */
window.FUO_CONFIG = {
  // Supabase 项目地址（来自你的项目 ref：mxvlyuteecnyencjebyt）
  SUPABASE_URL: 'https://mxvlyuteecnyencjebyt.supabase.co',

  // Publishable Key（可公开，仅此一把！）
  SUPABASE_ANON_KEY: 'sb_publishable_wfnd9vfQ-_7BsyG56p20Ew_9L_j02oA',

  // Supabase 项目 ref（根路径跳转判断登录态用）
  SUPABASE_REF: 'mxvlyuteecnyencjebyt',
};

/**
 * 计算站点基础路径。
 * 线上（Finokuo.github.io）时 base = ''，路径为 /main/ /drive/；
 * 本地或沙盒预览（挂在 /fuo/ 之下）时自动带上前缀，
 * 且目录路径需要显式 /index.html 才能被静态服务器解析。
 */
window.FUO_BASE = (function () {
  var path = window.location.pathname;
  return path.indexOf('/fuo/') !== -1 ? path.slice(0, path.indexOf('/fuo/')) + '/fuo' : '';
})();

window.FUO_SUFFIX = window.FUO_BASE ? '/index.html' : '/';

window.FUO_PATHS = {
  MAIN: window.FUO_BASE + '/main' + window.FUO_SUFFIX,
  DRIVE: window.FUO_BASE + '/drive' + window.FUO_SUFFIX,
  // 工具集目录页：/drive/tool-cluster/（各工具在其下的独立子目录）
  TOOL_CLUSTER: window.FUO_BASE + '/drive/tool-cluster' + window.FUO_SUFFIX,
  // v0.9：桌面版下载页（AI 管理大师 EXE 入口）
  FUOTOOL: window.FUO_BASE + '/fuotool' + window.FUO_SUFFIX,
};

/**
 * 工具集内跳转：slug → /drive/tool-cluster/<slug>/
 */
window.FUO_TOOL_URL = function (slug) {
  return window.FUO_BASE + '/drive/tool-cluster/' + encodeURIComponent(slug) + window.FUO_SUFFIX;
};
