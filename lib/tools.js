/**
 * 给模型调的绒花墨坊工具（5 个，白名单）。
 *
 * 为什么这些工具值得存在：墨坊的 MCP 面（`nf_*`，51 个）要靠 MCP 客户端接进来，
 * 客户端一掉线整批工具就消失；而插件自己走 HTTP，**断了也不影响**。
 * 更重要的是**一屏化**：模型不缺口号，缺“这一章多少段、哪几段被批注、
 * 六项指标哪一项越线”这三样同时在手 —— 那就是 `mofang_chapter`。
 *
 * 四条纪律（越界即错，测试里钉着）：
 *  ① **只读 + 只算不落**：唯一的写动作是 `mofang_paragraph_drop`（丢候选，正文不动）。
 *     **没有“采用”工具** —— 采用候选会把候选写进正文，那是作者的签字动作，
 *     墨坊的 `/chapters/paragraph/apply` 要求 GUI 双因子，Agent 调必然 403。
 *  ② **输出有界**：批注最多 10 条、候选正文最多 2000 字、段落只给序号/字数/开头 16 字。
 *     上下文是共用资源（暮雨：「上下文空间占满就死了」）。
 *  ③ **连不上 ≠ 没有数据**：墨坊没开时回 `connected:false` + hint，绝不回
 *     "0 段 / 0 条批注" —— 那会让模型以为书是空的，转头去重造。
 *  ④ **零依赖**：只用 node 内置 + 本仓 `lib/http.js`。
 */

import { qs } from './http.js'

/** 输出上限（见纪律②） */
export const MAX_ANNOTATIONS = 10
export const MAX_CANDIDATE_CHARS = 2000
export const PARA_HEAD_CHARS = 16

/**
 * 一屏里最多列多少段（默认窗口）。
 *
 * ⚠ 2026-11-23 真机踩到：第 1 章 273 段，`mofang_chapter` 把整张段落表渲染进上下文
 *   （273 条「序号(字数)」），一次读章就把预算吃掉一截，而段落清单的用途只是
 *   "找到要改的那一段"，不是"把全文抄一遍"。现在按窗口给，并说清还有多少没列。
 */
export const MAX_RENDER_PARAGRAPHS = 40
/** 窗口上限：调用方可以要更多，但不会无限要（默认 40，最多 80） */
export const MAX_RENDER_PARAGRAPHS_CAP = 80

const DISCONNECTED_HINT = '墨坊没连上：先打开绒花墨坊桌面端（或用 python scripts/nf_api.py --port 8765 起服务），'
  + '再重试这一次调用。不要据此认为书是空的。'

/** 完整 JSON Schema 的 object（宿主要求 properties/required 齐全，fact 23b） */
function objectParams(properties, required = []) {
  return { type: 'object', properties, required }
}

/** 统一把值压成整数（schema 里写 integer 就必须真给整数） */
function int(v, dft = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : dft
}

function str(v, dft = '') {
  const s = v === null || v === undefined ? '' : String(v)
  return s === '' ? dft : s
}

/** 章节内容 → 一屏需要的三样（段落/批注/指标） */
async function readChapter(client, n, layer) {
  const q = qs({ n, layer })
  const [paras, anns, struct] = await Promise.all([
    client.get('/chapters/paragraphs' + q),
    client.get('/chapters/annotations' + q),
    client.get('/review/structure'),
  ])
  return { paras, anns, struct }
}

/** 从结构指标里挑出这一章的那些项（结构体见 utils/judge/structure.collect） */
function metricsOf(structData, chapter) {
  const rows = []
  const list = (structData && structData.chapters) || []
  const hit = list.find((c) => int(c && c.chapter) === int(chapter))
  if (!hit) return { rows, needsSampling: false }
  const trig = new Set(((hit.triggered || []).map((t) => str(t && t.code))))
  for (const [code, value] of Object.entries(hit.metrics || {})) {
    if (value === null || value === undefined) continue
    rows.push({ code, value: Number(value), triggered: trig.has(code) })
  }
  return { rows, needsSampling: !!hit.needs_sampling }
}

