/**
 * dsh-novelforge —— 绒花墨坊（NovelForge）× DSH 插件（宿主侧薄层）。
 *
 * 一句话：把"改稿这条链"接进 DSH 会话 —— 模型能查判据、能出候选（只算不落），
 * **采用仍归作者**；作者在 DSH 设置里能改墨坊地址与超时，不用碰环境变量。
 *
 * 三层边界（越界即错，测试里钉着）：
 *  ① **DSH 概念只许出现在本文件**：`root.inject/get/on/effect`、`webServer.register`、
 *     `systemPrompt`、`tools.register`、`configEditor`、`clientModules`。
 *     其它模块只认 HTTP 与纯函数（换宿主时只改这里）。
 *  ② **墨坊只经本机 HTTP**（`lib/http.js`，非回环直接拒绝）。不 import 墨坊代码。
 *  ③ **不做"采用"**：没有工具能写正文；墨坊的 `/chapters/paragraph/apply` 要作者本人（403）。
 *
 * 已核实的宿主形态（读 dsh-fangcun 0.7.x 与真机结论，别猜）：
 *  · 导出 `export default { name, apply(root, config) }`；
 *  · `root.inject(['webServer'], (ctx) => …)` 局部等待服务；路由 `{kind:'exact', path, handler}`，
 *    **没有 method 字段**，方法在 handler 里自己判；
 *  · `root.get('systemPrompt' | 'tools')` 读可选服务 —— **绝不写进 inject**（老宿主没这服务会让插件永不 apply）；
 *  · `webserver/index-inject` 那张表**宿主启动时只收集一次**，将来推挂件必须在 apply() 最前面订阅；
 *  · 设置写回走 `root.fiber.entry` + `root.get('configEditor').edit(...)`，
 *    不手改 profile 的 cordis.patch.yml（那份文件属于用户，还装着别的插件的行）。
 */

import { MofangClient } from './http.js'
import { buildTools } from './tools.js'
import { registerPrompt, statusLine } from './prompt.js'
import { collectHealth, probe, state } from './health.js'
import {
  describeSettings, effectiveSettings, mergeSettings, normalizeSettings, validateSettingsPatch,
} from './settings.js'

export const PLUGIN_NAME = 'dsh-novelforge'
export const PLUGIN_VERSION = '0.2.0'

/**
 * 与墨坊之间的契约版本：墨坊改了这几个端点的字段/语义就 +1。
 * 插件按版本决定"能不能调、怎么调"，不靠猜（DSH 0.2.2-rc 期两边都在动）。
 */
export const CONTRACT_VERSION = 1

/** 用到的墨坊端点（health 与实际调用都从这里取，别在两处各写一份） */
export const ENDPOINTS = {
  state: '/state',
  whoami: '/whoami',
  chapter_paragraphs: '/chapters/paragraphs',
  chapter_annotations: '/chapters/annotations',
  structure: '/review/structure',
  paragraph_preview: '/chapters/paragraph/preview',
  paragraph_pending: '/chapters/paragraph/pending',
  paragraph_drop: '/chapters/paragraph/drop',
}

const HEALTH_ROUTE = '/mofang/health.json'
/** 规范路径被上一代残留占住时的退路（见 ⑤ 的注释） */
const HEALTH_ROUTE_FALLBACK = '/mofang/api/health.json'
const SETTINGS_ROUTE = '/mofang/api/settings'

/**
 * 当前生效的设置与宿主上下文。
 *
 * 为什么放模块级：health / settings 两个 handler 拿不到 apply 的闭包变量，
 * 而它们恰恰要回答"现在连的是哪个地址、设置能不能写"。每次 apply 都重置（不留上一轮的影子）。
 */
let liveRoot = null
let liveSettings = normalizeSettings(null)
let liveEffective = null
let liveConfigError = ''
let liveClient = null

/** 最近一次健康检查的绝对时刻（health 里给"什么时候看过"） */
const lastTick = { at: '' }

function nowIso() {
  return new Date().toISOString()
}

function sendJson(res, code, payload) {
  try {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(payload))
  } catch { /* 连接已断：没什么可做的 */ }
}

function isLoopback(address) {
  const a = String(address || '')
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a === ''
}

