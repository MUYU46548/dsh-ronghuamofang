import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTools, MAX_CANDIDATE_CHARS, MAX_RENDER_PARAGRAPHS, toolNames } from '../lib/tools.js'

/** 假墨坊：按路径返回预设回执；`off` 让它整体当作"没连上" */
function fakeClient(table, { off = false } = {}) {
  const calls = []
  const pick = (path, body) => {
    const key = Object.keys(table).find((k) => path.startsWith(k))
    if (!key) return { ok: false, status: 404, data: null, error: 'no route', hint: '' }
    const v = table[key]
    return typeof v === 'function' ? v(body) : v
  }
  return {
    calls,
    async get(path) {
      calls.push(['GET', path])
      if (off) return { ok: false, status: 0, data: null, error: '连不上墨坊（x）',
        hint: '先起墨坊：打开绒花墨坊桌面端，或 python scripts/nf_api.py --port 8765。' }
      return pick(path)
    },
    async post(path, body) {
      calls.push(['POST', path, body])
      if (off) return { ok: false, status: 0, data: null, error: '连不上墨坊（x）',
        hint: '先起墨坊：打开绒花墨坊桌面端，或 python scripts/nf_api.py --port 8765。' }
      return pick(path, body)
    },
  }
}

const STATE_OK = {
  ok: true,
  data: {
    book: '测试书', agent_mode: true, chapter_target_words: [4000, 7200],
    budget: { tokens_used: 120, token_limit: { max_total_tokens: 10000000 } },
    stages: [{ stage: 1, status: 'done' }, { stage: 2, status: 'running' }],
  },
}
const WHO_OK = { ok: true, data: { engine: 'direct' } }

test('工具清单：5 个、名字全 mofang_ 前缀、全都有完整 JSON Schema', () => {
  const defs = buildTools(fakeClient({}))
  assert.deepEqual(defs.map((d) => d.name), [
    'mofang_status', 'mofang_chapter', 'mofang_paragraph_preview',
    'mofang_paragraph_pending', 'mofang_paragraph_drop',
  ])
  assert.deepEqual(toolNames(), defs.map((d) => d.name))
  for (const d of defs) {
    assert.equal(d.parameters.type, 'object', d.name)
    assert.equal(typeof d.parameters.properties, 'object', d.name)
    assert.equal(typeof d.description, 'string', d.name)
    assert.equal(d.output.schema.type, 'object', d.name)
    assert.ok(Array.isArray(d.output.schema.required), d.name)
    // required 里列的字段必须在 properties 里 —— 缺一个宿主会在输出校验拒掉整次调用
    for (const k of d.output.schema.required) {
      assert.ok(k in d.output.schema.properties, d.name + ' 缺 ' + k)
    }
    assert.equal(typeof d.output.render, 'function', d.name)
    assert.equal(typeof d.execute, 'function', d.name)
  }
})

test('**没有“采用”工具**：插件不许替作者把候选写进正文', () => {
  const names = buildTools(fakeClient({})).map((d) => d.name)
  assert.equal(names.some((n) => /apply|adopt|accept|save/i.test(n)), false, names.join(','))
  // 参数里也不许出现 apply 端点
  const src = JSON.stringify(buildTools(fakeClient({})).map((d) => d.parameters))
  assert.equal(src.includes('paragraph/apply'), false)
})

test('mofang_status：连上时给书/阶段/引擎/字数区间/token', async () => {
  const c = fakeClient({ '/state': STATE_OK, '/whoami': WHO_OK })
  const [status] = buildTools(c)
  const v = await status.execute({})
  assert.equal(v.connected, true)
  assert.equal(v.book, '测试书')
  assert.equal(v.stage, 2)
  assert.equal(v.stage_status, 'running')
  assert.equal(v.engine, 'direct')
  assert.equal(v.agent_mode, true)
  assert.equal(v.words_low, 4000)
  assert.equal(v.words_high, 7200)
  assert.equal(v.token_limit, 10000000)
  // render 不抛
  assert.match(status.output.render({}, v)[0].text, /测试书/)
})

