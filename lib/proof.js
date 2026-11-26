/**
 * 会话级自证（proof）：把模型**真的调了 mofang_* 工具的顺序**记成本地账本。
 *
 * 为什么需要它：规则段写着“改稿前先 mofang_chapter”，但没有任何东西能回答
 * “模型到底做没做”。`session/event` 的 `tool/call` 是唯一可靠来源 —— 模型自述不算、
 * 人看界面也不算。插件自己记一份，health 直接出“先查后改”的数。
 *
 * 两条纪律：
 *  ① **只记录、不改行为**：不拦工具、不注入参数；模型照常调，账本只读。
 *  ② **不记参数**：只记时间/会话/轮次/工具名/序号。`feedback` 里可能有正文或私事，
 *     正文永远不落这份账本（书稿只在本机，但没必要多一份副本）。
 *
 * 账本：`~/.dsh/dsh-novelforge/tools.jsonl`，一行一次 mofang_* 调用，上限 500 行。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 只认插件自己的工具（别把宿主的工具也算进“改稿”） */
export const TOOL_PREFIX = 'mofang_'

/** 账本上限：一天几百次调用也够回溯好几天 */
export const MAX_ROWS = 500

/** 一次改稿里最关心的两个工具 */
export const CHAPTER_TOOL = 'mofang_chapter'
export const PREVIEW_TOOL = 'mofang_paragraph_preview'

export function dshHome(env = process.env) {
  const fromEnv = String(env.DSH_HOME || '').trim()
  if (fromEnv) return fromEnv
  return path.join(env.USERPROFILE || env.HOME || os.homedir(), '.dsh')
}

export function proofPaths(env = process.env) {
  const dir = path.join(dshHome(env), 'dsh-novelforge')
  return { dir, tools: path.join(dir, 'tools.jsonl') }
}

/**
 * 会话 id 归一化：宿主给的是 Session **对象**，真 id 在 `session.id` / `session.header.id`。
 *
 * 2026-11-03 方寸侧真机踩过 `String(session)` → `"[object Object]"`：不同会话的同一轮
 * 互相顶掉，账本看起来有数据、少的那些没有任何痕迹。这里显式拒绝那个字符串，
 * 取不出 id 就返回空串（调用方跳过，**绝不编 id**）。
 */
export function sessionIdOf(session) {
  if (typeof session === 'string') {
    const s = session.trim()
    return s === '[object Object]' ? '' : s
  }
  if (!session || typeof session !== 'object') return ''
  const header = session.header
  for (const candidate of [session.id, session.sessionId, header && header.id]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

function readJsonl(file) {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf-8') } catch { return [] }
  const out = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
  }
  return out
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf-8')
}

function rewriteJsonl(file, rows) {
  const tmp = file + '.tmp'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf-8')
  fs.renameSync(tmp, file)
}

/**
 * 把账本行聚合成“轮次”，并算两件事：
 *  · `chapterBeforePreview` —— 同一会话同一轮里，mofang_chapter 出现在 preview 之前；
 *  · `previewWithoutChapter` —— 先出候选、后查判据（或压根没查）。
 *
 * 只按 `session#turn` 分组；`turn` 缺失时归到 0，仍能看出先后。
 */
export function summarizeRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()
  for (const row of list) {
    if (!row || typeof row !== 'object') continue
    const key = String(row.session || '') + '#' + String(row.turn || 0)
    let g = groups.get(key)
    if (!g) {
      g = {
        session: String(row.session || ''),
        turn: Number(row.turn) || 0,
        tools: [],
        chapterAt: 0,
        previewAt: 0,
        firstAt: String(row.at || ''),
        lastAt: String(row.at || ''),
      }
      groups.set(key, g)
    }
    const seq = Number(row.seq) || (g.tools.length + 1)
    g.tools.push(String(row.tool || ''))
    if (row.at) g.lastAt = String(row.at)
    if (row.tool === CHAPTER_TOOL && !g.chapterAt) g.chapterAt = seq
    if (row.tool === PREVIEW_TOOL && !g.previewAt) g.previewAt = seq
  }
  const turns = Array.from(groups.values())
  let chapterBeforePreview = 0
  let previewWithoutChapter = 0
  for (const g of turns) {
    g.chapterBeforePreview = g.chapterAt > 0 && g.previewAt > 0 && g.chapterAt < g.previewAt
    g.previewWithoutChapter = g.previewAt > 0 && (g.chapterAt === 0 || g.chapterAt > g.previewAt)
    if (g.chapterBeforePreview) chapterBeforePreview += 1
    if (g.previewWithoutChapter) previewWithoutChapter += 1
  }
  const last = list.length ? list[list.length - 1] : null
  const lastKey = last ? String(last.session || '') + '#' + String(last.turn || 0) : ''
  const lastGroup = lastKey ? groups.get(lastKey) : null
  return {
    rows: list.length,
    lastAt: last ? String(last.at || '') : '',
    lastSession: last ? String(last.session || '') : '',
    lastTool: last ? String(last.tool || '') : '',
    turns: {
      total: turns.length,
      calls: list.length,
      chapterBeforePreview,
      previewWithoutChapter,
    },
    lastTurn: lastGroup ? {
      session: lastGroup.session,
      turn: lastGroup.turn,
      tools: lastGroup.tools.slice(0, 12),
      chapterBeforePreview: lastGroup.chapterBeforePreview,
      previewWithoutChapter: lastGroup.previewWithoutChapter,
    } : null,
  }
}

/** 一行账本 → 一次 `session/event` 的处理结果（返回写入的行，方便测试/排查） */
export class ProofLog {
  constructor(options = {}) {
    const paths = proofPaths(options.env || process.env)
    this.file = options.file || paths.tools
    this.maxRows = Number(options.maxRows) > 0 ? Number(options.maxRows) : MAX_ROWS
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    this.onError = typeof options.onError === 'function' ? options.onError : () => {}
    this.rows = readJsonl(this.file)
    this.seq = new Map()
    for (const row of this.rows) {
      const key = String(row.session || '') + '#' + String(row.turn || 0)
      this.seq.set(key, Math.max(Number(this.seq.get(key) || 0), Number(row.seq) || 0))
    }
  }

  /** 喂一个 `session/event`；只认 `tool/call` 里的 mofang_*，其余原样忽略。 */
  record(session, event) {
    try {
      if (!event || typeof event !== 'object' || event.type !== 'tool/call') return null
      const data = event.data || {}
      const tool = String(data.name || '')
      if (!tool.startsWith(TOOL_PREFIX)) return null
      const sessionId = sessionIdOf(session)
      if (!sessionId) return null
      const turn = Number(data.turn) || 0
      const key = sessionId + '#' + turn
      const seq = Number(this.seq.get(key) || 0) + 1
      this.seq.set(key, seq)
      const row = {
        at: new Date(this.now()).toISOString(),
        session: sessionId,
        turn,
        seq,
        tool,
      }
      appendJsonl(this.file, row)
      this.rows.push(row)
      if (this.rows.length > this.maxRows) {
        this.rows = this.rows.slice(-this.maxRows)
        rewriteJsonl(this.file, this.rows)
      }
      return row
    } catch (e) {
      this.onError('写自证账本失败：' + String((e && e.message) || e))
      return null
    }
  }

  /** health 用：聚合当前账本（≤500 行，现算） */
  summary() {
    return Object.assign({ path: this.file, enabled: true }, summarizeRows(this.rows))
  }
}
