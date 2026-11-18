// 温故知新静态版 · 可选本地服务器(零依赖, Node >= 18)
// ------------------------------------------------------------------
// 作用: 1) 静态托管本目录; 2) 把 /api/ai/* 反代到 AI 服务。
// 默认上游: 内置 GLM4 网关(写入代码, 开箱即用, 无需任何环境变量);
// 如需换成自己的服务, 用环境变量覆盖: AI_BASE_URL / AI_API_KEY / AI_MODEL / AI_EXTRA_HEADERS。
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8080)
// 内置 GLM4 网关(平台鉴权头一并写入; 对外不可见)
// 地址候选: 内网优先 → 公网回退(内公网共用, 先试内网, 不行试公网)
const BUILTIN_URLS = [
  'http://172.23.4.166:8080/v1', // 内网: 平台网关(内网环境直达, 最快)
  'https://internal-api.z.ai/v1', // 公网: 平台网关域名
  'https://api.z.ai/api/v1', // 公网: Z.ai 官方 GLM API(OpenAI 兼容)
]
const BUILTIN_HEADERS = {
  'X-Z-AI-From': 'Z',
  'X-Token': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZDRiOTAzNzEtMWViMy00NjUwLWE2MTAtYmJkNDM3MjhmMTUwIiwiY2hhdF9pZCI6ImNoYXQtMTIwMGIwMjYtZTYyOS00NmUwLTljNWQtZjZjYWFjZmRmZjcxIiwicGxhdGZvcm0iOiJ6YWkifQ.1WuS0XcKfTGp4YxOnzQuFyz02XxEdueAOkl3a1e3UUM',
  'X-Chat-Id': 'chat-1200b026-e629-46e0-9c5d-f6caacfdff71',
  'X-User-Id': 'd4b90371-1eb3-4650-a610-bbd43728f150',
}
// 上游候选: 环境变量 AI_BASE_URL 优先(单一地址, 照传 model);
// 未设置时按「内网 → 公网」依次尝试内置候选(先试内网, 不行试公网)
const ENV_UP = process.env.AI_BASE_URL ? process.env.AI_BASE_URL.replace(/\/+$/, '') : ''
const CANDIDATES = ENV_UP ? [ENV_UP] : BUILTIN_URLS.slice()
let UP_BASE = null // 已验证可用的上游地址(粘性; 失效自动重探测)
const KEY = process.env.AI_API_KEY || 'Z.ai'
const MODEL = process.env.AI_MODEL || 'glm-4-plus'
// 可选: 额外请求头(JSON 字符串, 覆盖内置头或对接其他网关时使用)
let EXTRA_HEADERS = {}
try { EXTRA_HEADERS = process.env.AI_EXTRA_HEADERS ? JSON.parse(process.env.AI_EXTRA_HEADERS) : {} } catch { EXTRA_HEADERS = {} }
// 上游请求头: 内置候选附带平台鉴权头; 自定义上游仅 Bearer + 可选额外头
function upHeaders(base) {
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY }
  if (BUILTIN_URLS.indexOf(base) >= 0) Object.assign(h, BUILTIN_HEADERS)
  return Object.assign(h, EXTRA_HEADERS)
}

// 网络可达性探测(HEAD, 任何 HTTP 响应含 401/404 都算可达; 不可达地址跳过不白等)
async function aliveCandidates() {
  const alive = []
  for (const base of CANDIDATES) {
    try {
      await fetch(base + '/models', { method: 'HEAD', signal: AbortSignal.timeout(3000) })
      alive.push(base)
    } catch (e) {
      console.log('[ai] 上游不可达, 跳过: ' + base)
    }
  }
  return alive.length ? alive : CANDIDATES.slice()
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' }

function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(body)
}

async function upstream(system, messages, temperature) {
  // 先试已记住的可用地址, 否则按「内网 → 公网」顺序探测后依次尝试
  const bases = UP_BASE ? [UP_BASE] : await aliveCandidates()
  let lastErr = null
  for (const base of bases) {
    const body = { model: MODEL, messages: [{ role: 'system', content: system }, ...messages], temperature }
    const builtin = BUILTIN_URLS.indexOf(base) >= 0
    if (builtin) delete body.model // 内置网关模型固定, 不传 model; 自定义上游照传
    try {
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: upHeaders(base),
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error('上游返回 ' + r.status)
      const d = await r.json()
      const reply = d.choices?.[0]?.message?.content || ''
      if (!reply) throw new Error('上游返回空回复')
      UP_BASE = base
      return reply
    } catch (e) {
      lastErr = e
      if (UP_BASE === base) UP_BASE = null // 粘性地址失效, 下次重新探测
      console.log('[ai] 上游失败(' + base + '): ' + (e && e.message ? e.message : e) + ', 试下一个')
    }
  }
  throw lastErr || new Error('AI 上游全部不可用')
}

function extractJSON(text) {
  const a = String(text).match(/\[[\s\S]*\]/)
  if (a) return JSON.parse(a[0])
  const o = String(text).match(/\{[\s\S]*\}/)
  if (o) return JSON.parse(o[0])
  throw new Error('AI 未返回 JSON')
}

