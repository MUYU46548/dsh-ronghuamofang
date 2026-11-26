/**
 * 反证：把修复逐条改回"坏版本"，确认测试真的会红，然后原样还原。
 *
 * 为什么值得一个脚本：判据写在测试里不等于判据有效。只有"改坏就红"才证明它钉住了东西
 * （AGENTS.md 的 I10：规矩写在报告里 ≠ 写在闸门里，判据是"违反时会不会失败"）。
 *
 * 用法：node test/counter-proof.mjs
 * ⚠ 只改内存里的字符串再写回，且 finally 里必定还原；不碰编码（UTF-8 读写）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 跑一批测试，回 { pass, fail } */
function runTests(files) {
  let out = ''
  try {
    out = execFileSync(process.execPath, ['--test', ...files], { cwd: ROOT, encoding: 'utf8' })
  } catch (e) {
    out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
  }
  const pass = Number((out.match(/^# pass (\d+)/m) || [])[1] || 0)
  const fail = Number((out.match(/^# fail (\d+)/m) || [])[1] || 0)
  return { pass, fail }
}

/** 换一处字符串 → 跑测试 → 无论结果都还原 */
function mutate(file, from, to, tests, label) {
  const abs = path.join(ROOT, file)
  const original = fs.readFileSync(abs, 'utf8')
  if (!original.includes(from)) {
    console.log('⚠ 跳过「' + label + '」：源文件里找不到要改的片段（判据可能已过期）')
    return { skipped: true }
  }
  try {
    fs.writeFileSync(abs, original.replace(from, to), 'utf8')
    const r = runTests(tests)
    console.log('反证「' + label + '」→ pass ' + r.pass + ' / fail ' + r.fail
      + (r.fail > 0 ? '  ✅ 抓到' : '  ❌ 没抓到（判据无效）'))
    return r
  } finally {
    fs.writeFileSync(abs, original, 'utf8')
  }
}

const cases = [
  // ① 2026-11-23 真机故障：setupTools 只试一次就放弃
  mutate('lib/index.js', 'const TOOL_ATTEMPTS = 30', 'const TOOL_ATTEMPTS = 1',
    ['test/plugin.test.mjs'], 'tools 服务只试一次就放弃'),
  // ② 段落清单抄全文（273 段全渲染）
  mutate('lib/tools.js', '.slice(0, window)', '.slice(0, 99999)',
    ['test/tools.test.mjs'], '段落清单抄全文（无窗口）'),
  // ③ 设置不校验回环（书稿可能发到外网）
  mutate('lib/settings.js', 'patch[key] = baseUrlOf({}, value)', 'patch[key] = value',
    ['test/settings.test.mjs'], '设置不校验回环地址'),
  // ④ health 路由冲突时不退让（新版 health 永远被旧残留挡住）
  mutate('lib/index.js', 'if (!isFallback && r.fallback && /duplicate/i.test(msg)) {',
    'if (false) {', ['test/plugin.test.mjs'], 'health 路由冲突不退让'),
  // ⑤ 2026-11-26：候选读取失败被渲染成“没有候选”（400 被吞成 exists:false）
  mutate('lib/tools.js', 'if (v.error) {', 'if (false) {',
    ['test/tools.test.mjs'], '候选读取失败被说成没有候选'),
  // ⑥ 2026-11-26：批注端点失败时装成“0 条”
  mutate('lib/tools.js',
    "const annotationsError = anns.ok ? '' : (anns.error || ('HTTP ' + anns.status))",
    "const annotationsError = ''",
    ['test/tools.test.mjs'], '批注端点失败装 0'),
  // ⑦ 2026-11-26：结构指标端点失败时装成“没有越线指标”
  mutate('lib/tools.js',
    "const metricsError = struct.ok ? '' : (struct.error || ('HTTP ' + struct.status))",
    "const metricsError = ''",
    ['test/tools.test.mjs'], '指标端点失败装 0'),
  // ⑧ 2026-11-26：宿主能力缺失却不告警（compat 一片绿）
  mutate('lib/compat.js',
    "if (state !== 'ok') warnings.push(warnOf(cap.key, cap.need, state))",
    "if (false) warnings.push(warnOf(cap.key, cap.need, state))",
    ['test/compat.test.mjs'], '宿主能力缺失不告警'),
]

const bad = cases.filter((c) => c && c.skipped !== true && !(c.fail > 0))
console.log('')
if (bad.length) {
  console.log('❌ 有 ' + bad.length + ' 条反证没抓到 —— 那些判据是摆设，要重写')
  process.exitCode = 1
} else {
  console.log('✅ 全部反证都抓到了：改坏 → 变红，判据有效')
}
