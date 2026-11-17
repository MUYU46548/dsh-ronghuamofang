/**
 * dsh-novelforge —— 绒花墨坊（NovelForge）× DSH 插件（宿主侧薄层）。
 *
 * 一句话：把"改稿这条链"接进 DSH 会话 —— 模型能查判据、能出候选（只算不落），
 * **采用仍归作者**。
 *
 * 三层边界（越界即错，测试里钉着）：
 *  ① **DSH 概念只许出现在本文件**：`root.inject/get/on/effect`、`webServer.register`、
 *     `systemPrompt`、`tools.register`。其它模块只认 HTTP 与纯函数（换宿主时只改这里）。
 *  ② **墨坊只经本机 HTTP**（`lib/http.js`，非回环直接拒绝）。不 import 墨坊代码。
 *  ③ **不做"采用"**：没有工具能写正文；墨坊的 `/chapters/paragraph/apply` 要作者本人（403）。
 *
 * 已核实的宿主形态（读 dsh-fangcun 0.6.x 的真机事实，别猜）：
 *  · 导出 `export default { name, apply(root) }`；
 *  · `root.inject(['webServer'], (ctx) => …)` 局部等待服务；路由 `{kind:'exact', path, handler}`，
 *    **没有 method 字段**，方法在 handler 里自己判；
 *  · `root.get('systemPrompt' | 'tools')` 读可选服务 —— **绝不写进 inject**（老宿主没这服务会让插件永不 apply）；
 *  · `webserver/index-inject` 那张表**宿主启动时只收集一次**，要推挂件就必须在 apply() 最前面订阅。
 */

import { MofangClient, baseUrlOf } from './http.js'
import { buildTools } from './tools.js'
import { registerPrompt, statusLine } from './prompt.js'
import { collectHealth, probe, state } from './health.js'

export const PLUGIN_NAME = 'dsh-novelforge'
export const PLUGIN_VERSION = '0.1.0'

/**
 * 与墨坊之间的契约版本：墨坊改了这几个端点的字段/语义就 +1。
 * 插件按版本决定"能不能调、怎么调"，不靠猜（DSH 0.2.2-rc 期两边都在动）。
 */
export const CONTRACT_VERSION = 1

/** 用到的墨坊端点（health 与实际调用都从这里取，别在两处各写一份） */
export const ENDPOINTS = {
  state: '/state',
  chapter_paragraphs: '/chapters/paragraphs',
  chapter_annotations: '/chapters/annotations',
  structure: '/review/structure',
  paragraph_preview: '/chapters/paragraph/preview',
  paragraph_pending: '/chapters/paragraph/pending',
  paragraph_drop: '/chapters/paragraph/drop',
}

const HEALTH_ROUTE = '/mofang/health.json'

function sendJson(res, code, payload) {
  try {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(payload))
  } catch { /* 连接已断：没什么可做的 */ }
}

