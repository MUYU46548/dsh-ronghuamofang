/**
 * 提示词：**静态规则段** + **一行现状**。
 *
 * 为什么规则段必须是静态文本（不掺实时数据）：宿主对 system prompt 做前缀缓存，
 * 掺进"今天几号/现在第几章"会让整段缓存失效（dsh-fangcun 的教训）。
 * 动态部分只走 `context()`，一行、可刷新的快照。
 *
 * 为什么要这段：没有它，模型在 DSH 会话里**不知道墨坊存在**，也不会想到去查判据；
 * 那正是用户说的"没插件几乎什么都做不了，和之前纯 MCP 差不多"。
 */

export const RULES_NAME = 'dsh-novelforge.rules'
export const STATUS_NAME = 'dsh-novelforge.status'

/** 规则段（静态）。写法要求：每条都能落到一个工具动作上，不写口号。 */
export const RULES_TEXT = [
  '绒花墨坊（NovelForge）在这台机器上，改稿这条链用 mofang_* 工具。',
  '改一段之前，先 mofang_chapter 拿到这一段的三样：段落号、未收口批注、六项结构指标。缺一步就是闭眼改。',
  '字数口径只数汉字（标点不算）；单章区间看 mofang_status 的 words_low/words_high。',
  '改稿只有一条合法路径：mofang_paragraph_preview（只算不落）→ mofang_paragraph_pending 看改前/改后。',
  '“采用”（把候选写进正文）是作者在墨坊里点的。不要用工具代替，也不要直接改章节文件、'
    + '不要调 /chapters/paragraph/apply —— 那条要求作者本人操作，会被 403。',
  '候选明显不合格就 mofang_paragraph_drop；不要用“再改一次”把烂候选堆到 3 条把好的挤掉。',
  '失败先看回执说的是哪一种：截断（该调大 max_tokens）/ 超时（重试或换模型）/ 段落数变化（疑似整章重写）。',
  '闲聊、纯知识问题不要调这些工具。',
].join('\n')

/**
 * 把规则段与一行现状注册进 systemPrompt 服务。
 * 返回 dispose；服务缺方法来时**不假装成功**（调用方据此写 health）。
 */
export function registerPrompt(sp, { line } = {}) {
  const offs = []
  if (typeof sp.section === 'function') {
    const d = sp.section({ name: RULES_NAME, order: 60, text: RULES_TEXT })
    if (typeof d === 'function') offs.push(d)
  }
  if (typeof sp.context === 'function' && typeof line === 'function') {
    const d = sp.context({ name: STATUS_NAME, order: 61, text: () => line() })
    if (typeof d === 'function') offs.push(d)
  }
  return () => {
    for (const off of offs) {
      try { off() } catch { /* 已注销 */ }
    }
  }
}

/** 一行现状（插件里能自证的那几件事） */
export function statusLine({ reachable, book, stage, pendingOpen }) {
  if (!reachable) return '绒花墨坊 · 未连接（打开桌面端或起 nf_api 后自动恢复，不用重启 DSH）'
  const parts = ['绒花墨坊 · 已连接']
  if (book) parts.push('《' + book + '》')
  if (stage) parts.push('第 ' + stage + ' 阶段')
  if (Number(pendingOpen) > 0) parts.push('未收口批注 ' + Number(pendingOpen) + ' 条')
  return parts.join(' · ')
}
