/**
 * 会话级自证（lib/proof.js）：只记 mofang_* 的调用顺序，不记参数。
 *
 * 判据要能回答两件事：
 *  · 同一轮里 mofang_chapter 是不是在 preview 之前；
 *  · 先 preview 后 chapter（或压根没查）必须算“没先查判据”，不能算绿。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProofLog, sessionIdOf, MAX_ROWS } from '../lib/proof.js'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nf-proof-'))
}

test('sessionIdOf：对象 / 字符串 / 拒绝 [object Object]', () => {
  assert.equal(sessionIdOf('s1'), 's1')
  assert.equal(sessionIdOf({ id: 's2' }), 's2')
  assert.equal(sessionIdOf({ header: { id: 's3' } }), 's3')
  assert.equal(sessionIdOf({}), '')
  assert.equal(sessionIdOf('[object Object]'), '')
})

test('先 chapter 后 preview：落账本，health 汇总为“先查后改”', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'tools.jsonl')
  const proof = new ProofLog({ file, now: () => 1000 })
  const s = { id: 's1' }
  proof.record(s, { type: 'tool/call', data: { name: 'mofang_chapter', turn: 1 } })
  proof.record(s, { type: 'tool/call', data: { name: 'mofang_paragraph_preview', turn: 1 } })
  const sum = proof.summary()
  assert.equal(sum.rows, 2)
  assert.equal(sum.turns.total, 1)
  assert.equal(sum.turns.chapterBeforePreview, 1)
  assert.equal(sum.turns.previewWithoutChapter, 0)
  assert.deepEqual(sum.lastTurn.tools, ['mofang_chapter', 'mofang_paragraph_preview'])
  // 只记工具名：参数（feedback 里可能有正文/私事）不许落盘
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[0].includes('feedback'), false)
  assert.equal(lines[0].includes('mofang_chapter'), true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('先 preview 后 chapter：算“没先查判据”', () => {
  const dir = tmpDir()
  const proof = new ProofLog({ file: path.join(dir, 'tools.jsonl'), now: () => 1000 })
  const s = { id: 's2' }
  proof.record(s, { type: 'tool/call', data: { name: 'mofang_paragraph_preview', turn: 2 } })
  proof.record(s, { type: 'tool/call', data: { name: 'mofang_chapter', turn: 2 } })
  const sum = proof.summary()
  assert.equal(sum.turns.chapterBeforePreview, 0)
  assert.equal(sum.turns.previewWithoutChapter, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('只记 mofang_*：别的工具、非 tool/call、没有会话 id 都不落账', () => {
  const dir = tmpDir()
  const proof = new ProofLog({ file: path.join(dir, 'tools.jsonl'), now: () => 1000 })
  const s = { id: 's3' }
  assert.equal(proof.record(s, { type: 'tool/call', data: { name: 'pwsh' } }), null)
  assert.equal(proof.record(s, { type: 'message' }), null)
  assert.equal(proof.record({}, { type: 'tool/call', data: { name: 'mofang_status' } }), null)
  assert.equal(proof.summary().rows, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('账本上限：超过 maxRows 只留最新的', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'tools.jsonl')
  const proof = new ProofLog({ file, maxRows: 3, now: () => 1000 })
  const s = { id: 's4' }
  for (const name of ['mofang_status', 'mofang_chapter', 'mofang_paragraph_pending', 'mofang_paragraph_drop']) {
    proof.record(s, { type: 'tool/call', data: { name, turn: 1 } })
  }
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(rows.length, 3)
  assert.equal(rows.at(-1).tool, 'mofang_paragraph_drop')
  assert.ok(MAX_ROWS > 3)
  fs.rmSync(dir, { recursive: true, force: true })
})
