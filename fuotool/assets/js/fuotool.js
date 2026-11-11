/* =====================================================
 * Fuo Tools · 桌面版下载页逻辑
 *
 * 职责：
 *   1) DL 配置 → 渲染下载按钮（未就绪 = 呼吸提示；就绪 = 真下载）
 *   2) 「进入网页版」按钮 → 复刻根入口分流（登录→drive / 未登录→main）
 *   3) 平台检测：非 Windows 给出提示
 *
 * ★ 安装包发布指引（给站长）：
 *   ① 把 EXE 上传到本目录的 download/ 子目录
 *      （例如 fuotool/download/FuoTools-Setup-0.9.0.exe）
 *   ② 把下面 DL.ready 改为 true，并填好 size / date / sha256
 *   ③ 推送上线——页面上三处下载按钮自动变为真实下载链接
 * ===================================================== */
(function () {
  'use strict';

  /* ---------- 下载配置（发布时改这里） ---------- */
  var DL = {
    ready: false,                                  // ← EXE 上传后改为 true
    version: '0.9.0',
    size: '—',                                     // 例：'98.4 MB'
    date: '—',                                     // 例：'2026-11-12'
    url: './download/FuoTools-Setup-0.9.0.exe',    // 安装包地址
    sha256: ''                                     // 例：'a3f0…（64 位）'
  };

  /* ---------- 站内路径（与 config.js 同规则，本页独立计算） ---------- */
  var REF = 'mxvlyuteecnyencjebyt'; // Supabase 项目 ref（仅用于读本地会话键判断登录态）
  var path = window.location.pathname;
  var inPreview = path.indexOf('/fuo/') !== -1;
  var BASE = inPreview ? path.slice(0, path.indexOf('/fuo/')) + '/fuo' : '';
  var SUFFIX = inPreview ? '/index.html' : '/';
  var WEB = {
    MAIN: BASE + '/main' + SUFFIX,
    DRIVE: BASE + '/drive' + SUFFIX,
  };

  /* ---------- 小工具 ---------- */
  function $(id) { return document.getElementById(id); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function isWindows() {
    var ua = navigator.userAgent || '';
    return /Windows/i.test(ua);
  }

  /* ---------- 渲染下载按钮（Hero / 下载卡 / CTA 三处） ---------- */
  var DOWN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

  function makeReadyBtn(extraText) {
    var a = document.createElement('a');
    a.className = 'btn btn-primary btn-lg dl-btn';
    a.href = DL.url;
    a.setAttribute('download', '');
    a.innerHTML = DOWN_SVG + '<span>下载 Windows 版' + (extraText || '') + '</span>';
    return a;
  }

  function makeWaitBtn() {
    var b = document.createElement('button');
    b.className = 'btn btn-primary btn-lg dl-btn is-wait';
    b.type = 'button';
    b.innerHTML = '<i class="dl-pulse" aria-hidden="true"></i><span>桌面版打包上传中 · 敬请期待</span>';
    b.addEventListener('click', function () {
      toast('v' + DL.version + ' 安装包正在打包上传——本页就是官方下载地址，可先收藏（Ctrl+D）');
    });
    return b;
  }

  function renderDownload() {
    var hero = $('dl-hero-holder');
    var main = $('dl-main-holder');
    var cta = $('dl-cta-holder');
    var btn = DL.ready ? makeReadyBtn('（v' + DL.version + '）') : makeWaitBtn();

    if (hero) hero.innerHTML = '';
    if (hero) hero.appendChild(DL.ready ? makeReadyBtn('（v' + DL.version + '）') : makeWaitBtn());
    if (main) { main.innerHTML = ''; main.appendChild(btn); }
    if (cta) { cta.innerHTML = ''; cta.appendChild(DL.ready ? makeReadyBtn('') : makeWaitBtn()); }

    // 元信息
    var verEl = $('dl-ver'), sizeEl = $('dl-size'), dateEl = $('dl-date');
    if (verEl) verEl.textContent = 'v' + DL.version;
    if (sizeEl && DL.size !== '—') sizeEl.textContent = DL.size;
    if (dateEl && DL.date !== '—') dateEl.textContent = DL.date;

    // SHA-256（就绪且填写了才显示）
    var sha = $('dl-sha');
    if (sha && DL.ready && DL.sha256) {
      sha.textContent = 'SHA-256 · ' + DL.sha256;
      sha.hidden = false;
    }

    // 平台提示
    var hint = $('dl-os-hint');
    if (hint) {
      if (!isWindows()) {
        hint.innerHTML = '检测到你当前不是 Windows——桌面版首批仅支持 Windows 10 / 11，可先收藏本页';
      } else if (!DL.ready) {
        hint.innerHTML = '适配你的系统：<b>Windows</b> · 安装包就绪后此处可直接下载';
      } else {
        hint.innerHTML = '适配你的系统：<b>Windows</b>';
      }
      hint.hidden = false;
    }
  }

  /* ---------- 「进入网页版」：复刻根入口分流 ---------- */
  function webTarget() {
    try {
      var raw = localStorage.getItem('sb-' + REF + '-auth-token');
      if (raw) {
        var t = JSON.parse(raw);
        var hasSession = !!(
          (t && t.access_token) ||
          (t && t.currentSession) ||
          (t && t.user)
        );
        if (hasSession) return WEB.DRIVE;
      }
    } catch (e) { /* 读不到就当未登录 */ }
    return WEB.MAIN;
  }

  function bindWebLinks() {
    var target = webTarget();
    document.querySelectorAll('[data-goto-web]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.href = target;
      });
    });
  }

  function boot() {
    renderDownload();
    bindWebLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