const CHAT_SYSTEM = '你是「温故知新」初中复习平台的 AI 学习助手「小知」,面向 7-9 年级的初中生。回答准确、简洁、易懂,默认 300 字内,鼓励学生,语气亲切。与学习无关的问题礼貌引导回学习。'

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const path = decodeURIComponent(url.pathname)

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
    return res.end()
  }

  // ---------- AI 反代 ----------
  if (path === '/api/ai/health') return json(res, 200, { ok: true, capabilities: { chat: true, quiz: true, teachCheck: true } })

  if (req.method === 'POST' && (path === '/api/ai/chat' || path === '/api/ai/teach-check' || path === '/api/quiz/generate' || path === '/api/quiz/suggest-big')) {
    try {
      const body = await new Promise((resolve, reject) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (e) { reject(e) } })
        req.on('error', reject)
      })

      if (path === '/api/ai/chat') {
        let system = CHAT_SYSTEM
        if (body.context?.title) system += '\n\n用户当前正在复习知识点《' + String(body.context.title).slice(0, 100) + '》,内容摘要: ' + String(body.context.content || '').slice(0, 300)
        const msgs = (body.messages || []).slice(-20)
        const reply = await upstream(system, msgs, 0.6)
        return json(res, 200, { reply })
      }

      if (path === '/api/ai/teach-check') {
        const prompt = '你是一位初中老师。学生用费曼学习法讲解知识点《' + body.title + '》。\n标准内容:\n' + String(body.content).slice(0, 1200) + '\n\n学生讲解:\n' + String(body.explanation).slice(0, 1200) + '\n\n只输出 JSON: {"level":"excellent|good|gaps","score":0-100整数,"strengths":["讲对的"],"gaps":["遗漏/讲错"],"suggestion":"一条建议"}'
        const out = await upstream('你是初中老师, 只输出 JSON。', [{ role: 'user', content: prompt }], 0.3)
        return json(res, 200, extractJSON(out))
      }

      if (path === '/api/quiz/generate') {
        const scope = (body.chapters?.length ? '章节: ' + body.chapters.join('、') + '。' : '') + (body.topics?.length ? '考点: ' + body.topics.join('、') + '。' : '') + (body.note ? '备注: ' + body.note + '。' : '') + (body.bigType ? '大题题型「' + body.bigType + '」。' : '') + (body.existingStems?.length ? '\n避免与这些已出题目重复: ' + body.existingStems.slice(-8).join(' | ') : '')
        const prompt = '学科: ' + body.subject + '。题型: ' + body.qType + '。难度: ' + body.difficulty + '。' + scope + '出 ' + (body.count || 5) + ' 道。\n' +
          '只输出 JSON 数组, 每项: {"topic":"知识点名","stem":"题干(仅填空题用____占位, 选择题题干完整不带占位)","options":["仅选择题4项,不含ABCD前缀"],"answer":"选择题为A-D单个字母, 填空题/大题为答案文本","analysis":"解析"}。贴合初中范围, 答案唯一正确, 选择题题干末尾可直接接选项。'
        const out = await upstream('你是初中出题专家, 只输出 JSON 数组。', [{ role: 'user', content: prompt }], 0.7)
        const arr = extractJSON(out)
        return json(res, 200, { questions: (Array.isArray(arr) ? arr : []).filter((q) => q && q.stem && q.answer).slice(0, body.count || 5) })
      }

      if (path === '/api/quiz/suggest-big') {
        const prompt = '初中' + body.subject + (body.chapters?.length ? ', 章节: ' + body.chapters.join('、') : '') + '。参照期中期末卷惯例, 推荐 3~5 个压轴大题题型。只输出 JSON 数组: [{"label":"题型","count":题数,"reason":"一句话理由"}]'
        const out = await upstream('你是初中教研员, 只输出 JSON。', [{ role: 'user', content: prompt }], 0.3)
        const arr = extractJSON(out)
        return json(res, 200, { suggestions: (Array.isArray(arr) ? arr : []).filter((s) => s && s.label).slice(0, 5) })
      }
    } catch (e) {
      return json(res, 502, { error: 'AI 调用失败: ' + (e && e.message ? e.message : e) })
    }
  }

  // ---------- 静态文件 ----------
  let file = path === '/' ? '/index.html' : path
  const abs = join(ROOT, file)
  if (abs.startsWith(ROOT) && existsSync(abs) && statSync(abs).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(abs)] || 'application/octet-stream' })
    return res.end(readFileSync(abs))
  }
  // SPA 回退: 未命中文件时返回 index.html(hash 路由由前端处理)
  const indexAbs = join(ROOT, 'index.html')
  if (existsSync(indexAbs)) {
    res.writeHead(200, { 'Content-Type': MIME['.html'] })
    return res.end(readFileSync(indexAbs))
  }
  res.writeHead(404)
  res.end('Not Found')
})

server.listen(PORT, () => {
  console.log('温故知新静态版已启动: http://localhost:' + PORT)
  console.log('AI 服务: ' + (ENV_UP
    ? ENV_UP + '(模型 ' + MODEL + ')'
    : '内置 GLM4 网关(内网优先, 公网回退)'))
  if (!ENV_UP) aliveCandidates().then(function (alive) {
    console.log('[ai] 上游候选: ' + CANDIDATES.join(' → '))
    console.log('[ai] 可用上游: ' + (alive.length ? alive.join(', ') : '(均不可达, 调用时重试)'))
  })
})
