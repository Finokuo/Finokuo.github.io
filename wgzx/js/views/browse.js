// 温故知新静态版 · 浏览类视图
// 学科浏览 / 章节列表 / 知识点详情(讲解 + 闪卡自评 + 例题揭示 + AI 工具) / 搜索 / 我的收藏 / 按课本浏览
// 依赖: core.js → store.js → data.js → ui.js → ai.js(先加载), app.js(后加载); 纯内存数据, 无 fetch
;(function () {
  'use strict'

  const W = window.W
  if (!W.views) W.views = {} // 兜底: 视图注册表须在 app.js 之前就绪

  // ==================== 通用小工具 ====================

  const HOME_TITLE = '温故知新 · 初中全科复习'
  const RATING_LABEL = { good: '会了', fuzzy: '模糊', bad: '不会' }

  /** 冒号型/括号型答案标记(与原版 splitExample 同规则, 冒号型前一字符不能是「解回问作简」) */
  const COLON_MARKER_RE = /([^解回问作简])(解答|答案示例|答案|解析|答)\s*[:：]/
  const BRACKET_MARKER_RE = /[【[]\s*(解答|答案|解析|解)\s*[】\]]/

  /** hex → rgba 透明色(用于学科色渐变底) */
  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''))
    if (!m) return 'rgba(194,41,32,' + alpha + ')'
    const n = parseInt(m[1], 16)
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')'
  }

  /** 页面大标题(设计系统未提供对应工具类, 统一在这里定样式) */
  function pageH1(text) {
    return W.h('h1', { style: { fontSize: '24px', fontWeight: '800', letterSpacing: '0.3px' } }, text)
  }

  /** 可点击的学科 chip(保留学科图标与颜色) */
  function chipButton(subject, onClick) {
    const btn = W.h('button', {
      type: 'button',
      style: { background: 'none', border: 'none', padding: '0', cursor: 'pointer' },
      onclick: onClick,
      title: '进入' + subject.name + '学科',
      'aria-label': '进入' + subject.name + '学科',
    })
    btn.appendChild(W.ui.subjectChip(subject))
    return btn
  }

  /** 面包屑/次级链接(复用 section-more 样式: 灰字, hover 变主色) */
  function crumb(text, onClick, title) {
    return W.h('button', { class: 'section-more', type: 'button', onclick: onClick, title: title || text }, text)
  }

  /** 未知资源空态 + 回首页按钮 */
  function unknownView(icon, title, hint) {
    return W.ui.emptyState(icon, title, hint, W.ui.btn('回首页', { variant: 'primary', onClick: function () { W.go('home') } }))
  }

  /** 详情页通用区块: 图标标题 + 内容容器 */
  function block(icon, title, inner) {
    return W.h('div', { class: 'kp-block' }, W.h('div', { class: 'kp-block-title' }, W.icon(icon, 16), title), inner)
  }

  /** 按平台年级顺序排列 grade 名(数据中未知的 grade 追加在后, 保持出现顺序) */
  function orderedGrades(chapters) {
    const out = []
    for (const g of W.data.gradeOrder) {
      for (const ch of chapters) {
        if (ch.grade === g) { out.push(g); break }
      }
    }
    for (const ch of chapters) {
      if (out.indexOf(ch.grade) < 0) out.push(ch.grade)
    }
    return out
  }

  /** 双换行分段, 段内单换行转 <br>; 全部走文本节点, 不拼 HTML */
  function paragraphs(text) {
    const box = W.h('div')
    const parts = String(text || '').split(/\n\s*\n/)
    for (const part of parts) {
      const p = W.h('p')
      const lines = part.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) p.appendChild(W.h('br'))
        if (lines[i]) p.appendChild(document.createTextNode(lines[i]))
      }
      box.appendChild(p)
    }
    return box
  }

  /** 拆分例题: 题面 + 答案(取两种标记中最早出现者); 拆不开则整段视为隐藏模式 */
  function splitExample(example) {
    const text = String(example || '').trim()
    let hit = null
    const colon = COLON_MARKER_RE.exec(text)
    if (colon && colon.index > 0) {
      hit = { index: colon.index + 1, end: colon.index + colon[0].length, label: colon[2] }
    }
    const bracket = BRACKET_MARKER_RE.exec(text)
    if (bracket && bracket.index > 0 && (!hit || bracket.index < hit.index)) {
      hit = { index: bracket.index, end: bracket.index + bracket[0].length, label: bracket[1] }
    }
    if (hit) {
      const question = text.slice(0, hit.index).trim().replace(/[,，;；、]\s*$/, '')
      if (question) return { mode: 'marker', question: question, answer: text.slice(hit.end).trim(), label: hit.label }
    }
    return { mode: 'whole', question: '', answer: '', label: '答案' }
  }

  /** 例题区块: marker 模式题面可见/答案点击显示; whole 模式整段点击显示; 不持久化状态 */
  function exampleBlock(kp) {
    const parsed = splitExample(kp.example)
    const inner = W.h('div', { class: 'kp-block-inner' })

    function hintText() {
      return parsed.mode === 'marker' ? '先自己想一想, 再对答案' : '先自己想一想, 再看完整例题'
    }

    if (parsed.mode === 'marker') {
      inner.appendChild(W.h('div', { class: 'kp-content' }, paragraphs(parsed.question)))
      const area = W.h('div', { class: 'example-reveal' })
      function showAnswer() {
        area.innerHTML = ''
        const box = W.h('div', {
          style: { background: 'var(--warning-soft)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: '10px', padding: '10px 12px', lineHeight: '1.8' },
        })
        box.appendChild(W.h('div', {}, W.h('strong', {}, parsed.label + ': '), parsed.answer))
        box.appendChild(W.h('button', { class: 'section-more', type: 'button', style: { marginTop: '2px' }, onclick: hideAnswer }, '收起' + parsed.label))
        area.appendChild(box)
      }
      function hideAnswer() {
        area.innerHTML = ''
        area.appendChild(W.h('div', { class: 'row' },
          W.h('button', { class: 'reveal-btn', type: 'button', onclick: showAnswer }, W.icon('eye', 15), '点击显示答案'),
          W.h('span', { class: 'small muted' }, hintText()),
        ))
      }
      hideAnswer()
      inner.appendChild(area)
      return block('pencil', '典型例题', inner)
    }

    // 无法拆分: 整段隐藏, 点击后展开
    const content = W.h('div', { class: 'kp-content' }, paragraphs(kp.example))
    content.style.display = 'none'
    const btnWrap = W.h('div', { class: 'example-reveal' })
    btnWrap.appendChild(W.h('div', { class: 'row' },
      W.h('button', {
        class: 'reveal-btn',
        type: 'button',
        onclick: function () { content.style.display = ''; btnWrap.style.display = 'none' },
      }, W.icon('eye', 15), '点击显示答案'),
      W.h('span', { class: 'small muted' }, hintText()),
    ))
    inner.appendChild(content)
    inner.appendChild(btnWrap)
    return block('pencil', '典型例题', inner)
  }

  /**
   * 回收 kpCard/kpActions 留下的 store 订阅。
   * ui.kpActions 在卡片尚未挂载时创建, closest('.view') 找不到根节点,
   * 会把退订函数暂存在 .kp-actions 元素的 __unsub 上; 这里统一收集,
   * 视图卸载时连同 rootEl.__cleanups 一起退订, 避免列表重绘后监听器泄漏。
   */
  function makeUnsubCollector(rootEl, ctx) {
    const pending = []
    function collect() {
      const wraps = rootEl.querySelectorAll('.kp-actions')
      for (let i = 0; i < wraps.length; i++) {
        const u = wraps[i].__unsub
        if (typeof u === 'function' && !wraps[i].__unsubTaken) {
          wraps[i].__unsubTaken = true
          pending.push(u)
        }
      }
    }
    ctx.addCleanup(function () {
      const all = (rootEl.__cleanups || []).slice()
      for (let i = 0; i < pending.length; i++) all.push(pending[i])
      for (let i = 0; i < all.length; i++) { try { all[i]() } catch (e) { /* 忽略 */ } }
    })
    return collect
  }

  // ==================== 1. 学科视图 ====================

  W.views.subject = function (rootEl, view, ctx) {
    const subject = W.data.getSubject(view.slug)
    if (!subject) {
      rootEl.appendChild(unknownView('book-open', '学科不存在', '该学科可能未收录或链接有误, 回首页重新浏览'))
      return
    }

    const allKps = []
    for (const ch of subject.chapters) for (const kp of ch.kps) allKps.push(kp)

    // 学科横幅: 学科色渐变浅底 + 图标/名称/简介 + 总进度
    const prog = W.ui.progress(0, subject.color, true)
    const bannerBarEl = prog.firstChild
    const bannerMetaEl = W.h('span', { class: 'small muted', style: { whiteSpace: 'nowrap' } })

    rootEl.appendChild(W.h('div', {
      class: 'card',
      style: { background: 'linear-gradient(135deg, ' + hexToRgba(subject.color, 0.12) + ', ' + hexToRgba(subject.color, 0.04) + ')' },
    },
      W.h('div', { class: 'row-wrap' },
        W.ui.subjectIcon(subject, 30),
        W.h('div', { class: 'flex-1' },
          pageH1(subject.name),
          W.h('p', { class: 'muted small mt-1' }, subject.description),
          W.h('div', { class: 'row-wrap mt-2' },
            W.ui.badge(subject.chapters.length + ' 章'),
            W.ui.badge(allKps.length + ' 个知识点'),
          ),
        ),
      ),
      W.h('div', { class: 'row mt-3' },
        W.h('div', { class: 'flex-1' }, prog),
        bannerMetaEl,
      ),
    ))

    // 章节按年级分组
    const rowRefs = []
    for (const grade of orderedGrades(subject.chapters)) {
      const chs = subject.chapters.filter(function (c) { return c.grade === grade })
      if (!chs.length) continue
      const group = W.h('div', { class: 'grade-group mt-3' })
      group.appendChild(W.h('div', { class: 'grade-title' }, grade + ' · ' + chs.length + ' 章'))
      const listCard = W.h('div', { class: 'card list-card' })
      for (const ch of chs) {
        const metaEl = W.h('span', { class: 'chapter-meta' })
        const bar = W.h('div')
        const openChapter = function () { W.go('chapter', { uid: ch.uid }) }
        listCard.appendChild(W.h('div', {
          class: 'chapter-row',
          role: 'button',
          tabindex: '0',
          'aria-label': '进入章节: ' + ch.name,
          onclick: openChapter,
          onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChapter() } },
        },
          W.h('span', { class: 'chapter-name' }, ch.name),
          metaEl,
          W.h('div', { class: 'progress', style: { width: '76px', flexShrink: '0' } }, bar),
          W.icon('chevron-right', 16),
        ))
        rowRefs.push({ kps: ch.kps, metaEl: metaEl, barEl: bar })
      }
      group.appendChild(listCard)
      rootEl.appendChild(group)
    }

    // store 变化 → 原位更新进度数字(不整页重绘, 避免滚动位置跳回顶部)
    function paintProgress() {
      const n = W.data.learnedCount(allKps)
      bannerMetaEl.textContent = '已学 ' + n + ' / ' + allKps.length
      bannerBarEl.style.width = (allKps.length ? Math.round(n / allKps.length * 100) : 0) + '%'
      for (const ref of rowRefs) {
        const cn = W.data.learnedCount(ref.kps)
        ref.metaEl.textContent = cn + '/' + ref.kps.length + ' 已学'
        ref.barEl.style.width = (ref.kps.length ? Math.round(cn / ref.kps.length * 100) : 0) + '%'
      }
    }
    paintProgress()
    ctx.addCleanup(W.storeSubscribe(paintProgress))
  }

  // ==================== 2. 章节视图 ====================

  W.views.chapter = function (rootEl, view, ctx) {
    const found = W.data.getChapter(view.uid)
    if (!found) {
      rootEl.appendChild(unknownView('book-open', '章节不存在', '链接可能已失效, 回首页重新浏览'))
      return
    }
    const chapter = found.chapter
    const subject = found.subject
    const kps = chapter.kps || []
    const collectUnsubs = makeUnsubCollector(rootEl, ctx)

    // 头部: 学科 chip + 年级徽章 + 章节名
    rootEl.appendChild(W.h('div', { class: 'row-wrap' },
      chipButton(subject, function () { W.go('subject', { slug: subject.slug }) }),
      W.ui.badge(chapter.grade),
    ))
    rootEl.appendChild(pageH1(chapter.name))

    // 已学进度 + 随机抽 1 个
    const prog = W.ui.progress(0, subject.color)
    const barEl = prog.firstChild
    const metaEl = W.h('span', { class: 'small muted', style: { whiteSpace: 'nowrap' } })

    function randomPick() {
      if (!kps.length) return
      const pick = kps[Math.floor(Math.random() * kps.length)]
      W.go('kp', { uid: pick.uid })
    }
    function paintProgress() {
      const n = W.data.learnedCount(kps)
      metaEl.textContent = '已学 ' + n + ' / ' + kps.length
      barEl.style.width = (kps.length ? Math.round(n / kps.length * 100) : 0) + '%'
    }

    rootEl.appendChild(W.h('div', { class: 'row mt-2' },
      W.h('div', { class: 'flex-1' }, prog),
      metaEl,
      W.ui.btn('随机抽一个', { variant: 'outline', size: 'sm', icon: 'dice', onClick: randomPick }),
    ))

    // 知识点卡片列表
    const list = W.h('div', { class: 'list-stack mt-3' })
    if (!kps.length) {
      list.appendChild(W.ui.emptyState('book-open', '本章内容正在准备中', '知识点即将上线'))
    } else {
      for (const kp of kps) list.appendChild(W.ui.kpCard({ kp: kp, chapter: chapter, subject: subject }, {}))
    }
    rootEl.appendChild(list)

    collectUnsubs()
    paintProgress()
    ctx.addCleanup(W.storeSubscribe(paintProgress))
  }

  // ==================== 3. 知识点详情视图 ====================

  W.views.kp = function (rootEl, view, ctx) {
    const found = W.data.getKP(view.uid)
    if (!found) {
      rootEl.appendChild(unknownView('book-open', '知识点不存在', '链接可能已失效, 回首页重新浏览'))
      return
    }
    const kp = found.kp
    const chapter = found.chapter
    const subject = found.subject
    const prevUid = found.prevUid
    const nextUid = found.nextUid
    const collectUnsubs = makeUnsubCollector(rootEl, ctx)

    document.title = kp.title + ' - 温故知新'
    ctx.addCleanup(function () { document.title = HOME_TITLE })

    // 顶部信息条: 学科 / 年级 / 章节 / 类型 / 难度
    rootEl.appendChild(W.h('div', { class: 'kp-header-bar' },
      chipButton(subject, function () { W.go('subject', { slug: subject.slug }) }),
      W.ui.badge(chapter.grade),
      crumb(chapter.name, function () { W.go('chapter', { uid: chapter.uid }) }, '进入章节: ' + chapter.name),
      W.ui.typeBadge(kp.type),
      W.ui.diffBadge(kp.difficulty),
    ))

    // 标题 + 已学/收藏操作
    rootEl.appendChild(W.h('div', { class: 'kp-title-block kp-detail' },
      W.h('h1', {}, kp.title),
      W.ui.kpActions(kp.uid),
    ))

    // 闪卡自评: 会了/模糊/不会 → SRS 推进
    const RATING_DEFS = [
      { key: 'good', label: '会了', sub: '记得牢固', icon: 'check-circle' },
      { key: 'fuzzy', label: '模糊', sub: '印象不深', icon: 'refresh' },
      { key: 'bad', label: '不会', sub: '需要重学', icon: 'x' },
    ]
    const ratingWrap = W.h('div', { class: 'rating-row' })
    const ratingBtns = []
    for (const def of RATING_DEFS) {
      const btn = W.h('button', {
        type: 'button',
        onclick: function () {
          W.reviewKP(kp.uid, def.key)
          W.toast('已记录: ' + def.label + ', 复习安排已更新', 'success', 1600)
        },
      },
        W.icon(def.icon, 17),
        W.h('span', { class: 'lbl' }, def.label),
        W.h('span', { class: 'sub' }, def.sub),
      )
      ratingBtns.push({ key: def.key, btn: btn })
      ratingWrap.appendChild(btn)
    }
    const statusEl = W.h('div', { class: 'small muted', style: { marginTop: '8px' } })

    function paintRating() {
      const cur = W.store.ratings[kp.uid]
      for (const item of ratingBtns) {
        const active = cur === item.key
        item.btn.className = W.cls('btn', active ? 'btn-primary' : 'btn-outline', 'rating-btn')
        if (active) item.btn.setAttribute('aria-pressed', 'true')
        else item.btn.removeAttribute('aria-pressed')
      }
      const srs = W.store.srs[kp.uid]
      const parts = []
      if (cur) parts.push('上次自评: ' + (RATING_LABEL[cur] || cur))
      if (srs) parts.push('盒子 ' + srs.box + ' · 下次复习 ' + W.fmtDateTime(srs.due))
      statusEl.textContent = parts.length
        ? parts.join(' · ')
        : '读完讲解后自评一次, 系统按记忆曲线安排下次复习'
    }
    paintRating()
    rootEl.appendChild(ratingWrap)
    rootEl.appendChild(statusEl)
    ctx.addCleanup(W.storeSubscribe(paintRating))

    // 知识讲解
    if (kp.content) {
      rootEl.appendChild(block('book-open', '知识讲解', W.h('div', { class: 'kp-block-inner' }, W.h('div', { class: 'kp-content' }, paragraphs(kp.content)))))
    }

    // 核心要点
    if (kp.keyPoints && kp.keyPoints.length) {
      const ul = W.h('ul', { class: 'kp-keypoint-list' })
      for (const point of kp.keyPoints) ul.appendChild(W.h('li', {}, point))
      rootEl.appendChild(block('lightbulb', '核心要点', W.h('div', { class: 'kp-block-inner' }, ul)))
    }

    // 典型例题(答案默认隐藏)
    if (kp.example) rootEl.appendChild(exampleBlock(kp))

    // 拓展深化 / 易错警示 / 中考考法
    if (kp.extension) {
      rootEl.appendChild(block('sparkles', '拓展深化', W.h('div', { class: 'kp-block-inner extension' }, W.h('div', { class: 'kp-content' }, paragraphs(kp.extension)))))
    }
    if (kp.traps) {
      rootEl.appendChild(block('alert', '易错警示', W.h('div', { class: 'kp-block-inner traps' }, W.h('div', { class: 'kp-content' }, paragraphs(kp.traps)))))
    }
    if (kp.examFocus) {
      rootEl.appendChild(block('target', '中考考法', W.h('div', { class: 'kp-block-inner exam' }, W.h('div', { class: 'kp-content' }, paragraphs(kp.examFocus)))))
    }

    // 标签
    rootEl.appendChild(W.h('div', { class: 'kp-block' }, W.ui.tagChips(kp.tags)))

    // 工具行: 问小知 / 朗读 / 费曼讲解评估
    const tools = W.h('div', { class: 'row-wrap mt-3' })
    tools.appendChild(W.ui.btn('问小知', {
      variant: 'outline',
      icon: 'message',
      onClick: function () { W.ai.setContext({ title: kp.title, content: kp.content }); W.ai.openPanel() },
    }))

    if (W.ai.speakSupported()) {
      let speaking = false
      const speakBtn = W.ui.btn('朗读', { variant: 'outline', icon: 'volume', onClick: toggleSpeak })
      function paintSpeak() {
        speakBtn.innerHTML = ''
        speakBtn.appendChild(W.icon(speaking ? 'volume-x' : 'volume', 16))
        speakBtn.appendChild(document.createTextNode(speaking ? '停止朗读' : '朗读'))
        speakBtn.title = speaking ? '停止朗读' : '朗读知识点'
        speakBtn.setAttribute('aria-label', speakBtn.title)
      }
      function toggleSpeak() {
        if (speaking) {
          W.ai.stopSpeak()
          speaking = false
          paintSpeak()
          return
        }
        const ok = W.ai.speak(kp.title + '。' + kp.content, function () { speaking = false; paintSpeak() })
        if (ok) { speaking = true; paintSpeak() } else { W.toast('当前浏览器不支持语音朗读', 'error') }
      }
      paintSpeak()
      tools.appendChild(speakBtn)
      ctx.addCleanup(function () { W.ai.stopSpeak() })
    }

    tools.appendChild(W.ui.btn('AI 讲解评估 (费曼)', { variant: 'primary', icon: 'graduation', onClick: openTeachModal }))
    rootEl.appendChild(tools)

    // 上一个 / 下一个
    const prevCtx = prevUid ? W.data.getKP(prevUid) : null
    const nextCtx = nextUid ? W.data.getKP(nextUid) : null
    const navRow = W.h('div', { class: 'kp-nav-row' },
      W.h('button', {
        class: 'btn btn-outline',
        type: 'button',
        disabled: prevCtx ? null : true,
        style: { maxWidth: '46%' },
        title: prevCtx ? prevCtx.kp.title : '',
        onclick: function () { if (prevUid) W.go('kp', { uid: prevUid }) },
      },
        W.icon('chevron-left', 16),
        W.h('span', { class: 'truncate' }, prevCtx ? prevCtx.kp.title : '已是第一个'),
      ),
      W.h('span', { class: 'muted', style: { flexShrink: '0', opacity: '0.5' } }, W.icon('lightbulb', 15)),
      W.h('button', {
        class: 'btn btn-outline',
        type: 'button',
        disabled: nextCtx ? null : true,
        style: { maxWidth: '46%' },
        title: nextCtx ? nextCtx.kp.title : '',
        onclick: function () { if (nextUid) W.go('kp', { uid: nextUid }) },
      },
        W.h('span', { class: 'truncate' }, nextCtx ? nextCtx.kp.title : '已是最后一个'),
        W.icon('chevron-right', 16),
      ),
    )
    rootEl.appendChild(navRow)

    collectUnsubs()

    // ---- 费曼讲解评估弹窗 ----
    const TEACH_LEVELS = { excellent: ['讲得透', 'success'], good: ['基本到位', 'warning'], gaps: ['有缺口', 'danger'] }

    function openTeachModal() {
      const ta = W.h('textarea', {
        class: 'textarea',
        placeholder: '用你自己的话讲讲「' + kp.title + '」…可以打比方、举例子, 讲得越具体评估越准(至少 15 字)',
        'aria-label': '用自己的话讲解这个知识点',
      })
      const countEl = W.h('div', { class: 'small muted', style: { textAlign: 'right', marginTop: '4px' } })
      const resultBox = W.h('div', { class: 'mt-2' })
      const errBox = W.h('div', { class: 'mt-2' })
      let loading = false

      const submitBtn = W.h('button', { class: 'btn btn-primary', type: 'button', onclick: submit, style: { marginTop: '10px', alignSelf: 'flex-start' } })
      function paintSubmit() {
        ta.disabled = loading
        submitBtn.innerHTML = ''
        if (loading) {
          submitBtn.disabled = true
          submitBtn.appendChild(W.icon('loader', 16))
          submitBtn.appendChild(document.createTextNode('小知正在听… (约需十几秒)'))
          return
        }
        submitBtn.disabled = ta.value.trim().length < 15
        submitBtn.appendChild(W.icon('send', 16))
        submitBtn.appendChild(document.createTextNode('提交给小知评估'))
      }
      function updateCount() {
        const n = ta.value.trim().length
        countEl.textContent = n + ' 字' + (n < 15 ? ' (至少 15 字)' : '')
        if (!loading) submitBtn.disabled = n < 15
      }
      ta.addEventListener('input', updateCount)

      function renderTeachResult(box, res) {
        box.innerHTML = ''
        const lv = TEACH_LEVELS[res.level] || TEACH_LEVELS.gaps
        const card = W.h('div', { class: 'card card-pad-sm' })

        card.appendChild(W.h('div', { class: 'row-wrap' },
          W.h('span', { style: { fontSize: '30px', fontWeight: '800', lineHeight: '1' } }, res.score == null ? '—' : String(res.score)),
          W.h('span', { class: 'muted small' }, '分'),
          W.ui.badge(lv[0], lv[1]),
        ))

        const strengths = Array.isArray(res.strengths) ? res.strengths : []
        if (strengths.length) {
          const ul = W.h('ul', { style: { margin: '6px 0 0', padding: '0', listStyle: 'none' } })
          for (const s of strengths) {
            ul.appendChild(W.h('li', { class: 'row', style: { alignItems: 'flex-start' } },
              W.h('span', { style: { color: 'var(--success)', flexShrink: '0', marginTop: '3px' } }, W.icon('check-circle', 14)),
              W.h('span', { style: { fontSize: '13.5px', lineHeight: '1.7' } }, String(s)),
            ))
          }
          card.appendChild(W.h('div', { class: 'mt-2' },
            W.h('div', { style: { fontWeight: '700', fontSize: '13.5px' } }, '讲对的点'),
            ul,
          ))
        }

        const gaps = Array.isArray(res.gaps) ? res.gaps : []
        const gapsBody = gaps.length
          ? (function () {
            const ul = W.h('ul', { style: { margin: '6px 0 0', padding: '0', listStyle: 'none' } })
            for (const g of gaps) {
              ul.appendChild(W.h('li', { class: 'row', style: { alignItems: 'flex-start' } },
                W.h('span', { style: { color: 'var(--warning)', flexShrink: '0', marginTop: '3px' } }, W.icon('alert', 14)),
                W.h('span', { style: { fontSize: '13.5px', lineHeight: '1.7' } }, String(g)),
              ))
            }
            return ul
          })()
          : W.h('p', { class: 'small muted mt-1' }, '没有发现明显漏洞, 讲得很完整!')
        card.appendChild(W.h('div', { class: 'mt-2' },
          W.h('div', { style: { fontWeight: '700', fontSize: '13.5px' } }, '有待补的漏洞'),
          gapsBody,
        ))

        if (res.suggestion) {
          card.appendChild(W.h('blockquote', {
            style: { margin: '12px 0 0', borderLeft: '3px solid rgba(194,41,32,0.5)', paddingLeft: '10px', fontSize: '13.5px', lineHeight: '1.7' },
          }, String(res.suggestion)))
        }

        card.appendChild(W.h('div', { class: 'mt-2' },
          W.ui.btn('再讲一遍', {
            variant: 'outline',
            size: 'sm',
            icon: 'refresh',
            onClick: function () { box.innerHTML = ''; ta.value = ''; updateCount() },
          })))

        box.appendChild(card)
      }

      function submit() {
        if (loading) return
        const explanation = ta.value.trim()
        if (explanation.length < 15) return
        loading = true
        errBox.innerHTML = ''
        resultBox.innerHTML = ''
        paintSubmit()
        W.ai.teachCheck({ title: kp.title, content: kp.content, explanation: explanation, subject: subject.name })
          .then(function (res) {
            W.bumpActivity('recalls', 2)
            W.toast('小知已听完你的讲解', 'success')
            renderTeachResult(resultBox, res || {})
          })
          .catch(function (e) {
            const msg = e && e.message ? e.message : '评估失败, 请重试'
            W.toast(msg, 'error')
            errBox.innerHTML = ''
            errBox.appendChild(W.ui.errorCard(msg))
          })
          .then(function () {
            loading = false
            paintSubmit()
          })
      }

      let aiHint = null
      if (!W.ai.hasAI()) {
        aiHint = W.h('div', {
          class: 'card card-pad-sm',
          style: { background: 'var(--info-soft)', borderColor: 'rgba(15,118,110,0.3)', fontSize: '13px', padding: '12px 14px' },
        },
          W.h('div', { class: 'row' }, W.icon('info', 15), W.h('span', {}, '尚未连接 AI 服务, 讲解评估需要 AI 支持; 也可以先自己对照要点检查。')),
          W.h('div', { class: 'mt-1' }, W.ui.btn('配置 AI 服务', { variant: 'outline', size: 'sm', icon: 'settings', onClick: function () { W.ai.openSettings() } })),
        )
      }

      const col = W.h('div', { class: 'col' },
        aiHint,
        W.h('p', { class: 'small muted' }, '合上书, 用自己的话把这个知识点讲一遍。小知会对照原文, 指出你讲对的地方和遗漏的漏洞。'),
        ta,
        countEl,
        submitBtn,
        errBox,
        resultBox,
      )
      paintSubmit()
      updateCount()
      W.modal({ title: '讲给小知听 · 费曼式自测', content: col, wide: true })
    }
  }

  // ==================== 4. 搜索视图 ====================

  W.views.search = function (rootEl, view, ctx) {
    let q = String(view.q || '').trim()
    let slug = ''
    const collectUnsubs = makeUnsubCollector(rootEl, ctx)
    const HOT_TAGS = ['中考高频', '易错点', '实验探究', '古诗词', '函数']

    rootEl.appendChild(pageH1('搜索知识点'))

    // 搜索框: 输入即本地实时搜索, 回车/按钮同步到 hash
    const input = W.h('input', {
      class: 'input flex-1',
      type: 'search',
      value: q,
      placeholder: '输入关键词, 如「勾股定理」「光合作用」…',
      'aria-label': '搜索知识点',
    })
    function submit() {
      W.go('search', { q: input.value.trim() })
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit() })
    input.addEventListener('input', W.debounce(function () {
      const v = input.value.trim()
      if (v === q) return
      q = v
      renderResults()
    }, 350))
    rootEl.appendChild(W.h('div', { class: 'row mt-2' },
      input,
      W.ui.btn('搜索', { variant: 'primary', icon: 'search', onClick: submit }),
    ))

    // 学科过滤
    const seg = W.h('div', { class: 'seg mt-2', role: 'group', 'aria-label': '按学科过滤' })
    const segRefs = []
    function paintSeg() {
      for (const r of segRefs) r.btn.classList.toggle('active', r.s === slug)
    }
    const segDefs = [{ label: '全部', s: '' }].concat(W.data.subjects.map(function (s) { return { label: s.name, s: s.slug } }))
    for (const d of segDefs) {
      const btn = W.h('button', {
        class: 'seg-item',
        type: 'button',
        'aria-pressed': 'false',
        onclick: function () { slug = d.s; paintSeg(); renderResults() },
      }, d.label)
      segRefs.push({ btn: btn, s: d.s })
      seg.appendChild(btn)
    }
    rootEl.appendChild(seg)
    paintSeg()

    // 结果区
    const resultsBox = W.h('div', { class: 'mt-3' })
    function hotTagsBlock() {
      const wrap = W.h('div', {},
        W.h('p', { class: 'small muted', style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, W.icon('flame', 15), '热门搜索'),
      )
      const tags = W.h('div', { class: 'row-wrap mt-2' })
      for (const t of HOT_TAGS) {
        tags.appendChild(W.h('button', {
          class: 'badge badge-soft',
          type: 'button',
          style: { border: 'none', cursor: 'pointer', fontSize: '12.5px', padding: '6px 13px' },
          onclick: function () { input.value = t; q = t; renderResults() },
        }, t))
      }
      wrap.appendChild(tags)
      return wrap
    }

    function renderResults() {
      resultsBox.innerHTML = ''
      if (!q) {
        resultsBox.appendChild(hotTagsBlock())
        return
      }
      const results = W.data.search(q, slug)
      resultsBox.appendChild(W.h('p', { class: 'small muted', 'aria-live': 'polite' },
        '找到 ' + results.length + ' 个与「' + q + '」相关的知识点' + (slug ? ' (已按学科过滤)' : '')))
      if (!results.length) {
        resultsBox.appendChild(W.ui.emptyState('search', '没有找到相关知识点', '换个关键词试试, 如「一元二次方程」「光合作用」'))
        return
      }
      const list = W.h('div', { class: 'list-stack mt-2' })
      for (const r of results) {
        list.appendChild(W.ui.kpCard(
          { kp: r.kp, chapter: r.chapter, subject: r.subject },
          { snippet: r.snippet, highlight: q },
        ))
      }
      resultsBox.appendChild(list)
      collectUnsubs()
    }

    rootEl.appendChild(resultsBox)
    renderResults()
    if (!q) input.focus()
  }

  // ==================== 5. 我的收藏 ====================

  W.views.favorites = function (rootEl, view, ctx) {
    const collectUnsubs = makeUnsubCollector(rootEl, ctx)

    const countBadge = W.ui.badge('0', 'badge-primary')
    rootEl.appendChild(W.h('div', { class: 'row' }, pageH1('我的收藏'), countBadge))
    const countEl = W.h('p', { class: 'small muted mt-1' })
    rootEl.appendChild(countEl)
    const listBox = W.h('div', { class: 'list-stack mt-3' })
    rootEl.appendChild(listBox)

    function renderList() {
      listBox.innerHTML = ''
      const entries = Object.entries(W.store.favorites).sort(function (a, b) { return b[1] - a[1] })
      let learnedN = 0
      for (const en of entries) if (en[0] in W.store.learned) learnedN++
      countBadge.textContent = String(entries.length)
      countEl.textContent = '收藏 ' + entries.length + ' · 已掌握 ' + learnedN

      if (!entries.length) {
        listBox.appendChild(W.ui.emptyState('heart', '还没有收藏', '在知识点详情页点击爱心即可收藏'))
        return
      }
      for (const en of entries) {
        const f = W.data.getKP(en[0])
        if (!f) continue
        listBox.appendChild(W.ui.kpCard(f, {}))
      }
      collectUnsubs()
    }

    renderList()
    ctx.addCleanup(W.storeSubscribe(W.debounce(renderList, 150)))
  }

  // ==================== 6. 按课本浏览 ====================

  W.views.textbook = function (rootEl, view, ctx) {
    let slug = W.data.getSubject('chinese')
      ? 'chinese'
      : (W.data.subjects[0] ? W.data.subjects[0].slug : '')

    rootEl.appendChild(pageH1('按课本浏览'))
    rootEl.appendChild(W.h('p', { class: 'small muted mt-1' }, '选择教材版本, 点右侧章节直达对应复习内容。'))

    // 学科选择
    const seg = W.h('div', { class: 'seg mt-2', role: 'group', 'aria-label': '选择学科' })
    function buildSeg() {
      seg.innerHTML = ''
      for (const s of W.data.subjects) {
        seg.appendChild(W.h('button', {
          class: W.cls('seg-item', s.slug === slug && 'active'),
          type: 'button',
          'aria-pressed': s.slug === slug ? 'true' : 'false',
          onclick: function () { slug = s.slug; buildSeg(); renderBody() },
        }, s.name))
      }
    }

    // 章节 chip: 版本目录条目映射到的平台复习章节
    function chapterChip(uid, fallbackName, kpCount) {
      let name = fallbackName
      if (!name) {
        const f = W.data.getChapter(uid)
        name = f ? f.chapter.name : uid
      }
      return W.ui.btn(name + '(' + (kpCount || 0) + ')', {
        variant: 'outline',
        size: 'sm',
        onClick: function () { W.go('chapter', { uid: uid }) },
      })
    }

    const body = W.h('div', { class: 'mt-3' })
    function renderBody() {
      body.innerHTML = ''
      const editions = W.data.editions(slug)
      if (!editions.length) {
        body.appendChild(W.ui.emptyState('book-marked', '暂无教材版本目录', '该学科的课本目录尚未收录, 可从首页按学科浏览'))
        return
      }
      for (const ed of editions) {
        const card = W.h('div', { class: 'card mb-3' })
        card.appendChild(W.h('div', { class: 'row-wrap' },
          W.h('h3', { style: { fontSize: '16px' } }, ed.name),
          ed.fullName ? W.h('span', { class: 'small muted' }, ed.fullName) : null,
        ))

        let gradeCount = 0
        for (const g of ed.grades) {
          if (!g.chapters || !g.chapters.length) continue
          gradeCount++
          card.appendChild(W.h('div', { class: 'grade-title mt-2' }, g.grade + ' · ' + g.chapters.length + ' 章'))
          for (const node of g.chapters) {
            const mapped = node.chapters || []
            const left = W.h('div', { class: 'flex-1' },
              W.h('div', { style: { fontWeight: '600', fontSize: '14px' } }, node.name || ''),
              node.note ? W.h('div', { class: 'small muted' }, node.note) : null,
            )
            const right = W.h('div', { class: 'row-wrap', style: { justifyContent: 'flex-end' } })
            if (!mapped.length) {
              right.appendChild(W.ui.badge('暂未收录'))
            } else {
              for (const m of mapped) right.appendChild(chapterChip(m.uid, m.name, m.kpCount))
            }
            card.appendChild(W.h('div', { class: 'mastery-row' }, left, right))
          }
        }
        if (!gradeCount) card.appendChild(W.h('p', { class: 'small muted mt-2' }, '该版本目录为空'))
        body.appendChild(card)
      }
    }

    buildSeg()
    renderBody()
    rootEl.appendChild(seg)
    rootEl.appendChild(body)
  }
})()
