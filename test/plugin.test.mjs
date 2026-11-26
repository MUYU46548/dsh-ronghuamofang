import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import plugin, { apply, PLUGIN_NAME, PLUGIN_VERSION, ROUTES, ENDPOINTS } from '../lib/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf-8'))
const PATCH = fs.readFileSync(path.join(HERE, '..', 'cordis.patch.yml'), 'utf-8')

/**
 * 假宿主：把真机形态照抄一遍（get/inject/on/effect/fiber/logger）。
 * `configEditor` 默认可写 —— 设置路由的"能写/不能写"两条路都要能测。
 */
function makeRoot({ withPrompt = true, withTools = true, withWeb = true, withEditor = true } = {}) {
  const sections = []
  const contexts = []
  const tools = []
  const routes = []
  const effects = []
  const edits = []
  const root = {
    logger: { info() {}, warn() {} },
    fiber: { entry: { options: { id: PLUGIN_NAME } } },
    sections,
    contexts,
    tools,
    routes,
    edits,
    get(name) {
      if (name === 'systemPrompt' && withPrompt) {
        return {
          section(o) { sections.push(o); return () => {} },
          context(o) { contexts.push(o); return () => {} },
        }
      }
      if (name === 'tools' && withTools) {
        return { register(d) { tools.push(d); return () => {} } }
      }
      if (name === 'configEditor' && withEditor) {
        return { async edit(entry, change) { edits.push({ entry, change }); } }
      }
      if (name === 'clientModules') {
        return { clientPath(id) { return id === PLUGIN_NAME ? '/client.js' : undefined } }
      }
      if (name === 'webServer' && withWeb) {
        return { register(r) { routes.push(r); return () => {} } }
      }
      return undefined
    },
    inject(deps, cb) {
      assert.deepEqual(deps, ['webServer'])
      if (!withWeb) return
      cb({
        webServer: { register(r) { routes.push(r); return () => {} } },
        effect(fn) { effects.push(fn); return fn() },
      })
    },
    effect(fn) { effects.push(fn); return fn() },
    on() { return () => {} },
  }
  return root
}

/** 假墨坊：client 直接注入，避免测试期真起服务 */
function fakeClient() {
  return {
    async get(p) {
      if (p.startsWith('/state')) {
        return { ok: true, status: 200, data: { book: '测试书', stages: [{ stage: 1, status: 'running' }] }, error: '', hint: '' }
      }
      return { ok: true, status: 200, data: { ok: true }, error: '', hint: '' }
    },
    async post() { return { ok: true, status: 200, data: { ok: true }, error: '', hint: '' } },
  }
}

/** 调一个 handler，拿 { status, json } */
function call(handler, req, res0 = {}) {
  let body = ''
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(k, v) { this.headers[k] = v },
    end(x) { body = String(x || '') },
  }
  return Promise.resolve(handler({ headers: { host: '127.0.0.1:59009' }, socket: { remoteAddress: '127.0.0.1' }, ...req }, res))
    .then(() => ({ status: res.statusCode, json: body ? JSON.parse(body) : null }))
}

const byPath = (routes, p) => routes.find((r) => r.path === p)

test('包与补丁：name 三处一致（不一致的症状是“装了但插件不出现”）', () => {
  assert.equal(PLUGIN_NAME, PKG.name)
  assert.equal(plugin.name, PKG.name)
  assert.match(PATCH, new RegExp('id:\\s*' + PKG.name))
  assert.match(PATCH, new RegExp('name:\\s*' + PKG.name))
})

test('版本两处一致（index.js 与 package.json 漂移会让 health 说谎）', () => {
  assert.equal(PLUGIN_VERSION, PKG.version)
})

test('engines.dsh 只有下限、没有上界（写上界 = 升级后插件静默消失）', () => {
  assert.equal(PKG.engines.dsh, '>=0.2.1-rc.2')
  assert.equal(PKG.dsh.compatibility.dsh, '>=0.2.1-rc.2')
  assert.equal(/<\s*\d/.test(String(PKG.engines.dsh)), false)
})

test('清单：client 半与图标都声明了，且文件都在', () => {
  assert.equal(PKG.dsh.client.platform, 'web')
  assert.equal(PKG.exports['./client'], './client.js')
  assert.equal(PKG.exports['./icon'], './icon.svg')
  assert.ok(PKG.files.includes('client.js'))
  assert.ok(PKG.files.includes('icon.svg'))
  assert.ok(PKG.files.includes('locale/*.json'))
  for (const f of ['client.js', 'icon.svg', 'locale/zh.json', 'locale/en.json']) {
    assert.ok(fs.existsSync(path.join(HERE, '..', f)), f)
  }
  assert.equal(PKG.dependencies, undefined, '零依赖')
})

