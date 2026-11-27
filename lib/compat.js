/**
 * 宿主兼容性自检（照 dsh-fangcun 0.7.x 的口径：**运行时真实形状，不比版本号**）。
 *
 * 为什么需要这个模块：DSH 还在 0.2.2-rc 线上，宿主 API 会变。插件"加载上但少干活"时，
 * health 里如果只有"注册成功与否"，用户看到的要么是一片绿、要么是一句没头没尾的 false。
 * 这里给每项能力一个三态：
 *
 *   ok       —— 拿到了，而且形状对
 *   degraded —— 拿到了，但形状不像预期（可能部分功能静默失效）
 *   missing  —— 根本没这个服务（老宿主，或宿主改名了）
 *
 * 结论进 `health.compat`；**只体检、只报告、绝不退出** —— 能用的部分继续用。
 *
 * 为什么不用版本号：`engines.dsh` 只保下限（写上限会让升级后插件静默消失），
 * 而版本号相等不代表 API 没变（preview 期尤其如此）。形状比版本可靠。
 */

/** 期望的宿主能力清单。`late: true` 表示实测比插件 apply 晚几秒才进上下文。 */
export const HOST_CAPABILITIES = [
  {
    key: 'webServer',
    need: 'health 与设置两条路由',
    probe(root) {
      const svc = get(root, 'webServer')
      if (!svc) return 'missing'
      return typeof svc.register === 'function' ? 'ok' : 'degraded'
    },
  },
  {
    key: 'systemPrompt',
    need: '规则段与一行现状',
    probe(root) {
      const svc = get(root, 'systemPrompt')
      if (!svc) return 'missing'
      return typeof svc.section === 'function' ? 'ok' : 'degraded'
    },
  },
  {
    key: 'tools',
    need: '5 个 mofang_* 工具',
    probe(root) {
      const svc = get(root, 'tools')
      if (!svc) return 'missing'
      return typeof svc.register === 'function' ? 'ok' : 'degraded'
    },
  },
  {
    key: 'configEditor',
    need: '设置保存（写 profile patch）',
    late: true,
    probe(root) {
      const svc = get(root, 'configEditor')
      if (!svc) return 'missing'
      return typeof svc.edit === 'function' ? 'ok' : 'degraded'
    },
  },
  {
    key: 'clientModules',
    need: '设置页「绒花墨坊」一节',
    late: true,
    probe(root) {
      const svc = get(root, 'clientModules')
      if (!svc) return 'missing'
      return typeof svc.clientPath === 'function' ? 'ok' : 'degraded'
    },
  },
  {
    key: 'effect',
    need: '可撤销注册（重载不留僵尸）',
    probe(root) {
      return typeof root.effect === 'function' ? 'ok' : 'missing'
    },
  },
  {
    key: 'session/event',
    need: '会话级自证（工具调用顺序）',
    probe(root) {
      return canSubscribe(root)
    },
  },
]

/** 后挂服务键（留给将来的重试窗口用；当前 health 每次现问，不需要等） */
export const LATE_CAPABILITIES = new Set(
  HOST_CAPABILITIES.filter((cap) => cap.late === true).map((cap) => cap.key),
)

function get(root, name) {
  try {
    return typeof root.get === 'function' ? root.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * `root.on` 到底能不能订阅 —— **真调一次**再看能不能注销。
 * 只判 `typeof === 'function'` 会放过“有方法但一调用就抛”的宿主；那与“没有”对插件
 * 是同一件事（收不到事件 = 自证全哑）。用一个不可能触发的假事件名，订阅后立刻注销。
 */
function canSubscribe(root) {
  if (typeof root.on !== 'function') return 'missing'
  try {
    const off = root.on('dsh-ronghuamofang/compat-probe', () => {})
    try { if (typeof off === 'function') off() } catch { /* 注销失败不影响判断 */ }
    return 'ok'
  } catch {
    return 'degraded'
  }
}

/** 三态 → 一句人话（只在不 ok 时用） */
function warnOf(key, need, state) {
  if (state === 'missing') {
    return '宿主没有 ' + key + ' 服务/事件 —— ' + need + ' 这块不可用（插件其余部分照常）'
  }
  return key + ' 存在但形状不像预期 —— ' + need + ' 可能部分失效；宿主大概改过 API'
}

/**
 * 跑一次体检。**绝不抛**：任何探测出错都记成 missing 并继续。
 * @param {any} root - 插件 apply 拿到的根上下文
 * @returns {{checkedAt: string, capabilities: Record<string,string>, warnings: string[], summary: string}}
 */
export function checkHost(root) {
  const capabilities = {}
  const warnings = []
  for (const cap of HOST_CAPABILITIES) {
    let state = 'missing'
    try {
      state = cap.probe(root) || 'missing'
    } catch {
      state = 'missing'
    }
    capabilities[cap.key] = state
    if (state !== 'ok') warnings.push(warnOf(cap.key, cap.need, state))
  }
  const okCount = Object.values(capabilities).filter((v) => v === 'ok').length
  const total = HOST_CAPABILITIES.length
  return {
    checkedAt: new Date().toISOString(),
    capabilities,
    warnings,
    summary: warnings.length === 0
      ? '全部 ' + total + ' 项宿主能力正常'
      : okCount + '/' + total + ' 项正常，' + warnings.length + ' 项有缺口（插件照常工作，只提醒）',
  }
}
