# CHANGELOG

## 0.2.0 —— 2026-11-23

真机 DSH 里跑通，并补上"在 DSH 内就能设置"。判据 56 条离线 + 4 条反证（`test/counter-proof.mjs`）。

### 修

- **工具注册只会试一次**（真机故障，最严重的一个）：`setupTools` 只调一次 `root.get('tools')`，
  拿不到就永久放弃。而 `tools` 服务是**异步就绪**的，结果 health 报
  `tools.registered: false` 而 `prompt.rules: true` —— 规则段在指挥模型去调 5 个不存在的工具。
  现在每秒重试、最多 30 次，期间 health 如实显示"正在重试（n/30）"。
- **`web.register` 的清理函数被丢弃**：HMR 换代码后旧路由注销不掉，新代码注册同一路径报
  `duplicate exact route`，health 永远停在旧响应上（看起来像"新版没生效"）。
  现在留住 disposer；并且主路径被占时自动退到 `/mofang/api/health.json`，
  在 `routes.conflicts` 里如实说明（重启 DSH 后残留消失，回到原路径）。
- **段落清单抄全文**：`mofang_chapter` 把 273 段整表渲染进上下文。现在按窗口给
  （默认 40、上限 80，`para_from` 可定位后半段），并说清"还有 N 段没列"。

### 加

- **设置页**（`client.js`，注册 `settings.section`，标签「绒花墨坊」）：看连接状态/工具注册/规则段，
  改墨坊地址与超时，「测试连接」当场真连一次，「恢复默认」清空覆盖。
- **设置路由** `/mofang/api/settings`：`GET` 读现状（`?probe=1` 顺带探活）、`PUT` 写两项覆盖。
  写入走 `configEditor.edit` 写 profile patch（**不手改** `cordis.patch.yml`），
  校验回环地址、拒绝跨站写、`configEditor` 缺失时如实 501。
- **`lib/settings.js`**：两项设置的纯校验与归一（config > env > 默认，并报来源）。
- **`MOFANG_TIMEOUT_MS`** 环境变量；`baseUrlOf` 支持显式覆盖（设置页校重复用它，只有一处回环判定）。
- **health 扩充**：`connection`（生效值 + 来源）、`settings`（能不能写）、`client`（设置页进模块表没）、
  `routes.conflicts`、`checkedAt`。
- **包元数据**：`locale/{zh,en}.json`（标题/描述）、`icon.svg`、`dsh.client`、`./client` 与 `./icon` 导出。
- **`test/counter-proof.mjs`**：把 4 条修复逐条改回坏版本，确认测试真会红再还原 —— 判据不是摆设。

## 0.1.0 —— 2026-11-17

首个可用版本（离线 30/30，对真墨坊 2/2；**未在真机 DSH 里装过**）。

- `lib/http.js`：只连回环的墨坊 HTTP 客户端；连不上/超时/403 一律结构化返回，不抛。
- `lib/tools.js`：5 个工具 —— `mofang_status` / `mofang_chapter` / `mofang_paragraph_preview`
  / `mofang_paragraph_pending` / `mofang_paragraph_drop`。**没有"采用"**。
- `lib/prompt.js`：静态规则段（改稿纪律）+ 一行现状。
- `lib/health.js` + 路由 `/mofang/health.json`：规则段/工具/路由注册状态 + 墨坊连通性。
- 判据见 `AGENTS.md` §1；离线用例在 `test/`。