test('连不上时：connected:false + hint，**不许**假装“书上没有数据”', async () => {
  const c = fakeClient({}, { off: true })
  const defs = buildTools(c)
  const st = await defs[0].execute({})
  assert.equal(st.connected, false)
  assert.match(st.hint, /绒花墨坊/)
  const ch = await defs[1].execute({ n: 3 })
  assert.equal(ch.connected, false)
  assert.equal(ch.total_paragraphs, 0)
  assert.match(ch.hint, /nf_api/)
  // 渲染文案要说“未连接”，不能渲染成“0 段”那种谎
  assert.match(defs[1].output.render({}, ch)[0].text, /未连接/)
})

test('mofang_chapter：段落/未收口批注/指标一屏', async () => {
  const c = fakeClient({
    '/chapters/paragraphs': {
      ok: true,
      data: {
        ok: true, chapter: 3, layer: 'refined', count: 3,
        paragraphs: [
          { index: 0, text: '第一段的开头很长很长', chars: 11 },
          { index: 1, text: '第二段', chars: 3 },
          { index: 2, text: '第三段', chars: 3 },
        ],
      },
    },
    '/chapters/annotations': {
      ok: true,
      data: {
        ok: true, chapter: 3, total: 2, open: 1,
        annotations: [
          { id: 'a1', para_index: 1, status: 'open', note: '连排对白太多' },
          { id: 'a2', para_index: 2, status: 'resolved', note: '已处理' },
        ],
      },
    },
    '/review/structure': {
      ok: true,
      data: {
        ok: true, exists: true,
        chapters: [{ chapter: 3, metrics: { dialogue_runs: 3, short_end: 0.4 },
          triggered: [{ code: 'short_end' }], needs_sampling: true }],
      },
    },
  })
  const defs = buildTools(c)
  const v = await defs[1].execute({ n: 3 })
  assert.equal(v.connected, true)
  assert.equal(v.error, '')
  assert.equal(v.total_paragraphs, 3)
  assert.equal(v.open_annotations, 1)
  assert.equal(v.annotations.length, 1)          // resolved 的不再提醒
  assert.equal(v.annotations[0].para_index, 1)
  assert.equal(v.paragraphs[1].chars, 3)
  assert.equal(v.needs_sampling, true)
  const hot = v.metrics.filter((m) => m.triggered).map((m) => m.code)
  assert.deepEqual(hot, ['short_end'])
})

test('mofang_chapter：章不存在 → 说清是哪一章读不出来（不是“连不上”）', async () => {
  const c = fakeClient({
    '/chapters/paragraphs': { ok: false, status: 404, data: null, error: '第 9 章不存在', hint: '' },
    '/chapters/annotations': { ok: true, data: { ok: true, annotations: [] } },
    '/review/structure': { ok: true, data: { ok: true, exists: false } },
  })
  const v = await buildTools(c)[1].execute({ n: 9 })
  assert.equal(v.connected, true)
  assert.match(v.error, /第 9 章不存在/)
})

/**
 * 为什么钉这条：2026-11-23 真机读第 1 章（273 段），`mofang_chapter` 把整张段落表
 * 渲染进上下文 ≈ 2k token，一次读章吃掉一截预算。纪律②写着"输出有界"，这里是漏洞。
 */
test('mofang_chapter：**长章不抄全文**（默认最多 40 段，且说清还有多少没列）', async () => {
  const paragraphs = Array.from({ length: 273 }, (_, i) => ({
    index: i, text: '第' + i + '段开头', chars: 12 + (i % 7),
  }))
  const c = fakeClient({
    '/chapters/paragraphs': { ok: true, data: { ok: true, chapter: 1, layer: 'checked', count: 273, paragraphs } },
    '/chapters/annotations': { ok: true, data: { ok: true, open: 0, annotations: [] } },
    '/review/structure': { ok: true, data: { ok: true, exists: true, chapters: [] } },
  })
  const def = buildTools(c)[1]
  const v = await def.execute({ n: 1 })
  assert.equal(v.total_paragraphs, 273)
  assert.equal(v.paragraphs.length, MAX_RENDER_PARAGRAPHS)
  assert.equal(v.para_from, 0)
  const text = def.output.render({}, v)[0].text
  assert.match(text, /还有 233 段没列/, '必须说清截了多少，否则模型以为这章只有 40 段')
  // 渲染体量有界：40 段 ≈ 几百字，不是 273 段的整表
  assert.ok(text.length < 1600, '渲染长度 ' + text.length + ' 太大')
})

