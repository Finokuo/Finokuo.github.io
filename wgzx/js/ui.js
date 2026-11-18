// 温故知新静态版 · 共享 UI 组件(全部视图从这里取组件, 保证视觉一致)
;(function () {
  'use strict'

  const W = window.W
  const ui = (W.ui = {})

  // ---------- 基础 ----------
  ui.btn = function (text, opts) {
    opts = opts || {}
    const el = W.h('button', {
      class: W.cls('btn', opts.variant ? 'btn-' + opts.variant : 'btn-primary', opts.size ? 'btn-' + opts.size : '', opts.class),
      onclick: opts.onClick,
      disabled: opts.disabled || null,
      title: opts.title || null,
      type: opts.type || 'button',
    })
    if (opts.icon) el.appendChild(W.icon(opts.icon, opts.iconSize || 16))
    if (text) el.appendChild(document.createTextNode(text))
    return el
  }

  ui.iconBtn = function (name, opts) {
    opts = opts || {}
    return W.h(
      'button',
      {
        class: W.cls('icon-btn', opts.class),
        onclick: opts.onClick,
        title: opts.title || '',
        'aria-label': opts.title || name,
        disabled: opts.disabled || null,
      },
      W.icon(opts.onIcon && opts.on ? opts.onIcon : name, opts.size || 18),
    )
  }

  ui.badge = function (text, variant) {
    return W.h('span', { class: W.cls('badge', variant ? 'badge-' + variant : 'badge-soft') }, text)
  }

  ui.progress = function (pct, color, large) {
    pct = Math.max(0, Math.min(100, pct || 0))
    return W.h(
      'div',
      { class: W.cls('progress', large ? 'progress-lg' : ''), role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      W.h('div', { style: { width: pct + '%', background: color || 'var(--primary)' } }),
    )
  }

  // ---------- 学科 ----------
  const SUBJECT_ICON_FALLBACK = { BookOpen: 'book-open', Sigma: 'sigma', Languages: 'languages', Atom: 'atom', FlaskConical: 'flask', Leaf: 'leaf', Landmark: 'landmark', Globe: 'globe', Scale: 'scale' }

  ui.subjectIcon = function (subject, size) {
    size = size || 22
    const name = SUBJECT_ICON_FALLBACK[subject.icon] || 'book-open'
    return W.h(
      'div',
      { class: 'subject-icon', style: { background: subject.color, width: (size + 14) + 'px', height: (size + 14) + 'px', borderRadius: Math.round((size + 14) / 3) + 'px' } },
      W.icon(name, size),
    )
  }

  ui.subjectChip = function (subject) {
    return W.h(
      'span',
      { class: 'subject-chip', style: { background: subject.color } },
      W.icon(SUBJECT_ICON_FALLBACK[subject.icon] || 'book-open', 12, 'ico'),
      subject.name,
    )
  }

  ui.diffBadge = function (d) {
    const map = { 1: ['基础', 'badge-success'], 2: ['中等', 'badge-warning'], 3: ['较难', 'badge-danger'] }
    const m = map[d] || map[1]
    return W.h('span', { class: 'badge ' + m[1] }, m[0])
  }

  ui.typeBadge = function (type) {
    return type === 'extension' ? ui.badge('拓展', 'badge-info') : ui.badge('课内', 'badge-primary')
  }

  ui.tagChips = function (tags, max) {
    return W.h(
      'div',
      { class: 'row-wrap', style: { gap: '5px' } },
      (tags || []).slice(0, max || 4).map(function (t) { return W.h('span', { class: 'badge badge-soft' }, t) }),
    )
  }

  // ---------- 布局组件 ----------
  ui.sectionTitle = function (icon, text, more) {
    const head = W.h('div', { class: 'section-head' }, W.h('h2', { class: 'section-title' }, W.icon(icon, 18), text))
    if (more) head.appendChild(more)
    return head
  }

  ui.emptyState = function (icon, title, hint, action) {
    return W.h(
      'div',
      { class: 'empty-state' },
      W.h('div', { class: 'ico-wrap' }, W.icon(icon, 28)),
      W.h('h3', {}, title),
      hint ? W.h('p', {}, hint) : null,
      action || null,
    )
  }

  ui.errorCard = function (msg, retry) {
    const el = W.h('div', { class: 'error-card' }, W.icon('alert', 18), W.h('div', { class: 'flex-1' }, msg))
    if (retry) el.appendChild(W.h('div', {}, retry))
    return el
  }

  ui.card = function () {
    const kids = []
    let cls = 'card'
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i]
      if (a && a.__cls) { cls += ' ' + a.__cls; continue }
      kids.push(a)
    }
    return W.h.apply(null, ['div', { class: cls }].concat(kids))
  }
  // card('...', {__cls: 'card-hover'}) 语法糖
  ui.cardCls = function (cls) { return { __cls: cls } }

  ui.skeleton = function (h, w) {
    return W.h('div', { class: 'skeleton', style: { height: (h || 60) + 'px', width: w || '100%' } })
  }

  // ---------- 知识点操作(已学/收藏) ----------
  ui.kpActions = function (uid, onChange) {
    const wrap = W.h('div', { class: 'kp-actions' })
    function render() {
      wrap.innerHTML = ''
      const learned = uid in W.store.learned
      const fav = uid in W.store.favorites
      const btnLearn = W.h(
        'button',
        {
          class: W.cls('icon-btn', learned && 'on-learned'),
          title: learned ? '标记为未学' : '标记为已学',
          'aria-label': learned ? '标记为未学' : '标记为已学',
          onclick: function () { W.toggleLearned(uid); W.toast(learned ? '已标记为未学' : '已标记为已学', 'success', 1400) },
        },
        W.icon(learned ? 'check-circle' : 'circle', 18),
      )
      const btnFav = W.h(
        'button',
        {
          class: W.cls('icon-btn', fav && 'on-fav'),
          title: fav ? '取消收藏' : '收藏',
          'aria-label': fav ? '取消收藏' : '收藏',
          onclick: function () { W.toggleFavorite(uid); W.toast(fav ? '已取消收藏' : '已收藏', 'success', 1400) },
        },
        W.icon('heart', 18),
      )
      wrap.appendChild(btnLearn)
      wrap.appendChild(btnFav)
    }
    render()
    if (onChange !== false) {
      // 跟随全局状态变化(其他页面改动时同步)
      const unsub = W.storeSubscribe(function () { render() })
      const cleanup = wrap.closest('.view') && wrap.closest('.view').__cleanups
      if (cleanup) cleanup.push(unsub)
      else wrap.__unsub = unsub
    }
    return wrap
  }

  // ---------- 知识点卡片(列表通用) ----------
  ui.kpCard = function (ctx, opts) {
    opts = opts || {}
    const kp = ctx.kp
    const q = opts.highlight
    // 高亮串含 <mark>, 须经 html 属性注入(highlight 内部已先做转义, 注入安全); 其余一律文本节点
    const title = W.h('div', {
      class: 'kp-card-title',
      onclick: function () { W.go('kp', { uid: kp.uid }) },
      html: q ? W.data.highlight(kp.title, q) : W.esc(kp.title),
    })
    const snippetText = opts.snippet || kp.content.slice(0, 80) + (kp.content.length > 80 ? '…' : '')
    const snippet = W.h('div', {
      class: 'kp-card-snippet',
      html: q ? W.data.highlight(snippetText, q) : W.esc(snippetText),
    })
    return W.h(
      'div',
      { class: 'card card-hover kp-card' },
      W.h('div', { class: 'kp-card-head' }, title, ui.kpActions(kp.uid, opts.noWatch)),
      snippet,
      W.h(
        'div',
        { class: 'kp-card-foot' },
        ui.subjectChip(ctx.subject),
        ui.typeBadge(kp.type),
        ui.diffBadge(kp.difficulty),
        ui.tagChips(kp.tags, 3),
      ),
    )
  }

  // ---------- 倒计时 ----------
  W.defaultExamDate = function () {
    const now = new Date()
    let y = now.getFullYear()
    // 中考: 6 月中旬(以 6 月 14 日为参考)
    let exam = new Date(y, 5, 14)
    if (now > exam) exam = new Date(y + 1, 5, 14)
    const ey = exam.getFullYear()
    const m = String(exam.getMonth() + 1).padStart(2, '0')
    const d = String(exam.getDate()).padStart(2, '0')
    return ey + '-' + m + '-' + d
  }

  W.daysUntil = function (dateStr) {
    if (!dateStr) return null
    const parts = dateStr.split('-').map(Number)
    const target = new Date(parts[0], parts[1] - 1, parts[2])
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return Math.round((target - today) / 86400000)
  }

  // ---------- 学习时长追踪(可见每满 1 分钟计入) ----------
  W.startTimeTracker = function () {
    let seconds = 0
    setInterval(function () {
      if (document.visibilityState === 'visible') {
        seconds++
        if (seconds >= 60) {
          seconds = 0
          W.addActivityMinutes(1)
        }
      }
    }, 1000)
  }

  // ---------- 视图容器(供 router 与 store 重渲染联动) ----------
  ui.viewRoot = function () {
    const el = W.h('div', { class: 'view view-enter' })
    el.__cleanups = []
    return el
  }
})()
