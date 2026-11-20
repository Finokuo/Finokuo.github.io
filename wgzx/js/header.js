// 温故知新静态版 · 顶部导航(返回/Logo/主导航/搜索/AI/移动菜单)
;(function () {
  'use strict'

  const W = window.W

  // ---------- FuoTool 返回地址(已写入代码) ----------
  // 本站并入 FuoTool 后, 「返回 FuoTool」按钮跳转到这里。
  var FUOTOOL_URL = 'https://finokuo.github.io/'

  function goFuotool() {
    window.location.href = FUOTOOL_URL
  }

  const NAV_ITEMS = [
    { key: 'home', label: '首页', icon: 'home', hash: '#/' },
    { key: 'textbook', label: '课本', icon: 'book-open', hash: '#/textbook' },
    { key: 'quiz', label: '出题', icon: 'clipboard-list', hash: '#/quiz' },
    { key: 'review', label: '复习', icon: 'layers', hash: '#/review' },
    { key: 'recite', label: '背诵', icon: 'book-open-check', hash: '#/recite' },
    { key: 'wrongbook', label: '错题本', icon: 'book-x', hash: '#/wrongbook' },
    { key: 'stats', label: '统计', icon: 'bar-chart', hash: '#/stats' },
    { key: 'favorites', label: '收藏', icon: 'heart', hash: '#/favorites' },
  ]

  let searchInput = null

  function navigate(hash) {
    if (location.hash === hash) {
      W.app.render()
    } else {
      location.hash = hash
    }
  }

  function submitSearch(q) {
    q = (q || '').trim()
    if (!q) return
    navigate('#/search/' + encodeURIComponent(q))
  }

  W.renderHeader = function () {
    const root = document.getElementById('site-header')
    if (!root) return
    const view = W.app.current()

    const canBack = W.app.depth > 0

    const brand = W.h(
      'div',
      {
        class: 'brand',
        onclick: function () { navigate('#/') },
        onkeydown: function (e) { if (e.key === 'Enter') navigate('#/') },
        role: 'link',
        tabindex: 0,
        'aria-label': '回到首页',
      },
      W.h('div', { class: 'brand-seal' }, '温'),
      W.h('div', {}, W.h('span', {}, '温故知新'), W.h('span', { class: 'brand-sub' }, '初中全科复习')),
    )

    const backBtn = W.h(
      'button',
      {
        class: 'icon-btn',
        title: '返回',
        'aria-label': '返回上一页',
        disabled: !canBack || null,
        onclick: function () { W.app.back() },
      },
      W.icon('arrow-left', 19),
    )

    // 桌面导航
    const nav = W.h('nav', { class: 'nav', 'aria-label': '主导航' })
    for (const item of NAV_ITEMS.slice(0, 7)) {
      const active = W.app.matchesNav(view, item.key)
      nav.appendChild(
        W.h('button', { class: W.cls('nav-link', active && 'active'), onclick: function () { navigate(item.hash) } }, item.label),
      )
    }

    // 搜索框(桌面)
    const searchWrap = W.h(
      'div',
      { class: 'header-search desktop-only' },
      W.h('span', { class: 'search-ico' }, W.icon('search', 15)),
      (searchInput = W.h('input', {
        type: 'search',
        placeholder: '搜索知识点…',
        'aria-label': '搜索知识点',
        onkeydown: function (e) { if (e.key === 'Enter') submitSearch(searchInput.value) },
      })),
    )

    // 返回 FuoTool(桌面顶栏; 移动端收进菜单, 见 .mobile-exit)
    const fuotoolBtn = W.h(
      'button',
      {
        class: 'btn btn-outline btn-sm fuotool-btn',
        title: '返回 FuoTool',
        'aria-label': '返回 FuoTool 主页',
        onclick: goFuotool,
      },
      W.icon('external-link', 15),
      W.h('span', {}, 'FuoTool'),
    )
    fuotoolBtn.style.height = '36px'

    // AI 按钮
    const aiBtn = W.h(
      'button',
      {
        class: 'btn btn-primary btn-sm',
        onclick: function () { W.ai.openPanel() },
        title: '小知 AI 助手',
      },
      W.icon('sparkles', 15),
      W.h('span', { class: 'ai-btn-label' }, 'AI 助手'),
    )
    aiBtn.style.height = '36px'

    // 移动菜单按钮(开合均有动画: 面板渐开 + 图标变叉, 见 css .mobile-menu / .menu-toggle)
    const menu = W.h('div', { class: 'mobile-menu' })
    const menuInner = W.h('div', { class: 'mobile-menu-inner' })
    menu.appendChild(menuInner)

    function closeMenu() {
      menu.classList.remove('open')
      menuBtn.classList.remove('open')
      menuBtn.setAttribute('aria-label', '打开菜单')
      menuBtn.setAttribute('aria-expanded', 'false')
    }
    const menuBtn = W.h(
      'button',
      {
        class: 'icon-btn menu-toggle',
        title: '菜单',
        'aria-label': '打开菜单',
        'aria-expanded': 'false',
        onclick: function () {
          const open = menu.classList.toggle('open')
          menuBtn.classList.toggle('open', open)
          menuBtn.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单')
          menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false')
        },
      },
      W.icon('menu', 20),
    )

    // 移动菜单
    const mSearch = W.h(
      'div',
      { class: 'header-search' },
      W.h('span', { class: 'search-ico' }, W.icon('search', 15)),
      W.h('input', {
        type: 'search',
        placeholder: '搜索知识点…',
        'aria-label': '搜索知识点',
        onkeydown: function (e) {
          if (e.key === 'Enter') {
            submitSearch(e.target.value)
            closeMenu()
          }
        },
      }),
    )
    const mNav = W.h('nav', { 'aria-label': '移动端导航' })
    for (const item of NAV_ITEMS) {
      const active = W.app.matchesNav(view, item.key)
      mNav.appendChild(
        W.h(
          'button',
          {
            class: W.cls('mobile-nav-item', active && 'active'),
            onclick: function () {
              closeMenu()
              navigate(item.hash)
            },
          },
          W.icon(item.icon, 18),
          item.label,
        ),
      )
    }
    // 返回 FuoTool(移动菜单首项, 通栏)
    const mExit = W.h(
      'button',
      {
        class: 'mobile-exit',
        onclick: function () {
          closeMenu()
          goFuotool()
        },
      },
      W.icon('external-link', 16),
      '返回 FuoTool',
    )
    menuInner.appendChild(mSearch)
    menuInner.appendChild(mExit)
    menuInner.appendChild(mNav)

    const inner = W.h(
      'div',
      { class: 'header-inner' },
      W.h('div', { class: 'header-side' }, backBtn, brand),
      W.h('div', { class: 'header-side right' }, nav, searchWrap, fuotoolBtn, aiBtn, menuBtn),
    )

    root.innerHTML = ''
    root.appendChild(inner)
    root.appendChild(menu)
  }
})()
