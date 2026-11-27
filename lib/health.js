/**
 * `/mofang/health.json` —— 只报**能自证的事实**，不报期望。
 *
 * 为什么值得一个端点：插件的失败模式几乎都是"装了但没生效"——
 * 规则段没注册、工具没注册上、设置页没进模块表、墨坊没开。这几种在界面上长得一模一样
 * （都是"没有反应"），只有把每一环的状态摊出来才分得清是"哪一环没接上"（dsh-fangcun 的三件套口径）。
 */

/**
 * 会话级自证的默认值（health 与 apply 重置共用，别在两处各写一份）。
 * 挂上之后 health 现问 `liveProof.summary()`，不再读这个。
 */
export const EMPTY_PROOF = {
  enabled: false, path: '', rows: 0, lastAt: '', lastSession: '', lastTool: '',
  turns: { total: 0, calls: 0, chapterBeforePreview: 0, previewWithoutChapter: 0 },
  lastTurn: null, error: '',
}

/** 进程内活状态（index.js 注册时写进来，health 读它） */
export const state = {
  prompt: { rules: false, status: false, error: '' },
  tools: { registered: false, names: [], error: '' },
  routes: { registered: false, paths: [], conflicts: [], error: '' },
  lastProbe: {
    at: '', reachable: false, book: '', stage: 0, error: '',
    // 对端契约线索（见 probeApi）：没有它，"版本不匹配"只能表现为静默少数据
    api: { server: '', version: '', healthOk: false, shapeOk: false, warnings: [] },
  },
  // 会话级自证：未挂上时的默认值（挂上后 health 现问 liveProof.summary()）
  proof: { ...EMPTY_PROOF },
}

/** 探一次墨坊（不抛；连不上只是 reachable:false） */
export async function probe(client) {
  const r = await client.get('/state')
  const d = r.ok ? (r.data || {}) : {}
  const stages = Array.isArray(d.stages) ? d.stages : []
  const next = stages.find((s) => String((s && s.status) || '') !== 'done') || {}
  const api = await probeApi(client, r)
  state.lastProbe = {
    at: new Date().toISOString(),
    reachable: !!r.ok,
    book: r.ok ? String(d.book || '') : '',
    stage: r.ok ? Number(next.stage || 0) : 0,
    error: r.ok ? '' : String(r.error || ''),
    api,
  }
  return state.lastProbe
}

/**
 * 契约探针：墨坊 body 里**没有** API 版本（只有 `Server: NovelForgeAPI/0.2` 头），
 * 所以这里报"当前能看见什么"：Server 头、/health 通不通、/state 的形状对不对。
 *
 * 形状不对是目前"版本不匹配"最可靠的信号 —— 比版本号可靠（版本号相等不代表字段没改名）。
 * 只报告，不阻断：工具照常调，失败时按各自回执说人话。
 */
async function probeApi(client, stateResult) {
  if (!stateResult || !stateResult.ok) {
    return { server: '', version: '', healthOk: false, shapeOk: false, warnings: [] }
  }
  const h = await client.get('/health')
  const server = String((h && h.server) || '')
  const version = (server.match(/NovelForgeAPI\/([\d.]+)/) || [])[1] || ''
  const warnings = []
  const d = stateResult.data || {}
  if (!Array.isArray(d.stages)) {
    warnings.push('/state 没有 stages 数组 —— 阶段进度读不到')
  }
  if (!Array.isArray(d.chapter_target_words)) {
    warnings.push('/state 没有 chapter_target_words 数组 —— 单章字数区间读不到')
  }
  if (!d.budget || typeof d.budget !== 'object') {
    warnings.push('/state 没有 budget 对象 —— token 用量读不到')
  }
  if (!h.ok) {
    warnings.push('墨坊 /health 没正常回话（' + (h.error || 'HTTP ' + h.status) + '）')
  }
  return { server, version, healthOk: !!h.ok, shapeOk: warnings.length === 0, warnings }
}

/**
 * 组装 health（每次现算，不缓存 —— 读的都是内存状态 + 十几次布尔判断）。
 *
 * `settings` / `client` / `checkedAt` 由 index.js 传进来（那里才拿得到宿主上下文）。
 * 本函数不认识 DSH：它只把别人算好的事实摆整齐 —— 换宿主只改 index.js。
 */
export function collectHealth({ version, contract, settings, client, compat, proof, checkedAt } = {}) {
  const p = state.lastProbe
  const s = settings || {
    writable: false, entryId: '', error: '', values: {}, overridden: {}, effective: null, configError: '',
  }
  return {
    ok: true,
    // 必须等于 package.json 的 name（测试钉着）；改包名时两处一起改
    plugin: { name: 'dsh-ronghuamofang', version },
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
    // 宿主能力三态（lib/compat.js）：形状不对时这里会红，而不是等用户撞上“保存不了/设置页没有”
    compat: compat || { checkedAt: '', capabilities: {}, warnings: [], summary: '尚未体检' },
    // 会话级自证：模型真的按“先查判据、再出候选”的顺序调了吗
    proof: proof || state.proof,
    // 三件套里**插件只能报自己看得见的那两环**：墨坊在不在、插件自己装没装全。
    mofang: {
      reachable: !!p.reachable,
      book: p.book || '',
      stage: p.stage || 0,
      lastAt: p.at || '',
      error: p.error || '',
      // 对端契约线索：Server 头 + /state 形状。墨坊不报 API 版本，这是目前唯一能看见的错位信号。
      api: p.api || { server: '', version: '', healthOk: false, shapeOk: false, warnings: [] },
      hint: p.reachable ? '' : '打开绒花墨坊（或起 nf_api）即可；插件每次调用都新连一次，不用重启 DSH。',
    },
    prompt: { ...state.prompt },
    tools: { ...state.tools },
    routes: { ...state.routes },
    checkedAt: checkedAt || '',
    note: '这里只有插件能自证的事实；「DSH 装没装」由 DSH 自己回答，不属于本插件。',
  }
}
