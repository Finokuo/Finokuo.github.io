// 温故知新静态版 · 学习视图: 闪卡复习 / AI 出题 / 错题本 / 学习统计 / 组卷打印 / 背诵打卡
// 依赖: core.js / store.js / data.js / ui.js / ai.js (先加载); 经典脚本, 挂 window.W
;(function () {
  'use strict'

  const W = window.W
  if (!W.views) W.views = {}

  var LETTERS = ['A', 'B', 'C', 'D']
  var GOALS_DEFAULT = { kps: 5, quizzes: 3, recalls: 5 }

  // ================= 共享小工具 =================

  var spinKfReady = false
  function ensureSpinKF() {
    if (spinKfReady) return
    spinKfReady = true
    try {
      var st = document.createElement('style')
      st.id = 'wgzx-spin-kf'
      st.textContent = '@keyframes wgzx-spin { to { transform: rotate(360deg); } }'
      document.head.appendChild(st)
    } catch (e) { /* ignore */ }
  }

  function spinner(size) {
    ensureSpinKF()
    var el = W.icon('loader', size || 18)
    el.style.animation = 'wgzx-spin 0.9s linear infinite'
    return el
  }

  function pageHead(icon, title, sub) {
    return W.h(
      'div',
      { style: { marginBottom: '16px' } },
      W.h('h1', { class: 'section-title', style: { fontSize: '22px', margin: '0' } }, W.icon(icon, 20), title),
      sub ? W.h('p', { class: 'muted', style: { fontSize: '13.5px', marginTop: '5px', marginBottom: '0' } }, sub) : null,
    )
  }

  /** seg 选择组: items [{v,label}], 返回 el(带 getValue) */
  function segGroup(items, value, onChange) {
    var el = W.h('div', { class: 'seg', role: 'group' })
    var cur = value
    function paint() {
      for (var i = 0; i < el.children.length; i++) {
        var b = el.children[i]
        var on = b.__v === cur
        b.classList.toggle('active', on)
        b.setAttribute('aria-pressed', on ? 'true' : 'false')
      }
    }
    for (var i = 0; i < items.length; i++) {
      ;(function (it) {
        var b = W.h(
          'button',
          { class: 'seg-item', type: 'button', onclick: function () { cur = it.v; paint(); onChange(it.v) } },
          it.label,
        )
        b.__v = it.v
        el.appendChild(b)
      })(items[i])
    }
    paint()
    el.getValue = function () { return cur }
    return el
  }

  function fieldBlock(label, control, hint) {
    return W.h(
      'div',
      { class: 'field' },
      W.h('span', { class: 'field-label' }, label),
      control,
      hint ? W.h('span', { class: 'muted', style: { fontSize: '12px' } }, hint) : null,
    )
  }

  var MAX_QUESTIONS = 20

  /**
   * 数字步进器(高度自定义题量, 上限 20): [−] [输入框] [+]
   * opts: { get, set, min=1, max=20|fn(), label, onChange }
   * 返回元素带 .sync(): 外部数量变化后同步禁用态/显值(不重建 DOM, 不丢焦点)
   */
  function countStepper(opts) {
    var min = opts.min != null ? opts.min : 1
    function maxVal() { return typeof opts.max === 'function' ? opts.max() : (opts.max != null ? opts.max : MAX_QUESTIONS) }
    function clamp(v) {
      v = parseInt(v, 10)
      if (isNaN(v)) v = min
      return Math.max(min, Math.min(maxVal(), v))
    }
    var input = W.h('input', {
      type: 'number', class: 'input stepper-input', 'aria-label': opts.label || '数量',
      min: String(min), max: String(MAX_QUESTIONS), inputmode: 'numeric',
    })
    input.value = String(opts.get())
    var minusBtn = W.h('button', { class: 'stepper-btn', type: 'button', 'aria-label': '减少数量', onclick: function () { apply(opts.get() - 1) } }, W.icon('minus', 14))
    var plusBtn = W.h('button', { class: 'stepper-btn', type: 'button', 'aria-label': '增加数量', onclick: function () { apply(opts.get() + 1) } }, W.icon('plus', 14))

    function paint() {
      var cur = opts.get()
      if (document.activeElement !== input) input.value = String(cur)
      minusBtn.disabled = cur <= min || null
      plusBtn.disabled = cur >= maxVal() || null
    }
    function apply(v, fromTyping) {
      var c = clamp(v)
      if (c !== opts.get()) {
        opts.set(c)
        if (opts.onChange) opts.onChange(c)
      }
      if (fromTyping) {
        if (String(c) !== input.value) input.value = String(c)
      } else {
        input.value = String(c)
      }
      paint()
    }
    input.addEventListener('input', function () {
      if (input.value === '') return
      apply(parseInt(input.value, 10), true)
    })
    input.addEventListener('blur', function () { apply(input.value === '' ? min : parseInt(input.value, 10)) })

    var el = W.h('div', { class: 'stepper', role: 'group', 'aria-label': opts.label || '数量选择' }, minusBtn, input, plusBtn)
    el.sync = paint
    paint()
    return el
  }

  function subjectMap() {
    var m = {}
    for (var i = 0; i < W.data.subjects.length; i++) m[W.data.subjects[i].name] = W.data.subjects[i]
    return m
  }

  function gradeShort(g) {
    var map = { '七年级上册': '七上', '七年级下册': '七下', '八年级上册': '八上', '八年级下册': '八下', '九年级上册': '九上', '九年级下册': '九下' }
    return map[g] || g
  }

  function qTypeLabel(t) {
    return t === '选择' ? '选择题' : t === '填空' ? '填空题' : '大题'
  }

  function quizDiffBadge(d) {
    var map = { '简单': 'badge-success', '中等': 'badge-warning', '困难': 'badge-danger' }
    return W.h('span', { class: 'badge ' + (map[d] || 'badge-soft') }, d)
  }

  /** 配图 SVG 净化: 仅接受 <svg> 开头, 去除 script 与 on* 事件, 不合规则不渲染 */
  function safeFigure(svg) {
    if (!svg || typeof svg !== 'string') return null
    var t = svg.trim()
    if (!/^<svg[\s>]/i.test(t) || t.length > 12000) return null
    var s = t.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<\/?script[^>]*>/gi, '')
    s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    if (/<script/i.test(s) || /javascript:/i.test(s)) return null
    return s
  }

  function figureBox(svg) {
    var safe = safeFigure(svg)
    return safe ? W.h('div', { class: 'figure-box', html: safe, role: 'img', 'aria-label': '题目配图' }) : null
  }

  /** 章节多选(网格复选 chips), selected: Set(uid) */
  function chapterPicker(subject, selected) {
    var wrap = W.h('div', {
      style: {
        maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px',
        padding: '10px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '4px 12px', alignContent: 'start',
      },
    })
    if (!subject || !subject.chapters.length) {
      wrap.appendChild(W.h('span', { class: 'muted small' }, '该学科暂无章节数据'))
      return wrap
    }
    for (var i = 0; i < subject.chapters.length; i++) {
      ;(function (ch) {
        var cb = W.h('input', { type: 'checkbox' })
        cb.checked = selected.has(ch.uid)
        cb.addEventListener('change', function () {
          if (cb.checked) selected.add(ch.uid)
          else selected.delete(ch.uid)
        })
        wrap.appendChild(
          W.h('label', { class: 'checkbox-row', style: { fontSize: '12.5px', padding: '2px 0' } }, cb,
            W.h('span', { class: 'muted' }, gradeShort(ch.grade) + ' · ' + ch.name)),
        )
      })(subject.chapters[i])
    }
    return wrap
  }

  var BIG_CUSTOM = '__custom__'

  /** 大题题型的当前生效值(预设或自定义文本) */
  function effBigType(st) {
    return st.bigCustom ? (st.bigCustomText || '').trim() : (st.bigType || '')
  }

  /** 大题题型选择(预设/小知推荐/自定义输入) + 推荐理由行 */
  function bigTypeField(state, onSuggest) {
    var labels = state.suggestions.length
      ? state.suggestions.map(function (s) { return s.label })
      : W.bigqPresets(state.subject)
    if (!state.bigCustom && (!state.bigType || labels.indexOf(state.bigType) < 0)) state.bigType = labels[0] || ''
    var sel = W.h('select', { class: 'select', 'aria-label': '大题题型' })
    for (var i = 0; i < labels.length; i++) sel.appendChild(W.h('option', { value: labels[i] }, labels[i]))
    sel.appendChild(W.h('option', { value: BIG_CUSTOM }, '✎ 自定义题型…'))
    sel.value = state.bigCustom ? BIG_CUSTOM : state.bigType

    // 自定义题型输入行(切换显示, 不重渲染避免闪烁)
    var customRow = W.h('div', { class: 'row' },
      W.h('div', { class: 'flex-1' }, W.h('input', {
        class: 'input', maxlength: '24', placeholder: '输入自定义题型, 如「动点与最值综合」',
        value: state.bigCustomText, 'aria-label': '自定义大题题型',
      })),
    )
    var customInput = customRow.firstChild.firstChild
    customInput.addEventListener('input', function () { state.bigCustomText = customInput.value })
    function paintCustom(focus) {
      customRow.style.display = state.bigCustom ? '' : 'none'
      if (state.bigCustom && focus) customInput.focus()
    }
    sel.addEventListener('change', function () {
      if (sel.value === BIG_CUSTOM) state.bigCustom = true
      else {
        state.bigCustom = false
        state.bigType = sel.value
      }
      paintCustom(true)
    })
    paintCustom()

    var suggestBtn = W.ui.btn('小知推荐题型', { variant: 'outline', size: 'sm', icon: 'sparkles', onClick: function () { onSuggest(suggestBtn) } })
    var reason = null
    if (state.suggestions.length) {
      reason = W.h(
        'div',
        { class: 'muted', style: { fontSize: '12px', lineHeight: '1.6' } },
        state.suggestions.map(function (s) { return W.h('div', {}, '「' + s.label + '」 ' + (s.reason || '')) }),
      )
    }
    return W.h(
      'div',
      { class: 'field' },
      W.h('span', { class: 'field-label' }, '大题题型'),
      W.h('div', { class: 'row', style: { alignItems: 'flex-start' } }, W.h('div', { class: 'flex-1' }, sel), suggestBtn),
      customRow,
      reason,
    )
  }

  function dedupe(arr) {
    var out = [], seen = {}
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = true; out.push(arr[i]) }
    }
    return out
  }

  function noAiLine() {
    return W.h(
      'div',
      { class: 'small', style: { display: 'flex', gap: '6px', alignItems: 'center', background: 'var(--info-soft)', color: 'var(--info)', borderRadius: '10px', padding: '8px 12px' } },
      W.icon('info', 14),
      W.h('span', {}, '当前无 AI 服务, 将使用本机题库生成(题目来自知识点例题与要点)'),
    )
  }

  // ================= 1. 闪卡复习 =================

  W.views.review = function (rootEl, view, ctx) {
    var state = {
      phase: 'setup', // setup | study | done
      slug: '', count: 10, quick: false,
      deck: [], idx: 0, revealed: false, advancing: false,
      stats: { good: 0, fuzzy: 0, bad: 0 },
    }

    function summaryCard() {
      var learned = Object.keys(W.store.learned).length
      var favs = Object.keys(W.store.favorites).length
      var due = W.selectDueUids(W.store.srs).length
      function cell(num, label, icon, color) {
        return W.h(
          'div',
          { style: { flex: '1', minWidth: '110px', textAlign: 'center' } },
          W.h('div', { class: 'stat-num', style: color ? { color: color } : null }, String(num)),
          W.h('div', { class: 'stat-label', style: { justifyContent: 'center' } }, W.icon(icon, 13), label),
        )
      }
      return W.ui.card(
        W.h(
          'div',
          { class: 'row-wrap', style: { justifyContent: 'space-around' } },
          cell(due, '今日到期复习', 'hourglass', 'var(--danger)'),
          cell(learned, '已学知识点', 'check-circle'),
          cell(favs, '收藏', 'heart'),
          cell(W.store.streak, '连续学习天数', 'flame', 'var(--warning)'),
        ),
      )
    }

    function startSession() {
      var dueUids = W.selectDueUids(W.store.srs)
      var items = [], seen = {}
      for (var i = 0; i < dueUids.length && items.length < state.count; i++) {
        var c = W.data.getKP(dueUids[i])
        if (!c || (state.slug && c.subject.slug !== state.slug)) continue
        if (seen[c.kp.uid]) continue
        seen[c.kp.uid] = true
        items.push(c)
      }
      if (items.length < state.count) {
        var filter = { exclude: Object.keys(seen) }
        if (state.slug) filter.slugs = [state.slug]
        var extra = W.data.random(state.count - items.length, filter)
        for (var j = 0; j < extra.length; j++) {
          if (!seen[extra[j].kp.uid]) { seen[extra[j].kp.uid] = true; items.push(extra[j]) }
        }
      }
      if (!items.length) {
        W.toast('没有可复习的卡片, 先去浏览知识点再自评几次吧', 'error')
        return
      }
      state.deck = items
      state.idx = 0
      state.revealed = false
      state.stats = { good: 0, fuzzy: 0, bad: 0 }
      state.phase = 'study'
      render()
    }

    function rate(rating) {
      if (state.advancing) return
      state.advancing = true
      W.reviewKP(state.deck[state.idx].kp.uid, rating)
      state.stats[rating]++
      setTimeout(function () {
        state.advancing = false
        state.idx++
        state.revealed = false
        if (state.idx >= state.deck.length) state.phase = 'done'
        render()
      }, 180)
    }

    function ratingRow() {
      function rbtn(label, sub, rating, icon, color) {
        return W.h(
          'button',
          { class: 'btn btn-outline rating-btn', style: { color: color }, onclick: function () { rate(rating) } },
          W.icon(icon, 18),
          W.h('span', { class: 'lbl' }, label),
          W.h('span', { class: 'sub' }, sub),
        )
      }
      return W.h(
        'div',
        { class: 'rating-row' },
        rbtn('会了', '间隔拉长', 'good', 'check-circle', 'var(--success)'),
        rbtn('模糊', '近期再考', 'fuzzy', 'refresh', 'var(--warning)'),
        rbtn('不会', '重头再来', 'bad', 'x', 'var(--danger)'),
      )
    }

    function studyScreen() {
      var c = state.deck[state.idx]
      var kp = c.kp
      var remaining = state.deck.length - state.idx - 1
      var showBody = state.quick || state.revealed

      var head = W.h(
        'div',
        { class: 'row', style: { justifyContent: 'space-between', marginBottom: '12px' } },
        W.h('span', { class: 'small', style: { fontWeight: '600' } }, '第 ' + (state.idx + 1) + ' / ' + state.deck.length + ' 张 · 剩余 ' + remaining + ' 张'),
        W.ui.btn('退出', { variant: 'ghost', size: 'sm', onClick: function () { state.phase = 'setup'; render() } }),
      )

      var cardEl = W.h('div', { class: 'flashcard' })
      if (!showBody) {
        cardEl.style.cursor = 'pointer'
        cardEl.setAttribute('role', 'button')
        cardEl.setAttribute('tabindex', '0')
        cardEl.addEventListener('click', function () { state.revealed = true; render() })
        cardEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.revealed = true; render() }
        })
        cardEl.appendChild(W.ui.subjectChip(c.subject))
        cardEl.appendChild(W.h('h2', {}, kp.title))
        cardEl.appendChild(W.h('p', { class: 'hint' }, '先在心里把这个知识点完整讲一遍, 再点击显示内容'))
        cardEl.appendChild(W.ui.btn('想一想, 点击显示内容', { variant: 'primary', icon: 'eye', onClick: function () { state.revealed = true; render() } }))
      } else {
        var body = W.h('div', { class: 'body' }, W.h('p', { style: { whiteSpace: 'pre-wrap' } }, kp.content))
        if (kp.keyPoints && kp.keyPoints.length) {
          body.appendChild(
            W.h('ul', { class: 'kp-keypoint-list', style: { marginTop: '10px' } },
              kp.keyPoints.map(function (p) { return W.h('li', {}, p) })),
          )
        }
        if (kp.traps) {
          body.appendChild(
            W.h('div', { style: { marginTop: '10px', background: 'var(--warning-soft)', borderRadius: '10px', padding: '10px 12px', fontSize: '13.5px' } },
              W.h('b', {}, '易错警示: '), kp.traps),
          )
        }
        if (kp.examFocus) {
          body.appendChild(
            W.h('div', { style: { marginTop: '10px', background: 'var(--info-soft)', borderRadius: '10px', padding: '10px 12px', fontSize: '13.5px' } },
              W.h('b', {}, '中考考法: '), kp.examFocus),
          )
        }
        cardEl.appendChild(
          W.h('div', { class: 'row-wrap', style: { justifyContent: 'center' } },
            W.ui.badge(kp.title, 'badge-soft'),
            W.h('span', { class: 'muted small' }, c.subject.name + ' · ' + c.chapter.grade)),
        )
        cardEl.appendChild(body)
      }

      var wrap = W.h('div', { class: 'flashcard-wrap' }, cardEl)
      wrap.appendChild(
        W.h('div', { class: 'flashcard-meta' }, W.h('span', {}, c.chapter.name), W.ui.diffBadge(kp.difficulty), W.ui.typeBadge(kp.type)),
      )
      if (showBody) {
        wrap.appendChild(ratingRow())
        wrap.appendChild(W.h('p', { class: 'muted small', style: { textAlign: 'center', marginTop: '6px' } }, '自评后自动进入间隔重复: 会了 = 间隔拉长, 不会 = 近期再考'))
      } else {
        wrap.appendChild(W.h('p', { class: 'muted small', style: { textAlign: 'center', marginTop: '6px' } }, '先回忆, 再翻面对照自评'))
      }
      return W.h('div', {}, head, wrap)
    }

    function doneScreen() {
      var s = state.stats
      var total = s.good + s.fuzzy + s.bad
      return W.h(
        'div',
        { class: 'flashcard-wrap' },
        W.ui.card(
          W.h(
            'div',
            { style: { textAlign: 'center' } },
            W.h('div', { style: { color: 'var(--primary)' } }, W.icon('trophy', 40)),
            W.h('h2', { style: { fontSize: '20px', margin: '8px 0 0' } }, '本轮复习完成!'),
            W.h('p', { class: 'muted', style: { marginTop: '6px' } }, '本轮复习 ' + total + ' 张: 会了 ' + s.good + ' · 模糊 ' + s.fuzzy + ' · 不会 ' + s.bad),
            W.h('p', { class: 'muted small', style: { marginTop: '2px' } }, '自评结果已进入间隔重复队列, 到期会自动出现在今日复习里'),
          ),
          W.h(
            'div',
            { class: 'row mt-3' },
            W.ui.btn('再来一轮', { variant: 'primary', icon: 'refresh', onClick: startSession }),
            W.ui.btn('返回', { variant: 'outline', onClick: function () { state.phase = 'setup'; render() } }),
          ),
        ),
      )
    }

    function setupScreen() {
      var subjectItems = [{ v: '', label: '全部' }]
      for (var i = 0; i < W.data.subjects.length; i++) subjectItems.push({ v: W.data.subjects[i].slug, label: W.data.subjects[i].name })
      var segSubject = segGroup(subjectItems, state.slug, function (v) { state.slug = v })
      var segCount = segGroup(
        [{ v: 10, label: '10 张' }, { v: 20, label: '20 张' }, { v: 30, label: '30 张' }],
        state.count,
        function (v) { state.count = v },
      )
      var quickCb = W.h('input', { type: 'checkbox' })
      quickCb.checked = state.quick
      quickCb.addEventListener('change', function () { state.quick = quickCb.checked })

      var startBtn = W.ui.btn('开始复习', { variant: 'primary', size: 'lg', icon: 'play', onClick: startSession })
      startBtn.style.width = '100%'

      return [
        pageHead('layers', '闪卡复习', '到期卡片优先, 随机卡片补齐; 自评驱动间隔重复, 记忆更牢固'),
        summaryCard(),
        W.ui.card(
          W.h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
            fieldBlock('学科', segSubject),
            fieldBlock('每组数量', segCount),
            W.h('label', { class: 'checkbox-row' }, quickCb, W.h('span', {}, '快闪模式(直接显示内容, 免翻面)')),
          ),
        ),
        W.h('div', { class: 'mt-3' }, startBtn),
      ]
    }

    function render() {
      rootEl.innerHTML = ''
      var parts = []
      if (state.phase === 'setup') parts = setupScreen()
      else if (state.phase === 'study') parts = [studyScreen()]
      else parts = [doneScreen()]
      for (var i = 0; i < parts.length; i++) if (parts[i]) rootEl.appendChild(parts[i])
    }

    render()
  }

  // ================= 2. 智能出题 =================

  W.views.quiz = function (rootEl, view, ctx) {
    var state = {
      phase: 'form', // form | generating | run | result
      subject: '数学', qType: '选择', difficulty: '中等', count: 5,
      bigType: '', bigCustom: false, bigCustomText: '', suggestions: [], suggesting: false,
      chapters: new Set(), note: '',
      loading: false, genDone: 0, genTotal: 0,
      questions: null, meta: null, calibNote: null,
      idx: 0, picked: null, written: '', judged: false, selfDone: false,
      log: [], wrongTopics: [],
    }

    function updateGenText() {
      var el = W.$('#quiz-gen-text', rootEl)
      if (el) el.textContent = '小知正在出题 (' + Math.min(state.genDone, state.genTotal) + '/' + state.genTotal + ')…'
    }

    function suggestBigTypes(btn) {
      if (state.suggesting) return
      state.suggesting = true
      btn.disabled = true
      btn.textContent = '小知思考中…'
      W.ai.suggestBig({ subject: state.subject })
        .then(function (sugs) {
          state.suggesting = false
          state.suggestions = sugs || []
          state.bigType = ''
          state.bigCustom = false
          state.bigCustomText = ''
          render()
          if (state.suggestions.length) W.toast('小知按校考惯例推荐了 ' + state.suggestions.length + ' 个题型', 'success')
          else W.toast('小知暂时没给出推荐, 已使用默认题型', 'error')
        })
        .catch(function (e) {
          state.suggesting = false
          state.suggestions = []
          render()
          W.toast((e && e.message) || '推荐失败, 已使用默认题型', 'error')
        })
    }

    function generate(reqOverride) {
      if (state.loading) return
      // 大题: 预设题型或自定义题型(不可为空)
      var effBig = effBigType(state)
      if (state.qType === '大题' && state.bigCustom && !effBig) {
        W.toast('请先填写自定义大题题型', 'error')
        return
      }
      var reqCount = Math.max(1, Math.min(MAX_QUESTIONS, state.count || 5))
      var subj = subjectMap()[state.subject]
      var req = { subject: state.subject, qType: state.qType, difficulty: state.difficulty, count: reqCount }
      if (state.qType === '大题' && effBig) req.bigType = effBig
      if (subj && state.chapters.size) {
        var names = []
        for (var i = 0; i < subj.chapters.length; i++) if (state.chapters.has(subj.chapters[i].uid)) names.push(subj.chapters[i].name)
        if (names.length) req.chapters = names
      }
      if (state.note.trim()) req.note = state.note.trim()
      if (reqOverride) for (var k in reqOverride) req[k] = reqOverride[k]

      state.count = reqCount
      state.loading = true
      state.phase = 'generating'
      state.genDone = 0
      state.genTotal = req.count
      render()
      W.ai.quizGenerate(req, function (done, total) {
        state.genDone = done
        state.genTotal = total
        updateGenText()
      }).then(function (res) {
        state.loading = false
        var qs = res && res.questions ? res.questions : []
        if (!qs.length) {
          W.toast('这组参数没能出好题, 换个条件再试', 'error')
          state.phase = 'form'
          render()
          return
        }
        state.questions = qs
        state.meta = { subject: req.subject, qType: req.qType, difficulty: req.difficulty, bigType: req.bigType || '' }
        state.calibNote = (res && res.calibNote) || null
        state.idx = 0
        state.picked = null
        state.written = ''
        state.judged = false
        state.selfDone = false
        state.log = []
        state.wrongTopics = []
        state.phase = 'run'
        render()
      }).catch(function (e) {
        state.loading = false
        W.toast((e && e.message) || '出题失败, 请稍后重试', 'error')
        state.phase = 'form'
        render()
      })
    }

    function finalize(grade) {
      var q = state.questions[state.idx]
      var meta = state.meta
      state.judged = true
      var userAnswer = ''
      if (meta.qType === '选择') userAnswer = state.picked != null ? LETTERS[state.picked] : ((state.written || '').trim() || '(未作答)')
      else userAnswer = (state.written || '').trim() || '(未作答)'
      if (grade === 'wrong') {
        W.addWrongQuestion({
          subject: meta.subject, topic: q.topic, qType: meta.qType, difficulty: meta.difficulty,
          stem: q.stem, options: q.options, figure: q.figure, answer: q.answer, analysis: q.analysis,
          userAnswer: userAnswer,
        })
        state.wrongTopics.push(q.topic)
      }
      state.log.push({ q: q, grade: grade })
      W.bumpActivity('quizzes', 1) // 每道已作答题目计一次练习
      render()
    }

    function submitCurrent() {
      if (state.judged) return
      var q = state.questions[state.idx]
      var meta = state.meta
      var grade = W.gradeQuestion(meta.qType, q, state.picked, state.written)
      if (grade === 'unanswered') {
        W.toast('请先作答再提交', 'error')
        return
      }
      finalize(grade)
    }

    function revealBig() {
      if (state.judged) return
      state.judged = true
      state.selfDone = false
      render()
    }

    function selfMark(ok) {
      if (state.selfDone) return
      state.selfDone = true
      finalize(ok ? 'correct' : 'wrong')
    }

    function nextQuestion() {
      state.idx++
      state.picked = null
      state.written = ''
      state.judged = false
      state.selfDone = false
      if (state.idx >= state.questions.length) state.phase = 'result'
      render()
    }

    function runScreen() {
      var q = state.questions[state.idx]
      var meta = state.meta
      var N = state.questions.length
      var i = state.idx
      var useOptions = meta.qType === '选择' && q.options && q.options.length === 4
      var useInput = !useOptions && (meta.qType === '填空' || meta.qType === '选择')
      var isBig = meta.qType === '大题'

      var head = W.h(
        'div',
        { class: 'quiz-progress-row' },
        W.h('div', { style: { flex: '1' } }, W.ui.progress(((i + (state.judged && !isBig ? 1 : 0)) / N) * 100)),
        W.h('span', { class: 'small', style: { whiteSpace: 'nowrap', fontWeight: '600' } }, '第 ' + (i + 1) + ' / ' + N + ' 题'),
      )

      var card = W.h(
        'div',
        { class: 'card quiz-q-card', style: { padding: '20px' } },
        W.h(
          'div',
          { class: 'row-wrap mb-1' },
          W.ui.badge(qTypeLabel(meta.qType), 'badge-primary'),
          quizDiffBadge(meta.difficulty),
          W.h('span', { class: 'muted small', style: { marginLeft: 'auto' } }, '考点: ' + (q.topic || '综合')),
        ),
        W.h('div', { class: 'quiz-stem' }, q.stem),
      )
      var fig = figureBox(q.figure)
      if (fig) card.appendChild(fig)

      // 选择题: 选项 + 提交
      if (useOptions) {
        var opts = W.h('div', { class: 'quiz-options' })
        for (var oi = 0; oi < q.options.length; oi++) {
          ;(function (idx2, text) {
            var b = W.h(
              'button',
              {
                class: 'quiz-option',
                type: 'button',
                onclick: function () {
                  if (!state.judged) { state.picked = idx2; paintOpts() }
                },
              },
              W.h('span', { class: 'opt-letter' }, LETTERS[idx2]),
              W.h('span', { class: 'flex-1' }, text),
            )
            b.__oi = idx2
            opts.appendChild(b)
          })(oi, q.options[oi])
        }
        function paintOpts() {
          for (var p = 0; p < opts.children.length; p++) {
            var b = opts.children[p]
            b.classList.toggle('picked', !state.judged && b.__oi === state.picked)
            b.classList.toggle('correct', state.judged && LETTERS[b.__oi] === q.answer)
            b.classList.toggle('wrong', state.judged && b.__oi === state.picked && LETTERS[b.__oi] !== q.answer)
            if (state.judged) b.disabled = true
          }
        }
        paintOpts()
        card.appendChild(opts)
      }

      // 填空(或无选项的选择): 输入 + 提交
      if (useInput) {
        var input = W.h('input', { class: 'input quiz-answer-input', placeholder: '在此写下你的答案', 'aria-label': '第 ' + (i + 1) + ' 题作答' })
        if (state.judged) input.disabled = true
        input.value = state.written
        input.addEventListener('input', function () { state.written = input.value })
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitCurrent() })
        card.appendChild(input)
      }

      // 大题: 文本区 + 对照参考答案
      if (isBig) {
        var ta = W.h('textarea', { class: 'textarea', rows: '5', placeholder: '先在草稿纸上完成, 再对照参考答案(此处可留空)', 'aria-label': '第 ' + (i + 1) + ' 题作答' })
        if (state.judged) ta.disabled = true
        ta.value = state.written
        ta.addEventListener('input', function () { state.written = ta.value })
        card.appendChild(ta)
      }

      if (!state.judged) {
        card.appendChild(
          W.h('div', { class: 'row mt-3' },
            W.ui.btn(isBig ? '对照参考答案' : '提交本题', { variant: 'primary', icon: isBig ? 'eye' : 'check', onClick: isBig ? revealBig : submitCurrent })),
        )
      } else {
        // 判定/解析面板
        var okBadge = null
        if (!isBig || state.selfDone) {
          var g = isBig ? state.log[state.log.length - 1].grade : W.gradeQuestion(meta.qType, q, state.picked, state.written)
          okBadge = W.h(
            'span',
            { class: 'badge ' + (g === 'correct' ? 'badge-success' : 'badge-danger'), style: { marginRight: '8px' } },
            g === 'correct' ? '答对了' : '答错了',
          )
        }
        var panel = W.h('div', { class: 'quiz-analysis' })
        if (okBadge) panel.appendChild(okBadge)
        if (useOptions) {
          var pickedLetter = state.picked != null ? LETTERS[state.picked] : null
          panel.appendChild(
            W.h('div', { style: { fontWeight: '700' } },
              '正确答案: ' + q.answer + (pickedLetter && pickedLetter !== q.answer ? ' · 你选了 ' + pickedLetter : pickedLetter === q.answer ? ' · 选对了' : '')),
          )
        } else if (useInput) {
          panel.appendChild(W.h('div', { style: { fontWeight: '700' } }, '参考答案: ' + q.answer))
          panel.appendChild(W.h('div', { class: 'muted', style: { fontSize: '13px' } }, '你的作答: ' + ((state.written || '').trim() || '(未作答)')))
        } else {
          panel.appendChild(W.h('div', { style: { fontWeight: '700' } }, '参考解答:'))
          panel.appendChild(W.h('div', { style: { whiteSpace: 'pre-wrap' } }, q.answer))
        }
        if (q.analysis) {
          panel.appendChild(W.h('div', { class: 'muted', style: { marginTop: '8px', fontSize: '13px', whiteSpace: 'pre-wrap', borderTop: '1px dashed var(--border)', paddingTop: '8px' } }, '解析: ' + q.analysis))
        }
        card.appendChild(panel)

        // 大题自评
        if (isBig && !state.selfDone) {
          card.appendChild(
            W.h(
              'div',
              { class: 'rating-row' },
              W.h('button', { class: 'btn btn-outline rating-btn', style: { color: 'var(--success)' }, onclick: function () { selfMark(true) } },
                W.icon('check-circle', 17), W.h('span', { class: 'lbl' }, '我答对了')),
              W.h('button', { class: 'btn btn-outline rating-btn', style: { color: 'var(--danger)' }, onclick: function () { selfMark(false) } },
                W.icon('x', 17), W.h('span', { class: 'lbl' }, '我答错了')),
            ),
          )
        } else {
          var isLast = i + 1 >= N
          var nextBtn = W.ui.btn(isLast ? '查看结果' : '下一题', { variant: 'primary', icon: isLast ? 'bar-chart' : 'chevron-right', onClick: nextQuestion })
          nextBtn.style.flex = '1'
          card.appendChild(W.h('div', { class: 'mt-3' }, nextBtn))
        }
      }

      return W.h('div', {}, head, card)
    }

    function resultCell(num, label, color) {
      return W.h(
        'div',
        { class: 'card card-pad-sm quiz-result-cell' },
        W.h('div', { class: 'num', style: { color: color } }, String(num)),
        W.h('div', { class: 'muted small', style: { marginTop: '2px' } }, label),
      )
    }

    function resultScreen() {
      var total = state.questions.length
      var correct = 0, wrong = 0
      for (var i = 0; i < state.log.length; i++) {
        if (state.log[i].grade === 'correct') correct++
        else if (state.log[i].grade === 'wrong') wrong++
      }
      var unanswered = total - state.log.length
      var score = total ? Math.round((correct / total) * 100) : 0
      var allRight = correct === total && unanswered === 0

      var card = W.h(
        'div',
        { class: 'card quiz-q-card', style: { padding: '20px' } },
        W.h(
          'div',
          { style: { textAlign: 'center' } },
          W.h('div', { style: { color: allRight ? 'var(--primary)' : 'var(--muted-fg)' } }, W.icon(allRight ? 'trophy' : 'bar-chart', 36)),
          W.h('h2', { style: { fontSize: '19px', margin: '8px 0 0' } }, allRight ? '全部答对, 太棒了!' : '本轮练习完成'),
        ),
      )
      var grid = W.h('div', { class: 'quiz-result-grid' })
      grid.appendChild(resultCell(correct, '答对', 'var(--success)'))
      grid.appendChild(resultCell(wrong, '答错', 'var(--danger)'))
      grid.appendChild(resultCell(unanswered, '未答', 'var(--muted-fg)'))
      grid.appendChild(resultCell(score + '%', '得分率', 'var(--primary)'))
      card.appendChild(grid)
      if (state.calibNote) {
        card.appendChild(W.h('p', { class: 'muted small', style: { display: 'flex', gap: '6px', alignItems: 'center' } }, W.icon('info', 13), state.calibNote))
      }
      card.appendChild(
        W.h(
          'div',
          { class: 'row-wrap mt-2' },
          W.ui.btn('再来一组', { variant: 'primary', icon: 'refresh', onClick: function () { generate() } }),
          state.wrongTopics.length
            ? W.ui.btn('错题重练', { variant: 'outline', icon: 'book-x', onClick: function () { generate({ topics: dedupe(state.wrongTopics), count: state.questions.length }) } })
            : null,
          W.ui.btn('返回设置', { variant: 'ghost', onClick: function () { state.phase = 'form'; render() } }),
        ),
      )

      var list = W.h('div', { class: 'list-stack mt-3', style: { maxWidth: '760px', margin: '18px auto 0' } })
      for (var qi = 0; qi < state.questions.length; qi++) {
        var entry = state.log[qi]
        var g = entry ? entry.grade : null
        list.appendChild(
          W.h(
            'div',
            { class: 'card card-pad-sm row', style: { gap: '10px', alignItems: 'flex-start' } },
            W.h('span', { style: { color: g === 'correct' ? 'var(--success)' : g === 'wrong' ? 'var(--danger)' : 'var(--muted-fg)', marginTop: '2px' } },
              W.icon(g === 'correct' ? 'check-circle' : g === 'wrong' ? 'x' : 'circle', 16)),
            W.h(
              'div',
              { class: 'flex-1', style: { minWidth: '0' } },
              W.h('div', { class: 'small', style: { fontWeight: '600' } }, '第 ' + (qi + 1) + ' 题 · ' + (state.questions[qi].topic || '综合')),
              W.h('div', { class: 'muted small', style: { display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden', marginTop: '2px' } }, state.questions[qi].stem),
            ),
          ),
        )
      }
      return [card, list]
    }

    function generatingScreen() {
      return W.h(
        'div',
        { class: 'flashcard-wrap' },
        W.ui.card(
          W.h(
            'div',
            { style: { textAlign: 'center', padding: '18px 0' } },
            W.h('div', { style: { color: 'var(--primary)', display: 'flex', justifyContent: 'center' } }, spinner(30)),
            W.h('p', { id: 'quiz-gen-text', style: { marginTop: '12px', fontWeight: '600' } }, '小知正在出题 (0/' + state.genTotal + ')…'),
            W.h('p', { class: 'muted small' }, '命题需要一点时间, 请稍候'),
          ),
        ),
        !W.ai.hasAI() ? W.h('div', { class: 'mt-2' }, noAiLine()) : null,
      )
    }

    function formScreen() {
      var subj = subjectMap()[state.subject]
      var selSubject = W.h('select', { class: 'select', 'aria-label': '学科' })
      for (var i = 0; i < W.data.subjects.length; i++) selSubject.appendChild(W.h('option', { value: W.data.subjects[i].name }, W.data.subjects[i].name))
      selSubject.value = state.subject
      selSubject.addEventListener('change', function () {
        state.subject = selSubject.value
        state.bigType = ''
        state.bigCustom = false
        state.bigCustomText = ''
        state.suggestions = []
        state.chapters.clear()
        render()
      })

      var segQType = segGroup(
        [{ v: '选择', label: '选择' }, { v: '填空', label: '填空' }, { v: '大题', label: '大题' }],
        state.qType,
        function (v) { state.qType = v; render() },
      )
      var segDiff = segGroup(
        [{ v: '简单', label: '简单' }, { v: '中等', label: '中等' }, { v: '困难', label: '困难' }],
        state.difficulty,
        function (v) { state.difficulty = v },
      )
      // 题量: 高度自定义(1~20 题任意值, 可点按也可直接输入)
      var countCtl = countStepper({
        get: function () { return state.count },
        set: function (v) { state.count = v },
        min: 1, max: MAX_QUESTIONS,
        label: '题量',
      })

      var noteInput = W.h('input', { class: 'input', placeholder: '备注: 如「侧重计算」', value: state.note, 'aria-label': '出题备注' })
      noteInput.addEventListener('input', function () { state.note = noteInput.value })

      var startBtn = W.ui.btn('开始出题', { variant: 'primary', size: 'lg', icon: 'sparkles', onClick: function () { generate() } })
      startBtn.style.width = '100%'

      var topFields = W.h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px' } },
        fieldBlock('学科', selSubject),
        fieldBlock('题型', segQType),
        fieldBlock('难度', segDiff),
        fieldBlock('题量', countCtl, '可点箭头或直接输入, 最多 ' + MAX_QUESTIONS + ' 题'),
      )

      var kids = [topFields]
      if (state.qType === '大题') {
        kids.push(W.h('div', { class: 'mt-3' }, bigTypeField(state, suggestBigTypes)))
      }
      if (subj) {
        kids.push(W.h('div', { class: 'mt-3' }, fieldBlock('出题范围(可多选, 不选即全科)', chapterPicker(subj, state.chapters))))
      }
      kids.push(W.h('div', { class: 'mt-3' }, fieldBlock('备注(可选)', noteInput)))
      if (!W.ai.hasAI()) kids.push(W.h('div', { class: 'mt-3' }, noAiLine()))

      return [
        pageHead('sparkles', '智能出题', '按学科、范围、难度定制自测题; 答错的题自动进入错题本'),
        W.ui.card(W.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, kids)),
        W.h('div', { class: 'mt-3' }, startBtn),
      ]
    }

    function render() {
      rootEl.innerHTML = ''
      var parts = []
      if (state.phase === 'form') parts = formScreen()
      else if (state.phase === 'generating') parts = [generatingScreen()]
      else if (state.phase === 'run') parts = [runScreen()]
      else parts = resultScreen()
      for (var i = 0; i < parts.length; i++) if (parts[i]) rootEl.appendChild(parts[i])
    }

    render()
  }

  // ================= 3. 错题本 =================

  W.views.wrongbook = function (rootEl, view, ctx) {
    var state = { tab: 'pending', subject: '全部', expanded: {} }
    var listWrap = null

    function allRecords() {
      return Object.keys(W.store.wrongQuestions).map(function (id) { return W.store.wrongQuestions[id] })
    }

    function records() {
      var list = state.tab === 'pending' ? W.selectPendingWrong() : W.selectResolvedWrong()
      if (state.subject !== '全部') {
        list = list.filter(function (q) { return q.subject === state.subject })
      }
      return list
    }

    function subjectOptions() {
      var counts = {}
      for (var i = 0; i < allRecords().length; i++) {
        var s = allRecords()[i].subject
        counts[s] = (counts[s] || 0) + 1
      }
      return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] })
    }

    function findError(q, btn) {
      if (!W.ai.hasAI()) {
        W.toast('未配置 AI 服务: 点右上角「小知」悬浮球可以设置, 配置后即可用 AI 找错', 'error')
        return
      }
      if (btn) { btn.disabled = true; btn.textContent = '小知诊断中…' }
      W.ai.findError({
        subject: q.subject, topic: q.topic, qType: q.qType, stem: q.stem,
        options: q.options, userAnswer: q.userAnswer, answer: q.answer, analysis: q.analysis,
      }).then(function (text) {
        W.modal({
          title: '小知的错题诊断',
          content: W.h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: '1.9', fontSize: '14px' } }, String(text || '')),
          cancelText: '关闭',
        })
      }).catch(function (e) {
        W.toast((e && e.message) || '诊断失败, 请稍后重试', 'error')
      }).then(function () { renderList() })
    }

    function recordCard(q) {
      var subj = subjectMap()[q.subject]
      var open = !!state.expanded[q.id]
      var stemStyle = open
        ? { whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: '1.8' }
        : { display: '-webkit-box', WebkitLineClamp: '6', WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: '1.8' }

      var toggle = null
      if (q.stem.length > 90) {
        toggle = W.h('button', { class: 'section-more', onclick: function () { state.expanded[q.id] = !open; renderList() } },
          open ? '收起' : '展开', W.icon(open ? 'chevron-down' : 'chevron-right', 12))
      }

      var aiBtn = W.ui.btn('AI 找错', { variant: 'outline', size: 'sm', icon: 'sparkles', onClick: function () { findError(q, aiBtn) } })
      var resolveBtn = state.tab === 'pending'
        ? W.ui.btn('标记攻克', { variant: 'secondary', size: 'sm', icon: 'check-circle', onClick: function () { W.setWrongResolved(q.id, true); W.toast('已标记攻克, 继续保持', 'success'); render() } })
        : W.ui.btn('恢复练习', { variant: 'secondary', size: 'sm', icon: 'refresh', onClick: function () { W.setWrongResolved(q.id, false); W.toast('已恢复到待攻克', 'success'); render() } })
      var delBtn = W.ui.btn('删除', {
        variant: 'danger-outline', size: 'sm', icon: 'trash',
        onClick: function () {
          W.confirm({
            title: '删除错题', message: '删除后无法恢复, 确定删除这道错题吗?', okText: '删除', danger: true,
            onOk: function () { W.removeWrongQuestion(q.id); W.toast('已删除', 'success'); render() },
          })
        },
      })

      return W.ui.card(
        W.h(
          'div',
          { class: 'row-wrap' },
          subj ? W.ui.subjectChip(subj) : W.ui.badge(q.subject, 'badge-soft'),
          q.topic ? W.ui.badge(q.topic, 'badge-primary') : null,
          W.ui.badge(qTypeLabel(q.qType), 'badge-soft'),
          quizDiffBadge(q.difficulty),
          W.h('span', { class: 'badge badge-warning' }, '错 ' + (q.wrongCount || 1) + ' 次'),
          W.h('span', { class: 'muted small', style: { marginLeft: 'auto' } }, W.fmtDate(q.lastWrongAt)),
        ),
        W.h('div', { class: 'mt-1', style: stemStyle }, q.stem),
        toggle,
        W.h('div', { class: 'muted small mt-1' }, '你的作答: ' + (q.userAnswer || '(未作答)') + ' · 正确答案: ' + q.answer),
        W.h('div', { class: 'row-wrap mt-2' }, aiBtn, resolveBtn, delBtn),
      )
    }

    function renderList() {
      if (!listWrap) return
      listWrap.innerHTML = ''
      var list = records()
      if (!list.length) {
        listWrap.appendChild(
          W.ui.emptyState(
            'book-x',
            state.tab === 'pending' ? '没有待攻克的错题' : '还没有已攻克的错题',
            state.tab === 'pending' ? '去出题页做几道题, 答错的题会自动收进错题本' : '把待攻克的错题标记攻克后, 会自动归档到这里',
            state.tab === 'pending' ? W.ui.btn('去出题', { variant: 'primary', onClick: function () { W.go('quiz') } }) : null,
          ),
        )
        return
      }
      var stack = W.h('div', { class: 'list-stack' })
      for (var i = 0; i < list.length; i++) stack.appendChild(recordCard(list[i]))
      listWrap.appendChild(stack)
    }

    function clearResolved() {
      var list = W.selectResolvedWrong()
      if (!list.length) {
        W.toast('没有已攻克的错题', 'error')
        return
      }
      W.confirm({
        title: '清空已攻克',
        message: '将删除 ' + list.length + ' 道已攻克的错题记录, 无法恢复。确定清空吗?',
        okText: '清空', danger: true,
        onOk: function () {
          for (var i = 0; i < list.length; i++) W.removeWrongQuestion(list[i].id)
          W.toast('已清空 ' + list.length + ' 道已攻克错题', 'success')
          render()
        },
      })
    }

    function render() {
      rootEl.innerHTML = ''
      var all = allRecords()
      var pendingN = 0
      for (var i = 0; i < all.length; i++) if (!all[i].resolved) pendingN++
      var resolvedN = all.length - pendingN

      rootEl.appendChild(pageHead('book-x', '错题本', '做错的题会自动收进来; 同一道题重复做错会累计次数'))

      var sel = W.h('select', { class: 'select', style: { maxWidth: '150px' }, 'aria-label': '按学科筛选' })
      var names = ['全部'].concat(subjectOptions())
      for (var j = 0; j < names.length; j++) sel.appendChild(W.h('option', { value: names[j] }, names[j]))
      sel.value = state.subject
      sel.addEventListener('change', function () { state.subject = sel.value; renderList() })

      var tabSeg = segGroup(
        [
          { v: 'pending', label: '待攻克 ' + pendingN },
          { v: 'resolved', label: '已攻克 ' + resolvedN },
        ],
        state.tab,
        function (v) { state.tab = v; renderList() },
      )

      rootEl.appendChild(
        W.ui.card(
          W.h(
            'div',
            { class: 'row-wrap', style: { justifyContent: 'space-between' } },
            W.h('span', { class: 'small', style: { fontWeight: '600' } }, '共 ' + all.length + ' 道错题 · 待攻克 ' + pendingN),
            resolvedN ? W.ui.btn('清空已攻克', { variant: 'danger-outline', size: 'sm', icon: 'trash', onClick: clearResolved }) : null,
          ),
          W.h('div', { class: 'row-wrap mt-2' }, tabSeg, sel),
        ),
      )

      listWrap = W.h('div', { class: 'mt-2' })
      rootEl.appendChild(listWrap)
      renderList()
    }

    render()
    var unsub = W.storeSubscribe(W.debounce(function () {
      if (rootEl.isConnected) render()
    }, 300))
    ctx.addCleanup(unsub)
  }

  // ================= 4. 学习统计 =================

  W.views.stats = function (rootEl, view, ctx) {
    function dateKey(d) {
      var m = String(d.getMonth() + 1).padStart(2, '0')
      var day = String(d.getDate()).padStart(2, '0')
      return d.getFullYear() + '-' + m + '-' + day
    }

    function statCard(num, label, icon, color) {
      return W.ui.card(
        W.h('div', { class: 'stat-num', style: color ? { color: color } : null }, String(num)),
        W.h('div', { class: 'stat-label' }, W.icon(icon, 13), label),
        { __cls: 'card-pad-sm' },
      )
    }

    function heatLevel(score) {
      if (score <= 0) return 0
      if (score >= 40) return 4
      if (score >= 20) return 3
      if (score >= 8) return 2
      return 1
    }

    function heatCard() {
      var heat = W.h('div', { class: 'heatmap mt-2' })
      var now = new Date()
      var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      var monday = new Date(t0)
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
      for (var w = 16; w >= 0; w--) {
        var col = W.h('div', { class: 'heatmap-col' })
        for (var i = 0; i < 7; i++) {
          var d = new Date(monday)
          d.setDate(d.getDate() - w * 7 + i)
          if (d > t0) {
            col.appendChild(W.h('div', { class: 'heatmap-cell', style: { visibility: 'hidden' } }))
            continue
          }
          var key = dateKey(d)
          var a = W.store.activityDays[key] || {}
          var score = (a.minutes || 0) + (a.kps || 0) + (a.quizzes || 0) + (a.recites || 0) + (a.recalls || 0)
          var lv = heatLevel(score)
          col.appendChild(W.h('div', { class: W.cls('heatmap-cell', lv ? 'l' + lv : ''), title: key + (score > 0 ? ' · 学习活动 ' + score : ' · 未学习') }))
        }
        heat.appendChild(col)
      }
      var legend = W.h('div', { class: 'row mt-1', style: { justifyContent: 'flex-end', gap: '5px', fontSize: '11px', color: 'var(--muted-fg)' } }, '少')
      for (var l = 1; l <= 4; l++) legend.appendChild(W.h('span', { class: 'heatmap-cell l' + l }))
      legend.appendChild(W.h('span', {}, '多'))
      return W.ui.card(
        W.h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          W.h('h3', { style: { fontSize: '15px', margin: '0' } }, '学习热力图'),
          W.h('span', { class: 'muted small' }, '近 17 周 · 颜色越深学习越多')),
        heat, legend,
      )
    }

    function masteryCard() {
      var rows = W.h('div', { class: 'mt-1' })
      for (var i = 0; i < W.data.subjects.length; i++) {
        var s = W.data.subjects[i]
        var total = 0, learned = 0
        for (var ci = 0; ci < s.chapters.length; ci++) {
          var kps = s.chapters[ci].kps
          for (var ki = 0; ki < kps.length; ki++) {
            total++
            if (kps[ki].uid in W.store.learned) learned++
          }
        }
        var pct = total ? (learned / total) * 100 : 0
        rows.appendChild(
          W.h(
            'div',
            { class: 'mastery-row' },
            W.h('div', { class: 'mastery-ico', style: { background: s.color } }, s.name.slice(0, 1)),
            W.h(
              'div',
              { class: 'mastery-main' },
              W.h('div', { class: 'row1' }, W.h('span', { style: { fontWeight: '600' } }, s.name), W.h('span', { class: 'muted' }, learned + ' / ' + total)),
              W.ui.progress(pct, s.color),
            ),
          ),
        )
      }
      return W.ui.card(W.h('h3', { style: { fontSize: '15px', margin: '0' } }, '各科掌握度'), rows)
    }

    function editGoals() {
      var g = W.store.settings.dailyGoals || {}
      function mkNum(label, val) {
        var input = W.h('input', { class: 'input', type: 'number', min: '1', max: '200', value: String(val || ''), 'aria-label': label })
        return W.h('label', { class: 'field' }, W.h('span', { class: 'field-label' }, label), input)
      }
      var kIn = mkNum('学习知识点(个/天)', g.kps || GOALS_DEFAULT.kps)
      var qIn = mkNum('练习题目(题/天)', g.quizzes || GOALS_DEFAULT.quizzes)
      var rIn = mkNum('主动回忆(次/天)', g.recalls || GOALS_DEFAULT.recalls)
      W.modal({
        title: '设置每日目标',
        content: W.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, kIn, qIn, rIn),
        okText: '保存',
        onOk: function () {
          function clamp(input, d) {
            var n = Math.round(Number(input.querySelector('input').value))
            return n >= 1 && n <= 200 ? n : d
          }
          W.setSettings({
            dailyGoals: {
              kps: clamp(kIn, GOALS_DEFAULT.kps),
              quizzes: clamp(qIn, GOALS_DEFAULT.quizzes),
              recalls: clamp(rIn, GOALS_DEFAULT.recalls),
            },
          })
          W.toast('每日目标已保存', 'success')
        },
      })
    }

    function goalsCard() {
      var g = W.store.settings.dailyGoals || {}
      var goals = { kps: g.kps || GOALS_DEFAULT.kps, quizzes: g.quizzes || GOALS_DEFAULT.quizzes, recalls: g.recalls || GOALS_DEFAULT.recalls }
      var act = W.store.activityDays[W.todayStr()] || {}
      function quest(icon, title, cur, target) {
        cur = cur || 0
        var done = cur >= target
        return W.h(
          'div',
          { class: 'quest-row' },
          W.h('div', { class: W.cls('quest-ico', done && 'done') }, W.icon(done ? 'check-circle' : icon, 17)),
          W.h('div', { class: 'quest-main' }, W.h('h4', {}, title), W.h('p', {}, '今日 ' + cur + ' / ' + target)),
          W.h('span', { class: W.cls('badge', done ? 'badge-success' : 'badge-soft') }, done ? '已完成' : cur + '/' + target),
        )
      }
      return W.ui.card(
        W.h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          W.h('h3', { style: { fontSize: '15px', margin: '0' } }, '今日任务'),
          W.ui.btn('编辑目标', { variant: 'ghost', size: 'sm', icon: 'pencil', onClick: editGoals })),
        quest('circle', '学习知识点', act.kps, goals.kps),
        quest('clipboard-list', '练习题目', act.quizzes, goals.quizzes),
        quest('brain', '主动回忆', act.recalls, goals.recalls),
      )
    }

    function editExamDate() {
      var input = W.h('input', { class: 'input', type: 'date', value: W.store.settings.examDate || W.defaultExamDate(), 'aria-label': '考试日期' })
      W.modal({
        title: '设置考试日期',
        content: W.h('label', { class: 'field' }, W.h('span', { class: 'field-label' }, '日期(默认为最近一次中考参考日)'), input),
        okText: '保存',
        onOk: function () {
          if (!input.value) {
            W.toast('请选择日期', 'error')
            return false
          }
          W.setSettings({ examDate: input.value })
          W.toast('考试日期已保存', 'success')
        },
      })
    }

    function examCard() {
      var examDate = W.store.settings.examDate || W.defaultExamDate()
      var days = W.daysUntil(examDate)
      return W.ui.card(
        W.h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          W.h('h3', { style: { fontSize: '15px', margin: '0' } }, '考试倒计时'),
          W.ui.btn('设置日期', { variant: 'ghost', size: 'sm', icon: 'calendar', onClick: editExamDate })),
        W.h(
          'div',
          { class: 'row', style: { gap: '14px' } },
          W.h('div', { class: 'stat-num', style: { fontSize: '34px' } }, days != null && days >= 0 ? String(days) : '—'),
          W.h(
            'div',
            {},
            W.h('div', { class: 'small', style: { fontWeight: '600' } }, W.store.settings.examLabel || '中考倒计时'),
            W.h('div', { class: 'muted small' }, examDate + (days != null && days >= 0 ? ' · 还有 ' + days + ' 天' : '')),
          ),
        ),
      )
    }

    function build() {
      rootEl.innerHTML = ''
      var learnedN = Object.keys(W.store.learned).length
      var favN = Object.keys(W.store.favorites).length
      var weekMin = 0
      for (var i = 0; i < 7; i++) {
        var d = new Date()
        d.setDate(d.getDate() - i)
        var a = W.store.activityDays[dateKey(d)]
        if (a) weekMin += a.minutes || 0
      }

      rootEl.appendChild(pageHead('bar-chart', '学习统计', '你的每一分努力, 都被认真记录着'))
      rootEl.appendChild(
        W.h(
          'div',
          { class: 'stat-grid mt-2' },
          statCard(learnedN, '已学知识点', 'check-circle'),
          statCard(favN, '收藏', 'heart'),
          statCard(W.store.streak, '连续学习天数', 'flame', 'var(--warning)'),
          statCard(W.fmtMinutes(weekMin), '本周学习时长', 'clock'),
        ),
      )
      rootEl.appendChild(W.h('div', { class: 'mt-3' }, heatCard()))
      rootEl.appendChild(W.h('div', { class: 'mt-3' }, masteryCard()))
      rootEl.appendChild(
        W.h('div', { class: 'mt-3', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' } }, goalsCard(), examCard()),
      )
    }

    build()
    var unsub = W.storeSubscribe(W.debounce(function () {
      if (rootEl.isConnected && W.app && W.app.render) W.app.render()
    }, 400))
    ctx.addCleanup(unsub)
  }

  // ================= 5. 组卷打印 =================

  W.views.paper = function (rootEl, view, ctx) {
    var MAX_BIG_ROWS = 8
    var state = {
      phase: 'form', // form | gen | paper
      subject: '数学', nChoice: 5, nFill: 4,
      // 大题可分多组题型, 每组独立选型(预设/小知推荐/自定义)与题量
      bigs: [{ type: '', custom: false, customText: '', count: 2 }],
      suggestions: [], suggesting: false,
      chapters: new Set(),
      paper: null, ansOpen: false, _focusCustom: -1,
    }
    var CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

    function presetLabels() {
      return state.suggestions.length
        ? state.suggestions.map(function (s) { return s.label })
        : W.bigqPresets(state.subject)
    }
    function bigsTotal() {
      var n = 0
      for (var i = 0; i < state.bigs.length; i++) n += state.bigs[i].count
      return n
    }
    function paperTotal() { return state.nChoice + state.nFill + bigsTotal() }
    function rowBigType(row) { return row.custom ? (row.customText || '').trim() : (row.type || '') }

    function suggestBigTypes(btn) {
      if (state.suggesting) return
      state.suggesting = true
      btn.disabled = true
      btn.textContent = '小知思考中…'
      W.ai.suggestBig({ subject: state.subject })
        .then(function (sugs) {
          state.suggesting = false
          state.suggestions = sugs || []
          // 按推荐一键组好大题部分: 每个推荐题型一行, 数量取建议值且总量不超上限
          var budget = MAX_QUESTIONS - state.nChoice - state.nFill
          var rows = []
          for (var i = 0; i < state.suggestions.length && rows.length < MAX_BIG_ROWS; i++) {
            if (budget < 1) break
            var sug = state.suggestions[i]
            var c = Math.max(1, Math.min(parseInt(sug.count, 10) || 1, budget))
            rows.push({ type: sug.label, custom: false, customText: '', count: c })
            budget -= c
          }
          if (rows.length) state.bigs = rows
          render()
          if (state.suggestions.length) W.toast('小知推荐了 ' + rows.length + ' 组常考大题题型, 已自动排好', 'success')
          else W.toast('小知暂时没给出推荐, 已使用默认题型', 'error')
        })
        .catch(function (e) {
          state.suggesting = false
          state.suggestions = []
          render()
          W.toast((e && e.message) || '推荐失败, 已使用默认题型', 'error')
        })
    }

    function chapterNames() {
      var subj = subjectMap()[state.subject]
      var names = []
      if (subj && state.chapters.size) {
        for (var i = 0; i < subj.chapters.length; i++) if (state.chapters.has(subj.chapters[i].uid)) names.push(subj.chapters[i].name)
      }
      return names
    }

    function generate() {
      if (state.phase === 'gen') return
      // 校验: 每组大题的自定义题型必须已填写
      for (var bi = 0; bi < state.bigs.length; bi++) {
        if (state.bigs[bi].custom && !rowBigType(state.bigs[bi])) {
          W.toast('第 ' + (bi + 1) + ' 组大题的自定义题型还没填写', 'error')
          return
        }
      }
      var total = paperTotal()
      if (total <= 0) {
        W.toast('请至少选择 1 道题', 'error')
        return
      }
      if (total > MAX_QUESTIONS) {
        W.toast('总题量最多 ' + MAX_QUESTIONS + ' 题(当前 ' + total + ' 题), 请删减后再生成', 'error')
        return
      }

      var jobs = []
      if (state.nChoice > 0) jobs.push({ qType: '选择', count: state.nChoice, difficulty: '中等', label: '选择题' })
      if (state.nFill > 0) jobs.push({ qType: '填空', count: state.nFill, difficulty: '中等', label: '填空题' })
      for (var bj = 0; bj < state.bigs.length; bj++) {
        var row = state.bigs[bj]
        var t = rowBigType(row)
        jobs.push({ qType: '大题', count: row.count, difficulty: '困难', label: '「' + (t || '解答题') + '」', bigType: t || undefined })
      }

      var names = chapterNames()
      state.phase = 'gen'
      state.paper = null
      state.genLabel = jobs.length ? jobs[0].label : '题目'
      state.genCount = jobs.length ? jobs[0].count : 0
      render()

      var sections = []
      var idx = 0
      function setGen(t) {
        var el = W.$('#paper-gen-text', rootEl)
        if (el) el.textContent = t
      }
      function runJob() {
        if (idx >= jobs.length) { finish(); return }
        var job = jobs[idx]
        var req = { subject: state.subject, qType: job.qType, difficulty: job.difficulty, count: job.count }
        if (job.bigType) req.bigType = job.bigType
        if (names.length) req.chapters = names
        setGen('正在生成' + job.label + ' (0/' + job.count + ')…')
        W.ai.quizGenerate(req, function (done, t) {
          setGen('正在生成' + job.label + ' (' + Math.min(done, job.count) + '/' + job.count + ')…')
        }).then(function (res) {
          sections.push({ qType: job.qType, bigType: job.bigType || '', questions: (res && res.questions) || [] })
          idx++
          runJob()
        }).catch(function (e) {
          W.toast((e && e.message) || '组卷失败, 请稍后重试', 'error')
          state.phase = 'form'
          render()
        })
      }
      function finish() {
        var hasQ = false
        for (var i = 0; i < sections.length; i++) if (sections[i].questions.length) hasQ = true
        if (!hasQ) {
          W.toast('没能生成题目, 请稍后重试', 'error')
          state.phase = 'form'
          render()
          return
        }
        state.paper = {
          subject: state.subject,
          sections: sections.filter(function (s) { return s.questions.length }),
          chapterLabel: names.length
            ? (names.slice(0, 3).join('、') + (names.length > 3 ? ' 等 ' + names.length + ' 章' : ''))
            : '全科综合',
          date: W.todayStr(),
        }
        state.phase = 'paper'
        render()
      }
      runJob()
    }

    function formScreen() {
      var subj = subjectMap()[state.subject]
      var selSubject = W.h('select', { class: 'select', 'aria-label': '学科' })
      for (var i = 0; i < W.data.subjects.length; i++) selSubject.appendChild(W.h('option', { value: W.data.subjects[i].name }, W.data.subjects[i].name))
      selSubject.value = state.subject
      selSubject.addEventListener('change', function () {
        state.subject = selSubject.value
        state.bigs = [{ type: '', custom: false, customText: '', count: 2 }]
        state.suggestions = []
        state.chapters.clear()
        render()
      })

      // ---- 题量步进器: 选择/填空 0~20, 大题每组 1~20, 全卷合计不超 20 ----
      var steppers = []
      var totalEl = null
      var addBigBtnRef = null
      function syncAll() {
        for (var si = 0; si < steppers.length; si++) steppers[si].sync()
        if (totalEl) {
          var t = paperTotal()
          totalEl.textContent = t >= MAX_QUESTIONS
            ? '已满 ' + MAX_QUESTIONS + ' 题(上限)'
            : '共 ' + t + ' / ' + MAX_QUESTIONS + ' 题'
          totalEl.style.color = t >= MAX_QUESTIONS ? 'var(--danger)' : 'var(--primary)'
        }
        if (addBigBtnRef) addBigBtnRef.disabled = state.bigs.length >= MAX_BIG_ROWS || paperTotal() >= MAX_QUESTIONS || null
      }
      function makeStepper(get, set, min, label) {
        var st = countStepper({
          get: get,
          set: set,
          min: min,
          max: function () { return MAX_QUESTIONS - (paperTotal() - get()) },
          label: label,
          onChange: syncAll,
        })
        steppers.push(st)
        return st
      }

      var choiceStepper = makeStepper(function () { return state.nChoice }, function (v) { state.nChoice = v }, 0, '选择题数量')
      var fillStepper = makeStepper(function () { return state.nFill }, function (v) { state.nFill = v }, 0, '填空题数量')

      // ---- 大题多组行 ----
      var labels = presetLabels()
      for (var ri = 0; ri < state.bigs.length; ri++) {
        var r0 = state.bigs[ri]
        if (!r0.custom && (!r0.type || labels.indexOf(r0.type) < 0)) r0.type = labels[0] || ''
      }

      function bigRowEl(row, idx) {
        var sel = W.h('select', { class: 'select', 'aria-label': '第 ' + (idx + 1) + ' 组大题题型' })
        for (var li = 0; li < labels.length; li++) sel.appendChild(W.h('option', { value: labels[li] }, labels[li]))
        sel.appendChild(W.h('option', { value: BIG_CUSTOM }, '✎ 自定义题型…'))
        sel.value = row.custom ? BIG_CUSTOM : row.type
        sel.addEventListener('change', function () {
          if (sel.value === BIG_CUSTOM) row.custom = true
          else {
            row.custom = false
            row.type = sel.value
          }
          state._focusCustom = idx
          render()
        })
        var customInput = W.h('input', {
          class: 'input', maxlength: '24', placeholder: '输入自定义题型, 如「材料分析题」',
          value: row.customText, 'aria-label': '第 ' + (idx + 1) + ' 组自定义题型',
        })
        customInput.addEventListener('input', function () { row.customText = customInput.value })
        customInput.style.display = row.custom ? '' : 'none'
        if (state._focusCustom === idx && row.custom) {
          state._focusCustom = -1
          setTimeout(function () { customInput.focus() }, 0)
        }

        var delBtn = W.h(
          'button',
          { class: 'icon-btn', type: 'button', title: '删除该组', 'aria-label': '删除第 ' + (idx + 1) + ' 组大题', onclick: function () { state.bigs.splice(idx, 1); render() } },
          W.icon('trash', 16),
        )

        return W.h(
          'div',
          { class: 'big-row' },
          W.h(
            'div',
            { class: 'big-row-top' },
            W.h('div', { class: 'big-row-type' }, sel),
            makeStepper(function () { return row.count }, function (v) { row.count = v }, 1, '第 ' + (idx + 1) + ' 组大题数量'),
            delBtn,
          ),
          customInput,
        )
      }

      var addBigBtn = W.ui.btn('添加大题题型', { variant: 'outline', size: 'sm', icon: 'plus', onClick: function () {
        if (state.bigs.length >= MAX_BIG_ROWS) return
        state.bigs.push({ type: labels[0] || '', custom: false, customText: '', count: 1 })
        render()
      } })
      addBigBtnRef = addBigBtn
      var suggestBtn = W.ui.btn('小知推荐题型组合', { variant: 'outline', size: 'sm', icon: 'sparkles', onClick: function () { suggestBigTypes(suggestBtn) } })

      var bigKids = []
      for (var bi = 0; bi < state.bigs.length; bi++) bigKids.push(bigRowEl(state.bigs[bi], bi))
      if (!bigKids.length) {
        bigKids.push(W.h('span', { class: 'muted small' }, '当前没有大题; 点「添加大题题型」可加入, 或用小知推荐一键排好'))
      }
      if (state.suggestions.length) {
        bigKids.push(
          W.h(
            'div',
            { class: 'muted', style: { fontSize: '12px', lineHeight: '1.6' } },
            state.suggestions.map(function (s) { return W.h('div', {}, '「' + s.label + '」 ' + (s.reason || '')) }),
          ),
        )
      }

      var bigField = W.h(
        'div',
        { class: 'field' },
        W.h(
          'div',
          { class: 'row-wrap', style: { alignItems: 'center', rowGap: '6px' } },
          W.h('span', { class: 'field-label' }, '大题(可分多组题型)'),
          W.h('span', { class: 'flex-1' }),
          suggestBtn,
          addBigBtn,
        ),
        bigKids,
      )

      totalEl = W.h('div', { class: 'small', style: { textAlign: 'center', color: 'var(--primary)', fontWeight: '600' } }, '共 ' + paperTotal() + ' / ' + MAX_QUESTIONS + ' 题')

      var kids = [
        W.h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px' } },
          fieldBlock('学科', selSubject),
          fieldBlock('选择题数量', choiceStepper, '可为 0'),
          fieldBlock('填空题数量', fillStepper, '可为 0'),
        ),
        W.h('div', { class: 'mt-3' }, bigField),
      ]
      if (subj) kids.push(W.h('div', { class: 'mt-3' }, fieldBlock('出题范围(可多选, 不选即全科)', chapterPicker(subj, state.chapters))))
      if (!W.ai.hasAI()) kids.push(W.h('div', { class: 'mt-3' }, noAiLine()))

      var goBtn = W.ui.btn('生成试卷', { variant: 'primary', size: 'lg', icon: 'printer', onClick: generate })
      goBtn.style.width = '100%'

      syncAll()
      return [
        pageHead('printer', '组卷打印', '自定义题型组合与题量(全卷最多 ' + MAX_QUESTIONS + ' 题), 一键打印; 打印时自动隐藏按钮与答案区'),
        W.ui.card(W.h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, kids)),
        W.h('div', { class: 'mt-3' }, totalEl),
        W.h('div', { class: 'mt-2' }, goBtn),
      ]
    }

    function genScreen() {
      return W.h(
        'div',
        { class: 'flashcard-wrap' },
        W.ui.card(
          W.h(
            'div',
            { style: { textAlign: 'center', padding: '18px 0' } },
            W.h('div', { style: { color: 'var(--primary)', display: 'flex', justifyContent: 'center' } }, spinner(30)),
            W.h('p', { id: 'paper-gen-text', style: { marginTop: '12px', fontWeight: '600' } }, '正在生成' + state.genLabel + ' (0/' + state.genCount + ')…'),
            W.h('p', { class: 'muted small' }, '分题型依次命题, 请稍候'),
          ),
        ),
      )
    }

    function answerCard(p) {
      var body = W.h('div')
      if (state.ansOpen) {
        var n = 0
        for (var si = 0; si < p.sections.length; si++) {
          var sec = p.sections[si]
          for (var qi = 0; qi < sec.questions.length; qi++) {
            n++
            var ansTxt = String(sec.questions[qi].answer || '')
            if (sec.qType === '大题' && ansTxt.length > 200) ansTxt = ansTxt.slice(0, 200) + '…'
            body.appendChild(
              W.h('div', { class: 'small', style: { padding: '5px 0', borderBottom: '1px dashed var(--border)', lineHeight: '1.7' } },
                W.h('b', {}, n + '. '), ansTxt),
            )
          }
        }
      }
      return W.ui.card(
        W.h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          W.h('h3', { style: { fontSize: '15px', margin: '0' } }, '答案区(打印时自动隐藏)'),
          W.ui.btn(state.ansOpen ? '隐藏答案区' : '显示答案区', {
            variant: 'outline', size: 'sm', icon: 'eye',
            onClick: function () { state.ansOpen = !state.ansOpen; render() },
          })),
        body,
        { __cls: 'no-print' },
      )
    }

    function paperScreen() {
      var p = state.paper
      var top = W.h(
        'div',
        { class: 'no-print row-wrap mb-2', style: { maxWidth: '820px', margin: '0 auto 12px' } },
        W.ui.btn('打印试卷', { variant: 'primary', icon: 'printer', onClick: function () { window.print() } }),
        W.ui.btn('重新组卷', { variant: 'outline', icon: 'refresh', onClick: function () { generate() } }),
        W.ui.btn('返回设置', { variant: 'ghost', onClick: function () { state.phase = 'form'; render() } }),
      )

      var num = 0
      var sheet = W.h('div')
      sheet.appendChild(
        W.h(
          'div',
          { style: { textAlign: 'center', marginBottom: '16px', borderBottom: '2px solid var(--fg)', paddingBottom: '12px' } },
          W.h('h2', { style: { fontSize: '20px', margin: '0' } }, '温故知新 · ' + p.subject + '练习卷'),
          W.h('div', { class: 'muted small', style: { marginTop: '6px' } }, p.date + ' · 范围: ' + p.chapterLabel),
        ),
      )

      for (var si = 0; si < p.sections.length; si++) {
        var sec = p.sections[si]
        var secTitle = sec.qType === '大题' ? (sec.bigType || '解答题') : qTypeLabel(sec.qType)
        sheet.appendChild(W.h('h3', { style: { fontSize: '15.5px', margin: '16px 0 8px' } }, CN_NUM[si] + '、' + secTitle))
        for (var qi = 0; qi < sec.questions.length; qi++) {
          num++
          var q = sec.questions[qi]
          var qEl = W.h('div', { style: { marginBottom: '14px' } })
          qEl.appendChild(W.h('div', { style: { whiteSpace: 'pre-wrap', lineHeight: '1.9', fontSize: '14.5px' } }, num + '. ' + q.stem))
          var fig = figureBox(q.figure)
          if (fig) qEl.appendChild(fig)
          if (sec.qType === '选择' && q.options && q.options.length === 4) {
            for (var oi = 0; oi < q.options.length; oi++) {
              qEl.appendChild(W.h('div', { style: { paddingLeft: '18px', lineHeight: '1.9', fontSize: '14px' } }, LETTERS[oi] + '. ' + q.options[oi]))
            }
          } else if (sec.qType === '填空') {
            qEl.appendChild(W.h('div', { style: { height: '26px', borderBottom: '1px solid var(--border-strong)', margin: '10px 0 0 18px' } }))
          } else {
            for (var li = 0; li < 3; li++) {
              qEl.appendChild(W.h('div', { style: { height: '30px', borderBottom: '1px solid var(--border)', margin: '16px 0 0 18px' } }))
            }
          }
          sheet.appendChild(qEl)
        }
      }

      var sheetCard = W.h('div', { class: 'card', style: { padding: '28px', maxWidth: '820px', margin: '0 auto' } }, sheet)
      return [top, sheetCard, W.h('div', { class: 'mt-3' }, answerCard(p))]
    }

    function render() {
      rootEl.innerHTML = ''
      var parts = []
      if (state.phase === 'form') parts = formScreen()
      else if (state.phase === 'gen') parts = [genScreen()]
      else parts = paperScreen()
      for (var i = 0; i < parts.length; i++) if (parts[i]) rootEl.appendChild(parts[i])
    }

    render()
  }

  // ================= 6. 背诵打卡 =================

  W.views.recite = function (rootEl, view, ctx) {
    var items = W.data.reciteItems()
    var state = { subject: '全部', grade: '全部', category: '全部' }
    var listWrap = null

    var STATUS = {
      todo: { label: '未开始', badge: 'badge-soft' },
      learning: { label: '背诵中', badge: 'badge-warning' },
      recited: { label: '已背下', badge: 'badge-success' },
      mastered: { label: '默写过关', badge: 'badge-info' },
    }
    var NEXT = { todo: '开始背诵', learning: '背下来了', recited: '默写过关' }

    function clozeText(text) {
      var n = 0, out = ''
      for (var i = 0; i < text.length; i++) {
        var ch = text[i]
        if (/[\u4e00-\u9fff]/.test(ch)) {
          n++
          out += n % 5 === 0 ? '□' : ch
        } else {
          out += ch
        }
      }
      return out
    }

    function catBadge(cat) {
      var map = { '古诗词': 'badge-primary', '文言文': 'badge-warning', '道法观点': 'badge-success' }
      return W.h('span', { class: 'badge ' + (map[cat] || 'badge-soft') }, cat)
    }

    function openDetail(it) {
      var cloze = false
      var speaking = false
      var textEl = W.h('div', { class: 'recite-text' }, it.text)
      function paintText() { textEl.textContent = cloze ? clozeText(it.text) : it.text }

      var readBtn = W.h('button', { class: 'btn btn-outline', type: 'button' })
      function paintRead() {
        readBtn.innerHTML = ''
        readBtn.appendChild(W.icon(speaking ? 'volume-x' : 'volume', 15))
        readBtn.appendChild(document.createTextNode(speaking ? '停止朗读' : '朗读全文'))
      }
      readBtn.addEventListener('click', function () {
        if (!W.ai.speakSupported()) {
          W.toast('当前浏览器不支持语音朗读', 'error')
          return
        }
        if (speaking) {
          W.ai.stopSpeak()
          speaking = false
          paintRead()
        } else {
          speaking = true
          paintRead()
          W.ai.speak(it.text, function () { speaking = false; paintRead() })
        }
      })

      var clozeBtn = W.h('button', { class: 'btn btn-outline', type: 'button' })
      function paintCloze() {
        clozeBtn.innerHTML = ''
        clozeBtn.appendChild(W.icon(cloze ? 'eye' : 'pencil', 15))
        clozeBtn.appendChild(document.createTextNode(cloze ? '还原全文' : '挖空自测'))
      }
      clozeBtn.addEventListener('click', function () {
        cloze = !cloze
        paintText()
        paintCloze()
      })

      paintRead()
      paintCloze()
      W.modal({
        title: it.title,
        content: W.h(
          'div',
          {},
          W.h('div', { class: 'muted small mb-1' }, (it.author ? it.author + ' · ' : '') + it.subject + ' · ' + it.grade + ' · ' + it.category),
          textEl,
          W.h('div', { class: 'row-wrap mt-2 no-print' }, readBtn, clozeBtn),
        ),
        cancelText: '关闭',
        onClose: function () { if (speaking) W.ai.stopSpeak() },
      })
    }

    function reciteRow(it) {
      var rec = W.store.recitations[it.id]
      var status = rec && rec.status ? rec.status : 'todo'
      var st = STATUS[status] || STATUS.todo
      var checkins = rec && rec.checkins ? rec.checkins.length : 0

      var left = W.h(
        'div',
        { class: 'flex-1', style: { minWidth: '0' } },
        W.h(
          'div',
          { class: 'row-wrap', style: { gap: '8px' } },
          W.h('span', { style: { fontWeight: '700', cursor: 'pointer' }, title: '点击查看全文', onclick: function () { openDetail(it) } }, it.title),
          it.author ? W.h('span', { class: 'muted small' }, it.author) : null,
          catBadge(it.category),
          W.h('span', { class: 'badge badge-soft' }, gradeShort(it.grade)),
          W.h('span', { class: 'badge ' + st.badge }, st.label),
        ),
        it.brief ? W.h('div', { class: 'muted small', style: { marginTop: '4px' } }, it.brief) : null,
        checkins ? W.h('div', { class: 'muted small', style: { marginTop: '3px' } }, '打卡 ' + checkins + ' 次') : null,
      )

      var right = W.h('div', { class: 'row-wrap', style: { flexShrink: '0' } })
      right.appendChild(
        W.ui.btn('打卡', {
          variant: 'primary', size: 'sm', icon: 'check',
          onClick: function () {
            var ok = W.checkinRecitation(it.id)
            W.toast(ok ? '打卡成功, 坚持就是胜利' : '今日已打过卡', ok ? 'success' : 'error')
          },
        }),
      )
      if (NEXT[status]) {
        var nextStatus = status === 'todo' ? 'learning' : status === 'learning' ? 'recited' : 'mastered'
        right.appendChild(
          W.ui.btn(NEXT[status], {
            variant: 'outline', size: 'sm',
            onClick: function () {
              W.setRecitation(it.id, { status: nextStatus })
              W.toast(nextStatus === 'mastered' ? '恭喜, 默写过关!' : nextStatus === 'recited' ? '已标记背下来了' : '开始背诵, 加油', 'success')
            },
          }),
        )
      }
      return W.h('div', { class: 'recite-item-row' }, left, right)
    }

    function filtered() {
      return items.filter(function (it) {
        if (state.subject !== '全部' && it.subject !== state.subject) return false
        if (state.grade !== '全部' && it.grade !== state.grade) return false
        if (state.category !== '全部' && it.category !== state.category) return false
        return true
      })
    }

    function renderList() {
      if (!listWrap) return
      listWrap.innerHTML = ''
      var list = filtered()
      if (!list.length) {
        listWrap.appendChild(W.ui.emptyState('book-open', '没有符合条件的内容', '调整上面的筛选条件再试试'))
        return
      }
      var cardEl = W.h('div', { class: 'card list-card' })
      for (var i = 0; i < list.length; i++) cardEl.appendChild(reciteRow(list[i]))
      listWrap.appendChild(cardEl)
    }

    function headerStats() {
      var recitedN = 0, masteredN = 0
      for (var i = 0; i < items.length; i++) {
        var rec = W.store.recitations[items[i].id]
        var stt = rec && rec.status ? rec.status : 'todo'
        if (stt === 'recited' || stt === 'mastered') recitedN++
        if (stt === 'mastered') masteredN++
      }
      function cell(num, label, icon, color) {
        return W.h(
          'div',
          { style: { flex: '1', minWidth: '110px', textAlign: 'center' } },
          W.h('div', { class: 'stat-num', style: color ? { color: color } : null }, String(num)),
          W.h('div', { class: 'stat-label', style: { justifyContent: 'center' } }, W.icon(icon, 13), label),
        )
      }
      return W.ui.card(
        W.h(
          'div',
          { class: 'row-wrap', style: { justifyContent: 'space-around' } },
          cell(items.length, '篇目总数', 'layers'),
          cell(recitedN, '已背下', 'check-circle', 'var(--success)'),
          cell(masteredN, '默写过关', 'trophy', 'var(--primary)'),
          cell(W.store.streak, '连续打卡天数', 'flame', 'var(--warning)'),
        ),
      )
    }

    function render() {
      rootEl.innerHTML = ''
      rootEl.appendChild(pageHead('book-open-check', '背诵打卡', '必背古诗词、文言文与道法观点; 点击标题可查看全文、朗读与挖空自测'))
      rootEl.appendChild(headerStats())

      var gradeOptions = []
      for (var gi = 0; gi < W.data.gradeOrder.length; gi++) {
        var g = W.data.gradeOrder[gi]
        for (var ii = 0; ii < items.length; ii++) {
          if (items[ii].grade === g) { gradeOptions.push(g); break }
        }
      }
      function segOf(key, opts) {
        var arr = [{ v: '全部', label: '全部' }]
        for (var i = 0; i < opts.length; i++) {
          arr.push({ v: opts[i], label: key === 'grade' ? gradeShort(opts[i]) : opts[i] })
        }
        return segGroup(arr, state[key], function (v) { state[key] = v; renderList() })
      }
      rootEl.appendChild(
        W.ui.card(
          W.h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            fieldBlock('学科', segOf('subject', ['语文', '道德与法治'])),
            fieldBlock('年级', segOf('grade', gradeOptions)),
            fieldBlock('类别', segOf('category', ['古诗词', '文言文', '道法观点'])),
          ),
        ),
      )

      listWrap = W.h('div', { class: 'mt-2' })
      rootEl.appendChild(listWrap)
      renderList()
    }

    render()
    var unsub = W.storeSubscribe(W.debounce(function () {
      if (rootEl.isConnected) {
        render()
      }
    }, 250))
    ctx.addCleanup(unsub)
  }
})()
