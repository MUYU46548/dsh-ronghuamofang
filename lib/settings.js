/**
 * 插件设置（墨坊地址 / 请求超时）的**纯校验与归一**。
 *
 * 为什么需要它：墨坊的端口不是永远 8765（`scripts/nf_api.py --port` 可换、多实例调试也会换），
 * 而"改环境变量再重启 DSH"对作者来说太重。把这两项放进 DSH 设置页，改完一次生效。
 *
 * 三条原则（与 dsh-fangcun 的 settings.js 同一口径）：
 *  ① **空字符串 = 清掉覆盖**（回到环境变量 / 默认值），不是"设成空地址"；
 *  ② **脏值不写**：非回环地址、非法端口、超时越界，一律拒绝并说人话；
 *  ③ 这个文件不认识 DSH，只认"两个字符串字段" —— 可搬走、可单测。
 *
 * ⚠ 墨坊的**业务数据**不在这里：书、章、批注全在墨坊自己的工程里，插件只是读。
 */
import { DEFAULT_BASE, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS, baseUrlOf } from './http.js'

/** 字段与长度上限（超长直接拒，不截断 —— 截断会把地址悄悄改错） */
export const SETTINGS_FIELDS = {
  baseUrl: 2048,
  timeoutMs: 16,
}

export const SETTINGS_KEYS = Object.keys(SETTINGS_FIELDS)

function asString(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  return value.trim()
}

/**
 * 把 Loader 行里的原始 config 归一成两个字符串。
 * 认不出的键直接忽略（测试会注入 `client`，那是脚手架不是设置）。
 */
export function normalizeSettings(raw) {
  const out = { baseUrl: '', timeoutMs: '' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const key of SETTINGS_KEYS) {
    const v = asString(raw[key])
    if (v !== null) out[key] = v.slice(0, SETTINGS_FIELDS[key])
  }
  return out
}

/**
 * 校验一份**局部**设置（只含用户这次要改的键）。
 *
 * @param {unknown} input
 * @returns {{ok: true, patch: Record<string, string>} | {ok: false, error: string}}
 */
export function validateSettingsPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: '设置必须是一个 JSON 对象' }
  }
  const keys = Object.keys(input)
  if (keys.length === 0) return { ok: false, error: '没有要保存的设置' }

  const patch = {}
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(SETTINGS_FIELDS, key)) {
      return { ok: false, error: '不认识的设置项：' + key }
    }
    const value = asString(input[key])
    if (value === null) {
      return { ok: false, error: '设置项 ' + key + ' 必须是字符串（留空表示清除）' }
    }
    if (value.length > SETTINGS_FIELDS[key]) {
      return { ok: false, error: '设置项 ' + key + ' 太长（上限 ' + SETTINGS_FIELDS[key] + ' 字符）' }
    }
    if (/[\u0000\r\n]/.test(value)) {
      return { ok: false, error: '设置项 ' + key + ' 不能包含换行或空字符' }
    }
    if (key === 'baseUrl' && value !== '') {
      // 复用 http.js 的唯一一处回环判定：错误文案与工具层完全一致
      try {
        patch[key] = baseUrlOf({}, value)
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      }
      continue
    }
    if (key === 'timeoutMs' && value !== '') {
      const n = Number(value)
      if (!Number.isInteger(n)) {
        return { ok: false, error: '超时必须是整数毫秒（' + MIN_TIMEOUT_MS + '–' + MAX_TIMEOUT_MS + '）' }
      }
      if (n < MIN_TIMEOUT_MS || n > MAX_TIMEOUT_MS) {
        return { ok: false, error: '超时超出范围（' + MIN_TIMEOUT_MS + '–' + MAX_TIMEOUT_MS + ' 毫秒）' }
      }
      patch[key] = String(n)
      continue
    }
    patch[key] = value
  }
  return { ok: true, patch }
}

/**
 * 把一份局部 patch 合进现有 config：空值 = **删掉这个键**，让下层（环境变量 / 默认）
 * 重新生效；不能写成 `baseUrl: ""` —— 那会把"没设置"变成一个显式的空覆盖。
 */
export function mergeSettings(current, patch) {
  const next = { ...(current && typeof current === 'object' ? current : {}) }
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === '') delete next[key]
    else next[key] = value
  }
  return next
}

/** 设置页展示用：哪些字段有覆盖 */
export function describeSettings(settings) {
  const s = normalizeSettings(settings)
  const overridden = {}
  for (const key of SETTINGS_KEYS) overridden[key] = Boolean(s[key])
  return { values: s, overridden }
}

/**
 * 当前**真正生效**的两项 + 各自从哪来（config > env > 默认）。
 *
 * 为什么来源要单独报：排查"我明明设了 8766 却连的 8765"时，
 * "值是多少"没用，"这个值是谁给的"才有用（dsh-fangcun 的设置页同样这么报数据根来源）。
 *
 * baseUrl 这里会**校验回环**：非回环直接抛，调用方据此把插件标成"配置无效"而不是静默连出去。
 */
export function effectiveSettings(settings, env = process.env) {
  const s = normalizeSettings(settings)
  const fromEnv = String((env && env.MOFANG_API) || '').trim()
  const rawBase = s.baseUrl || fromEnv || DEFAULT_BASE
  const baseUrl = baseUrlOf(env, rawBase)
  const source = s.baseUrl ? 'config' : (fromEnv ? 'env' : 'default')

  const envTimeout = Number((env && env.MOFANG_TIMEOUT_MS) || 0)
  const rawTimeout = s.timeoutMs
    ? Number(s.timeoutMs)
    : (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS)
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.trunc(rawTimeout) : DEFAULT_TIMEOUT_MS
  const timeoutSource = s.timeoutMs ? 'config' : (envTimeout > 0 ? 'env' : 'default')

  return { baseUrl, baseUrlSource: source, timeoutMs, timeoutMsSource: timeoutSource }
}
