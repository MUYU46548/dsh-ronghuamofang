# AGENTS.md —— 在这个仓库开工前先读这一页

> 只放**已核实的事实**与**不容越界的规则**。写给用户看的在 `README.md`，
> 与墨坊的分工在 `E:\CODE\CangKu\ronghuamofang\docs\开发路线-读改接进DSH-20261117.md`。

## 0. 一句话

把"改稿这条链"接进 DSH：**规则段 + 5 个工具 + 一行现状 + health + 设置页**，全部只走本机 HTTP，
**不提供"采用"** —— 采用是作者的签字动作。

> **包名 = `dsh-ronghuamofang`**（2026-11-26 改名后发布；原名 `dsh-novelforge` 被 npm 以
> “与 `dsh-novel-forge` 太像”拒绝）。GitHub 仓库已是 `MUYU46548/dsh-ronghuamofang`；
> 本地目录暂仍叫 `dsh-novelforge`（两个 profile 的 `link:` 指向它，改名要等重启窗口）。
> 改包名要同时改：`package.json name` / `lib/index.js PLUGIN_NAME` / `lib/health.js` 的
> `plugin.name` / `client.js` 的两处 id / `cordis.patch.yml` 的 id+name / 自证账本目录 / 两个
> profile 的依赖与 bundles —— 测试会钉住前五项。

## 1. 硬边界（越界即错，测试里钉着）

- **DSH 概念只在 `lib/index.js`**：`root.inject/get/on/effect`、`webServer.register`、
  `systemPrompt`、`tools.register`、`configEditor`、`clientModules`。
  别的模块只认 HTTP 与纯函数 —— 换宿主只改一个文件。
- **只连回环**：地址不是 `127.0.0.1`/`localhost`/`[::1]` 直接抛（`lib/http.js` 的 `baseUrlOf`，
  设置页的校验复用它 —— **只有一处判定**）。
- **不 import 墨坊代码、不 import electron**；零依赖（只用 Node 内置，`dependencies`/`peerDependencies` 都不许有）。
- **没有写正文的工具**：不注册 apply/adopt 类工具；`ENDPOINTS` 里也不列 `/chapters/paragraph/apply`。
- **输出有界**：批注 10 条、候选正文 2000 字、段落清单**按窗口**（默认 40、上限 80，
  且必须说清"还有 N 段没列"）—— 只给序号/字数/开头 16 字。
- **连不上要说"没连上"**，不许回 "0 段 / 0 条批注"（那会让模型以为书是空的，转头去重造）。
- **`engines.dsh` 只写下限不写上界**：写上界会让升级后插件**静默消失**（`skippedBundles`，无人打印原因）。
- **设置只走 `configEditor.edit`**，不手改 profile 的 `cordis.patch.yml`
  （那份文件属于用户，还装着别的插件的行与注释）。

## 2. 已核实的宿主事实（照抄 dsh-fangcun 0.7.x 与真机结论）

| # | 事实 | 后果 |
|---|---|---|
| 1 | 插件导出 `export default { name, apply(root, config) }` | name 必须等于 `package.json` 的 name，否则"装了但不出现" |
| 2 | 路由：`ctx.webServer.register({kind:'exact', path, handler})`，**没有 method 字段** | 方法在 handler 里判；写请求自己回 405 |
| 3 | `root.get('systemPrompt'|'tools'|'configEditor'|'clientModules')` 读可选服务，**绝不 inject** | 老宿主没这服务时 inject 会让插件永不 apply |
| 4 | 服务可能晚到 | 规则段追 10 次/1 秒，工具追 **30 次**/1 秒；期间 health 显示"正在重试（n/N）" |
| 5 | `tools.register` 只校验 `output.schema`，**不编译 `parameters`** | `parameters` 必须交完整 JSON Schema `{type:'object',properties:{…}}` |
| 6 | `output.schema` 的 `required` 每分支都要填满 | 少一个字段，宿主拒掉**整次**调用（看起来像"工具坏了"） |
| 7 | `webserver/index-inject` 那张表宿主启动时只收集一次 | 将来推挂件必须在 `apply()` 最前面订阅 |
| 8 | 桌面端页面是 `dsh-app://app/`，请求不带 `sec-fetch-*`/`referer` | 判"页面真来取"要靠自己加的标记；判写请求同源**不能只靠这些头** |
| 9 | **`web.register` 返回的 disposer 必须留住** | 丢了的话 HMR 换代码后旧路由注销不掉，新代码注册同路径报 `duplicate exact route` —— 看起来像"新版没生效"（2026-11-23 真机踩到） |
| 10 | 设置写回：`root.fiber.entry` + `configEditor.edit(entry, change)` | 保存后 Loader 重启该行，`apply(root, config)` 拿到新 config |
| 11 | `configEditor` / `clientModules` 比插件晚就绪 | health 与 GET 路由要**当场**问，不能照抄 apply 时那一拍 |
| 12 | 带 `dsh.client` 的包，客户端半经 `clientModules` 进模块表 | `clientPath(id)` 为空 = 还没进表（manifest 改了要重启条目）；设置页靠 `settings.section` slot |
| 13 | HMR 开启时，Plugin Manager 的一次开关会触发 recomposition | 它会按磁盘比较替换 `link:` 包**已加载的文件** —— 这样改完代码不用重启 DSH（但**路由的僵尸注册**不会因此消失，那是第 9 条）。⚠ 2026-11-26 事故：**有会话在跑时开关插件会打断在跑的回合**；加载改动前先确认无在跑会话，或让用户手动重载 |
| 14 | `session/event` 的签名是 `(session, event)`，`session` 是**对象** | 真 id 在 `session.id` / `session.header.id`；写 `String(session)` 会得到 `[object Object]`，不同会话互相顶掉。取不出 id 就跳过，**绝不编 id** |

