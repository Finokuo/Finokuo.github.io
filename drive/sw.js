/* =====================================================
 * Fuo Tools · Service Worker（PWA 离线壳，scope = /drive/）
 *
 * 策略：
 *   · 页面导航（navigate）→ 网络优先，断网回退缓存
 *   · 静态资源（css/js/png/json/svg，同源 GET）→ 缓存优先 + 后台更新
 *   · Supabase API（跨域）与 auth 请求一律直连，不缓存
 *   · 版本升级：新 CACHE_NAME 自动清旧缓存
 * 注册：sidebar.js 统一注册（仅 https / localhost）
 * ===================================================== */
(function () {
  'use strict';

  var CACHE = 'fuo-shell-v8';
  var SHELL = [
    '/drive/',
    '/drive/index.html',
    '/drive/assets/css/style.css',
    '/drive/assets/css/accent.css',
    '/drive/assets/js/config.js',
    '/drive/assets/js/sidebar.js',
    '/drive/assets/js/palette.js',
    '/drive/assets/js/theme.js',
    '/drive/assets/js/fx.js',
    '/drive/assets/js/app.js',
    '/drive/assets/vendor/supabase.min.js',
    // v0.8：办公集 / 回收站 / 公开页
    '/drive/office/',
    '/drive/office/assets/office.css',
    '/drive/office/assets/office-store.js',
    '/drive/office/todo/',
    '/drive/office/todo/assets/todo.css',
    '/drive/office/todo/assets/todo.js',
    '/drive/office/habit/',
    '/drive/office/habit/assets/habit.css',
    '/drive/office/habit/assets/habit.js',
    '/drive/office/pomodoro/',
    '/drive/office/pomodoro/assets/pomodoro.css',
    '/drive/office/pomodoro/assets/pomodoro.js',
    '/drive/recycle/',
    '/drive/n/',
    '/drive/manifest.json'
  ];

  /* 安装：预缓存核心壳 */
  self.addEventListener('install', function (e) {
    e.waitUntil(
      caches.open(CACHE).then(function (c) {
        return Promise.allSettled(SHELL.map(function (u) { return c.add(u); }));
      }).then(function () { return self.skipWaiting(); })
    );
  });

  /* 激活：清掉旧版本缓存 */
  self.addEventListener('activate', function (e) {
    e.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      }).then(function () { return self.clients.claim(); })
    );
  });

  function isStatic(url) {
    return /\.(css|js|mjs|png|jpg|jpeg|gif|svg|webp|ico|json|woff2?|webmanifest)(\?|$)/i.test(url.pathname);
  }

  self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;

    var url = new URL(req.url);
    if (url.origin !== location.origin) return; // Supabase 等跨域直连

    /* 页面导航：网络优先，断网回退 */
    if (req.mode === 'navigate') {
      e.respondWith(
        fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () {
          return caches.match(req).then(function (hit) {
            return hit || caches.match('/drive/index.html');
          });
        })
      );
      return;
    }

    /* 静态资源：缓存优先 + 后台更新（stale-while-revalidate） */
    if (isStatic(url)) {
      e.respondWith(
        caches.match(req).then(function (hit) {
          var fetcher = fetch(req).then(function (res) {
            if (res && res.ok) {
              var copy = res.clone();
              caches.open(CACHE).then(function (c) { c.put(req, copy); });
            }
            return res;
          }).catch(function () { return hit; });
          return hit || fetcher;
        })
      );
    }
    /* 其余同源 GET（如切页 hash）不拦截 */
  });
})();
