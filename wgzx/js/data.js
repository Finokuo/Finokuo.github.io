// 温故知新静态版 · 数据访问层(对 WGZX_DATA 建索引, 全部本地内存查询)
;(function () {
  'use strict'

  const W = window.W

  const GRADE_ORDER = ['七年级上册', '七年级下册', '八年级上册', '八年级下册', '九年级上册', '九年级下册', '中考专题']

  const data = {
    subjects: [], // 排序后的学科元数据(含 chapters 引用)
    bySlug: {},
    kpIndex: new Map(), // uid -> { kp, chapter, subject, prevUid, nextUid }
    allKps: [], // 全部知识点上下文, 学科序→章节序
    totalKp: 0,
    totalChapters: 0,
    gradeOrder: GRADE_ORDER,
  }

  function gradeRank(grade) {
    const i = GRADE_ORDER.indexOf(grade)
    return i < 0 ? 99 : i
  }

  function build() {
    const raw = (window.WGZX_DATA && window.WGZX_DATA.subjects) || []
    const sorted = raw.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0) })
    data.subjects = sorted
    data.totalKp = 0
    data.totalChapters = 0
    for (const s of sorted) {
      data.bySlug[s.slug] = s
      data.totalChapters += (s.chapters || []).length
      // 章节按年级序重排(与原站一致)
      s.chapters.sort(function (a, b) {
        const g = gradeRank(a.grade) - gradeRank(b.grade)
        return g !== 0 ? g : (a.order || 0) - (b.order || 0)
      })
      let prev = null
      for (const ch of s.chapters) {
        for (const kp of ch.kps) {
          const ctx = { kp: kp, chapter: ch, subject: s, prevUid: prev ? prev.uid : null, nextUid: null }
          if (prev) data.kpIndex.get(prev.uid).nextUid = kp.uid
          data.kpIndex.set(kp.uid, ctx)
          data.allKps.push(ctx)
          prev = kp
          data.totalKp++
        }
      }
    }
  }

  // ---------- 学科/章节/知识点 ----------
  W.data = data

  W.data.getSubject = function (slug) { return data.bySlug[slug] || null }

  W.data.getChapter = function (uid) {
    for (const s of data.subjects) {
      for (const ch of s.chapters) if (ch.uid === uid) return { chapter: ch, subject: s }
    }
    return null
  }

  W.data.getKP = function (uid) { return data.kpIndex.get(uid) || null }

  W.data.chapterKPCount = function (ch) { return (ch.kps || []).length }

  /** 学习进度百分比(某学科/章节) */
  W.data.learnedCount = function (kps) {
    let n = 0
    for (const kp of kps) if (kp.uid in W.store.learned) n++
    return n
  }

  // ---------- 搜索(标题 > 标签 > 内容) ----------
  W.data.search = function (q, slug) {
    q = (q || '').trim()
    if (!q) return []
    const ql = q.toLowerCase()
    const out = []
    for (const ctx of data.allKps) {
      if (slug && ctx.subject.slug !== slug) continue
      const inTitle = ctx.kp.title.toLowerCase().indexOf(ql) >= 0
      const inTags = ctx.kp.tags.some(function (t) { return t.toLowerCase().indexOf(ql) >= 0 })
      const inContent = ctx.kp.content.toLowerCase().indexOf(ql) >= 0
      if (!inTitle && !inTags && !inContent) continue
      let snippet = ''
      if (inContent) {
        const idx = ctx.kp.content.toLowerCase().indexOf(ql)
        const start = Math.max(0, idx - 24)
        snippet = (start > 0 ? '…' : '') + ctx.kp.content.slice(start, idx + q.length + 40) + (idx + q.length + 40 < ctx.kp.content.length ? '…' : '')
      } else {
        snippet = ctx.kp.content.slice(0, 76) + '…'
      }
      out.push({ kp: ctx.kp, chapter: ctx.chapter, subject: ctx.subject, snippet: snippet, inTitle: inTitle })
      if (out.length >= 60) break
    }
    // 标题命中优先, 其余按难度
    out.sort(function (a, b) {
      if (a.inTitle !== b.inTitle) return a.inTitle ? -1 : 1
      return a.kp.difficulty - b.kp.difficulty
    })
    return out
  }

  /** 片段高亮: 返回 HTML(内部已转义) */
  W.data.highlight = function (text, q) {
    const safe = W.esc(text)
    if (!q) return safe
    const eq = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return safe.replace(new RegExp('(' + eq + ')', 'gi'), '<mark>$1</mark>')
  }

  // ---------- 每日一学(确定性, 上海时区日期) ----------
  W.data.dailyItems = function (dateStr) {
    dateStr = dateStr || W.shanghaiDateStr()
    const total = data.allKps.length
    if (!total) return []
    const h = W.seededRandom(dateStr)
    const picks = [h % total]
    const b = (h * 7 + 13) % total
    const c = (h * 31 + 101) % total
    if (picks.indexOf(b) < 0) picks.push(b)
    if (picks.indexOf(c) < 0) picks.push(c)
    let fill = 0
    while (picks.length < Math.min(3, total)) {
      if (picks.indexOf(fill) < 0) picks.push(fill)
      fill++
    }
    return picks.map(function (i) { return data.allKps[i] })
  }

  // ---------- 随机知识点 ----------
  W.data.random = function (count, filter) {
    filter = filter || {}
    let pool = data.allKps
    if (filter.chapters && filter.chapters.length) {
      const set = new Set(filter.chapters)
      pool = pool.filter(function (c) { return set.has(c.chapter.uid) })
    } else if (filter.slugs && filter.slugs.length) {
      const set = new Set(filter.slugs)
      pool = pool.filter(function (c) { return set.has(c.subject.slug) })
    }
    if (filter.exclude && filter.exclude.length) {
      const set = new Set(filter.exclude)
      pool = pool.filter(function (c) { return !set.has(c.kp.uid) })
    }
    const shuffled = pool.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t
    }
    return shuffled.slice(0, count)
  }

  // ---------- 教材版本 ----------
  W.data.editions = function (slug) {
    const catalog = (window.WGZX_EDITIONS || []).find(function (e) { return e.slug === slug })
    return catalog ? catalog.editions : []
  }

  // ---------- 背诵目录 ----------
  W.data.reciteItems = function () { return window.WGZX_RECITE || [] }

  build()
})()