/** 只读 health（GET） */
function healthHandler(req, res) {
  try {
    if (String((req && req.method) || 'GET').toUpperCase() !== 'GET') {
      res.setHeader && res.setHeader('Allow', 'GET')
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    let base = ''
    try { base = baseUrlOf() } catch { base = '(配置无效)' }   // 配置坏了也要能读到 health
    const body = collectHealth({
      version: PLUGIN_VERSION, contract: CONTRACT_VERSION, base,
    })
    if (state.prompt.error && !state.prompt.rules) body.prompt.error = state.prompt.error
    sendJson(res, 200, body)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
  }
}

export const ROUTES = [{ kind: 'exact', path: HEALTH_ROUTE, handler: healthHandler }]

/**
 * 挂载。每一步都**独立降级**：没有 systemPrompt 也照样注册工具，没有 tools 也照样有 health ——
 * 一个服务缺失不该让整个插件沉默（用户看到的就是"装了没用"）。
 */
export function apply(root, { client } = {}) {
  // 每次挂载都从"没注册上"开始算：模块级 state 是跨 apply 共享的，
  // 不清就会让上一轮的状态冒充这一轮（health 说"规则段已注册"而其实没有）。
  state.prompt = { rules: false, status: false, error: '' }
  state.tools = { registered: false, names: [], error: '' }
  state.routes = { registered: false, paths: [], error: '' }

  const logWarn = (msg) => {
    try { root && root.logger && root.logger.warn && root.logger.warn('[dsh-novelforge] ' + msg) } catch { /* 可选 */ }
  }

  let mofang = null
  let configError = ''
  try {
    mofang = client || new MofangClient({ baseUrl: baseUrlOf() })
  } catch (e) {
    // 配置坏了（比如 MOFANG_API 指向外网）：明说，不假装能用。
    // **但 health 路由照旧注册** —— 否则用户连"为什么没连上"都看不到。
    configError = String((e && e.message) || e)
    logWarn(configError)
  }

  // ① 一行现状用的快照（60 秒一次，绝不阻塞模型调用）
  if (mofang) {
    const tick = () => { void probe(mofang).catch(() => {}) }
    if (typeof root.effect === 'function') {
      root.effect(() => {
        tick()
        const t = setInterval(tick, 60_000)
        if (typeof t.unref === 'function') t.unref()
        return () => clearInterval(t)
      }, PLUGIN_NAME + ': probe')
    } else {
      tick()
    }
  }

  // ② 提示词：静态规则段 + 一行现状（服务可能晚到，最多追 10 秒）
  const setupPrompt = () => {
    const find = () => (typeof root.get === 'function' ? root.get('systemPrompt') : undefined)
    let attempts = 0
    let timer = null
    const attach = () => {
      const sp = find()
      if (sp && typeof sp.section === 'function') {
        registerPrompt(sp, {
          line: () => statusLine({
            reachable: state.lastProbe.reachable,
            book: state.lastProbe.book,
            stage: state.lastProbe.stage,
            pendingOpen: 0,
          }),
        })
        state.prompt.rules = true
        state.prompt.status = typeof sp.context === 'function'
        state.prompt.error = ''
        return
      }
      attempts += 1
      if (attempts >= 10) {
        state.prompt.error = 'systemPrompt 服务不可用（老宿主？）—— 规则段没有注册'
        return
      }
      // 重试期间也要**看得见**：health 里一直空着，用户会以为都正常
      state.prompt.error = 'systemPrompt 服务暂不可用，正在重试（' + attempts + '/10）'
      timer = setTimeout(attach, 1000)
      if (timer && typeof timer.unref === 'function') timer.unref()
    }
    attach()
    return () => { if (timer) clearTimeout(timer) }
  }
  if (typeof root.effect === 'function') root.effect(setupPrompt, PLUGIN_NAME + ': prompt')
  else setupPrompt()

  // ③ 模型工具（5 个，白名单）
  const setupTools = () => {
    if (!mofang) {
      state.tools.error = '墨坊地址配置无效，工具没有注册：' + configError
      return
    }
    const svc = typeof root.get === 'function' ? root.get('tools') : undefined
    if (!svc || typeof svc.register !== 'function') {
      state.tools.error = 'tools 服务不可用 —— 工具没有注册（DSH 版本过老？）'
      return
    }
    const defs = buildTools(mofang)
    const names = []
    for (const def of defs) {
      try {
        svc.register(def)
        names.push(def.name)
      } catch (e) {
        state.tools.error = '注册 ' + def.name + ' 失败：' + String((e && e.message) || e)
      }
    }
    state.tools.registered = names.length > 0
    state.tools.names = names
    if (!state.tools.error && names.length !== defs.length) {
      state.tools.error = '只注册上 ' + names.length + '/' + defs.length + ' 个工具'
    }
  }
  if (typeof root.effect === 'function') root.effect(setupTools, PLUGIN_NAME + ': tools')
  else setupTools()

  // ④ 只读路由（health）
  if (typeof root.inject === 'function') {
    root.inject(['webServer'], (ctx) => {
      const web = ctx && ctx.webServer
      if (!web || typeof web.register !== 'function') {
        state.routes.error = 'webServer 服务不可用 —— health 端点是空的'
        return
      }
      const paths = []
      for (const r of ROUTES) {
        try {
          web.register(r)
          paths.push(r.path)
        } catch (e) {
          state.routes.error = '注册 ' + r.path + ' 失败：' + String((e && e.message) || e)
        }
      }
      state.routes.registered = paths.length > 0
      state.routes.paths = paths
    })
  }

  return { client: mofang }
}

export default { name: PLUGIN_NAME, apply }
