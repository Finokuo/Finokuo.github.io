// 温故知新静态版 · 首页: Hero(搜索+倒计时) / 进度统计 / 学科宫格 / 今日温故 / 今日任务 / 功能入口
;(function () {
  'use strict'

  const W = window.W
  if (!W.views) W.views = {} // 兜底: 视图注册表须在 app.js 之前就绪

  function resolveGoals(settings) {
    const g = settings && settings.dailyGoals
    return {
      kps: (g && g.kps) || 5,
      quizzes: (g && g.quizzes) || 3,
      recalls: (g && g.recalls) || 5,
    }
  }

  function todayActivity() {
    return W.store.activityDays[W.todayStr()] || { minutes: 0, kps: 0, quizzes: 0, recalls: 0 }
  }

  function heroSection(ctx) {
    const examDate = W.store.settings.examDate || W.defaultExamDate()
    const days = W.daysUntil(examDate)
    const label = W.store.settings.examLabel || '中考倒计时'

    const search = W.h('input', {
      type: 'search',
      placeholder: '搜索知识点、学科、章节、标签…',
      'aria-label': '搜索知识点',
      onkeydown: function (e) {
        if (e.key === 'Enter' && e.target.value.trim()) W.go('search', { q: e.target.value.trim() })
      },
    })

    const countdown = W.h(
      'div',
      { class: 'card card-pad-sm countdown-card', style: { minWidth: '150px', cursor: 'pointer' }, onclick: function () { W.ai.openSettings() }, title: '点击设置中考日期' },
      W.h('div', { class: 'countdown-num' }, days != null && days >= 0 ? days : '—'),
      W.h('div', { class: 'countdown-label' }, label + ' · ' + examDate.slice(5)),
    )

    return W.h(
      'div',
      { class: 'hero' },
      W.h('div', { class: 'row-wrap', style: { justifyContent: 'space-between' } },
        W.h(
          'div',
          { style: { flex: '0 1 auto', minWidth: '240px' } },
          W.h('h1', {}, '温故而知新'),
          W.h('p', { class: 'hero-sub' }, '7~9 年级九大学科复习平台: 知识点精讲 · 闪卡复习 · AI 答疑 · 智能出题 · 错题本 · 背诵打卡。数据全部保存在本机浏览器, 无需注册。'),
        ),
        countdown,
      ),
      W.h('div', { class: 'hero-search' }, W.h('span', { class: 'search-ico' }, W.icon('search', 18)), search),
      W.h(
        'div',
        { class: 'hero-badges' },
        W.ui.badge('九学科全覆盖', 'badge-primary'),
        W.ui.badge('离线可用', 'badge-success'),
        W.ui.badge('进度自动保存', 'badge-info'),
      ),
    )
  }

  function progressSection(ctx) {
    const learned = Object.keys(W.store.learned).length
    const favs = Object.keys(W.store.favorites).length
    const due = W.selectDueUids(W.store.srs).length
    const pendingWrong = W.selectPendingWrong().length

    function statCard(num, label, icon, onClick) {
      const el = W.ui.card(W.h('div', { class: 'stat-num' }, String(num)), W.h('div', { class: 'stat-label' }, W.icon(icon, 13), label), { __cls: 'card-hover card-pad-sm stat-card' })
      el.addEventListener('click', onClick)
      el.setAttribute('role', 'button')
      el.setAttribute('tabindex', '0')
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      })
      return el
    }

    return W.h(
      'div',
      { class: 'stat-grid mt-2' },
      statCard(learned, '已学知识点', 'check-circle', function () { W.go('stats') }),
      statCard(favs, '收藏夹', 'heart', function () { W.go('favorites') }),
      statCard(due, '今日到期复习', 'refresh', function () { W.go('review') }),
      statCard(pendingWrong, '待攻克错题', 'book-x', function () { W.go('wrongbook') }),
    )
  }

  function subjectGrid(ctx) {
    const grid = W.h('div', { class: 'subject-grid' })
    for (const s of W.data.subjects) {
      const kps = []
      for (const ch of s.chapters) for (const kp of ch.kps) kps.push(kp)
      const learnedN = W.data.learnedCount(kps)
      const pct = kps.length ? (learnedN / kps.length) * 100 : 0

      grid.appendChild(
        W.h(
          'div',
          {
            class: 'card card-hover subject-card',
            onclick: function () { W.go('subject', { slug: s.slug }) },
            role: 'link',
            tabindex: 0,
            onkeydown: function (e) { if (e.key === 'Enter') W.go('subject', { slug: s.slug }) },
          },
          W.ui.subjectIcon(s, 21),
          W.h(
            'div',
            { class: 'flex-1' },
            W.h('h3', {}, s.name),
            W.h('div', { class: 'desc' }, s.description),
            W.h(
              'div',
              { class: 'meta-row' },
              W.h('span', {}, s.chapters.length + ' 章 · ' + kps.length + ' 知识点'),
            ),
            W.h('div', { class: 'row', style: { marginTop: '6px', gap: '8px' } },
              W.h('div', { style: { flex: '1' } }, W.ui.progress(pct, s.color)),
              W.h('span', { class: 'small muted', style: { whiteSpace: 'nowrap' } }, learnedN + '/' + kps.length),
            ),
          ),
        ),
      )
    }
    return grid
  }

  function dailySection(ctx, rerender) {
    // 与学科宫格同一范式: 等宽并置卡(3/2/1 列随断点), 摘要由 CSS line-clamp 统一控制
    const box = W.h('div', { class: 'today-grid' })
    function render() {
      box.innerHTML = ''
      for (const item of W.data.dailyItems()) {
        box.appendChild(
          W.ui.kpCard(item, {
            noWatch: false,
            snippet: item.kp.content,
          }),
        )
      }
    }
    render()
    const unsub = W.storeSubscribe(render)
    ctx.addCleanup(unsub)

    const more = W.h(
      'button',
      { class: 'section-more', onclick: function () { W.go('review') } },
      '开始复习',
      W.icon('chevron-right', 14),
    )
    return { box: box, more: more }
  }

  function questSection(ctx) {
    const goals = resolveGoals(W.store.settings)
    const act = todayActivity()

    function questRow(icon, title, desc, done) {
      return W.h(
        'div',
        { class: 'quest-row' },
        W.h('div', { class: W.cls('quest-ico', done && 'done') }, W.icon(done ? 'check-circle' : icon, 17)),
        W.h(
          'div',
          { class: 'quest-main' },
          W.h('h4', {}, title),
          W.h('p', {}, desc),
        ),
        W.h('span', { class: W.cls('badge', done ? 'badge-success' : 'badge-soft') }, done ? '已完成' : '进行中'),
      )
    }

    return W.ui.card(
      questRow('circle', '学习知识点', '今日已学 ' + (act.kps || 0) + ' / ' + goals.kps + ' 个', (act.kps || 0) >= goals.kps),
      questRow('clipboard-list', '练习题目', '今日已练 ' + (act.quizzes || 0) + ' / ' + goals.quizzes + ' 题', (act.quizzes || 0) >= goals.quizzes),
      questRow('brain', '主动回忆', '今日闪卡自评/讲解 ' + (act.recalls || 0) + ' / ' + goals.recalls + ' 次', (act.recalls || 0) >= goals.recalls),
      W.h('div', { class: 'row mt-1', style: { justifyContent: 'space-between', fontSize: '12.5px' } },
        W.h('span', { class: 'muted' }, '连续学习 ' + W.store.streak + ' 天 · 今日时长 ' + W.fmtMinutes(act.minutes || 0)),
        W.h('button', { class: 'section-more', onclick: function () { W.go('quiz') } }, '去练习', W.icon('chevron-right', 14)),
      ),
    )
  }

  function featureGrid(ctx) {
    function feat(icon, title, desc, hash, tint) {
      const el = W.h(
        'div',
        {
          class: 'card card-hover feature-card',
          onclick: function () { W.go(hash) },
          role: 'link',
          tabindex: 0,
          onkeydown: function (e) { if (e.key === 'Enter') W.go(hash) },
        },
        W.h('div', { class: 'ico-wrap', style: tint ? { background: tint.bg, color: tint.fg } : {} }, W.icon(icon, 19)),
        W.h('h3', {}, title),
        W.h('p', {}, desc),
      )
      return el
    }
    return W.h(
      'div',
      { class: 'feature-grid mt-2' },
      feat('sparkles', 'AI 出题', '智能组卷, 选择/填空/大题', 'quiz'),
      feat('layers', '闪卡复习', '间隔重复, 今日到期 ' + W.selectDueUids(W.store.srs).length + ' 张', 'review'),
      feat('book-open-check', '背诵打卡', '必背古诗文 + 道法观点', 'recite'),
      feat('printer', '组卷打印', '自定义试卷, 一键打印', 'paper'),
    )
  }

  W.views.home = function (rootEl, view, ctx) {
    const daily = dailySection(ctx)

    rootEl.appendChild(heroSection(ctx))
    rootEl.appendChild(progressSection(ctx))

    rootEl.appendChild(
      W.ui.sectionTitle('book-open', '九大学科',
        W.h('button', { class: 'section-more', onclick: function () { W.go('textbook') } }, '按课本浏览', W.icon('chevron-right', 14))),
    )
    rootEl.appendChild(subjectGrid(ctx))

    rootEl.appendChild(W.ui.sectionTitle('clock', '今日温故', daily.more))
    rootEl.appendChild(daily.box)

    rootEl.appendChild(W.ui.sectionTitle('target', '今日任务'))
    rootEl.appendChild(questSection(ctx))

    rootEl.appendChild(W.ui.sectionTitle('graduation', '学习工具'))
    rootEl.appendChild(featureGrid(ctx))

    // 订阅 store 变化刷新任务/进度区(整段重绘, 简单可靠)
    const unsub = W.storeSubscribe(
      W.debounce(function () {
        W.app.render()
      }, 400),
    )
    ctx.addCleanup(unsub)
  }
})()