/**
 * 写操作的来源校验：Host 必须是本机，跨站 Origin 一律拒。
 *
 * 桌面端页面是 `dsh-app://app/`，Electron 发给宿主服务的请求**不带** `sec-fetch-*` / `referer`，
 * 所以判据是「Host 是回环 + 若带 Origin 则必须是 dsh-app 或同源」。
 */
function isSameOriginMutation(req) {
  const headers = (req && req.headers) || {}
  const host = headers.host
  if (typeof host !== 'string' || !host) return false
  let hostname
  try { hostname = new URL('http://' + host).hostname } catch { return false }
  const loopbackHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  if (!loopbackHost) return false
  const origin = headers.origin
  if (typeof origin === 'string' && origin) {
    if (origin.startsWith('dsh-app://')) return true
    try { return new URL(origin).host === host } catch { return false }
  }
  return true
}

/** 读 JSON 请求体（上限 64 KiB）。只接受对象：设置是键值对 */
async function readJsonBody(req, limit = 64 * 1024) {
  let text = ''
  if (typeof req?.setEncoding === 'function') req.setEncoding('utf8')
  if (req && typeof req[Symbol.asyncIterator] === 'function') {
    for await (const chunk of req) {
      text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      if (Buffer.byteLength(text) > limit) throw new Error('请求体太大（上限 64 KiB）')
    }
  } else {
    throw new Error('读不到请求体（宿主请求形状变了）')
  }
  if (!text.trim()) throw new Error('请求体不能为空')
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求体必须是 JSON 对象')
  }
  return value
}

/** 本插件在 Loader 里的那一行 + configEditor（写设置只有这一条正路） */
function configTarget() {
  const root = liveRoot
  if (!root) return { error: '插件上下文还没就绪' }
  let entry = null
  try { entry = root.fiber && root.fiber.entry ? root.fiber.entry : null } catch { entry = null }
  if (!entry) return { error: '拿不到本插件的 Loader 行（宿主形状变了）—— 设置只能读' }
  let editor
  try {
    editor = typeof root.get === 'function' ? root.get('configEditor') : undefined
  } catch { editor = undefined }
  if (!editor || typeof editor.edit !== 'function') {
    return { error: '宿主没有 configEditor 服务 —— 设置只能读，不能保存' }
  }
  return { entry, editor }
}

/** Loader 行的 id（宿主形状变了就回空串，不猜） */
function entryIdOf(entry) {
  try {
    const id = entry && entry.options ? entry.options.id : ''
    return id ? String(id) : ''
  } catch { return '' }
}

/**
 * 设置现状：**每次都当场问宿主**。
 *
 * 为什么不在 apply 时算一次就存着：`configEditor` 是后挂的服务，插件 apply 那一刻它常常
 * 还没进上下文 —— 存下来就会把"能写"永久记成 false，而 GET 路由当场问是对的。
 * （dsh-fangcun 2026-11-19 真机踩到过这个坑。）
 */
function settingsStatus() {
  const target = liveRoot ? configTarget() : { error: '插件上下文还没就绪' }
  return {
    writable: Boolean(target.entry && target.editor),
    entryId: entryIdOf(target.entry),
    error: target.error || '',
  }
}

/** 客户端半（设置页）到底进没进 DSH 的模块表：manifest 改了没重启条目时这里是空 */
function clientModuleState() {
  try {
    const cm = liveRoot && typeof liveRoot.get === 'function' ? liveRoot.get('clientModules') : undefined
    if (!cm || typeof cm.clientPath !== 'function') return { available: false, path: '' }
    const p = cm.clientPath(PLUGIN_NAME)
    return { available: Boolean(p), path: p ? String(p) : '' }
  } catch {
    return { available: false, path: '' }
  }
}

/**
 * 一份设置快照（health 与 GET settings 共用，别各算一份）。
 * 地址配坏时（比如指向外网）**照样能读**，只是 effective 里带错误 —— 否则用户连"错在哪"都看不到。
 */
