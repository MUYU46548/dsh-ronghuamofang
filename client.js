/**
 * dsh-ronghuamofang —— client half（DSH 设置里的「绒花墨坊」一节）。
 *
 * 为什么需要它：DSH 0.2 线的内置 Settings 只自动渲染插件 `Config` 里的 volatile 字段，
 * 而 `Config` 要 `@deepseek-ai/schemastery`；本仓零依赖，不能引。第三方插件的实际做法
 * （`dsh-keep-awake` / `dsh-fangcun` 都是这样）是自带一个 client 模块，注册 `settings.section`。
 *
 * 这一节做三件事：
 *  ① 把墨坊当前状态说人话（连没连、哪本书、第几阶段、5 个工具注册上没有）；
 *  ② 编辑两项连接设置：墨坊地址 / 请求超时（走 `/mofang/api/settings`，
 *     宿主用 `configEditor` 写 profile patch，保存后插件重启一次生效）；
 *  ③ 「测试连接」：真连一次再回话，不用等 60 秒的探活。
 *
 * ⚠ 这是浏览器侧代码：不 import、不使用 Node API；React 从模块加载器的 require 取。
 * ⚠ 它**只读**墨坊：没有"采用"按钮，也不该有 —— 采用是作者的签字动作。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ronghuamofang',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const HEALTH = '/mofang/health.json'
    // 主路径被上一代残留占住时，插件会退到这个地址 —— 设置页也要跟过去，不能只认死一个
    const HEALTH_FALLBACK = '/mofang/api/health.json'
    const SETTINGS = '/mofang/api/settings'
    const REFRESH_MS = 10_000

    const styles = {
      panel: {
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        fontSize: 13,
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-primary)',
      },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      },
      heading: { margin: 0, fontSize: 12, fontWeight: 600, opacity: 0.7 },
      row: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 },
      label: { flex: '0 0 92px', color: 'var(--dsw-alias-label-secondary)' },
      value: { flex: 1, wordBreak: 'break-all' },
      dim: { opacity: 0.65, fontSize: 12 },
      error: { color: 'var(--dsw-state-error-primary)', fontSize: 12, whiteSpace: 'pre-wrap' },
      warn: { color: 'var(--dsw-state-warn-label)', fontSize: 12, whiteSpace: 'pre-wrap' },
      ok: { color: 'var(--dsw-state-success-primary)', fontSize: 12 },
      input: {
        flex: 1,
        minWidth: 0,
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        padding: '4px 8px',
        font: 'inherit',
      },
      button: {
        minHeight: 30,
        padding: '0 12px',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 15,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        font: 'inherit',
      },
      badge: {
        display: 'inline-block',
        padding: '1px 9px',
        borderRadius: 999,
        fontSize: 12,
        border: '1px solid var(--dsw-alias-border-l2)',
        whiteSpace: 'nowrap',
      },
      badgeOn: { color: 'var(--dsw-state-success-primary)' },
      badgeOff: { color: 'var(--dsw-state-warn-label)' },
      badgeErr: { color: 'var(--dsw-state-error-primary)' },
      actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 },
    }

    async function getJson(url) {
      const response = await fetch(url, { cache: 'no-store' })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body || body.ok !== true) {
        throw new Error((body && body.error) || ('HTTP ' + response.status))
      }
      return body
    }

    async function putSettings(patch) {
      const response = await fetch(SETTINGS, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body || body.ok !== true) {
        throw new Error((body && body.error) || ('HTTP ' + response.status))
      }
      return body
    }

    function sourceLabel(source) {
      if (source === 'config') return '设置页'
      if (source === 'env') return '环境变量'
      if (source === 'default') return '默认'
      return String(source || '')
    }

    function Section() {
      const [health, setHealth] = useState(null)
      const [settings, setSettings] = useState(null)
      const [draft, setDraft] = useState({ baseUrl: '', timeoutMs: '' })
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [error, setError] = useState('')
      const dirty = useRef(false)

      const applyBody = (body) => {
        setSettings(body)
        if (body && body.values && !dirty.current) {
          setDraft({
            baseUrl: body.values.baseUrl || '',
            timeoutMs: body.values.timeoutMs || '',
          })
        }
      }

      const refresh = async () => {
        let nextHealth = null
        let nextSettings = null
        try { nextHealth = await getJson(HEALTH) } catch {
          try { nextHealth = await getJson(HEALTH_FALLBACK) } catch (e) { setError(String(e.message || e)) }
        }
        try { nextSettings = await getJson(SETTINGS) } catch (e) { setError(String(e.message || e)) }
        if (nextHealth) setHealth(nextHealth)
        if (nextSettings) applyBody(nextSettings)
        if (nextHealth && nextSettings) setError('')
      }

      useEffect(() => {
        let alive = true
        const tick = async () => {
          await refresh()
          if (!alive) return
        }
        void tick()
        const timer = setInterval(() => { void tick() }, REFRESH_MS)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      const setField = (key, value) => {
        dirty.current = true
        setDraft((prev) => ({ ...prev, [key]: value }))
        setNotice('')
      }

      const save = async (patch) => {
        setBusy(true)
        setNotice('')
        setError('')
        try {
          const body = await putSettings(patch)
          dirty.current = false
          setDraft({
            baseUrl: body.values ? body.values.baseUrl || '' : '',
            timeoutMs: body.values ? body.values.timeoutMs || '' : '',
          })
          setNotice(body.message || '已保存')
          if (body.changed) setTimeout(() => { void refresh() }, 1500)
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy(false)
        }
      }

      const testConnection = async () => {
        setBusy(true)
        setNotice('')
        setError('')
        try {
          const body = await getJson(SETTINGS + '?probe=1')
          const m = body.mofang || {}
          setNotice(m.reachable
            ? '连上了：《' + (m.book || '?') + '》 · 第 ' + (m.stage || 0) + ' 阶段'
            : '没连上：' + (m.error || '墨坊没开'))
          if (m.reachable) setHealth((prev) => ({ ...(prev || {}), mofang: m }))
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy(false)
        }
      }

      const mofang = (health && health.mofang) || {}
      const tools = (health && health.tools) || {}
      const prompt = (health && health.prompt) || {}
      const compat = (health && health.compat) || {}
      const api = (mofang && mofang.api) || {}
      const conn = (settings && settings.effective) || (health && health.connection) || {}
      const writable = Boolean(settings && settings.writable)
      const reachable = Boolean(mofang.reachable)
      // 墨坊 body 里没有 API 版本；能拿到的是 Server 头（NovelForgeAPI/0.2）。拿不到就写"未报到"，不猜。
      const apiLabel = api.version
        ? 'NovelForgeAPI/' + api.version
        : (api.server ? String(api.server).split(' ')[0] : '未报到')
      const versionLine = '插件 v' + ((health && health.plugin && health.plugin.version) || '?')
        + ' · 墨坊 ' + apiLabel
      const compatLine = compat.summary || '宿主自检未完成'

      const badgeText = !health ? '读取中' : reachable ? '已连接' : '未连接'
      const badgeStyle = !health
        ? styles.badge
        : reachable ? { ...styles.badge, ...styles.badgeOn } : { ...styles.badge, ...styles.badgeOff }

      return h(
        'div',
        { style: styles.panel },
        h(
          'div',
          { style: styles.card },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('strong', null, '绒花墨坊'),
            h('span', { style: badgeStyle }, badgeText),
            h('span', { style: { ...styles.dim, marginLeft: 'auto' } },
              health && health.plugin ? 'v' + health.plugin.version : ''),
          ),
          h(
            'div',
            { style: styles.row },
            h('span', { style: styles.label }, '当前书'),
            h('span', { style: styles.value },
              reachable
                ? '《' + (mofang.book || '?') + '》 · 第 ' + (mofang.stage || 0) + ' 阶段'
                : (mofang.hint || '未连接')),
          ),
          h(
            'div',
            { style: styles.row },
            h('span', { style: styles.label }, '地址'),
            h('span', { style: styles.value }, conn.baseUrl || '—'),
          ),
          h(
            'div',
            { style: styles.row },
            h('span', { style: styles.label }, '模型工具'),
            h('span', { style: styles.value },
              tools.registered
                ? (tools.names || []).length + ' 个已注册'
                : ('未注册' + (tools.error ? ' · ' + tools.error : ''))),
          ),
          h(
            'div',
            { style: styles.row },
            h('span', { style: styles.label }, '改稿规则'),
            h('span', { style: styles.value },
              prompt.rules
                ? '已注入（含「采用归作者」）'
                : ('未注入' + (prompt.error ? ' · ' + prompt.error : ''))),
          ),
          h(
            'div',
            { style: styles.row },
            h('span', { style: styles.label }, '版本'),
            h('span', { style: styles.value }, versionLine),
          ),
          h(
            'div',
            { style: styles.row },
            h('span', { style: styles.label }, '宿主自检'),
            h('span', { style: styles.value }, compatLine),
          ),
          ...(compat.warnings || []).map((w, i) =>
            h('div', { key: 'cw' + i, style: styles.warn }, w)),
          ...(api.warnings || []).map((w, i) =>
            h('div', { key: 'aw' + i, style: styles.warn }, '墨坊契约：' + w)),
          mofang.lastAt
            ? h('div', { style: styles.dim }, '上次探活：' + mofang.lastAt)
            : null,
        ),
        h('div', { style: styles.heading }, '连接设置'),
        h(
          'div',
          { style: styles.card },
          h(
            'div',
            { style: styles.row },
            h('span', { style: styles.label }, '墨坊地址'),
            h('input', {
              style: styles.input,
              value: draft.baseUrl,
              placeholder: '留空 = http://127.0.0.1:8765（或环境变量 MOFANG_API）',
              onChange: (e) => setField('baseUrl', e.target.value),
            }),
          ),
          h(
            'div',
            { style: styles.row },
            h('span', { style: styles.label }, '超时（毫秒）'),
            h('input', {
              style: styles.input,
              value: draft.timeoutMs,
              placeholder: '留空 = 15000（1000–120000）',
              onChange: (e) => setField('timeoutMs', e.target.value),
            }),
          ),
          h('div', { style: styles.dim },
            '只允许本机回环地址（127.0.0.1 / localhost / ::1）—— 书稿不出这台机器。'),
          h('div', { style: styles.dim }, writable
            ? '保存后写进 DSH profile，插件会重启一次让新配置生效。'
            : (settings && settings.error) || '设置不可写（宿主没有 configEditor 服务）。'),
          h(
            'div',
            { style: styles.actions },
            h('button', {
              style: styles.button,
              disabled: busy || !writable,
              onClick: () => { void save({ baseUrl: draft.baseUrl, timeoutMs: draft.timeoutMs }) },
            }, busy ? '保存中…' : '保存'),
            h('button', {
              style: styles.button,
              disabled: busy || !writable,
              onClick: () => { void save({ baseUrl: '', timeoutMs: '' }) },
            }, '恢复默认'),
            h('button', {
              style: styles.button,
              disabled: busy,
              onClick: () => { void testConnection() },
            }, '测试连接'),
            h('button', {
              style: styles.button,
              disabled: busy,
              onClick: () => { void refresh() },
            }, '刷新'),
          ),
          notice ? h('div', { style: styles.ok }, notice) : null,
          error ? h('div', { style: styles.error }, error) : null,
        ),
        h('div', { style: styles.dim },
          '在 DSH 里只读改稿链：查章节三件套、出候选（只算不落）、丢候选。'
          + '「采用」（把候选写进正文）必须在墨坊里由作者本人点。'),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register({
        name: 'settings.section',
        id: 'dsh-ronghuamofang',
        order: 171,
        label: () => '绒花墨坊',
      }, Section))
    }

    return { inject: ['slots'], apply }
  },
})