test('apply：规则段真的注册了，且写明“采用归作者”', () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  assert.equal(root.sections.length, 1)
  const text = root.sections[0].text
  assert.match(text, /mofang_chapter/)
  assert.match(text, /采用/)
  assert.match(text, /403/)
  assert.equal(root.contexts.length, 1)
  assert.equal(typeof root.contexts[0].text, 'function')
})

test('apply：5 个工具真的注册上（不是“有定义没注册”）', () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  assert.equal(root.tools.length, 5)
  const names = root.tools.map((t) => t.name)
  assert.deepEqual(names, [
    'mofang_status', 'mofang_chapter', 'mofang_paragraph_preview',
    'mofang_paragraph_pending', 'mofang_paragraph_drop',
  ])
  for (const t of root.tools) {
    assert.equal(t.parameters.type, 'object')
    assert.ok(t.output && t.output.schema && t.output.render)
  }
})

test('apply：两条只读路由注册了（health + 设置）', () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  assert.equal(root.routes.length, 2)
  for (const r of root.routes) assert.equal(r.kind, 'exact')
  assert.deepEqual(root.routes.map((r) => r.path).sort(),
    ['/mofang/api/settings', '/mofang/health.json'])
  assert.deepEqual(ROUTES.map((r) => r.path).sort(),
    ['/mofang/api/settings', '/mofang/health.json'])
})

test('health：GET 返回能自证的事实', async () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  const { status, json } = await call(byPath(root.routes, '/mofang/health.json').handler, { method: 'GET' })
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.plugin.name, 'dsh-novelforge')
  assert.equal(json.plugin.version, PLUGIN_VERSION)
  assert.equal(json.tools.registered, true)
  assert.equal(json.tools.names.length, 5)
  assert.equal(json.prompt.rules, true)
  assert.equal(json.routes.registered, true)
  assert.deepEqual(json.routes.paths.sort(), ['/mofang/api/settings', '/mofang/health.json'])
  // 设置现状：测试宿主给了 configEditor，所以"能写"
  assert.equal(json.settings.writable, true)
  assert.equal(json.settings.entryId, PLUGIN_NAME)
  // 生效连接参数（注入 client 时没算 effective，但 health 里也要给出可读值）
  assert.ok(json.connection)
  assert.equal(typeof json.client.available, 'boolean')
  // 宿主能力三态：这一版起 health 必须自报（不是等用户撞上“保存不了/设置页没有”）
  assert.ok(json.compat, 'health 必须带 compat')
  assert.equal(json.compat.capabilities.tools, 'ok')
  assert.equal(json.compat.capabilities.configEditor, 'ok')
  assert.equal(json.compat.capabilities.clientModules, 'ok')
  assert.equal(json.compat.warnings.length, 0, JSON.stringify(json.compat.warnings))
  assert.match(json.compat.summary, /正常/)
})

test('health：非 GET → 405（不给写）', async () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  const { status } = await call(byPath(root.routes, '/mofang/health.json').handler, { method: 'POST' })
  assert.equal(status, 405)
})

/**
 * 为什么钉这条（2026-11-23 真机踩到）：0.1.0 的旧代码把 `web.register` 返回的清理函数丢了，
 * HMR 换掉模块后旧路由注销不掉，新代码注册同一路径就报 `duplicate exact route`：
 * `/mofang/api/settings` 能开，`/mofang/health.json` 却永远停在旧响应上 ——
 * 用户看到的是"新版没生效"，实际是路由注册失败。
 * 修法：主路径被占就退到 fallback，并**如实**把冲突写进 health（不假装一切正常）。
 */
