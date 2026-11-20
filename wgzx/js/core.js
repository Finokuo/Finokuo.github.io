// 温故知新静态版 · 核心命名空间与工具
// 兼容 file:// 直开: 全部经典脚本, 挂在 window.W 上, 无模块/无 fetch 依赖
;(function () {
  'use strict'

  const W = (window.W = window.W || {})

  W.VERSION = '1.0.0-static'

  // ---------- 基础工具 ----------
  W.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  W.cls = function () {
    const out = []
    for (let i = 0; i < arguments.length; i++) {
      const a = arguments[i]
      if (!a) continue
      if (typeof a === 'string') out.push(a)
      else if (Array.isArray(a)) out.push(W.cls.apply(null, a))
      else if (typeof a === 'object') for (const k in a) if (a[k]) out.push(k)
    }
    return out.join(' ')
  }

  /** 创建 DOM 元素: W.h('div', {class:'x', onclick: fn, html:'<b>'}, child1, child2) */
  W.h = function (tag, attrs) {
    const el = document.createElement(tag)
    if (attrs) {
      for (const key in attrs) {
        const val = attrs[key]
        if (val == null || val === false) continue
        if (key === 'class') el.className = val
        else if (key === 'html') el.innerHTML = val // 仅用于内部拼好的可信 HTML
        else if (key === 'text') el.textContent = val
        else if (key === 'style' && typeof val === 'object') Object.assign(el.style, val)
        else if (key === 'dataset' && typeof val === 'object') for (const d in val) el.dataset[d] = val[d]
        else if (key.slice(0, 2) === 'on' && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val)
        else if (val === true) el.setAttribute(key, '')
        else el.setAttribute(key, val)
      }
    }
    for (let i = 2; i < arguments.length; i++) W.append(el, arguments[i])
    return el
  }

  W.append = function (parent) {
    for (let i = 1; i < arguments.length; i++) {
      const c = arguments[i]
      if (c == null || c === false) continue
      if (Array.isArray(c)) { for (const cc of c) W.append(parent, cc); continue }
      parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c)
    }
    return parent
  }

  W.$ = function (sel, root) { return (root || document).querySelector(sel) }
  W.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)) }

  W.debounce = function (fn, ms) {
    let t = null
    return function () {
      const args = arguments
      clearTimeout(t)
      t = setTimeout(function () { fn.apply(null, args) }, ms)
    }
  }

  W.seededRandom = function (str) {
    let h = 7
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 99991
    return h
  }

  /** 上海时区日期 YYYY-MM-DD */
  W.shanghaiDateStr = function (date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date || new Date())
  }

  W.todayStr = function () {
    const d = new Date()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return d.getFullYear() + '-' + m + '-' + day
  }

  W.fmtMinutes = function (mins) {
    mins = Math.max(0, Math.round(mins || 0))
    if (mins < 60) return mins + ' 分钟'
    return Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分'
  }

  W.fmtDate = function (ts) {
    const d = new Date(ts)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }

  W.fmtDateTime = function (ts) {
    const d = new Date(ts)
    return W.fmtDate(ts) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  }

  W.diffLabel = { 1: '基础', 2: '中等', 3: '较难' }
  W.typeLabel = { core: '课内', extension: '拓展' }

  // ---------- 图标(内联 SVG, lucide 风格 24x24 stroke) ----------
  const ICONS = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'book-open-check': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/><path d="m6 9 2 2 4-4"/>',
    'book-x': '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="m9.5 8 5 5"/><path d="m14.5 8-5 5"/>',
    'book-marked': '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="m10 12 2 2 4-4"/>',
    sigma: '<path d="M18 7V4H6l6 8-6 8h12v-3"/>',
    languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    atom: '<circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/>',
    flask: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 18.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-8.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    landmark: '<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sparkles: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
    'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    circle: '<circle cx="12" cy="12" r="10"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    'clipboard-list': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    'bar-chart': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    printer: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    'volume-x': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.24a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.24a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.24a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.24a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414-4.414A2 2 0 0 1 7 6.172V2"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414 4.414A2 2 0 0 1 17 17.828V22"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus: '<path d="M5 12h14"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    graduation: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
    dice: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M16 8h.01"/><path d="M12 12h.01"/><path d="M8 16h.01"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  }

  /** 生成内联 SVG 图标元素 */
  W.icon = function (name, size, cls) {
    const path = ICONS[name] || ICONS.info
    const s = size || 18
    const el = document.createElement('span')
    el.className = 'ico ' + (cls || '')
    el.setAttribute('aria-hidden', 'true')
    el.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'
    el.style.display = 'inline-flex'
    el.style.flexShrink = '0'
    return el
  }

  W.iconSvg = function (name, size) {
    const path = ICONS[name] || ICONS.info
    const s = size || 18
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px">' + path + '</svg>'
  }

  // ---------- Toast ----------
  W.toast = function (msg, type, ms) {
    const root = document.getElementById('toast-root')
    if (!root) return
    const el = W.h('div', { class: 'toast ' + (type || '') }, W.icon(type === 'error' ? 'alert' : type === 'success' ? 'check-circle' : 'info', 16), msg)
    root.appendChild(el)
    setTimeout(function () {
      el.classList.add('out')
      setTimeout(function () { el.remove() }, 300)
    }, ms || 2600)
  }

  // ---------- 弹窗 ----------
  W.modal = function (opts) {
    const root = document.getElementById('modal-root')
    if (!root || !opts) return null
    const overlay = W.h('div', { class: 'modal-overlay', role: 'dialog', 'aria-modal': 'true' })
    const close = function () {
      overlay.remove()
      document.removeEventListener('keydown', onKey)
      if (opts.onClose) opts.onClose()
    }
    const onKey = function (e) { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close() })

    const foot = W.h('div', { class: 'modal-foot' })
    if (opts.onOk) {
      foot.appendChild(
        W.h('button', { class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), onclick: function () { const r = opts.onOk(); if (r !== false) close() } }, opts.okText || '确定'),
      )
    }
    if (opts.onOk || opts.cancelText !== null) {
      foot.appendChild(W.h('button', { class: 'btn btn-outline', onclick: close }, opts.cancelText || '取消'))
    }

    const modal = W.h(
      'div',
      { class: 'modal ' + (opts.wide ? 'wide' : '') },
      W.h('div', { class: 'modal-head' }, W.h('h3', {}, opts.title || ''), W.h('button', { class: 'icon-btn', 'aria-label': '关闭', onclick: close }, W.icon('x', 18))),
      W.h('div', { class: 'modal-body' }, opts.content || ''),
      foot.childElementCount ? foot : null,
    )
    overlay.appendChild(modal)
    root.appendChild(overlay)
    return { close: close, el: modal }
  }

  W.confirm = function (opts) {
    const body = W.h('div', {}, W.h('p', { class: 'muted', style: { lineHeight: '1.7' } }, opts.message || ''))
    return W.modal({ title: opts.title || '确认操作', content: body, onOk: opts.onOk, okText: opts.okText, danger: opts.danger, wide: false })
  }
})()
