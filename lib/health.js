/**
 * `/mofang/health.json` —— 只报**能自证的事实**，不报期望。
 *
 * 为什么值得一个端点：插件的失败模式几乎都是"装了但没生效"——
 * 规则段没注册、工具没注册上、墨坊没开。这三种在界面上长得一模一样（都是"没有反应"），
 * 只有把每一环的状态摊出来才分得清是"哪一环没接上"（dsh-fangcun 的三件套口径）。
 */

/** 进程内活状态（index.js 注册时写进来，health 读它） */
export const state = {
  prompt: { rules: false, status: false, error: '' },
  tools: { registered: false, names: [], error: '' },
  routes: { registered: false, paths: [], error: '' },
  lastProbe: { at: '', reachable: false, book: '', stage: 0, error: '' },
}

/** 探一次墨坊（不抛；连不上只是 reachable:false） */
export async function probe(client) {
  const r = await client.get('/state')
  const d = r.ok ? (r.data || {}) : {}
  const stages = Array.isArray(d.stages) ? d.stages : []
  const next = stages.find((s) => String((s && s.status) || '') !== 'done') || {}
  state.lastProbe = {
    at: new Date().toISOString(),
    reachable: !!r.ok,
    book: r.ok ? String(d.book || '') : '',
    stage: r.ok ? Number(next.stage || 0) : 0,
    error: r.ok ? '' : String(r.error || ''),
  }
  return state.lastProbe
}

/** 组装 health（每次现算，不缓存 —— 这十几行读的是内存状态） */
export function collectHealth({ version, contract, base }) {
  const p = state.lastProbe
  return {
    ok: true,
    plugin: { name: 'dsh-novelforge', version },
    contract,
    base,
    // 三件套里**插件只能报自己看得见的两环**：墨坊在不在、插件自己装没装全。
    mofang: {
      reachable: !!p.reachable,
      book: p.book || '',
      stage: p.stage || 0,
      lastAt: p.at || '',
      error: p.error || '',
      hint: p.reachable ? '' : '打开绒花墨坊（或起 nf_api）即可；插件每次调用都新连一次，不用重启 DSH。',
    },
    prompt: { ...state.prompt },
    tools: { ...state.tools },
    routes: { ...state.routes },
    note: '这里只有插件能自证的事实；「DSH 装没装」由 DSH 自己回答，不属于本插件。',
  }
}
