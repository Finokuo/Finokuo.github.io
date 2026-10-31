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
 * 本地或沙盒预览（挂在 /fuo/ 之下）时自动带上前缀，保证预览可用。
 */
window.FUO_BASE = (function () {
  var path = window.location.pathname;
  return path.indexOf('/fuo/') !== -1 ? path.slice(0, path.indexOf('/fuo/')) + '/fuo' : '';
})();

window.FUO_PATHS = {
  MAIN: window.FUO_BASE + '/main/',
  DRIVE: window.FUO_BASE + '/drive/',
};
