// 温故知新静态版 · 学习进度状态(与 React 版共用 localStorage key "wengu-progress-v1")
// 迁移规则: 原版是 zustand persist, 存储形状为 { state: {...}, version: 0 } —— 这里保持一致,
// 旧用户的学习进度/错题本/背诵打卡/连击天数在静态版中无缝延续。
;(function () {
  'use strict'

  const W = window.W

  const KEY = 'wengu-progress-v1'

  // ---------- SRS 间隔重复(Leitner 盒子) ----------
  const SRS_INTERVALS = { 1: 10 * 60 * 1000, 2: 8 * 60 * 60 * 1000, 3: 24 * 60 * 60 * 1000, 4: 3 * 24 * 60 * 60 * 1000, 5: 7 * 24 * 60 * 60 * 1000 }
  const SRS_MAX_INTERVAL = 14 * 24 * 60 * 60 * 1000

  W.nextSRSCard = function (prev, rating, now) {
    now = now || Date.now()
    const box = (prev && prev.box) || 1
    if (rating === 'good') {
      const nextBox = Math.min(5, box + 1)
      const interval = nextBox === 5 && box === 5 ? SRS_MAX_INTERVAL : SRS_INTERVALS[nextBox]
      return { box: nextBox, due: now + interval, lastAt: now }
    }
    if (rating === 'fuzzy') {
      const interval = Math.max(10 * 60 * 1000, Math.round(SRS_INTERVALS[box] / 2))
      return { box: box, due: now + interval, lastAt: now }
    }
    return { box: 1, due: now + SRS_INTERVALS[1], lastAt: now }
  }

  W.selectDueUids = function (srs, now) {
    now = now || Date.now()
    return Object.keys(srs || {})
      .filter(function (uid) { return srs[uid].due <= now })
      .sort(function (a, b) { return srs[a].due - srs[b].due })
  }

  /** 错题稳定 id: FNV-1a x2(与 React 版一致, 同题跨端幂等) */
  W.wrongQuestionId = function (subject, qType, stem) {
    const src = subject + '|' + qType + '|' + stem
    let h1 = 0x811c9dc5
    let h2 = 0x01000193
    for (let i = 0; i < src.length; i++) {
      const c = src.charCodeAt(i)
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0
      h2 ^= c + i; h2 = Math.imul(h2, 0x85ebca6b) >>> 0
    }
    return 'wq-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
  }

  // ---------- 填空题判分归一化(与 React 版一致) ----------
  W.normalizeFillAnswer = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[。．.;；]+$/g, '')
      .trim()
  }

  function fillEquals(user, correct) {
    const u = W.normalizeFillAnswer(user)
    const c = W.normalizeFillAnswer(correct)
    if (!u) return false
    if (u === c) return true
    const cParts = correct.split(/[；;/]/).map(W.normalizeFillAnswer).filter(Boolean)
    if (cParts.length > 1) {
      const uParts = user.split(/[；;/]/).map(W.normalizeFillAnswer).filter(Boolean)
      return uParts.length === cParts.length && uParts.every(function (p, i) { return p === cParts[i] })
    }
    return false
  }

  /** 判题: qType 选择/填空/大题; picked 选项下标; written 文本 */
  W.gradeQuestion = function (qType, q, picked, written) {
    if (qType === '选择') {
      if (q.options && q.options.length === 4) {
        if (picked === undefined || picked === null) return 'unanswered'
        return ['A', 'B', 'C', 'D'][picked] === q.answer ? 'correct' : 'wrong'
      }
      if (!written || !written.trim()) return 'unanswered'
      return fillEquals(written, q.answer) ? 'correct' : 'wrong'
    }
    if (qType === '填空') {
      if (!written || !written.trim()) return 'unanswered'
      return fillEquals(written, q.answer) ? 'correct' : 'wrong'
    }
    return 'self'
  }

  // ---------- Store ----------
  const store = {
    learned: {},
    favorites: {},
    ratings: {},
    srs: {},
    kpUpdated: {},
    wrongQuestions: {},
    activityDays: {},
    recitations: {},
    settings: {},
    lastStudyDate: null,
    streak: 0,
  }

  const listeners = []
  let saveTimer = null

  function load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const s = parsed && parsed.state ? parsed.state : parsed
      if (!s || typeof s !== 'object') return
      for (const k of ['learned', 'favorites', 'ratings', 'srs', 'kpUpdated', 'wrongQuestions', 'activityDays', 'recitations', 'settings']) {
        if (s[k] && typeof s[k] === 'object') store[k] = s[k]
      }
      if (typeof s.lastStudyDate === 'string') store.lastStudyDate = s.lastStudyDate
      if (typeof s.streak === 'number') store.streak = s.streak
    } catch (e) { /* 数据损坏时静默重置 */ }
  }

  function save() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(function () {
      try {
        // 保持 zustand persist 形状, 双向兼容
        localStorage.setItem(KEY, JSON.stringify({ state: store, version: 0 }))
      } catch (e) { /* 存储满时忽略 */ }
    }, 120)
  }

  function emit() {
    for (const fn of listeners) {
      try { fn() } catch (e) { console.error(e) }
    }
  }

  W.store = store

  W.storeSubscribe = function (fn) {
    listeners.push(fn)
    return function () {
      const i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    }
  }

  function yesterdayStr() {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return d.getFullYear() + '-' + m + '-' + day
  }

  function touchStreak() {
    const today = W.todayStr()
    if (store.lastStudyDate === today) return
    store.streak = store.lastStudyDate === yesterdayStr() ? store.streak + 1 : 1
    store.lastStudyDate = today
  }

  function bumpActivity(kind, n) {
    n = n || 1
    const today = W.todayStr()
    const cur = store.activityDays[today] || { minutes: 0, kps: 0, quizzes: 0, recites: 0, recalls: 0 }
    cur[kind] = (cur[kind] || 0) + n
    store.activityDays[today] = cur
    touchStreak()
  }

  W.bumpActivity = bumpActivity

  W.toggleLearned = function (uid) {
    const now = Date.now()
    if (uid in store.learned) delete store.learned[uid]
    else { store.learned[uid] = now; bumpActivity('kps') }
    store.kpUpdated[uid] = now
    save(); emit()
  }

  W.toggleFavorite = function (uid) {
    const now = Date.now()
    if (uid in store.favorites) delete store.favorites[uid]
    else store.favorites[uid] = now
    store.kpUpdated[uid] = now
    save(); emit()
  }

  W.setRating = function (uid, rating) {
    store.ratings[uid] = rating
    store.kpUpdated[uid] = Date.now()
    save(); emit()
  }

  /** 主动复习: 自评 + SRS 推进 + 主动回忆计数 */
  W.reviewKP = function (uid, rating) {
    const now = Date.now()
    store.ratings[uid] = rating
    store.srs[uid] = W.nextSRSCard(store.srs[uid], rating, now)
    store.kpUpdated[uid] = now
    if (rating === 'good' && !(uid in store.learned)) { store.learned[uid] = now; bumpActivity('kps') }
    bumpActivity('recalls')
    save(); emit()
  }

  W.addWrongQuestion = function (q) {
    const now = Date.now()
    const id = q.id || W.wrongQuestionId(q.subject, q.qType, q.stem)
    const existing = store.wrongQuestions[id]
    if (existing) {
      existing.userAnswer = q.userAnswer
      existing.wrongCount = (existing.wrongCount || 1) + 1
      existing.lastWrongAt = now
      existing.updatedAt = now
    } else {
      store.wrongQuestions[id] = {
        id: id,
        subject: q.subject,
        topic: q.topic || '',
        qType: q.qType,
        difficulty: q.difficulty || '中等',
        stem: q.stem,
        options: q.options,
        figure: q.figure,
        answer: q.answer,
        analysis: q.analysis,
        userAnswer: q.userAnswer || '',
        wrongCount: 1,
        resolved: false,
        createdAt: q.createdAt || now,
        lastWrongAt: now,
        updatedAt: now,
      }
    }
    touchStreak()
    save(); emit()
    return id
  }

  W.setWrongResolved = function (id, resolved) {
    const cur = store.wrongQuestions[id]
    if (!cur) return
    cur.resolved = resolved
    cur.updatedAt = Date.now()
    save(); emit()
  }

  W.removeWrongQuestion = function (id) {
    delete store.wrongQuestions[id]
    save(); emit()
  }

  W.addActivityMinutes = function (minutes) {
    if (!minutes || minutes <= 0) return
    const today = W.todayStr()
    const cur = store.activityDays[today] || { minutes: 0, kps: 0, quizzes: 0, recites: 0, recalls: 0 }
    cur.minutes = (cur.minutes || 0) + minutes
    store.activityDays[today] = cur
    touchStreak()
    save(); emit()
  }

  W.setRecitation = function (itemId, patch) {
    const cur = store.recitations[itemId] || { itemId: itemId, status: 'todo', checkins: [], updatedAt: 0 }
    for (const k in patch) cur[k] = patch[k]
    cur.itemId = itemId
    cur.updatedAt = Date.now()
    store.recitations[itemId] = cur
    touchStreak()
    save(); emit()
  }

  W.checkinRecitation = function (itemId) {
    const cur = store.recitations[itemId] || { itemId: itemId, status: 'todo', checkins: [], updatedAt: 0 }
    const today = W.todayStr()
    if ((cur.checkins || []).indexOf(today) >= 0) return false
    if (cur.status === 'todo') cur.status = 'learning'
    cur.checkins = (cur.checkins || []).concat([today]).sort()
    cur.updatedAt = Date.now()
    store.recitations[itemId] = cur
    bumpActivity('recites')
    save(); emit()
    return true
  }

  W.setSettings = function (patch) {
    for (const k in patch) store.settings[k] = patch[k]
    store.settings.settingsAt = Date.now()
    save(); emit()
  }

  /** 错题选择器: 未攻克(按最近错误时间倒序) / 已攻克 */
  W.selectPendingWrong = function () {
    return Object.keys(store.wrongQuestions)
      .map(function (id) { return store.wrongQuestions[id] })
      .filter(function (q) { return !q.resolved })
      .sort(function (a, b) { return b.lastWrongAt - a.lastWrongAt })
  }

  W.selectResolvedWrong = function () {
    return Object.keys(store.wrongQuestions)
      .map(function (id) { return store.wrongQuestions[id] })
      .filter(function (q) { return q.resolved })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt })
  }

  load()
})()
