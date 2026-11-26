import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { MofangClient, baseUrlOf, errorText, qs } from '../lib/http.js'

function serve(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = String(req.url || '').split('?')[0]
      const handler = routes[path]
      if (!handler) {
        res.statusCode = 404
        res.end(JSON.stringify({ ok: false, error: 'no route' }))
        return
      }
      handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, base: 'http://127.0.0.1:' + port })
    })
  })
}

test('baseUrlOf：默认回环；环境变量可覆盖；非回环一律拒绝', () => {
  assert.equal(baseUrlOf({}), 'http://127.0.0.1:8765')
  assert.equal(baseUrlOf({ MOFANG_API: 'http://127.0.0.1:9000/' }), 'http://127.0.0.1:9000')
  assert.equal(baseUrlOf({ MOFANG_API: 'http://localhost:8765' }), 'http://localhost:8765')
  assert.throws(() => baseUrlOf({ MOFANG_API: 'http://10.0.0.5:8765' }), /回环/)
  assert.throws(() => baseUrlOf({ MOFANG_API: 'https://example.com' }), /回环/)
})

test('errorText：取墨坊统一报错里的那一句', () => {
  assert.equal(errorText({ ok: false, error: '第 1 章不存在' }), '第 1 章不存在')
  assert.equal(errorText({ message: '别的字段' }), '别的字段')
  assert.equal(errorText(null, '兜底'), '兜底')
})

test('qs：跳过空值、中文与空格要编码', () => {
  assert.equal(qs({ n: 3 }), '?n=3')
  assert.equal(qs({ n: 3, layer: '' }), '?n=3')
  assert.equal(qs({ chapter: 1, index: 2 }), '?chapter=1&index=2')
  assert.equal(qs({ q: '雨 夜' }), '?q=%E9%9B%A8%20%E5%A4%9C')
})

test('call：200 且 ok 字段为真 → ok:true', async () => {
  const { server, base } = await serve({
    '/health': (req, res) => { res.end(JSON.stringify({ ok: true })) },
  })
  try {
    const c = new MofangClient({ baseUrl: base })
    const r = await c.get('/health')
    assert.equal(r.ok, true)
    assert.equal(r.status, 200)
    assert.deepEqual(r.data, { ok: true })
  } finally {
    server.close()
  }
})

test('call：把墨坊的 Server 头带回来（体里没有 API 版本时只剩它）', async () => {
  const { server, base } = await serve({
    '/health': (req, res) => {
      res.setHeader('Server', 'NovelForgeAPI/0.2')
      res.end(JSON.stringify({ ok: true }))
    },
  })
  try {
    const c = new MofangClient({ baseUrl: base })
    const r = await c.get('/health')
    assert.equal(r.server, 'NovelForgeAPI/0.2')
  } finally {
    server.close()
  }
})

test('call：HTTP 200 但 body 里 ok:false 也算失败（墨坊的域模块就是这么表达的）', async () => {
  const { server, base } = await serve({
    '/x': (req, res) => { res.end(JSON.stringify({ ok: false, error: '第 1 章不存在' })) },
  })
  try {
    const c = new MofangClient({ baseUrl: base })
    const r = await c.get('/x')
    assert.equal(r.ok, false)
    assert.equal(r.status, 200)
    assert.equal(r.error, '第 1 章不存在')
  } finally {
    server.close()
  }
})

test('call：连不上 → status 0 + 可行动的 hint（不是抛异常）', async () => {
  const c = new MofangClient({ baseUrl: 'http://127.0.0.1:1' })
  const r = await c.get('/state')
  assert.equal(r.ok, false)
  assert.equal(r.status, 0)
  assert.match(r.hint, /nf_api|绒花墨坊/)
})

test('call：超时 → status 0 且说清是超时', async () => {
  const { server, base } = await serve({
    '/slow': () => { /* 永不回话 */ },
  })
  try {
    const c = new MofangClient({ baseUrl: base, timeoutMs: 150 })
    const r = await c.get('/slow')
    assert.equal(r.ok, false)
    assert.equal(r.status, 0)
    assert.match(r.error, /没回话/)
  } finally {
    server.closeAllConnections?.()
    server.close()
  }
})

test('POST 带 body 且必定报明来源头', async () => {
  let seen = null
  const { server, base } = await serve({
    '/echo': (req, res) => {
      let buf = ''
      req.on('data', (x) => { buf += x })
      req.on('end', () => {
        seen = { source: req.headers['x-mofang-source'], body: JSON.parse(buf || '{}') }
        res.end(JSON.stringify({ ok: true }))
      })
    },
  })
  try {
    const c = new MofangClient({ baseUrl: base })
    const r = await c.post('/echo', { chapter: 3 })
    assert.equal(r.ok, true)
    assert.equal(seen.source, 'dsh-novelforge')
    assert.deepEqual(seen.body, { chapter: 3 })
  } finally {
    server.close()
  }
})
