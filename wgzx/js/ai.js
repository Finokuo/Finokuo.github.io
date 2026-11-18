// 温故知新静态版 · AI 能力层 + 小知聊天面板
// ------------------------------------------------------------------
// AI 服务来源(启动时自动探测, 用户可配置):
//   1. site(站点 AI 后端) —— 优先走同源 /api/ai/*(托管环境/配套 server.mjs);
//      同源后端不存在时, 自动改试代码内置的 GLM4 网关直连(配置写入代码, 不在设置界面展示)
//   2. custom —— 用户自配 OpenAI 兼容端点(baseUrl + apiKey + model, 存 localStorage)
//   3. none —— 无 AI: 出题自动降级为「本地题库生成」(解析知识点例题/要点), 其余给出引导
//
// 内置 GLM4 网关地址为多候选回退: 先试内网地址(平台/托管内网环境最快),
// 不通再试公网地址(任何网络环境均可尝试), 任一可用即记住并沿用。
// 朗读: 浏览器 speechSynthesis(离线可用, 无需后端)
;(function () {
  'use strict'

  const W = window.W
  const ai = (W.ai = {})
  const CFG_KEY = 'wgzx-ai-config-v1'

  // ---------- 配置 ----------
  ai.config = { mode: 'site', baseUrl: '', apiKey: '', model: '' }
  try {
    const raw = localStorage.getItem(CFG_KEY)
    if (raw) {
      const c = JSON.parse(raw)
      if (c && typeof c === 'object') {
        if (c.mode === 'custom') ai.config.mode = 'custom'
        if (typeof c.baseUrl === 'string') ai.config.baseUrl = c.baseUrl
        if (typeof c.apiKey === 'string') ai.config.apiKey = c.apiKey
        if (typeof c.model === 'string') ai.config.model = c.model
      }
    }
  } catch (e) { /* ignore */ }

  ai.saveConfig = function (patch) {
    for (const k in patch) ai.config[k] = patch[k]
    try { localStorage.setItem(CFG_KEY, JSON.stringify(ai.config)) } catch (e) { /* ignore */ }
    ai.probe()
  }

  // ---------- 后端探测 ----------
  // backendKind: 'api'(同源 /api/ai/*) | 'glm4'(内置 GLM4 网关直连) | null(无)
  ai.backend = false // 兼容旧引用(页脚下载入口等): 任一后端可用即为 true
  ai.backendKind = null
  ai.probed = false

  // 内置 GLM4 网关(「站点 AI 后端」的直连出口; 配置写入代码, 不在设置界面展示)
  // 地址候选: 内网优先 → 公网回退(内公网共用, 先试内网, 不行试公网)
  var GLM4_URLS = [
    'http://172.23.4.166:8080/v1', // 内网: 平台网关(沙箱/内网托管环境直达, 最快)
    'https://internal-api.z.ai/v1', // 公网: 平台网关域名
    'https://api.z.ai/api/v1', // 公网: Z.ai 官方 GLM API(OpenAI 兼容)
  ]
  var glm4Base = null // 探测成功后记住的可用地址(粘性, 避免每次都从头试)
  var GLM4_HEADERS = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer Z.ai',
    'X-Z-AI-From': 'Z',
    'X-Token': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZDRiOTAzNzEtMWViMy00NjUwLWE2MTAtYmJkNDM3MjhmMTUwIiwiY2hhdF9pZCI6ImNoYXQtMTIwMGIwMjYtZTYyOS00NmUwLTljNWQtZjZjYWFjZmRmZjcxIiwicGxhdGZvcm0iOiJ6YWkifQ.1WuS0XcKfTGp4YxOnzQuFyz02XxEdueAOkl3a1e3UUM',
    'X-Chat-Id': 'chat-1200b026-e629-46e0-9c5d-f6caacfdff71',
    'X-User-Id': 'd4b90371-1eb3-4650-a610-bbd43728f150',
  }
  var GLM4_PROBE_KEY = 'wgzx-ai-glm4-probe-v1'

  function glm4Once(base, body, timeoutMs) {
    return fetch(base + '/chat/completions', {
      method: 'POST',
      headers: GLM4_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs || 40000),
    }).then(function (res) {
      if (!res.ok) throw new Error('AI 服务返回 ' + res.status)
      return res.json()
    }).then(function (data) {
      var reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      if (!reply) throw new Error('AI 返回了空回复')
      return reply
    })
  }

  // 多候选回退: 先试已记住的可用地址, 否则按「内网 → 公网」顺序依次尝试
  function glm4Raw(body, timeoutMs) {
    var bases = glm4Base ? [glm4Base] : GLM4_URLS.slice()
    var i = 0
    function next() {
      if (i >= bases.length) return Promise.reject(new Error('GLM4 网关内网/公网地址均不可达'))
      var base = bases[i++]
      return glm4Once(base, body, timeoutMs).then(function (reply) {
        glm4Base = base // 成功: 记住该地址, 后续请求直连
        return reply
      }).catch(function (e) {
        if (glm4Base === base) glm4Base = null // 记住的地址失效, 重新探测
        return next()
      })
    }
    return next()
  }

  // 内置 GLM4 直连 chat(与自定义端点同构: system + messages; 网关固定模型, 不传 model, 关闭思维链)
  function glm4Chat(system, messages, temperature, timeoutMs) {
    return glm4Raw({
      messages: [{ role: 'system', content: system }].concat(messages),
      thinking: { type: 'disabled' },
      temperature: temperature == null ? 0.6 : temperature,
    }, timeoutMs)
  }

  // GLM4 可达性探测(结果缓存: 成功 6h / 失败 5min —— 失败可能是同源后端冷启动的暂时状态, 缓存过长会让 AI 长时间显示不可用)
  function probeGlm4() {
    try {
      var raw = localStorage.getItem(GLM4_PROBE_KEY)
      if (raw) {
        var c = JSON.parse(raw)
        if (c && typeof c.at === 'number' && typeof c.ok === 'boolean') {
          if (Date.now() - c.at < (c.ok ? 21600000 : 300000)) {
            if (c.ok && c.base && GLM4_URLS.indexOf(c.base) >= 0) glm4Base = c.base
            return Promise.resolve(c.ok)
          }
        }
      }
    } catch (e) { /* ignore */ }
    glm4Base = null
    return glm4Raw({ messages: [{ role: 'user', content: 'OK' }], thinking: { type: 'disabled' }, max_tokens: 4 }, 8000)
      .then(function () { return true })
      .catch(function () { return false })
      .then(function (ok) {
        try { localStorage.setItem(GLM4_PROBE_KEY, JSON.stringify({ ok: ok, at: Date.now(), base: glm4Base || '' })) } catch (e) { /* ignore */ }
        return ok
      })
  }

  // 探测失败后的自动重试(45s 一次, 最多 10 次): 后端冷启动/网络抖动恢复后自动接回, 无需手动刷新
  var probeRetryTimer = null
  var probeRetryCount = 0
  var PROBE_RETRY_MAX = 10
  function scheduleProbeRetry() {
    if (probeRetryTimer) return
    probeRetryTimer = setTimeout(function () {
      probeRetryTimer = null
      if (ai.config.mode === 'site' && !ai.backendKind && location.protocol !== 'file:') {
        ai.probe()
      }
    }, 45000)
  }
  window.addEventListener('online', function () {
    if (ai.config.mode === 'site' && !ai.backendKind) { probeRetryCount = 0; ai.probe() }
  })

  // 同源 /api/ai/health 探测(带重试): 冷启动时首个请求可能要编译路由(可达十几秒),
  // 单次 3s 超时会在服务刚启动时误判「无 AI」, 进而落入浏览器直连 GLM4(公网环境不可达)
  // 并把失败缓存 30 分钟 —— 这是「AI 服务不管用」的主因。改为三轮递增超时 + 失败短缓存 + 自动重试。
  function probeHealth(attempt, onOk, giveUp) {
    var timeouts = [4000, 9000, 18000]
    var ms = timeouts[Math.min(attempt, timeouts.length - 1)]
    fetch('/api/ai/health', { signal: AbortSignal.timeout(ms) })
      .then(function (res) { return res.ok ? res.json() : null })
      .then(function (j) {
        if (j && j.ok) return j
        throw new Error('health not ok')
      })
      .then(function () {
        // 同源后端可用: 清掉 GLM4 失败缓存, 避免残留误判
        try { localStorage.removeItem(GLM4_PROBE_KEY) } catch (e) { /* ignore */ }
        onOk()
      })
      .catch(function () {
        if (attempt < 2) probeHealth(attempt + 1, onOk, giveUp)
        else giveUp()
      })
  }

  ai.probe = function () {
    var finish = function (kind) {
      ai.backendKind = kind || null
      ai.backend = !!kind
      ai.probed = true
      document.dispatchEvent(new CustomEvent('wgzx-ai-status'))
      renderFabState()
      if (kind) {
        probeRetryCount = 0
      } else {
        probeRetryCount++
        if (probeRetryCount <= PROBE_RETRY_MAX) scheduleProbeRetry()
      }
    }
    var tryGlm4 = function () {
      probeGlm4().then(function (ok) { finish(ok ? 'glm4' : null) })
    }
    // file:// 无同源后端, 直接试内置 GLM4 直连
    if (location.protocol === 'file:') return tryGlm4()
    probeHealth(0, function () { finish('api') }, tryGlm4)
  }

  ai.hasAI = function () {
    if (ai.config.mode === 'custom') return !!(ai.config.baseUrl && ai.config.apiKey)
    return !!ai.backendKind
  }

  ai.statusText = function () {
    if (ai.config.mode === 'custom') {
      return ai.config.baseUrl ? '自定义 AI 服务' : '自定义服务未配置'
    }
    return ai.backendKind ? '已连接站点 AI 后端' : '未连接 AI 后端'
  }

  // ---------- OpenAI 兼容直连(自定义模式) ----------
  function customChat(systemPrompt, messages, temperature, timeoutMs) {
    const base = ai.config.baseUrl.replace(/\/+$/, '')
    return fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ai.config.apiKey },
      body: JSON.stringify({ model: ai.config.model || 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }].concat(messages), temperature: temperature == null ? 0.6 : temperature }),
      signal: AbortSignal.timeout(timeoutMs || 40000),
    }).then(function (res) {
      if (!res.ok) throw new Error('AI 服务返回 ' + res.status)
      return res.json()
    }).then(function (data) {
      const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      if (!reply) throw new Error('AI 返回了空回复')
      return reply
    })
  }

  // ---------- 答疑 ----------
  const CHAT_SYSTEM = '你是「温故知新」初中复习平台的 AI 学习助手「小知」,面向 7-9 年级的初中生。\n' +
    '你的职责: 帮助学生复习初中语文、数学、英语、物理、化学、生物、历史、地理、道德与法治九大学科。\n' +
    '回答要求:\n1. 准确、简洁、易懂,默认控制在 300 字以内,用户要求详细讲解时可展开;\n' +
    '2. 适当举例,数学用文字或简单符号表述,注意初中生的知识范围,不要用高中及以上的超纲方法;\n' +
    '3. 讲解思路清晰,可分点作答;\n4. 若问题与学习无关,礼貌地引导回学习话题;\n5. 鼓励学生,语气亲切友善。'

  ai.chat = function (messages, context) {
    let system = CHAT_SYSTEM
    if (context && context.title) {
      system += '\n\n用户当前正在复习知识点《' + String(context.title).slice(0, 100) + '》,内容摘要: ' + String(context.content || '').slice(0, 300) + '。请优先结合该知识点进行解答。'
    }
    const msgs = messages.slice(-20).map(function (m) { return { role: m.role, content: String(m.content).slice(0, 3000) } })
    if (!msgs.length) return Promise.reject(new Error('消息不能为空'))

    if (ai.config.mode === 'custom') {
      return customChat(system, msgs, 0.6, 40000)
    }
    if (ai.backendKind === 'glm4') return glm4Chat(system, msgs, 0.6, 40000)
    if (ai.backendKind !== 'api') {
      // 触发一次后台重探(冷启动恢复后自动接回); 15s 节流避免频繁探测
      var now = Date.now()
      if (now - (ai._lastProbeOnFail || 0) > 15000) {
        ai._lastProbeOnFail = now
        ai.probe()
      }
      return Promise.reject(new Error('AI 服务连接中, 请稍候再试(约半分钟内自动恢复); 也可点击右上角设置检查 AI 服务'))
    }
    return fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: msgs, context: context || undefined }),
      signal: AbortSignal.timeout(40000),
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error(j && j.error ? j.error : '请求失败(' + res.status + ')')
        return j
      })
    }).then(function (j) {
      if (!j.reply) throw new Error('AI 返回了空回复')
      return j.reply
    })
  }

  // ---------- 费曼讲解评估 ----------
  ai.teachCheck = function (input) {
    const prompt = '你是一位初中' + (input.subject || '') + '老师。学生正在用费曼学习法向你讲解知识点《' + input.title + '》。\n' +
      '知识点标准内容:\n' + input.content.slice(0, 1200) + '\n\n学生的讲解:\n' + input.explanation.slice(0, 1200) + '\n\n' +
      '请严格输出 JSON(不要 markdown 代码块): {"level":"excellent|good|gaps","score":0到100整数,"strengths":["讲对的要点"],"gaps":["遗漏或讲错的要点"],"suggestion":"一条提升建议"}。level: excellent=讲得透, good=基本到位, gaps=有明显缺口。'
    if (ai.config.mode === 'custom') {
      return customChat('你是初中老师, 只输出 JSON。', [{ role: 'user', content: prompt }], 0.3, 30000).then(parseJSONLoose)
    }
    if (ai.backendKind === 'glm4') {
      return glm4Chat('你是初中老师, 只输出 JSON。', [{ role: 'user', content: prompt }], 0.3, 30000).then(parseJSONLoose)
    }
    if (ai.backendKind !== 'api') return Promise.reject(new Error('未连接 AI 后端'))
    return fetch('/api/ai/teach-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error(j && j.error ? j.error : '请求失败(' + res.status + ')')
        return j
      })
    })
  }

  function parseJSONLoose(text) {
    let t = String(text).trim()
    const m = t.match(/\{[\s\S]*\}/)
    if (m) t = m[0]
    return JSON.parse(t)
  }

  // ---------- 错题诊断(走 chat) ----------
  ai.findError = function (input) {
    const opts = input.options && input.options.length ? '\n题目选项:\n' + input.options.map(function (o, i) { return 'ABCD'[i] + '. ' + o }).join('\n') : ''
    const userMsg = [
      '我做错了一道题, 请帮我找出到底错在哪里, 并给出针对性的建议。',
      '学科: ' + input.subject,
      '考点: ' + input.topic,
      '题型: ' + input.qType + '题',
      '题干: ' + input.stem,
      opts,
      '我的作答: ' + (input.userAnswer || '(未作答)'),
      '正确答案: ' + input.answer,
      input.analysis ? '参考解析: ' + input.analysis : '',
      '',
      '请按以下格式回答(300字以内):',
      '1. 错在哪一步/哪个知识点(明确指出我的作答与正确答案的关键差异)',
      '2. 正确的思考过程(简要)',
      '3. 给我一条避免再错的建议',
    ].filter(Boolean).join('\n')
    return ai.chat([{ role: 'user', content: userMsg }], { title: input.topic, content: String(input.stem).slice(0, 280) })
  }

  // ---------- 大题题型建议 ----------
  const BIGQ_PRESETS = {
    数学: ['二次函数综合题', '几何综合题', '圆的综合题', '相似综合题', '动点与最值问题', '新定义压轴题', '反比例函数综合题', '实际应用题'],
    物理: ['力学综合题', '电学综合题', '力电综合题', '浮力与压强综合题', '实验探究题'],
    化学: ['综合计算题', '实验探究题', '推断题', '工艺流程题'],
    语文: ['现代文阅读', '文言文阅读', '名著阅读', '语言运用', '作文'],
    英语: ['阅读理解', '完形填空', '短文填空', '书面表达'],
    历史: ['材料分析题', '论述题', '探究与实践题'],
    道德与法治: ['材料分析题', '评析题', '探究与实践题'],
    地理: ['读图综合题', '材料分析题', '区域综合题'],
    生物: ['实验探究题', '图示分析题', '综合简答题'],
  }
  W.bigqPresets = function (subject) { return BIGQ_PRESETS[subject] || ['综合题'] }

  ai.suggestBig = function (input) {
    // 直连端点: 自定义 OpenAI 兼容 或 内置 GLM4 网关
    var direct = null
    if (ai.config.mode === 'custom' && ai.config.baseUrl) direct = customChat
    else if (ai.backendKind === 'glm4') direct = glm4Chat
    if (direct) {
      const prompt = '初中' + input.subject + (input.chapters && input.chapters.length ? '，章节范围: ' + input.chapters.join('、') : '') + '。' +
        '参照各地期中/期末卷惯例, 推荐 3~5 个常考压轴大题题型。严格输出 JSON 数组: [{"label":"题型名","count":建议题数整数,"reason":"一句话理由"}]'
      return direct('你是初中教研员, 只输出 JSON。', [{ role: 'user', content: prompt }], 0.3, 30000)
        .then(function (t) { const m = String(t).match(/\[[\s\S]*\]/); return JSON.parse(m ? m[0] : '[]') })
        .then(function (arr) { return (arr || []).filter(function (s) { return s && s.label }).slice(0, 5) })
    }
    if (ai.backendKind !== 'api') {
      // 无后端: 用静态预设(每个 1 题)
      return Promise.resolve(W.bigqPresets(input.subject).slice(0, 5).map(function (label) {
        return { label: label, count: 1, reason: '各地期末/中考常见压轴题型' }
      }))
    }
    return fetch('/api/quiz/suggest-big', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30000),
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error(j && j.error ? j.error : '请求失败(' + res.status + ')')
        return (j.suggestions || []).filter(function (s) { return s && typeof s.label === 'string' && s.label.trim() }).slice(0, 5)
      })
    })
  }

  // ---------- 出题(多轮同步命题 / 自定义端点 / 本地降级) ----------
  const QUIZ_SYSTEM = '你是初中出题专家, 面向 7-9 年级学生。你只输出一个 JSON 数组, 不要输出任何其他文字、不要 markdown 代码块。\n' +
    '数组每项: {"topic":"所属知识点/章节名","stem":"题干, 填空题用 ____ 表示空位","options":["仅选择题恰好4项,不含ABCD前缀"],"figure":可选白名单SVG字符串(不要用),"answer":"选择题为单个大写字母,填空为答案文本,大题为参考答案要点","analysis":"解析/评分要点"}\n' +
    '命题要求: 题目严格贴合初中知识范围; 选项无"以上都对"; 题干自包含; 答案必须唯一且正确。'

  function siteQuizBatch(req) {
    return fetch('/api/quiz/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(36000),
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) {
          const err = new Error(j && j.error ? j.error : '请求失败(' + res.status + ')')
          err.rateLimited = !!(j && j.rateLimited)
          err.retryAfterSec = j && j.retryAfterSec
          throw err
        }
        return j
      })
    })
  }

  ai.quizGenerate = function (req, onProgress) {
    const total = Math.max(1, Math.min(20, req.count || 5))
    req.count = total
    onProgress = onProgress || function () {}

    // 路径 1: 站点同源后端(多轮同步命题, 与原版协议一致)
    if (ai.config.mode !== 'custom' && ai.backendKind === 'api') {
      const collected = []
      const seen = new Set()
      const MAX_ROUNDS = 6
      const deadline = Date.now() + 240000
      let round = 0
      let emptyRounds = 0
      let calibNote

      onProgress(0, total)
      function attempt() {
        if (collected.length >= total || round >= MAX_ROUNDS || Date.now() >= deadline) {
          if (!collected.length) return Promise.reject(new Error('这组题目没能出好, 请稍后重试或调整参数(如减少题量/换难度)'))
          return Promise.resolve({ questions: collected.slice(0, total), calibNote: calibNote })
        }
        round++
        const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
        return siteQuizBatch(Object.assign({}, req, {
          count: total - collected.length,
          round: round,
          existingStems: collected.map(function (q) { return q.stem.slice(0, 60) }).slice(-60),
        })).then(function (res) {
          if (res.rateLimited) return sleep(Math.max(12, Math.min(75, res.retryAfterSec || 25)) * 1000).then(attempt)
          if (res.calibNote) calibNote = res.calibNote
          let fresh = 0
          for (const q of res.questions || []) {
            const key = q.stem.slice(0, 60)
            if (seen.has(key)) continue
            seen.add(key); collected.push(q); fresh++
          }
          onProgress(Math.min(collected.length, total), total)
          if (fresh === 0) { emptyRounds++; if (emptyRounds >= 3) round = MAX_ROUNDS } else emptyRounds = 0
          return attempt()
        }).catch(function (e) {
          if (collected.length) return attempt()
          throw e
        })
      }
      return attempt()
    }

    // 路径 2: 直连端点(自定义 OpenAI 兼容 / 内置 GLM4 网关, 分批单轮)
    var directChat = null
    if (ai.config.mode === 'custom' && ai.config.baseUrl) directChat = customChat
    else if (ai.backendKind === 'glm4') directChat = glm4Chat
    if (directChat) {
      const scope = (req.chapters && req.chapters.length ? '章节: ' + req.chapters.join('、') + '。' : '') +
        (req.topics && req.topics.length ? '考点: ' + req.topics.join('、') + '。' : '') +
        (req.note ? '备注: ' + req.note + '。' : '')
      const bigType = req.bigType ? '大题题型为「' + req.bigType + '」。' : ''
      const userPrompt = '学科: ' + req.subject + '。题型: ' + req.qType + '。难度: ' + req.difficulty + '。' + bigType + scope + '请出 ' + req.count + ' 道。'
      onProgress(0, total)
      return directChat(QUIZ_SYSTEM, [{ role: 'user', content: userPrompt }], 0.7, 90000).then(function (text) {
        let arr = []
        try { const m = String(text).match(/\[[\s\S]*\]/); arr = JSON.parse(m ? m[0] : '[]') } catch (e) { /* ignore */ }
        const questions = (arr || []).filter(function (q) { return q && q.stem && q.answer }).slice(0, total).map(function (q) {
          return { topic: q.topic || req.subject, stem: q.stem, options: Array.isArray(q.options) && q.options.length === 4 ? q.options : undefined, answer: q.answer, analysis: q.analysis }
        })
        if (!questions.length) throw new Error('AI 未能生成题目, 请重试或换用其他模型')
        onProgress(questions.length, total)
        return { questions: questions }
      })
    }

    // 路径 3: 无 AI —— 本地题库生成
    onProgress(0, total)
    return new Promise(function (resolve) {
      setTimeout(function () {
        const questions = W.localQuiz(req, total)
        if (!questions.length) {
          throw new Error('本地题库未能生成题目: 该范围内可用的例题/要点不足, 请调整范围或连接 AI 服务')
        }
        onProgress(questions.length, total)
        resolve({ questions: questions, calibNote: '离线模式: 题目由本机知识库自动生成' })
      }, 60)
    })
  }

  // ---------- 本地出题引擎(无 AI 降级) ----------
  // 来源: 知识点 example 中的选择题(「例题: ...A.xx B.xx ... 选X」) + keyPoints 关键句挖空
  W.localQuiz = function (req, total) {
    const out = []
    const usedTitles = new Set()
    const diffFilter = req.difficulty === '简单' ? [1] : req.difficulty === '困难' ? [3] : [1, 2, 3]
    const slugMap = {}
    for (const s of W.data.subjects) slugMap[s.name] = s

    let pool = []
    const subject = slugMap[req.subject]
    if (subject) {
      let chapters = subject.chapters
      if (req.chapters && req.chapters.length) {
        const set = new Set(req.chapters)
        chapters = chapters.filter(function (c) { return set.has(c.name) })
      }
      for (const ch of chapters) {
        for (const kp of ch.kps) {
          if (req.topics && req.topics.length) {
            if (!req.topics.some(function (t) { return kp.title.indexOf(t) >= 0 || t.indexOf(kp.title) >= 0 })) continue
          }
          if (diffFilter.indexOf(kp.difficulty) < 0) continue
          pool.push({ kp: kp, chapter: ch })
        }
      }
    }
    // 随机打散
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t
    }

    const EX_RE = /A[.．、]\s*([^ABCD]+?)\s*[，,]?\s*B[.．、]\s*([^ABCD]+?)\s*[，,]?\s*C[.．、]\s*([^ABCD]+?)\s*[，,]?\s*D[.．、]\s*([^ABCD]+?)\s*[。.，,]?\s*(?:解答|答案)?[:：]?\s*选\s*([A-D])/

    for (const item of pool) {
      if (out.length >= total) break
      const kp = item.kp

      // 1) 例题选择题
      if (kp.example && (req.qType === '选择')) {
        const m = kp.example.match(EX_RE)
        if (m && !usedTitles.has(kp.uid + '-mcq')) {
          const stemHead = kp.example.split(/A[.．、]/)[0].replace(/^例题[:：]\s*/, '').trim()
          if (stemHead.length > 8 && stemHead.length < 220) {
            usedTitles.add(kp.uid + '-mcq')
            out.push({
              topic: kp.title,
              stem: stemHead,
              options: [m[1].trim(), m[2].trim(), m[3].trim(), m[4].trim()],
              answer: m[5],
              analysis: kp.example.slice(stemHead.length).trim().slice(0, 300),
            })
            continue
          }
        }
      }

      // 2) 要点挖空(填空)
      if (req.qType === '填空') {
        for (const line of kp.keyPoints) {
          const term = (kp.title || '').replace(/^[:：]/, '')
          if (line.indexOf(term) >= 0 && term.length >= 2 && term.length <= 16 && !usedTitles.has(kp.uid + '-fill')) {
            usedTitles.add(kp.uid + '-fill')
            out.push({
              topic: kp.title,
              stem: line.replace(term, '____') + '\n(请填写划线处内容)',
              answer: term,
              analysis: '知识点《' + kp.title + '》: ' + kp.keyPoints[0],
            })
            break
          }
        }
        if (out.length && out[out.length - 1].topic === kp.title) continue
        // 「」引号术语挖空
        const m2 = (kp.keyPoints[0] || '').match(/「([^」]{2,12})」/)
        if (m2 && !usedTitles.has(kp.uid + '-fill2')) {
          usedTitles.add(kp.uid + '-fill2')
          out.push({
            topic: kp.title,
            stem: kp.keyPoints[0].replace(m2[0], '____') + '\n(请填写划线处内容)',
            answer: m2[1],
            analysis: '知识点《' + kp.title + '》',
          })
          continue
        }
      }

      // 3) 大题(简答, 学生对照要点自评)
      if (req.qType === '大题') {
        if (usedTitles.has(kp.uid + '-big')) continue
        usedTitles.add(kp.uid + '-big')
        const ask = req.bigType ? '【' + req.bigType + '】' : ''
        out.push({
          topic: kp.title,
          stem: ask + '请围绕《' + kp.title + '》作答: 结合' + (req.subject) + '知识, 说明其核心内容与关键要点。' + (req.chapters && req.chapters.length ? '(章节: ' + req.chapters[0] + ')' : ''),
          answer: kp.keyPoints.join('\n'),
          analysis: '评分参考: 答出要点即可。知识点内容:\n' + kp.content.slice(0, 200) + '…',
        })
      }
    }

    // 选择题不足时用要点挖空补
    if (req.qType === '选择' && out.length < total) {
      for (const item of pool) {
        if (out.length >= total) break
        const kp = item.kp
        if (usedTitles.has(kp.uid + '-fill')) continue
        const line = kp.keyPoints[0] || ''
        const m2 = line.match(/「([^」]{2,12})」/)
        if (!m2) continue
        usedTitles.add(kp.uid + '-fill')
        const correct = m2[1]
        // 干扰项: 其他知识点的「」术语
        const distract = []
        for (const other of pool) {
          if (distract.length >= 3) break
          if (other.kp.uid === kp.uid) continue
          const om = (other.kp.keyPoints[0] || '').match(/「([^」]{2,12})」/)
          if (om && om[1] !== correct && distract.indexOf(om[1]) < 0) distract.push(om[1])
        }
        if (distract.length < 3) continue
        const opts = [correct, distract[0], distract[1], distract[2]]
        // 打散选项, 记录正确字母
        for (let i = opts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          const t = opts[i]; opts[i] = opts[j]; opts[j] = t
        }
        out.push({
          topic: kp.title,
          stem: '根据知识点《' + kp.title + '》: ' + line.replace(m2[0], '____') + '\n划线处应为:',
          options: opts,
          answer: ['A', 'B', 'C', 'D'][opts.indexOf(correct)],
          analysis: '知识点《' + kp.title + '》: ' + line,
        })
      }
    }

    return out.slice(0, total)
  }

  // ---------- 朗读(浏览器 speechSynthesis) ----------
  ai.speak = function (text, onEnd) {
    try {
      window.speechSynthesis.cancel()
      const clipped = String(text).slice(0, 600)
      const u = new SpeechSynthesisUtterance(clipped)
      u.lang = 'zh-CN'
      u.rate = 1
      const voices = window.speechSynthesis.getVoices()
      const zh = voices.find(function (v) { return /zh|Chinese|中文/i.test(v.lang + v.name) })
      if (zh) u.voice = zh
      if (onEnd) {
        u.onend = onEnd
        u.onerror = onEnd
      }
      window.speechSynthesis.speak(u)
      return true
    } catch (e) { return false }
  }

  ai.stopSpeak = function () {
    try { window.speechSynthesis.cancel() } catch (e) { /* ignore */ }
  }

  ai.speakSupported = function () {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  // ---------- 小知聊天面板 ----------
  let panelEl = null
  let panelOpen = false
  let panelCtx = null
  const chatLog = [] // { role, content } — 面板生命周期内保留

  ai.openPanel = function (ctx) {
    if (ctx) panelCtx = ctx
    if (!panelEl) buildPanel()
    panelEl.classList.remove('hidden')
    panelOpen = true
    renderCtxChip()
    const input = panelEl.querySelector('.ai-input-row textarea')
    setTimeout(function () { if (input) input.focus() }, 60)
    scrollMsgs()
  }

  ai.closePanel = function () {
    if (panelEl) panelEl.classList.add('hidden')
    panelOpen = false
  }

  ai.setContext = function (ctx) {
    panelCtx = ctx
    renderCtxChip()
    if (!panelOpen) ai.openPanel()
  }

  function scrollMsgs() {
    if (!panelEl) return
    const box = panelEl.querySelector('.ai-msgs')
    if (box) box.scrollTop = box.scrollHeight
  }

  function renderCtxChip() {
    if (!panelEl) return
    const holder = panelEl.querySelector('.ai-ctx-holder')
    holder.innerHTML = ''
    if (panelCtx && panelCtx.title) {
      holder.appendChild(
        W.h(
          'div',
          { class: 'ai-ctx-chip' },
          W.icon('book-open', 13),
          W.h('span', { class: 'truncate', style: { maxWidth: '260px' } }, '正在复习: ' + panelCtx.title),
          W.h('button', { 'aria-label': '清除上下文', onclick: function () { panelCtx = null; renderCtxChip() } }, W.icon('x', 13)),
        ),
      )
    }
  }

  function msgNode(role, content, thinking) {
    const el = W.h('div', { class: W.cls('ai-msg', role === 'user' ? 'user' : 'bot', thinking && 'thinking') })
    el.textContent = content
    if (role !== 'user' && !thinking && ai.speakSupported()) {
      const tools = W.h('div', { class: 'msg-tools' })
      const btn = W.h(
        'button',
        {
          class: 'icon-btn',
          title: '朗读回复',
          'aria-label': '朗读回复',
          onclick: function () {
            if (btn.__reading) { ai.stopSpeak(); btn.__reading = false; btn.innerHTML = ''; btn.appendChild(W.icon('volume', 14)); return }
            btn.__reading = true
            btn.innerHTML = ''
            btn.appendChild(W.icon('volume-x', 14))
            ai.speak(content, function () { btn.__reading = false; btn.innerHTML = ''; btn.appendChild(W.icon('volume', 14)) })
          },
        },
        W.icon('volume', 14),
      )
      tools.appendChild(btn)
      el.appendChild(tools)
    }
    return el
  }

  function buildPanel() {
    const root = document.getElementById('ai-root')
    const msgs = W.h('div', { class: 'ai-msgs' })

    const input = W.h('textarea', { placeholder: '问小知一个学习问题…', rows: 1 })
    const send = W.h('button', { class: 'btn btn-primary', 'aria-label': '发送', title: '发送' }, W.icon('send', 17))
    const quick = W.h(
      'div',
      { class: 'ai-quick' },
      ['数学怎么审题?', '帮我背英语单词', '物理公式总是记混'].map(function (t) {
        return W.h('button', { onclick: function () { input.value = t; submit() } }, t)
      }),
    )

    function submit() {
      const text = input.value.trim()
      if (!text || send.disabled) return
      input.value = ''
      // 消息入列
      const thinking = msgNode('bot', '小知思考中…', true)
      msgs.appendChild(msgNode('user', text))
      msgs.appendChild(thinking)
      scrollMsgs()
      send.disabled = true
      const history = chatLog.concat([{ role: 'user', content: text }])
      ai.chat(history, panelCtx ? { title: panelCtx.title, content: panelCtx.content || '' } : undefined)
        .then(function (reply) {
          chatLog.length = 0
          chatLog.push({ role: 'user', content: text })
          chatLog.push({ role: 'assistant', content: reply })
          thinking.replaceWith(msgNode('bot', reply))
        })
        .catch(function (e) {
          const errBox = W.h('div', { class: 'ai-msg bot', style: { background: 'var(--danger-soft)', color: 'var(--danger)' } }, e && e.message ? e.message : '请求失败, 请稍后再试')
          if (!ai.hasAI()) {
            errBox.appendChild(
              W.h('div', { style: { marginTop: '6px' } },
                W.h('button', { class: 'btn btn-sm btn-outline', onclick: openSettings }, '配置 AI 服务')),
            )
          }
          thinking.replaceWith(errBox)
        })
        .then(function () { send.disabled = false; scrollMsgs() })
    }

    send.addEventListener('click', submit)
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    })

    const settingsBtn = W.h('button', { class: 'icon-btn', title: 'AI 服务设置', 'aria-label': 'AI 服务设置', onclick: openSettings }, W.icon('settings', 17))
    const closeBtn = W.h('button', { class: 'icon-btn', title: '收起', 'aria-label': '收起', onclick: ai.closePanel }, W.icon('x', 18))

    const head = W.h(
      'div',
      { class: 'ai-head' },
      W.h('div', { class: 'avatar' }, W.icon('sparkles', 18)),
      W.h(
        'div',
        { class: 'flex-1' },
        W.h('h3', {}, '小知 · AI 学习助手'),
        W.h('div', { class: 'sub' }, W.h('span', { class: 'ai-status-dot' }), W.h('span', { class: 'ai-status-text' }, '检测中…')),
      ),
      settingsBtn,
      closeBtn,
    )

    panelEl = W.h(
      'div',
      { class: 'ai-panel hidden', role: 'dialog', 'aria-label': 'AI 学习助手' },
      head,
      W.h('div', { class: 'ai-ctx-holder' }),
      msgs,
      quick,
      W.h('div', { class: 'ai-input-row' }, input, send),
    )
    // 欢迎语
    msgs.appendChild(msgNode('bot', '你好呀! 我是小知 🤖\n可以问我任何初中学习问题: 知识点讲解、解题思路、背诵技巧都行。点右上角齿轮可配置 AI 服务。'.replace(' 🤖', '')))
    root.appendChild(panelEl)

    // 状态渲染
    function refreshStatus() {
      const dot = panelEl.querySelector('.ai-status-dot')
      const text = panelEl.querySelector('.ai-status-text')
      if (!dot || !text) return
      const ok = ai.hasAI()
      dot.className = W.cls('ai-status-dot', !ok && 'off')
      text.textContent = ai.statusText()
    }
    document.addEventListener('wgzx-ai-status', refreshStatus)
    setTimeout(refreshStatus, 500)
  }

  function openSettings() {
    const c = ai.config
    const modeSite = W.h('input', { type: 'radio', name: 'wgzx-ai-mode', value: 'site' })
    const modeCustom = W.h('input', { type: 'radio', name: 'wgzx-ai-mode', value: 'custom' })
    ;(c.mode === 'custom' ? modeCustom : modeSite).checked = true

    const baseUrl = W.h('input', { class: 'input', placeholder: 'https://api.deepseek.com/v1', value: c.baseUrl })
    const model = W.h('input', { class: 'input', placeholder: 'deepseek-chat / gpt-4o-mini / qwen-plus…', value: c.model })
    const apiKey = W.h('input', { class: 'input', type: 'password', placeholder: 'sk-…', value: c.apiKey })

    const customBox = W.h(
      'div',
      { class: 'col', style: { gap: '10px', marginTop: '8px' } },
      W.h('div', { class: 'field' }, W.h('label', { class: 'field-label' }, 'API 地址(OpenAI 兼容)'), baseUrl),
      W.h('div', { class: 'field' }, W.h('label', { class: 'field-label' }, '模型'), model),
      W.h('div', { class: 'field' }, W.h('label', { class: 'field-label' }, 'API Key'), apiKey),
      W.h('p', { class: 'small muted', style: { lineHeight: '1.6' } }, '支持 OpenAI / DeepSeek / 智谱 / Moonshot 等兼容端点。配置保存在本机浏览器, 不会上传。若服务方未开放浏览器跨域(CORS), 请使用配套 server.mjs 反代。'),
    )

    const content = W.h(
      'div',
      { class: 'col', style: { gap: '10px' } },
      W.h('label', { class: 'checkbox-row', style: { alignItems: 'flex-start' } }, modeSite, W.h('span', {}, W.h('b', {}, '使用站点 AI 后端(推荐)'), W.h('br'), W.h('span', { class: 'small muted' }, '本站内置 AI 服务, 无需任何配置'))),
      W.h('label', { class: 'checkbox-row', style: { alignItems: 'flex-start' } }, modeCustom, W.h('span', {}, W.h('b', {}, '自定义 AI 服务'), W.h('br'), W.h('span', { class: 'small muted' }, '填入你自己的 OpenAI 兼容 API'))),
      customBox,
    )

    function syncMode() {
      const isCustom = modeCustom.checked
      ;['input', 'textarea'].forEach(function () {})
      customBox.querySelectorAll('input').forEach(function (el) { el.disabled = !isCustom })
      customBox.style.opacity = isCustom ? '1' : '0.5'
    }
    modeSite.addEventListener('change', syncMode)
    modeCustom.addEventListener('change', syncMode)

    const modal = W.modal({
      title: 'AI 服务设置',
      content: content,
      wide: true,
      onOk: function () {
        ai.saveConfig({
          mode: modeCustom.checked ? 'custom' : 'site',
          baseUrl: baseUrl.value.trim(),
          model: model.value.trim(),
          apiKey: apiKey.value.trim(),
        })
        W.toast('AI 设置已保存' + (ai.hasAI() ? ', AI 功能已可用' : ', 当前仍无可用 AI 服务'), ai.hasAI() ? 'success' : 'error')
      },
    })
    if (modal) {
      modal.el.querySelector('.modal-body').appendChild(W.h('div'))
      syncMode()
    }
  }
  ai.openSettings = openSettings

  // ---------- 悬浮球 ----------
  let fab = null
  function renderFabState() {
    if (!fab) return
    const dot = fab.querySelector('.ai-status-dot')
    if (dot) dot.className = W.cls('ai-status-dot', !ai.hasAI() && 'off')
  }

  function buildFab() {
    const root = document.getElementById('ai-root')
    fab = W.h(
      'button',
      { class: 'ai-fab', title: '小知 AI 助手', 'aria-label': '打开 AI 助手', onclick: function () { if (panelOpen && panelEl && !panelEl.classList.contains('hidden')) { ai.closePanel() } else { ai.openPanel() } } },
      W.icon('sparkles', 24),
    )
    fab.style.position = 'fixed'
    // 状态点(角标)
    const dot = W.h('span', { class: 'ai-status-dot', style: { position: 'absolute', right: '8px', top: '8px', boxShadow: '0 0 0 2px #fff' } })
    fab.appendChild(dot)
    root.appendChild(fab)
  }

  ai.initPanel = function () {
    buildFab()
    ai.probe()
  }
})()