test('health 路由被上一代残留占住时：退到 fallback，且 health 里说清这件事', () => {
  const root = makeRoot({ withWeb: false })
  const registered = []
  root.inject = (deps, cb) => {
    cb({
      webServer: {
        register(r) {
          if (r.path === '/mofang/health.json') {
            throw new Error('webserver: duplicate exact route "/mofang/health.json"')
          }
          registered.push(r)
          return () => {}
        },
      },
      effect(fn) { return fn() },
    })
  }
  apply(root, { client: fakeClient() })
  const paths = registered.map((r) => r.path)
  assert.ok(paths.includes('/mofang/api/health.json'), '必须退到 fallback，实际：' + paths.join(','))
  assert.equal(paths.includes('/mofang/health.json'), false)

  // 从 fallback 那一份 health 里读：必须承认自己退让了
  const handler = registered.find((r) => r.path === '/mofang/api/health.json').handler
  let body = ''
  handler({ method: 'GET' }, { statusCode: 0, setHeader() {}, end(x) { body = String(x || '') } })
  const v = JSON.parse(body)
  assert.deepEqual(v.routes.conflicts, ['/mofang/health.json'])
  assert.equal(v.routes.registered, true)
  assert.ok(v.routes.paths.includes('/mofang/api/health.json'))
})

test('**服务晚到**：apply 时 tools 还没挂上，追几秒后仍须注册成功（2026-11-23 真机故障）', async () => {
  // 为什么钉这条：真机实测 health 报 tools.registered=false 而 prompt.rules=true，
  // 5 个 mofang_* 一个都没进工具表。那不是"老宿主"，是 **tools 服务异步就绪**、
  // 而当时 setupTools 只试了一次就永久放弃。
  const root = makeRoot({ withTools: false })
  root.get = (function (orig) {
    let calls = 0
    return function (name) {
      if (name === 'tools') {
        calls += 1
        if (calls < 3) return undefined
        return { register(d) { root.tools.push(d); return () => {} } }
      }
      return orig.call(this, name)
    }
  })(root.get)

  apply(root, { client: fakeClient() })

  const started = Date.now()
  while (root.tools.length === 0 && Date.now() - started < 8000) {
    await new Promise((r) => setTimeout(r, 100))
  }

  assert.ok(root.tools.length > 0, 'tools 服务晚到 2 秒后仍应注册成功，实际一个都没注册上')
  assert.equal(root.tools.length, 5, '5 个 mofang_* 工具应全部注册')
  assert.deepEqual(root.tools.map((d) => d.name).sort(), [
    'mofang_chapter', 'mofang_paragraph_drop', 'mofang_paragraph_pending',
    'mofang_paragraph_preview', 'mofang_status',
  ])
})

test('重试期间 health 如实显示“正在重试”，不是空着让人以为都正常', async () => {
  const root = makeRoot({ withTools: false })
  apply(root, { client: fakeClient() })
  const { json } = await call(byPath(root.routes, '/mofang/health.json').handler, { method: 'GET' })
  assert.equal(json.tools.registered, false)
  assert.match(json.tools.error, /重试/)
})

test('宿主缺 systemPrompt / tools 时**不假装成功**，其它部分照常工作', async () => {
  const root = makeRoot({ withPrompt: false, withTools: false })
  apply(root, { client: fakeClient() })
  const { json } = await call(byPath(root.routes, '/mofang/health.json').handler, { method: 'GET' })
  assert.equal(json.prompt.rules, false)
  assert.match(json.prompt.error, /systemPrompt/)
  assert.equal(json.tools.registered, false)
  assert.match(json.tools.error, /tools/)
  assert.equal(json.routes.registered, true)      // health 仍在
})

test('设置：GET 读现状（两项覆盖 + 生效值 + 能不能写）', async () => {
  const root = makeRoot()
  apply(root, { client: fakeClient(), baseUrl: 'http://127.0.0.1:9000' }, )
  const { status, json } = await call(byPath(root.routes, '/mofang/api/settings').handler, { method: 'GET' })
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.writable, true)
  assert.equal(json.values.baseUrl, 'http://127.0.0.1:9000')
  assert.equal(json.overridden.baseUrl, true)
  assert.equal(json.effective.baseUrl, 'http://127.0.0.1:9000')
  assert.equal(json.effective.baseUrlSource, 'config')
})

test('设置：PUT 真写 Loader 行（走 configEditor，不手改 profile 文件）', async () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  const handler = byPath(root.routes, '/mofang/api/settings').handler

  // 模拟请求体流：一个可迭代的 req
  const body = JSON.stringify({ baseUrl: 'http://127.0.0.1:9001', timeoutMs: '8000' })
  const req = {
    method: 'PUT',
    url: '/mofang/api/settings',
    headers: { host: '127.0.0.1:59009', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    async *[Symbol.asyncIterator]() { yield body },
  }
  const { status, json } = await call(handler, req)
  assert.equal(status, 200, JSON.stringify(json))
  assert.equal(json.changed, true)
  assert.equal(json.restarting, true)
  assert.equal(root.edits.length, 1, '必须真的调了 configEditor.edit')
  // edit 的 change 收到当前 config 后合出下一份
  const next = root.edits[0].change({})
  assert.equal(next.baseUrl, 'http://127.0.0.1:9001')
  assert.equal(next.timeoutMs, '8000')
})

