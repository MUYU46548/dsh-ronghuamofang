import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import plugin, { apply, PLUGIN_NAME, PLUGIN_VERSION, ROUTES, ENDPOINTS } from '../lib/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PKG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf-8'))
const PATCH = fs.readFileSync(path.join(HERE, '..', 'cordis.patch.yml'), 'utf-8')

/** 假宿主：把 fangcun 那套真机形态照抄一遍（get/inject/on/effect） */
function makeRoot({ withPrompt = true, withTools = true, withWeb = true } = {}) {
  const sections = []
  const contexts = []
  const tools = []
  const routes = []
  const effects = []
  const root = {
    logger: { warn() {} },
    sections,
    contexts,
    tools,
    routes,
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
      return undefined
    },
    inject(deps, cb) {
      assert.deepEqual(deps, ['webServer'])
      if (!withWeb) return
      cb({ webServer: { register(r) { routes.push(r); return () => {} } } })
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

test('apply：health 路由注册了，且 GET 返回能自证的事实', () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  assert.equal(root.routes.length, 1)
  const r = root.routes[0]
  assert.equal(r.kind, 'exact')
  assert.equal(r.path, '/mofang/health.json')

  let body = ''
  const res = {
    statusCode: 0,
    setHeader() {},
    end(x) { body = String(x || '') },
  }
  r.handler({ method: 'GET' }, res)
  const v = JSON.parse(body)
  assert.equal(v.ok, true)
  assert.equal(v.plugin.name, 'dsh-novelforge')
  assert.equal(v.plugin.version, PLUGIN_VERSION)
  assert.equal(v.tools.registered, true)
  assert.deepEqual(v.tools.names.length, 5)
  assert.equal(v.prompt.rules, true)
  assert.equal(v.routes.registered, true)
  assert.ok(Array.isArray(v.routes.paths))
})

test('health：非 GET → 405（不给写）', () => {
  const root = makeRoot()
  apply(root, { client: fakeClient() })
  const res = { statusCode: 0, setHeader() {}, end() {} }
  root.routes[0].handler({ method: 'POST' }, res)
  assert.equal(res.statusCode, 405)
})

test('宿主缺 systemPrompt / tools 时**不假装成功**，其它部分照常工作', () => {
  const root = makeRoot({ withPrompt: false, withTools: false })
  apply(root, { client: fakeClient() })
  let body = ''
  const res = { statusCode: 0, setHeader() {}, end(x) { body = String(x || '') } }
  root.routes[0].handler({ method: 'GET' }, res)
  const v = JSON.parse(body)
  assert.equal(v.prompt.rules, false)
  assert.match(v.prompt.error, /systemPrompt/)
  assert.equal(v.tools.registered, false)
  assert.match(v.tools.error, /tools/)
  assert.equal(v.routes.registered, true)      // health 仍在
})

test('MOFANG_API 指向外网 → 插件明说配置错，不静默连出去', () => {
  const old = process.env.MOFANG_API
  process.env.MOFANG_API = 'https://example.com'
  try {
    const root = makeRoot()
    const out = apply(root, {})
    assert.equal(out.client, null)
    let body = ''
    const res = { statusCode: 0, setHeader() {}, end(x) { body = String(x || '') } }
    root.routes[0].handler({ method: 'GET' }, res)
    const v = JSON.parse(body)
    assert.match(v.prompt.error + v.tools.error, /回环/)
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
