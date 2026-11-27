/**
 * 与绒花墨坊（NovelForge）之间的唯一通道：**本机 HTTP**（`nf_api` on 127.0.0.1:8765）。
 *
 * 三条边界（越界即错，测试里钉着）：
 *  ① **只连回环地址**：插件不许连任何外部主机。基址不是 127.0.0.1 / localhost / ::1 时
 *     直接抛（宁可插件报错，也不许把书稿内容发到别处）。
 *  ② **不 import 墨坊代码**：两个仓互不锁死；墨坊改了内部结构，插件只受 HTTP 契约影响。
 *  ③ **不抛到调用方**：`call()` 一律返回结构化结果（`ok/status/data/error/hint`）。
 *     工具层据此回 `connected:false`——「墨坊没开」和「墨坊里没有这一章」是两件事，
 *     混成一句会让模型去重造数据。
 *
 * 为什么走 HTTP 而不是墨坊的 MCP（8766）：MCP 那条路要 stdio 垫片，而插件的进程里
 * 起子进程是另一类风险（Windows 上还会闪控制台窗口）。HTTP 直接、可测、失败可解释。
 */

/** 请求头里报明身份：墨坊的 agent 审计日志按它区分来源 */
export const SOURCE = 'dsh-ronghuamofang'

export const DEFAULT_BASE = 'http://127.0.0.1:8765'

/** 单次调用的超时：默认 15 秒；设置页可调，但夹在 1 秒 – 2 分钟之间 */
export const DEFAULT_TIMEOUT_MS = 15000
export const MIN_TIMEOUT_MS = 1000
export const MAX_TIMEOUT_MS = 120000

/** 只认本机回环，别的基址一律拒绝（见文件头边界①） */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * 解析基址。优先级：显式传入的 `override`（设置页写的 Loader config）> `MOFANG_API` > 默认。
 * 非回环一律抛 —— 这条是纯函数，设置页的校验也复用它，所以只有一处判定。
 */
export function baseUrlOf(env = process.env, override) {
  const raw = String(override || '').trim()
    || String((env && env.MOFANG_API) || '').trim()
    || DEFAULT_BASE
  const base = raw.replace(/\/+$/, '')
  let url
  try {
    url = new URL(base)
  } catch {
    throw new Error('MOFANG_API 不是合法 URL：' + base)
  }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) {
    throw new Error('墨坊只在本机回环上：拒绝连接 ' + base + '（只允许 http://127.0.0.1 / localhost / [::1]）')
  }
  return base
}

/** 从墨坊的回执里取一句人话（墨坊的报错统一是 `{ok:false,error}`） */
export function errorText(data, fallback = '') {
  if (!data || typeof data !== 'object') return fallback
  const msg = data.error || data.message || data.hint
  return typeof msg === 'string' && msg.trim() ? msg.trim() : fallback
}

/**
 * 一次 HTTP 调用的结果：
 *   - `ok`：HTTP 2xx 且 body 不是 `{ok:false}`（墨坊的域模块用 ok 字段表达业务失败）
 *   - `status`：HTTP 状态码（连不上时是 0）
 *   - `data`：解析后的 JSON（失败时可能是 `{error}`）
 *   - `hint`：给人/给模型看的下一步（连不上时说明怎么起墨坊）
 */
export class MofangClient {
  constructor({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl } = {}) {
    this.base = String(baseUrl || baseUrlOf()).replace(/\/+$/, '')
    this.timeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS
    this.fetch = fetchImpl || globalThis.fetch
    if (typeof this.fetch !== 'function') {
      throw new Error('没有可用的 fetch（Node >= 18 才有内置 fetch）')
    }
  }

  /** GET / POST */ 
  async call(method, path, { body, timeoutMs } = {}) {
    const url = this.base + (path.startsWith('/') ? path : '/' + path)
    const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : this.timeoutMs
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null
    const upper = String(method || 'GET').toUpperCase()
    try {
      const res = await this.fetch(url, {
        method: upper,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Mofang-Source': SOURCE,
          // 循环依赖：这里不 import agent_guard，只按它的头名发（墨坊那边判来源）
          'X-Mofang-Plugin': 'dsh-ronghuamofang',
        },
        body: upper === 'GET' || body === undefined ? undefined : JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined,
      })
      const text = await res.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = { raw: String(text || '').slice(0, 2000) }
      }
      const ok = res.status >= 200 && res.status < 300
        && !(data && typeof data === 'object' && data.ok === false)
      // 墨坊的 Server 头是 `NovelForgeAPI/0.2 Python/3.x`：插件拿不到 body 里的版本时，
      // 这是唯一能自报的“对端版本”线索（设置页与 health 都会显示它）。
      let server = ''
      try {
        server = res.headers && typeof res.headers.get === 'function'
          ? String(res.headers.get('server') || '')
          : ''
      } catch { server = '' }
      return {
        ok,
        status: res.status,
        data,
        error: ok ? '' : errorText(data, 'HTTP ' + res.status),
        hint: '',
        server,
      }
    } catch (e) {
      // 连不上 / 超时 / 被 abort —— 都不是“墨坊里没有这条数据”
      const msg = (e && (e.message || e.name)) || String(e)
      const timeout = /abort/i.test(String(msg)) || (e && e.name === 'AbortError')
      return {
        ok: false,
        status: 0,
        data: null,
        error: timeout ? '墨坊在 ' + ms + 'ms 内没回话' : '连不上墨坊（' + msg + '）',
        hint: '先起墨坊：桌面端打开绒花墨坊，或 python scripts/nf_api.py --port 8765。'
          + '启动后这一条会自动恢复（插件每次调用都新连一次）。',
        server: '',
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  get(path, opts) { return this.call('GET', path, opts) }
  post(path, body, opts) { return this.call('POST', path, Object.assign({ body }, opts || {})) }
}

/** URL 编码查询串（值里可能有中文/空格） */
export function qs(params) {
  const parts = []
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
  }
  return parts.length ? '?' + parts.join('&') : ''
}
