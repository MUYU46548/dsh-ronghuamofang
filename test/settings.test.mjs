import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  describeSettings, effectiveSettings, mergeSettings, normalizeSettings, validateSettingsPatch,
} from '../lib/settings.js'
import { DEFAULT_BASE, DEFAULT_TIMEOUT_MS } from '../lib/http.js'

test('normalizeSettings：认得出两项、认不出的键忽略（client 是脚手架不是设置）', () => {
  assert.deepEqual(normalizeSettings(null), { baseUrl: '', timeoutMs: '' })
  const s = normalizeSettings({ baseUrl: ' http://127.0.0.1:9000 ', timeoutMs: 8000, client: {} })
  assert.deepEqual(s, { baseUrl: 'http://127.0.0.1:9000', timeoutMs: '8000' })
})

test('validateSettingsPatch：空值 = 清除（允许）', () => {
  const r = validateSettingsPatch({ baseUrl: '', timeoutMs: '' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.patch, { baseUrl: '', timeoutMs: '' })
})

test('validateSettingsPatch：**非回环地址一律拒**（书稿不许发到别处）', () => {
  for (const bad of ['http://10.0.0.5:8765', 'https://example.com', 'http://192.168.1.9:8765']) {
    const r = validateSettingsPatch({ baseUrl: bad })
    assert.equal(r.ok, false, bad)
    assert.match(r.error, /回环/, bad)
  }
  for (const good of ['http://127.0.0.1:8766', 'http://localhost:8765/', 'http://[::1]:8765']) {
    const r = validateSettingsPatch({ baseUrl: good })
    assert.equal(r.ok, true, good)
    assert.equal(r.patch.baseUrl, good.replace(/\/+$/, ''))
  }
})

test('validateSettingsPatch：超时必须整数且在 1s–120s 之间', () => {
  assert.equal(validateSettingsPatch({ timeoutMs: '15000' }).ok, true)
  for (const bad of ['0', '999', '120001', 'abc', '1.5']) {
    const r = validateSettingsPatch({ timeoutMs: bad })
    assert.equal(r.ok, false, bad)
    assert.match(r.error, /超时/, bad)
  }
})

test('validateSettingsPatch：不认识的键、非对象、内部换行符都拒（首尾空白会被 trim，那是好意）', () => {
  assert.equal(validateSettingsPatch({ nope: 1 }).ok, false)
  assert.equal(validateSettingsPatch(null).ok, false)
  assert.equal(validateSettingsPatch([]).ok, false)
  assert.equal(validateSettingsPatch({}).ok, false)
  // 首尾空白 trim 掉是好事（粘贴常带）；**中间**夹一个换行才是脏值
  assert.equal(validateSettingsPatch({ baseUrl: 'http://127.0.0.1:1\n' }).ok, true)
  assert.equal(validateSettingsPatch({ baseUrl: 'http://127.0.0.1:1\nx' }).ok, false)
})

test('mergeSettings：空值删键（让环境变量重新生效），非空覆盖', () => {
  const cur = { baseUrl: 'http://127.0.0.1:9000', timeoutMs: '8000' }
  assert.deepEqual(mergeSettings(cur, { baseUrl: '' }), { timeoutMs: '8000' })
  assert.deepEqual(mergeSettings(cur, { timeoutMs: '3000' }),
    { baseUrl: 'http://127.0.0.1:9000', timeoutMs: '3000' })
})

test('describeSettings：两项都空 = 没有覆盖', () => {
  const d = describeSettings(null)
  assert.deepEqual(d.values, { baseUrl: '', timeoutMs: '' })
  assert.deepEqual(d.overridden, { baseUrl: false, timeoutMs: false })
})

test('effectiveSettings：config > env > 默认，且报来源', () => {
  const dflt = effectiveSettings({}, {})
  assert.equal(dflt.baseUrl, DEFAULT_BASE)
  assert.equal(dflt.baseUrlSource, 'default')
  assert.equal(dflt.timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.equal(dflt.timeoutMsSource, 'default')

  const fromEnv = effectiveSettings({}, { MOFANG_API: 'http://127.0.0.1:9999' })
  assert.equal(fromEnv.baseUrl, 'http://127.0.0.1:9999')
  assert.equal(fromEnv.baseUrlSource, 'env')

  const fromCfg = effectiveSettings(
    { baseUrl: 'http://127.0.0.1:9000' },
    { MOFANG_API: 'http://127.0.0.1:9999' },
  )
  assert.equal(fromCfg.baseUrl, 'http://127.0.0.1:9000')
  assert.equal(fromCfg.baseUrlSource, 'config')
})

test('effectiveSettings：环境变量指向外网时抛（不静默连出去）', () => {
  assert.throws(() => effectiveSettings({}, { MOFANG_API: 'https://example.com' }), /回环/)
})
