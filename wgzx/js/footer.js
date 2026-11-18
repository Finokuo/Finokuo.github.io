// 温故知新静态版 · 页脚(粘底: 由 #app flex 布局 mt-auto 语义实现)
;(function () {
  'use strict'

  const W = window.W

  W.renderFooter = function () {
    const root = document.getElementById('site-footer')
    if (!root) return
    const d = W.data
    const stamp = (window.WGZX_DATA && window.WGZX_DATA.generatedAt) || ''
    const genDate = stamp ? stamp.slice(0, 10) : ''

    const links = W.h(
      'div',
      { class: 'footer-links' },
      W.h('button', { onclick: function () { W.ai.openSettings() } }, 'AI 设置'),
      W.h('button', { onclick: function () { W.go('textbook') } }, '教材目录'),
      W.h('button', { onclick: function () { window.print() } }, '打印当前页'),
    )

    // 托管环境(有后端)时提供源码包下载
    if (W.ai && W.ai.backend) {
      links.appendChild(W.h('a', { href: 'static-site.zip', download: '温故知新-静态版.zip' }, '下载静态版 ZIP'))
    }

    root.innerHTML = ''
    root.appendChild(
      W.h(
        'div',
        { class: 'footer-inner' },
        W.h(
          'div',
          {},
          '「温故而知新, 可以为师矣」 · ',
          d.totalKp + ' 个知识点 / ' + d.subjects.length + ' 学科 / ' + d.totalChapters + ' 章节' + (genDate ? ' · 数据 ' + genDate + ' 更新' : ''),
        ),
        links,
      ),
    )
  }
})()