test('设置：PUT 非回环地址 → 400 且**不写**（书稿不出这台机器）', async () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  const body = JSON.stringify({ baseUrl: 'https://example.com' })
  const req = {
    method: 'PUT',
    url: '/mofang/api/settings',
    headers: { host: '127.0.0.1:59009', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    async *[Symbol.asyncIterator]() { yield body },
  }
  const { status, json } = await call(byPath(root.routes, '/mofang/api/settings').handler, req)
  assert.equal(status, 400)
  assert.match(json.error, /回环/)
  assert.equal(root.edits.length, 0)
})

test('设置：没有 configEditor 时**如实 501**，不假装保存成功', async () => {
  const root = makeRoot({ withEditor: false })
  apply(root, { client: fakeClient() })
  const handler = byPath(root.routes, '/mofang/api/settings').handler
  const g = await call(handler, { method: 'GET' })
  assert.equal(g.json.writable, false)
  assert.match(g.json.error, /configEditor/)

  const body = JSON.stringify({ baseUrl: 'http://127.0.0.1:9001' })
  const req = {
    method: 'PUT',
    url: '/mofang/api/settings',
    headers: { host: '127.0.0.1:59009', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    async *[Symbol.asyncIterator]() { yield body },
  }
  const { status } = await call(handler, req)
  assert.equal(status, 501)
})

test('设置：跨站写被拒（Origin 不是本机也不是 dsh-app）', async () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  const body = JSON.stringify({ baseUrl: 'http://127.0.0.1:9001' })
  const req = {
    method: 'PUT',
    url: '/mofang/api/settings',
    headers: { host: '127.0.0.1:59009', 'content-type': 'application/json', origin: 'http://evil.example' },
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    async *[Symbol.asyncIterator]() { yield body },
  }
  const { status } = await call(byPath(root.routes, '/mofang/api/settings').handler, req)
  assert.equal(status, 403)
  assert.equal(root.edits.length, 0)
})

test('MOFANG_API 指向外网 → 插件明说配置错，不静默连出去；health 仍可读', async () => {
  const old = process.env.MOFANG_API
  process.env.MOFANG_API = 'https://example.com'
  try {
    const root = makeRoot()
    const out = apply(root, {})
    assert.equal(out.client, null)
    const { json } = await call(byPath(root.routes, '/mofang/health.json').handler, { method: 'GET' })
    assert.match(json.settings.configError + json.tools.error + json.prompt.error, /回环/)
    assert.equal(json.tools.registered, false)
    assert.equal(json.routes.registered, true)   // health 还在
    // 设置页仍能读到"错在哪"并且能改（这就是修配置的入口）
    const s = await call(byPath(root.routes, '/mofang/api/settings').handler, { method: 'GET' })
    assert.equal(s.status, 200)
    assert.match(s.json.configError, /回环/)
  } finally {
    if (old === undefined) delete process.env.MOFANG_API
    else process.env.MOFANG_API = old
  }
})

test('端点清单只列读改链用到的（不夹带写正文的 apply）', () => {
  const all = Object.values(ENDPOINTS).join(',')
  assert.equal(all.includes('paragraph/apply'), false)
  for (const p of ['/state', '/chapters/paragraphs', '/chapters/annotations',
    '/review/structure', '/chapters/paragraph/preview', '/chapters/paragraph/pending',
    '/chapters/paragraph/drop']) {
    assert.ok(all.includes(p), p)
  }
})

test('lib 里不 import 墨坊代码、不 import electron（两仓互不锁死）', () => {
  const dir = path.join(HERE, '..', 'lib')
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue
    const src = fs.readFileSync(path.join(dir, f), 'utf-8')
    assert.equal(/from\s+['"][^'"]*electron/.test(src), false, f)
    assert.equal(/from\s+['"][^'"]*(novelforge|nf_api|nf_mcp)/.test(src), false, f)
    assert.equal(/require\(/.test(src), false, f + ' 用了 require（ESM 工程）')
  }
})
