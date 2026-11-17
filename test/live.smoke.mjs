import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MofangClient } from '../lib/http.js'
import { buildTools } from '../lib/tools.js'

/**
 * 真机冒烟：**只在你给了 MOFANG_API 时才跑**（没给就跳过，不假装通过）。
 *
 *   MOFANG_API=http://127.0.0.1:18765 npm test
 *
 * 为什么留这一条：离线用例只能证明"我们的代码自洽"，证明不了"墨坊真的这么回"。
 * 2026-11-17 用 `nf_api --port 18765 --allow-fake` 实跑过一次：
 * mofang_status → connected:true / book / stage；mofang_chapter(1) → 章不存在的原文回执。
 */
const BASE = String(process.env.MOFANG_API || '').trim()

test('live: mofang_status 打到真墨坊', { skip: !BASE && '未设置 MOFANG_API（跳过真机冒烟）' }, async () => {
  const tools = buildTools(new MofangClient({ baseUrl: BASE }))
  const v = await tools[0].execute({})
  assert.equal(v.connected, true, JSON.stringify(v))
  assert.equal(typeof v.book, 'string')
  assert.ok(v.stage >= 0)
  assert.ok(v.token_limit >= 0)
})

test('live: mofang_chapter 对不存在的章给原文回执（不是“连不上”）',
  { skip: !BASE && '未设置 MOFANG_API（跳过真机冒烟）' }, async () => {
    const tools = buildTools(new MofangClient({ baseUrl: BASE }))
    const v = await tools[1].execute({ n: 999 })
    assert.equal(v.connected, true, JSON.stringify(v))
    assert.ok(v.error.length > 0, '应该带一句“第 999 章不存在”之类的原文')
  })
