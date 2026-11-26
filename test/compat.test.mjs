/**
 * 宿主能力自检（lib/compat.js）的判据。
 *
 * 为什么单列一个文件：这是"DSH 升级后插件少干活"的第一道报警线，
 * 三态（ok / degraded / missing）和"只提醒不退出"都要被钉住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkHost, HOST_CAPABILITIES, LATE_CAPABILITIES } from '../lib/compat.js'

/** 一台"什么都有"的假宿主 */
function fullHost() {
  return {
    get(name) {
      if (name === 'webServer') return { register() {} }
      if (name === 'systemPrompt') return { section() {}, context() {} }
      if (name === 'tools') return { register() {} }
      if (name === 'configEditor') return { edit() {} }
      if (name === 'clientModules') return { clientPath() { return '/client.js' } }
      return undefined
    },
    effect() {},
    on() { return () => {} },
  }
}

test('全绿：七项宿主能力都 ok，warnings 为空', () => {
  const r = checkHost(fullHost())
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings))
  assert.match(r.summary, /全部 7 项宿主能力正常/)
  for (const cap of HOST_CAPABILITIES) assert.equal(r.capabilities[cap.key], 'ok', cap.key)
})

test('缺服务：记 missing + 一句人话，绝不抛', () => {
  const r = checkHost({ get() { return undefined } })
  assert.equal(r.capabilities.webServer, 'missing')
  assert.equal(r.capabilities.tools, 'missing')
  assert.equal(r.capabilities.effect, 'missing')
  assert.equal(r.warnings.length, HOST_CAPABILITIES.length)
  assert.ok(r.warnings.some((w) => /webServer/.test(w) && /没有/.test(w)), r.warnings.join('\n'))
})

test('形状不对：记 degraded，不是 ok（宿主留着服务名、方法却改名了）', () => {
  const host = fullHost()
  const orig = host.get
  host.get = (name) => (name === 'tools' ? {} : orig(name))
  const r = checkHost(host)
  assert.equal(r.capabilities.tools, 'degraded')
  assert.match(r.warnings.join('\n'), /tools 存在但形状不像预期/)
})

test('get 自己抛异常也不外泄：记 missing 并继续', () => {
  const r = checkHost({ get() { throw new Error('boom') }, effect() {} })
  assert.equal(r.capabilities.webServer, 'missing')
  assert.equal(typeof r.summary, 'string')
  assert.ok(r.checkedAt.includes('T'))
})

test('后挂服务标记：configEditor / clientModules 在 LATE_CAPABILITIES 里', () => {
  assert.ok(LATE_CAPABILITIES.has('configEditor'))
  assert.ok(LATE_CAPABILITIES.has('clientModules'))
  assert.equal(LATE_CAPABILITIES.has('tools'), false)
})
