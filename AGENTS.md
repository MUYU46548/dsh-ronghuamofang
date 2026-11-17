# AGENTS.md —— 在这个仓库开工前先读这一页

> 只放**已核实的事实**与**不容越界的规则**。写给用户看的在 `README.md`，
> 与墨坊的分工在 `E:\CODE\CangKu\NovelForge\docs\开发路线-读改接进DSH-20261117.md`。

## 0. 一句话

把"改稿这条链"接进 DSH：**规则段 + 5 个工具 + 一行现状 + health**，全部只走本机 HTTP，
**不提供"采用"** —— 采用是作者的签字动作。

## 1. 硬边界（越界即错，`test/plugin.test.mjs` 钉着）

- **DSH 概念只在 `lib/index.js`**：`root.inject/get/on/effect`、`webServer.register`、
  `systemPrompt`、`tools.register`。别的模块只认 HTTP 与纯函数 —— 换宿主只改一个文件。
- **只连回环**：`MOFANG_API` 不是 `127.0.0.1`/`localhost`/`[::1]` 直接抛（`lib/http.js`）。
- **不 import 墨坊代码、不 import electron**；零依赖（只用 Node 内置）。
- **没有写正文的工具**：不注册 apply/adopt 类工具；`ENDPOINTS` 里也不列 `/chapters/paragraph/apply`。
- **输出有界**：批注 10 条、候选正文 2000 字、段落只给序号/字数/开头 16 字。
- **连不上要说"没连上"**，不许回 "0 段 / 0 条批注"（那会让模型以为书是空的，转头去重造）。
- **`engines.dsh` 只写下限不写上界**：写上界会让升级后插件**静默消失**（`skippedBundles`，无人打印原因）。

## 2. 已核实的宿主事实（照抄 dsh-fangcun 0.6.x 的真机结论）

| # | 事实 | 后果 |
|---|---|---|
| 1 | 插件导出 `export default { name, apply(root) }` | name 必须等于 `package.json` 的 name，否则"装了但不出现" |
| 2 | 路由：`ctx.webServer.register({kind:'exact', path, handler})`，**没有 method 字段** | 方法在 handler 里判；写请求自己回 405 |
| 3 | `root.get('systemPrompt'|'tools')` 读可选服务，**绝不 inject** | 老宿主没这服务时 inject 会让插件永不 apply |
| 4 | 服务可能晚到 | 规则段最多追 10 次/1 秒；期间 health 显示"正在重试（n/10）" |
| 5 | `tools.register` 只校验 `output.schema`，**不编译 `parameters`** | `parameters` 必须交完整 JSON Schema `{type:'object',properties:{…}}` |
| 6 | `output.schema` 的 `required` 每分支都要填满 | 少一个字段，宿主拒掉**整次**调用（看起来像"工具坏了"） |
| 7 | `webserver/index-inject` 那张表宿主启动时只收集一次 | 将来推挂件必须在 `apply()` 最前面订阅 |
| 8 | 桌面端页面是 `dsh-app://app/`，请求不带 `sec-fetch-*`/`referer` | 判"页面真来取"要靠自己加的标记 |

## 3. 五条链路（改之前先看懂）

**工具**：`apply()` → `root.get('tools')` → `buildTools(mofang)` → 每个定义 `execute` 里
`mofang.get/post` → `lib/http.js` → `127.0.0.1:8765` → 墨坊域模块。
连不上/403/404 都变成结构化字段（`connected`/`error`/`hint`），**不抛**。

**提示词**：静态规则段（`RULES_TEXT`，不掺动态数据）+ 一行现状（`statusLine`，60 秒刷新快照）。
规则段里那句"采用是作者点的"是**产品语义**，不是文案 —— 删了它就等于放开 gate。

**一屏读章**（`mofang_chapter`）：三个只读端点并行 → 段落清单 + 未收口批注 + 六项指标。
`resolved` 的批注不再提醒（作者已经处理过）。

**候选**：`mofang_paragraph_preview` = 墨坊的 `/chapters/paragraph/preview`，**只算不落**；
候选进 `data/state/para_pending.json`，正文一个字不动。`mofang_paragraph_pending` 读它。
`mofang_paragraph_drop` 丢候选（正文不动）。

**health**：`/mofang/health.json` 报三件能自证的事（规则段/工具/路由注册没）+ 墨坊连没连。
"DSH 装没装"不归本插件报（插件活在 DSH 里，能跑就说明 DSH 在）。

## 4. 本地怎么跑

```powershell
npm test                    # 30 条离线：假宿主 + 假 HTTP，不需要 DSH、不需要墨坊
npm pack                    # 验发布包（host 会真 apply 一次）
```

装进 DSH（开发态用 `link:`，改完**重启**才生效）：

```powershell
dsh plugin --profile desktop add link:E:\CODE\CangKu\dsh-novelforge
curl.exe http://127.0.0.1:<端口>/mofang/health.json
```

## 5. 未做（如实列出，别当成"已经能用"）

- **没有挂件/浮层**：`webserver/index-inject` 那一步还没用上。想在 DSH 界面里看"未收口批注 3 条"，
  下一步就在这里加（照 dsh-fangcun 的 `widget.js` 骨架，注意让开右下角和顶部 40px 原生按钮区）。
- **没有 proof（会话级自证）**：现在不知道"模型到底有没有先查判据再改"。
  这是 L1 的退出判据，值得做：订阅 `session/event` 的 `tool/call`，落 `tools.jsonl`。
- **没在真机 DSH 里装过**：只有离线 30/30 + 对真墨坊 2/2（`test/live.smoke.mjs`）。
