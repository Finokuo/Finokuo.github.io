// 温故知新静态版 · Hash 路由与应用启动
;(function () {
  'use strict'

  const W = window.W

  const app = (W.app = {
    depth: 0, // 离开首页的层级(用于返回按钮态)
    stack: [], // 导航栈(用于返回)
    current: function () { return this._view || { kind: 'home' } },
  })

  W.views = W.views || {}

  // ---------- hash 解析 ----------
  // #/                              → home
  // #/s/<slug>                      → subject
  // #/c/<uid>                       → chapter
  // #/k/<uid>                       → kp
  // #/search/<q>                    → search
  // #/<view>                        → review/quiz/wrongbook/stats/paper/recite/textbook/favorites
  app.parse = function (hash) {
    const h = (hash || location.hash || '#/').replace(/^#\/?/, '')
    if (!h) return { kind: 'home' }
    const seg = h.split('/')
    switch (seg[0]) {
      case 's': return { kind: 'subject', slug: decodeURIComponent(seg[1] || '') }
      case 'c': return { kind: 'chapter', uid: decodeURIComponent(seg[1] || '') }
      case 'k': return { kind: 'kp', uid: decodeURIComponent(seg[1] || '') }
      case 'search': return { kind: 'search', q: decodeURIComponent(seg.slice(1).join('/') || '') }
      case 'review': case 'quiz': case 'wrongbook': case 'stats':
      case 'paper': case 'recite': case 'textbook': case 'favorites':
        return { kind: seg[0] }
      default: return { kind: 'home' }
    }
  }

  app.hashFor = function (kind, params) {
    params = params || {}
    switch (kind) {
      case 'home': return '#/'
      case 'subject': return '#/s/' + encodeURIComponent(params.slug || '')
      case 'chapter': return '#/c/' + encodeURIComponent(params.uid || '')
      case 'kp': return '#/k/' + encodeURIComponent(params.uid || '')
      case 'search': return '#/search/' + encodeURIComponent(params.q || '')
      default: return '#/' + kind
    }
  }

  /** 编程式导航: W.go('kp', {uid}) / W.go('home') */
  W.go = function (kind, params) {
    const hash = app.hashFor(kind, params)
    if (location.hash === hash) app.render()
    else location.hash = hash
  }

  /** 顶部返回按钮: 有历史则回退, 否则回首页 */
  app.back = function () {
    if (app.depth > 0 && history.length > 1) {
      history.back()
      // 兜底: 若 400ms 内未发生 hash 变化则强制回首页(首次直接落深链时)
      const before = location.hash
      const timer = setTimeout(function () {
        if (location.hash === before) location.hash = '#/'
      }, 400)
      const clear = function () { clearTimeout(timer); window.removeEventListener('hashchange', clear) }
      window.addEventListener('hashchange', clear)
    } else {
      location.hash = '#/'
    }
  }

  app.matchesNav = function (view, key) {
    if (!view) return key === 'home'
    if (key === 'home') return view.kind === 'home' || view.kind === 'subject' || view.kind === 'chapter' || view.kind === 'kp' || view.kind === 'search'
    return view.kind === key
  }

  // ---------- 渲染 ----------
  let cleanups = []

  app.render = function () {
    const main = document.getElementById('main')
    const view = app.parse()
    app._view = view

    // 清理上一视图的订阅
    for (const fn of cleanups) { try { fn() } catch (e) { /* ignore */ } }
    cleanups = []

    // depth 计算
    app.depth = view.kind === 'home' ? 0 : Math.max(1, app.depth + (app._lastHash !== location.hash ? 1 : 0))
    if (view.kind === 'home') app.depth = 0
    app._lastHash = location.hash

    // 清空并挂载
    main.innerHTML = ''
    const rootEl = W.ui.viewRoot()
    main.appendChild(rootEl)

    const renderer = W.views[view.kind]
    try {
      if (renderer) {
        renderer(rootEl, view, {
          addCleanup: function (fn) { cleanups.push(fn) },
        })
      } else {
        rootEl.appendChild(W.ui.emptyState('info', '页面不存在', '返回首页继续学习', W.ui.btn('回首页', { variant: 'primary', onClick: function () { W.go('home') } })))
      }
    } catch (e) {
      console.error('view render error:', e)
      rootEl.innerHTML = ''
      rootEl.appendChild(W.ui.errorCard('页面渲染出错: ' + (e && e.message ? e.message : e)))
    }

    // 更新头部/底部 + 回到顶部
    W.renderHeader()
    window.scrollTo({ top: 0 })
  }

  // ---------- 启动 ----------
  function boot() {
    if (!window.WGZX_DATA || !WGZX_DATA.subjects || WGZX_DATA.subjects.length === 0) {
      document.getElementById('main').innerHTML =
        '<div class="error-card" style="margin-top:20px">' + W.iconSvg('alert', 18) + '<div>数据加载失败: 未找到学科数据(data/*.js)。请确认解压时保留了完整目录结构。</div></div>'
      return
    }

    // 旧版 React PWA 的 Service Worker 会缓存旧页面: 静态版一律注销, 避免命中旧缓存
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        for (const r of regs) r.unregister()
      }).catch(function () {})
      if (window.caches && caches.keys) {
        caches.keys().then(function (keys) {
          for (const k of keys) caches.delete(k)
        }).catch(function () {})
      }
    }

    // 深链兼容: 旧版 PWA 快捷方式 ?view=quiz → hash 路由
    const q = new URLSearchParams(location.search).get('view')
    if (q && ['review', 'quiz', 'wrongbook', 'stats', 'paper', 'recite', 'textbook', 'favorites'].indexOf(q) >= 0) {
      location.replace(location.pathname + '#/' + q)
    }

    W.startTimeTracker()
    W.ai.initPanel()
    W.renderFooter()

    window.addEventListener('hashchange', app.render)
    app.render()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
