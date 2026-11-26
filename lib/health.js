/**
 * `/mofang/health.json` —— 只报**能自证的事实**，不报期望。
 *
 * 为什么值得一个端点：插件的失败模式几乎都是"装了但没生效"——
 * 规则段没注册、工具没注册上、设置页没进模块表、墨坊没开。这几种在界面上长得一模一样
 * （都是"没有反应"），只有把每一环的状态摊出来才分得清是"哪一环没接上"（dsh-fangcun 的三件套口径）。
 */

/** 进程内活状态（index.js 注册时写进来，health 读它） */
export const state = {
  prompt: { rules: false, status: false, error: '' },
  tools: { registered: false, names: [], error: '' },
  routes: { registered: false, paths: [], conflicts: [], error: '' },
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

/**
 * 组装 health（每次现算，不缓存 —— 读的都是内存状态 + 十几次布尔判断）。
 *
 * `settings` / `client` / `checkedAt` 由 index.js 传进来（那里才拿得到宿主上下文）。
 * 本函数不认识 DSH：它只把别人算好的事实摆整齐 —— 换宿主只改 index.js。
 */
export function collectHealth({ version, contract, settings, client, checkedAt } = {}) {
  const p = state.lastProbe
  const s = settings || {
    writable: false, entryId: '', error: '', values: {}, overridden: {}, effective: null, configError: '',
  }
  return {
    ok: true,
    plugin: { name: 'dsh-novelforge', version },
    contract,
    // 生效中的连接参数 + 来源（config / env / default）：排查"我设了 8766 怎么还连 8765"全靠它
    connection: s.effective,
    // 设置页的现状：两项覆盖、能不能写、拿不到哪一环（不假装保存成功）
    settings: {
      writable: s.writable,
      entryId: s.entryId,
      error: s.error,
      values: s.values,
      overridden: s.overridden,
      configError: s.configError || '',
    },
    // 客户端半（设置页）到底进没进 DSH 的模块表
    client: client || { available: false, path: '' },
    // 三件套里**插件只能报自己看得见的那两环**：墨坊在不在、插件自己装没装全。
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
    checkedAt: checkedAt || '',
    note: '这里只有插件能自证的事实；「DSH 装没装」由 DSH 自己回答，不属于本插件。',
  }
}