function settingsSnapshot() {
  const status = settingsStatus()
  let effective = liveEffective
  if (!effective) {
    try {
      effective = effectiveSettings(liveSettings)
    } catch (e) {
      effective = {
        baseUrl: '(配置无效)', baseUrlSource: 'config', timeoutMs: 0, timeoutMsSource: 'default',
      }
      liveConfigError = liveConfigError || String((e && e.message) || e)
    }
  }
  return {
    ...status,
    ...describeSettings(liveSettings),
    effective,
    configError: liveConfigError,
  }
}

/** 只读 health（GET） */
function healthHandler(req, res) {
  try {
    if (String((req && req.method) || 'GET').toUpperCase() !== 'GET') {
      res.setHeader && res.setHeader('Allow', 'GET')
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    lastTick.at = nowIso()
    sendJson(res, 200, collectHealth({
      version: PLUGIN_VERSION,
      contract: CONTRACT_VERSION,
      settings: settingsSnapshot(),
      client: clientModuleState(),
      checkedAt: lastTick.at,
    }))
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
  }
}

/**
 * 设置的后端：`GET` 读现状（`?probe=1` 顺带真连一次），`PUT` 写两项覆盖。
 *
 * 写入只有一条路：`configEditor.edit(entry, …)` 写 profile patch；保存后 Loader 会重启本插件，
 * `apply(root, config)` 拿到新值。**不手改** `cordis.patch.yml`。
 */
async function settingsHandler(req, res) {
  try {
    const method = String((req && req.method) || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'PUT') {
      res.setHeader && res.setHeader('Allow', 'GET, PUT')
      sendJson(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    if (!isLoopback(req && req.socket && req.socket.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: '只能从本机访问' })
      return
    }
    if (method === 'PUT') {
      if (!isSameOriginMutation(req)) {
        sendJson(res, 403, { ok: false, error: '跨站写被拒绝（只接受本机页面）' })
        return
      }
      const type = String((req && req.headers && req.headers['content-type']) || '').toLowerCase()
      if (!type.startsWith('application/json')) {
        sendJson(res, 415, { ok: false, error: 'Content-Type 必须是 application/json' })
        return
      }
    }

    // GET：读现状。`?probe=1` 是设置页的「测试连接」——真连一次，不留缓存。
    if (method === 'GET') {
      const url = String((req && req.url) || '')
      if (url.indexOf('probe=1') >= 0 && liveClient) {
        try { await probe(liveClient) } catch { /* 连不上只是 reachable:false */ }
        lastTick.at = nowIso()
      }
      sendJson(res, 200, {
        ok: true,
        ...settingsSnapshot(),
        mofang: { ...state.lastProbe },
        tools: { ...state.tools },
        prompt: { ...state.prompt },
        routes: { ...state.routes },
        client: clientModuleState(),
        plugin: { name: PLUGIN_NAME, version: PLUGIN_VERSION },
        checkedAt: lastTick.at,
      })
      return
    }

    // PUT：写设置
    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      sendJson(res, 400, { ok: false, error: String((e && e.message) || e) })
      return
    }
    const checked = validateSettingsPatch(body)
    if (!checked.ok) {
      sendJson(res, 400, { ok: false, error: checked.error })
      return
    }
    const next = normalizeSettings(mergeSettings(liveSettings, checked.patch))
    // 两项都没变就别演戏：不写 profile、不重启，也不谎报"会重启一次"。
    if (JSON.stringify(next) === JSON.stringify(liveSettings)) {
      sendJson(res, 200, {
        ok: true,
        changed: false,
        restarting: false,
        message: '已保存：没有变化（两项都空 = 不覆盖，继续用环境变量 / 默认值）',
        ...settingsSnapshot(),
      })
      return
    }
    const target = configTarget()
    if (!target.entry || !target.editor) {
      sendJson(res, 501, { ok: false, error: target.error || '设置不可写（宿主没有 configEditor 服务）' })
      return
    }
    try {
      await target.editor.edit(target.entry, (current) => mergeSettings(current, checked.patch))
    } catch (e) {
      sendJson(res, 409, { ok: false, error: '保存失败：' + String((e && e.message) || e) })
      return
    }
    liveSettings = next
    try { liveEffective = effectiveSettings(liveSettings) } catch { liveEffective = null }
    sendJson(res, 200, {
      ok: true,
      changed: true,
      restarting: true,
      message: '已保存；插件重启一次后按新设置连接',
      ...settingsSnapshot(),
    })
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) })
  }
}