/** 5 个工具定义（形状按 dsh-tools 的 ToolDefinition：name/description/parameters/output/execute） */
export function buildTools(client) {
  return [
    // ---------------------------------------------------------------- 1. 全景
    {
      name: 'mofang_status',
      description:
        '绒花墨坊（NovelForge）的全景：当前书、进行到第几阶段、引擎、字数区间、token 用量。'
        + '只读。开工前先看它，确认"这本书跑到哪了"，别凭印象。',
      parameters: objectParams({}),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            connected: { type: 'boolean' },
            hint: { type: 'string' },
            book: { type: 'string' },
            stage: { type: 'integer' },
            stage_status: { type: 'string' },
            engine: { type: 'string' },
            agent_mode: { type: 'boolean' },
            words_low: { type: 'integer' },
            words_high: { type: 'integer' },
            tokens_used: { type: 'integer' },
            token_limit: { type: 'integer' },
          },
          required: ['connected', 'hint', 'book', 'stage', 'stage_status', 'engine',
            'agent_mode', 'words_low', 'words_high', 'tokens_used', 'token_limit'],
        },
        render: (_args, v) => {
          if (!v.connected) return [{ type: 'text', text: '绒花墨坊未连接。\n' + v.hint }]
          return [{
            type: 'text',
            text: '《' + v.book + '》 · 第 ' + v.stage + ' 阶段（' + v.stage_status + '）'
              + ' · 引擎 ' + v.engine + (v.agent_mode ? ' · Agent 模式' : '')
              + '\n单章字数 ' + v.words_low + '–' + v.words_high + ' 个汉字'
              + ' · token ' + v.tokens_used + '/' + v.token_limit,
          }]
        },
      },
      async execute(args) {
        const [state, who] = await Promise.all([client.get('/state'), client.get('/whoami')])
        if (!state.ok) {
          return {
            connected: false, hint: state.hint || DISCONNECTED_HINT, book: '', stage: 0,
            stage_status: '', engine: '', agent_mode: false, words_low: 0, words_high: 0,
            tokens_used: 0, token_limit: 0,
          }
        }
        const st = state.data || {}
        const stages = Array.isArray(st.stages) ? st.stages : []
        const next = stages.find((s) => str(s && s.status) !== 'done') || stages[stages.length - 1] || {}
        const tw = Array.isArray(st.chapter_target_words) ? st.chapter_target_words : []
        const budget = st.budget || {}
        const tl = budget.token_limit || {}
        return {
          connected: true,
          hint: '',
          book: str(st.book),
          stage: int(next.stage),
          stage_status: str(next.status, 'unknown'),
          engine: str((who.data || {}).engine),
          agent_mode: !!st.agent_mode,
          words_low: int(tw[0]),
          words_high: int(tw[1]),
          tokens_used: int(budget.tokens_used),
          token_limit: int(tl.max_total_tokens),
        }
      },
    },

    // ---------------------------------------------------------------- 2. 一屏读章
    {
      name: 'mofang_chapter',
      description:
        '读某一章的"改稿三件套"：段落清单（序号/字数/开头）、未收口批注、六项结构指标。'
        + '零 token。**改稿前必须调它** —— 不读就改等于闭着眼睛改；'
        + '批注状态 drift/missing 说明原句已被改掉，别照旧段落号动手。',
      parameters: objectParams({
        n: { type: 'integer', description: '章节号（从 1 开始）' },
        layer: {
          type: 'string',
          enum: ['raw', 'checked', 'refined'],
          description: '哪一层（不传 = 当前最高存在的层）',
        },
        para_from: {
          type: 'integer',
          description: '段落清单从第几段开始列（0 起，默认 0）—— 长章要定位后半段时用',
        },
        para_count: {
          type: 'integer',
          description: '这次列多少段（默认 40，上限 80）—— 清单只用来定位，不是抄全文',
        },
      }, ['n']),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            connected: { type: 'boolean' },
            hint: { type: 'string' },
            error: { type: 'string' },
            chapter: { type: 'integer' },
            layer: { type: 'string' },
            paragraphs: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  index: { type: 'integer' },
                  chars: { type: 'integer' },
                  head: { type: 'string' },
                },
                required: ['index', 'chars', 'head'],
              },
            },
            total_paragraphs: { type: 'integer' },
            para_from: { type: 'integer' },
            para_window: { type: 'integer' },
            open_annotations: { type: 'integer' },
            annotations_error: { type: 'string' },
            annotations: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  para_index: { type: 'integer' },
                  status: { type: 'string' },
                  note: { type: 'string' },
                },
                required: ['id', 'para_index', 'status', 'note'],
              },
            },
            metrics: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  code: { type: 'string' },
                  value: { type: 'number' },
                  triggered: { type: 'boolean' },
                },
                required: ['code', 'value', 'triggered'],
              },
            },
            needs_sampling: { type: 'boolean' },
            metrics_error: { type: 'string' },
            metrics_hint: { type: 'string' },
          },
          required: ['connected', 'hint', 'error', 'chapter', 'layer', 'paragraphs',
            'total_paragraphs', 'para_from', 'para_window', 'open_annotations',
            'annotations_error', 'annotations', 'metrics', 'needs_sampling',
            'metrics_error', 'metrics_hint'],
        },
        render: (_args, v) => {
          if (!v.connected) return [{ type: 'text', text: '绒花墨坊未连接。\n' + v.hint }]
          if (v.error) return [{ type: 'text', text: '第 ' + v.chapter + ' 章读不出来：' + v.error }]
          const annLine = v.annotations_error
            ? '批注未读到（' + v.annotations_error + '）'
            : '未收口批注 ' + v.open_annotations + ' 条'
          const lines = [
            '第 ' + v.chapter + ' 章（' + v.layer + '）：' + v.total_paragraphs + ' 段'
              + ' · ' + annLine
              + (v.needs_sampling ? ' · 需人工抽样' : ''),
          ]
          for (const a of v.annotations.slice(0, MAX_ANNOTATIONS)) {
            lines.push('  [批注 ' + a.status + ' · 第 ' + a.para_index + ' 段] ' + a.note)
          }
          if (v.metrics_error) {
            lines.push('  结构指标未读到（' + v.metrics_error + '）')
          } else {
            const hot = v.metrics.filter((m) => m.triggered).map((m) => m.code)
            if (hot.length) lines.push('  越线指标：' + hot.join('、'))
            if (v.metrics_hint) lines.push('  ' + v.metrics_hint)
          }
          // 段落清单按窗口给：用途是"定位到哪一段"，不是抄全文。
          // 截断必须说清，否则模型会以为这一章就这么几段（比"没给"更糟的谎）。
          const from = v.para_from || 0
          const shown = v.paragraphs
          if (shown.length) {
            lines.push('  段落：' + shown.map((p) => p.index + '(' + p.chars + '字)').join(' '))
          } else {
            lines.push('  这一段范围里没有段落（全章共 ' + v.total_paragraphs + ' 段）')
          }
          const rest = v.total_paragraphs - from - shown.length
          if (rest > 0) {
            lines.push('  ……还有 ' + rest + ' 段没列（全章 ' + v.total_paragraphs
              + ' 段；要看后面的段，用 para_from 指定起点）')
          } else if (from > 0) {
            lines.push('  （从第 ' + from + ' 段起，已到章末）')
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        const n = int(args && args.n)
        const layer = str(args && args.layer)
        const empty = {
          connected: false, hint: DISCONNECTED_HINT, error: '', chapter: n, layer,
          paragraphs: [], total_paragraphs: 0, para_from: 0, para_window: 0,
          open_annotations: 0, annotations_error: '', annotations: [],
          metrics: [], needs_sampling: false, metrics_error: '', metrics_hint: '',
        }
        if (n < 1) return Object.assign({}, empty, { connected: true, error: 'n 必须是章号（>=1）' })
        const { paras, anns, struct } = await readChapter(client, n, layer)
        if (!paras.ok) {
          if (paras.status === 0) return empty
          return Object.assign({}, empty, {
            connected: true,
            error: paras.error || 'HTTP ' + paras.status,
            hint: '',
          })
        }
        const from = Math.max(0, int(args && args.para_from))
        const want = int(args && args.para_count) > 0 ? int(args && args.para_count) : MAX_RENDER_PARAGRAPHS
        const window = Math.min(want, MAX_RENDER_PARAGRAPHS_CAP)
        const pd = paras.data || {}
        const list = Array.isArray(pd.paragraphs) ? pd.paragraphs : []
        const ad = anns.ok ? (anns.data || {}) : {}
        // 单个端点失败不能缩成“0 条批注 / 没有越线指标”：那是另一种谎。
        const annotationsError = anns.ok ? '' : (anns.error || ('HTTP ' + anns.status))
        const rows = (Array.isArray(ad.annotations) ? ad.annotations : [])
          .filter((a) => str(a && a.status) !== 'resolved')
          .slice(0, MAX_ANNOTATIONS)
          .map((a) => ({
            id: str(a && a.id),
            para_index: int(a && a.para_index),
            status: str(a && a.status, 'open'),
            note: str(a && a.note).slice(0, 200),
          }))
        const sd = struct.ok ? (struct.data || {}) : {}
        const metricsError = struct.ok ? '' : (struct.error || ('HTTP ' + struct.status))
        const { rows: metrics, needsSampling } = metricsOf(sd, n)
        const shownList = list
          .filter((p) => int(p && p.index) >= from)
          .slice(0, window)
        return {
          connected: true,
          hint: '',
          error: '',
          chapter: int(pd.chapter, n),
          layer: str(pd.layer),
          paragraphs: shownList.map((p) => ({
            index: int(p && p.index),
            chars: int(p && p.chars),
            head: str(p && p.text).replace(/\s+/g, '').slice(0, PARA_HEAD_CHARS),
          })),
          total_paragraphs: int(pd.count, list.length),
          para_from: from,
          para_window: window,
          open_annotations: int(ad.open),
          annotations_error: annotationsError,
          annotations: rows,
          metrics,
          needs_sampling: needsSampling,
          metrics_error: metricsError,
          metrics_hint: sd.exists === false ? '还没算过结构指标（跑一次阶段 5 或 judge_structure.py 才有）' : '',
        }
      },
    },

    // ---------------------------------------------------------------- 3. 只算不落
    {
      name: 'mofang_paragraph_preview',
      description:
        '让模型按意见重写**某一段**，但**只算不落**：候选写进 para_pending.json，正文一个字不动。'
        + '返回 job_id；算完用 mofang_paragraph_pending 看改前/改后。'
        + '**采用（写进正文）是作者在墨坊里点的**，这里没有那个工具，也不许绕。',
      parameters: objectParams({
        chapter: { type: 'integer', description: '章节号' },
        paragraph_index: { type: 'integer', description: '段落号（0 起，用 mofang_chapter 取准）' },
        feedback: { type: 'string', description: '要改什么（作者的意见，别自己编）' },
        annotation_id: { type: 'string', description: '批注号（可选）：与这条批注绑定' },
      }, ['chapter', 'paragraph_index', 'feedback']),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            job_id: { type: 'string' },
            chapter: { type: 'integer' },
            index: { type: 'integer' },
            message: { type: 'string' },
            hint: { type: 'string' },
          },
          required: ['ok', 'job_id', 'chapter', 'index', 'message', 'hint'],
        },
        render: (_a, v) => [{
          type: 'text',
          text: v.ok
            ? '已开始生成候选（job ' + v.job_id + '）：' + v.message + '\n' + v.hint
            : '没生成：' + (v.message || '失败') + '\n' + v.hint,
        }],
      },
      async execute(args) {
        const chapter = int(args && args.chapter)
        const index = int(args && args.paragraph_index, -1)
        const feedback = str(args && args.feedback)
        const aid = str(args && args.annotation_id)
        const base = {
          ok: false, job_id: '', chapter, index, message: '',
          hint: '算完用 mofang_paragraph_pending 看改前/改后；采用是作者在墨坊里点的。',
        }
        if (chapter < 1 || index < 0) {
          return Object.assign({}, base, { message: 'chapter(>=1) 与 paragraph_index(>=0) 必填' })
        }
        if (!feedback.trim()) {
          return Object.assign({}, base, { message: 'feedback 必填（没有作者的意见就别改）' })
        }
        const body = { chapter, paragraph_index: index, feedback }
        if (aid) body.annotation_id = aid
        const r = await client.post('/chapters/paragraph/preview', body)
        if (!r.ok) {
          return Object.assign({}, base, {
            message: r.error || 'HTTP ' + r.status,
            hint: r.hint || base.hint,
          })
        }
        const d = r.data || {}
        return {
          ok: true,
          job_id: str(d.job_id),
          chapter,
          index,
          message: str(d.message, '已开始生成候选'),
          hint: base.hint,
        }
      },
    },

    // ---------------------------------------------------------------- 4. 看候选
    {
      name: 'mofang_paragraph_pending',
      description:
        '看某一段的待采用候选（改前/改后 + 最多 3 条并排）。**正文尚未改动**。'
        + 'exists=false 就是真没有候选 —— 不是"墨坊没连上"（那种情况 connected=false）。',
      parameters: objectParams({
        chapter: { type: 'integer', description: '章节号' },
        index: { type: 'integer', description: '段落号（0 起）' },
      }, ['chapter', 'index']),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            connected: { type: 'boolean' },
            hint: { type: 'string' },
            error: { type: 'string' },
            exists: { type: 'boolean' },
            chapter: { type: 'integer' },
            index: { type: 'integer' },
            before: { type: 'string' },
            after: { type: 'string' },
            truncated: { type: 'boolean' },
            candidates: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  cid: { type: 'string' },
                  feedback: { type: 'string' },
                  after: { type: 'string' },
                },
                required: ['cid', 'feedback', 'after'],
              },
            },
            note: { type: 'string' },
          },
          required: ['connected', 'hint', 'error', 'exists', 'chapter', 'index', 'before',
            'after', 'truncated', 'candidates', 'note'],
        },
        render: (_a, v) => {
          if (!v.connected) return [{ type: 'text', text: '绒花墨坊未连接。\n' + v.hint }]
          // 读失败不等于“没有候选”：400/500 时必须把原文交出去，否则模型会重出候选。
          if (v.error) {
            return [{
              type: 'text',
              text: '第 ' + v.chapter + ' 章第 ' + v.index + ' 段候选读不出来：' + v.error
                + '\n（这不等于“没有候选”。先看回执原因，别重出候选。）',
            }]
          }
          if (!v.exists) {
            return [{
              type: 'text',
              text: '第 ' + v.chapter + ' 章第 ' + v.index + ' 段没有待采用候选。'
                + (v.note ? '\n' + v.note : ''),
            }]
          }
          const lines = ['第 ' + v.chapter + ' 章第 ' + v.index + ' 段候选（正文未改）：', '改前：' + v.before]
          lines.push('改后：' + v.after + (v.truncated ? ' …（已截断）' : ''))
          if (v.candidates.length > 1) {
            lines.push('并排 ' + v.candidates.length + ' 条：')
            for (const c of v.candidates) lines.push('  - ' + c.cid + '：' + c.after)
          }
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args) {
        const chapter = int(args && args.chapter)
        const index = int(args && args.index, -1)
        const out = {
          connected: false, hint: DISCONNECTED_HINT, error: '', exists: false, chapter, index,
          before: '', after: '', truncated: false, candidates: [], note: '',
        }
        if (chapter < 1 || index < 0) {
          return Object.assign({}, out, { connected: true, error: 'chapter(>=1) 与 index(>=0) 必填' })
        }
        const r = await client.get('/chapters/paragraph/pending' + qs({ chapter, index }))
        if (!r.ok) {
          if (r.status === 0) return out
          return Object.assign({}, out, {
            connected: true,
            error: r.error || ('HTTP ' + r.status),
            hint: '',
          })
        }
        const d = r.data || {}
        if (!d.exists) {
          return Object.assign({}, out, {
            connected: true, hint: '', note: str(d.message, '没有待采用的候选'),
          })
        }
        const rec = d.rec || {}
        const cut = (s) => {
          const t = str(s)
          return t.length > MAX_CANDIDATE_CHARS ? t.slice(0, MAX_CANDIDATE_CHARS) : t
        }
        const after = cut(rec.after)
        return {
          connected: true,
          hint: '',
          exists: true,
          chapter,
          index,
          before: cut(rec.before),
          after,
          truncated: str(rec.after).length > after.length,
          candidates: (Array.isArray(d.candidates) ? d.candidates : []).slice(0, 3).map((c) => ({
            cid: str(c && c.cid),
            feedback: str(c && c.feedback).slice(0, 120),
            after: cut(c && c.after),
          })),
          note: str(d.note, '候选只在这里，正文尚未改动'),
        }
      },
    },

    // ---------------------------------------------------------------- 5. 丢候选
    {
      name: 'mofang_paragraph_drop',
      description:
        '丢掉某一段的待采用候选（删候选，**正文不动**）。候选明显不合格时用它，'
        + '别用"再改一次"把烂候选堆到 3 条把好的一条挤掉。',
      parameters: objectParams({
        chapter: { type: 'integer', description: '章节号' },
        paragraph_index: { type: 'integer', description: '段落号（0 起）' },
      }, ['chapter', 'paragraph_index']),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            message: { type: 'string' },
            hint: { type: 'string' },
          },
          required: ['ok', 'message', 'hint'],
        },
        render: (_a, v) => [{
          type: 'text',
          text: (v.ok ? '已放弃候选：' : '放弃失败：') + v.message + (v.hint ? '\n' + v.hint : ''),
        }],
      },
      async execute(args) {
        const chapter = int(args && args.chapter)
        const index = int(args && args.paragraph_index, -1)
        if (chapter < 1 || index < 0) {
          return { ok: false, message: 'chapter(>=1) 与 paragraph_index(>=0) 必填', hint: '' }
        }
        const r = await client.post('/chapters/paragraph/drop',
          { chapter, paragraph_index: index })
        if (!r.ok) {
          return { ok: false, message: r.error || 'HTTP ' + r.status, hint: r.hint || '' }
        }
        return { ok: true, message: str((r.data || {}).message, '已放弃候选（正文未改动）'), hint: '' }
      },
    },
  ]
}

/** 工具名清单（health 与测试都读它，别在别处再抄一份） */
export function toolNames() {
  return buildTools({ get: async () => ({ ok: false, status: 0, data: null, error: '', hint: '' }) })
    .map((t) => t.name)
}
