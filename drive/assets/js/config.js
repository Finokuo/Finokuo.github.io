/* Fuo Tools · 仪表盘配置（与 main 共用同一份 Supabase 项目） */
window.FUO_CONFIG = {
  SUPABASE_URL: 'https://mxvlyuteecnyencjebyt.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_wfnd9vfQ-_7BsyG56p20Ew_9L_j02oA',
  SUPABASE_REF: 'mxvlyuteecnyencjebyt',
};

/**
 * 线上 base = ''，路径为 /main/ /drive/；
 * 沙盒预览（挂在 /fuo/ 下）自动带前缀 + 显式 /index.html。
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
  // 云笔记（工具集成员之一）：/drive/tool-cluster/notes/
  NOTES: window.FUO_BASE + '/drive/tool-cluster/notes' + window.FUO_SUFFIX,
  // 收藏 / 设置
  FAVORITES: window.FUO_BASE + '/drive/favorites' + window.FUO_SUFFIX,
  SETTINGS: window.FUO_BASE + '/drive/settings' + window.FUO_SUFFIX,
  // v0.8：办公集 / 回收站 / 公开笔记页 / 公开主页
  OFFICE: window.FUO_BASE + '/drive/office' + window.FUO_SUFFIX,
  RECYCLE: window.FUO_BASE + '/drive/recycle' + window.FUO_SUFFIX,
  N: window.FUO_BASE + '/drive/n' + window.FUO_SUFFIX,
  U: window.FUO_BASE + '/drive/u' + window.FUO_SUFFIX,
  // v0.9：桌面版下载页（AI 管理大师 EXE 专属入口）
  FUOTOOL: window.FUO_BASE + '/fuotool' + window.FUO_SUFFIX,
};

/**
 * 工具集内跳转：slug → /drive/tool-cluster/<slug>/
 */
window.FUO_TOOL_URL = function (slug) {
  return window.FUO_BASE + '/drive/tool-cluster/' + encodeURIComponent(slug) + window.FUO_SUFFIX;
};

/**
 * v0.8：办公集内跳转：slug → /drive/office/<slug>/
 */
window.FUO_OFFICE_URL = function (slug) {
  return window.FUO_BASE + '/drive/office/' + encodeURIComponent(slug) + window.FUO_SUFFIX;
};