test('mofang_chapter：para_from 能定位后半段（长章按窗口读）', async () => {
  const paragraphs = Array.from({ length: 273 }, (_, i) => ({
    index: i, text: '第' + i + '段', chars: 10,
  }))
  const c = fakeClient({
    '/chapters/paragraphs': { ok: true, data: { ok: true, chapter: 1, layer: 'checked', count: 273, paragraphs } },
    '/chapters/annotations': { ok: true, data: { ok: true, open: 0, annotations: [] } },
    '/review/structure': { ok: true, data: { ok: true, exists: true, chapters: [] } },
  })
  const def = buildTools(c)[1]
  const v = await def.execute({ n: 1, para_from: 200, para_count: 20 })
  assert.equal(v.para_from, 200)
  assert.equal(v.paragraphs[0].index, 200)
  assert.equal(v.paragraphs.length, 20)
  const text = def.output.render({ n: 1, para_from: 200 }, v)[0].text
  assert.match(text, /还有 53 段没列/)
})

test('mofang_paragraph_preview：只算不落；空意见直接拒', async () => {
  const c = fakeClient({
    '/chapters/paragraph/preview': (body) => ({
      ok: true, status: 202,
      data: { ok: true, job_id: 'job-1', message: '正在生成候选（只算不落）' },
    }),
  })
  const defs = buildTools(c)
  const v = await defs[2].execute({ chapter: 3, paragraph_index: 2, feedback: '别那么口语' })
  assert.equal(v.ok, true)
  assert.equal(v.job_id, 'job-1')
  assert.match(v.hint, /作者/)
  const bad = await defs[2].execute({ chapter: 3, paragraph_index: 2, feedback: '   ' })
  assert.equal(bad.ok, false)
  assert.match(bad.message, /feedback/)
  assert.equal(c.calls.filter((x) => x[0] === 'POST').length, 1)   // 拒的时候没发请求
})

test('mofang_paragraph_preview：403（没权限/作者动作）照原话说，不假装成功', async () => {
  const c = fakeClient({
    '/chapters/paragraph/preview': {
      ok: false, status: 403,
      data: { ok: false, error: '这个操作只能由作者在桌面上做' },
      error: '这个操作只能由作者在桌面上做', hint: '',
    },
  })
  const v = await buildTools(c)[2].execute({ chapter: 1, paragraph_index: 0, feedback: '改' })
  assert.equal(v.ok, false)
  assert.match(v.message, /作者/)
})

test('mofang_paragraph_pending：exists:false 与“没连上”必须分得开；长候选截断', async () => {
  const long = '字'.repeat(MAX_CANDIDATE_CHARS + 50)
  const c = fakeClient({
    '/chapters/paragraph/pending': (body) => ({
      ok: true, status: 200,
      data: {
        ok: true, exists: true,
        rec: { before: '改前', after: long },
        candidates: [{ cid: 'c1', feedback: '意见', after: long }],
        note: '候选只在这里',
      },
    }),
  })
  const v = await buildTools(c)[3].execute({ chapter: 1, index: 0 })
  assert.equal(v.exists, true)
  assert.equal(v.after.length, MAX_CANDIDATE_CHARS)
  assert.equal(v.truncated, true)
  assert.equal(v.candidates[0].cid, 'c1')

  const none = fakeClient({
    '/chapters/paragraph/pending': { ok: true, status: 200, data: { ok: true, exists: false, message: '没有待采用的候选' } },
  })
  const v2 = await buildTools(none)[3].execute({ chapter: 1, index: 0 })
  assert.equal(v2.connected, true)
  assert.equal(v2.exists, false)
})

test('mofang_paragraph_drop：丢候选（正文不动）照抄墨坊回执', async () => {
  const c = fakeClient({
    '/chapters/paragraph/drop': { ok: true, status: 200, data: { ok: true, message: '已放弃候选（正文未改动）' } },
  })
  const v = await buildTools(c)[4].execute({ chapter: 1, paragraph_index: 0 })
  assert.equal(v.ok, true)
  assert.match(v.message, /正文未改动/)
})

test('参数校验：章号/段号越界不发请求', async () => {
  const c = fakeClient({})
  const defs = buildTools(c)
  const a = await defs[1].execute({ n: 0 })
  assert.match(a.error, /n 必须是章号/)
  const b = await defs[3].execute({ chapter: 0, index: 0 })
  assert.equal(b.connected, true)
  assert.match(b.note, /必填/)
  assert.equal(c.calls.length, 0)
})