## 3. 六条链路（改之前先看懂）

**工具**：`apply()` → `root.get('tools')`（拿不到就每秒重试，最多 30 次）→ `buildTools(mofang)` →
每个定义 `execute` 里 `mofang.get/post` → `lib/http.js` → `127.0.0.1:8765` → 墨坊域模块。
连不上/403/404 都变成结构化字段（`connected`/`error`/`hint`），**不抛**。

**提示词**：静态规则段（`RULES_TEXT`，不掺动态数据）+ 一行现状（`statusLine`，60 秒刷新快照）。
规则段里那句"采用是作者点的"是**产品语义**，不是文案 —— 删了它就等于放开 gate。

**一屏读章**（`mofang_chapter`）：三个只读端点并行 → 段落清单 + 未收口批注 + 六项指标。
`resolved` 的批注不再提醒（作者已经处理过）。段落清单**按窗口给**（`para_from` / `para_count`），
不抄全文 —— 第 1 章 273 段，整表渲染一次就吃掉一截预算。

**候选**：`mofang_paragraph_preview` = 墨坊的 `/chapters/paragraph/preview`，**只算不落**；
候选进 `data/state/para_pending.json`，正文一个字不动。`mofang_paragraph_pending` 读它。
`mofang_paragraph_drop` 丢候选（正文不动）。

**设置**：`/mofang/api/settings` 的 `GET` 读现状（`?probe=1` 顺带真连一次），`PUT` 写两项覆盖
（墨坊地址 / 请求超时）。写入走 `configEditor.edit` 写 profile patch，保存后插件重启一次生效。
浏览器侧是 `client.js` 注册的 `settings.section`（标签「绒花墨坊」，order 171）。

**health**：`/mofang/health.json` 报能自证的事（规则段/工具/路由/设置页/连接参数来源/墨坊连没连）。
主路径被上一代残留占住时自动退到 `/mofang/api/health.json`，并在 `routes.conflicts` 里**如实说出**这件事。
从 0.3.0 起还报两样：`compat`（宿主能力三态 + warnings，见 `lib/compat.js`）与
`mofang.api`（`Server: NovelForgeAPI/x` 头 + `/state` 形状 warnings）。**版本冲突只报警，不自动修**。
从 0.4.0 起报 `proof`：订阅 `session/event` 的 `tool/call`，把 `mofang_*` 调用顺序记到
`~/.dsh/dsh-ronghuamofang/tools.jsonl`（只记工具名，不记参数）；`turns.chapterBeforePreview`
才是“先查后改”，先 preview 后 chapter 记成 `previewWithoutChapter`。
"DSH 装没装"不归本插件报（插件活在 DSH 里，能跑就说明 DSH 在）。

## 4. 本地怎么跑

```powershell
npm test                    # 70 条离线：假宿主 + 假 HTTP，不需要 DSH、不需要墨坊
node test/counter-proof.mjs # 反证：把 9 条修复逐条改回坏版本，确认测试真会红，然后还原
npm pack --dry-run          # 验发布包内容
```

`npm test` 里的 `test/live.smoke.mjs` 只在给了 `MOFANG_API` 时才跑（没给就跳过，不假装通过）。

装进 DSH（开发态用 `link:`）：

```powershell
dsh plugin --profile desktop add link:E:\CODE\CangKu\dsh-novelforge
curl.exe http://127.0.0.1:<端口>/mofang/health.json
```

改完代码要让它生效：HMR 开着时在 Plugin Manager 里开关一次本 bundle 即可（见事实 13）；
**路由相关改动**（表里的路径）则要重启 DSH 才能清掉旧代码的僵尸注册。

## 5. 未做（如实列出，别当成"已经能用"）

- **挂件/浮层**：用户 2026-11-26 裁定（S2=A）**不做纯状态挂件** —— 状态行已覆盖模型侧信息。
  唯一有行动价值的是"待采用提醒"，但它要先等墨坊加"列出全部待采用候选"的端点，再让插件轮询。
- **墨坊端的三端诊断**：2026-11-26 已落地（`/dsh/diagnose` + 「DSH 诊断」面板）；
  接线随施工侧的 `nf_api.py` / `App.vue` 一起提交，安装版重建后才在界面可见。