export const ROUTES = [
  { kind: 'exact', path: HEALTH_ROUTE, handler: healthHandler, fallback: HEALTH_ROUTE_FALLBACK },
  { kind: 'exact', path: SETTINGS_ROUTE, handler: settingsHandler },
]

/**
 * 挂载。每一步都**独立降级**：没有 systemPrompt 也照样注册工具，没有 tools 也照样有 health ——
 * 一个服务缺失不该让整个插件沉默（用户看到的就是"装了没用"）。
 *
 * @param {object} root 宿主上下文
 * @param {object} [config] Loader 行里的 config（本插件的两项设置；测试可注入 `client`）
 */
export function apply(root, config = {}) {
  // 每次挂载都从"没注册上"开始算：模块级 state 是跨 apply 共享的，
  // 不清就会让上一轮的状态冒充这一轮（health 说"规则段已注册"而其实没有）。
  state.prompt = { rules: false, status: false, error: '' }
  state.tools = { registered: false, names: [], error: '' }
  state.routes = { registered: false, paths: [], conflicts: [], error: '' }

  liveRoot = root
  liveSettings = normalizeSettings(config)
  liveConfigError = ''
  liveEffective = null
  lastTick.at = ''

  const log = (level, msg) => {
    try {
      const fn = root && root.logger && root.logger[level]
      if (typeof fn === 'function') fn.call(root.logger, '[dsh-novelforge] ' + msg)
    } catch { /* logger 可选 */ }
  }
  const logWarn = (msg) => log('warn', msg)

  // ---------------------------------------------------------------- ① 配置 → 客户端
  let mofang = null
  const injected = config && config.client && typeof config.client.get === 'function' ? config.client : null
  if (injected) {
    mofang = injected
  } else {
    try {
      liveEffective = effectiveSettings(liveSettings)
      mofang = new MofangClient({
        baseUrl: liveEffective.baseUrl,
        timeoutMs: liveEffective.timeoutMs,
      })
    } catch (e) {
      // 配置坏了（比如 MOFANG_API 指向外网）：明说，不假装能用。
      // **但 health / settings 路由照旧注册** —— 否则用户连"为什么没连上、怎么改"都看不到。
      liveConfigError = String((e && e.message) || e)
      logWarn(liveConfigError)
    }
  }
  liveClient = mofang

  // ---------------------------------------------------------------- ② 一行现状
  if (mofang) {
    const tick = () => {
      void probe(mofang).catch(() => {})
      lastTick.at = nowIso()
    }
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

  // ---------------------------------------------------------------- ③ 提示词
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

  // ---------------------------------------------------------------- ④ 模型工具（5 个，白名单）
  //
  // ⚠ 2026-11-23 真机故障修复：原来这里只试**一次** `root.get('tools')`，拿不到就永久放弃。
  //   实测本机 health 报 tools.registered=false 而同一份 health 里 prompt.rules=true ——
  //   提示词注册上了、工具一个没上。后果不是"少几个工具"，是**系统提示在指挥模型去调不存在的 mofang_***。
  //   真因：`tools` 服务是**异步就绪**的，插件 apply 时通常还没挂上；这不是"老宿主"。
  //   现在：每秒重试，最多 30 次（宿主装配慢时也够）；期间 health 如实显示"正在重试"。
  const TOOL_ATTEMPTS = 30
  const setupTools = () => {
    if (!mofang) {
      state.tools.error = '墨坊地址配置无效，工具没有注册：' + liveConfigError
      return
    }
    let attempts = 0
    let timer = null
    let offs = []
    let done = false
    const attach = () => {
      const svc = typeof root.get === 'function' ? root.get('tools') : undefined
      if (!svc || typeof svc.register !== 'function') {
        attempts += 1
        if (attempts >= TOOL_ATTEMPTS) {
          timer = null
          state.tools.error = 'tools 服务等 ' + TOOL_ATTEMPTS + ' 秒仍未就绪 —— 模型工具没有注册'
          return
        }
        state.tools.error = 'tools 服务暂不可用，正在重试（' + attempts + '/' + TOOL_ATTEMPTS + '）'
        timer = setTimeout(attach, 1000)
        if (timer && typeof timer.unref === 'function') timer.unref()
        return
      }
      timer = null
      let defs
      try {
        defs = buildTools(mofang)
      } catch (e) {
        state.tools.error = '工具定义构建失败：' + String((e && e.message) || e)
        return
      }
      const names = []
      try {
        for (const def of defs) {
          const off = svc.register(def)
          // 注册返回的清理函数要留着：effect 收摊时必须反注册，
          // 否则重载插件会留下同名工具的僵尸注册（工具表里两份、调哪个不确定）
          if (typeof off === 'function') offs.push(off)
          names.push(def.name)
        }
      } catch (e) {
        // 单个工具注册失败不连坐已注册的：但状态如实记，别假装全绿
        state.tools.error = '注册第 ' + (names.length + 1) + '/' + defs.length + ' 个时失败：'
          + String((e && e.message) || e)
        for (const off of offs) { try { off() } catch { /* ignore */ } }
        offs = []
        state.tools.registered = false
        state.tools.names = []
        return
      }
      state.tools.registered = names.length > 0
      state.tools.names = names
      state.tools.error = names.length === defs.length
        ? ''
        : '只注册上 ' + names.length + '/' + defs.length + ' 个工具'
      done = true
      // 落一条日志：重启后工具还是没出现时，"注册上了但宿主没转发"和
      // "压根没注册上"是两件完全不同的事，没有这条只能靠猜。
      log('info', '工具已注册（' + names.length + ' 个，第 ' + (attempts + 1) + ' 次尝试）：' + names.join(', '))
    }
    attach()
    return () => {
      if (timer) clearTimeout(timer)
      if (done) {
        for (const off of offs) { try { off() } catch { /* ignore */ } }
        offs = []
      }
      state.tools.registered = false
      state.tools.names = []
    }
  }
  if (typeof root.effect === 'function') root.effect(setupTools, PLUGIN_NAME + ': tools')
  else setupTools()

  // ---------------------------------------------------------------- ⑤ 只读路由（health / settings）
  //
  // ⚠ 2026-11-23 真机踩到：0.1.0 的旧代码把 `web.register` 返回的清理函数**丢了**，
  //   HMR 换掉模块后旧路由注销不掉，新代码再注册同一路径就报
  //   `webserver: duplicate exact route "/mofang/health.json"` ——
  //   `/mofang/api/settings` 能开、health 却永远停在旧响应上（看起来像"新版没生效"）。
  //   现在：主路径被占就退到 fallback，并把"退到了哪"如实写进 health。
  if (typeof root.inject === 'function') {
    root.inject(['webServer'], (ctx) => {
      const web = ctx && ctx.webServer
      if (!web || typeof web.register !== 'function') {
        state.routes.error = 'webServer 服务不可用 —— health 端点是空的'
        return
      }
      const registerAll = () => {
        const paths = []
        const disposers = []
        const conflicts = []
        const attempt = (r, p, isFallback) => {
          try {
            const d = web.register({ kind: r.kind, path: p, handler: r.handler })
            if (typeof d === 'function') disposers.push(d)
            paths.push(p)
            return true
          } catch (e) {
            const msg = String((e && e.message) || e)
            if (!isFallback && r.fallback && /duplicate/i.test(msg)) {
              conflicts.push(r.path)
              return attempt(r, r.fallback, true)
            }
            state.routes.error = '注册 ' + p + ' 失败：' + msg
            return false
          }
        }
        for (const r of ROUTES) attempt(r, r.path, false)
        state.routes.registered = paths.length > 0
        state.routes.paths = paths
        state.routes.conflicts = conflicts
        if (conflicts.length) {
          logWarn('这些路径被上一代残留注册占住了，已换个位置：' + conflicts.join(', ')
            + ' —— 重启 DSH 后残留会消失，届时回到原路径')
        }
        return () => {
          state.routes.registered = false
          state.routes.paths = []
          state.routes.conflicts = []
          for (const d of disposers) { try { d() } catch { /* 已注销 */ } }
        }
      }
      if (typeof ctx.effect === 'function') ctx.effect(registerAll, PLUGIN_NAME + ': routes')
      else registerAll()
    })
  }

  return { client: mofang }
}

export default { name: PLUGIN_NAME, apply }
