# CHANGELOG

## 0.4.0 —— 2026-11-26（首次发布名为 `dsh-ronghuamofang`）

> **包名**：npm 以“与 `dsh-novel-forge` 太像”拒绝了 `dsh-novelforge`（E403）。按作者 2026-11-26
> 的裁决改成 `dsh-ronghuamofang` 后首次发布 0.4.0。`PLUGIN_NAME`、`cordis.patch.yml`、
> 两个 profile 的依赖/bundles、自证账本目录（`~/.dsh/dsh-ronghuamofang/`）同步改名；
> 本地目录与 GitHub 仓库暂仍叫 `dsh-novelforge`，仓库改名后续单独做。

会话级自证（proof）：回答“模型到底有没有先查判据、再出候选”——**只记录，不改模型行为**。
判据 70 条离线 + 9 条反证。

### 加

- **`lib/proof.js`**：订阅 `session/event` 的 `tool/call`，把 `mofang_*` 的调用顺序记到
  `~/.dsh/dsh-ronghuamofang/tools.jsonl`（上限 500 行）。只记时间/会话/轮次/工具名/序号；
  **不记参数**（`feedback` 里可能有正文或私事）。
- **`health.proof`**：`rows`、`turns.total`、`turns.chapterBeforePreview`、
  `turns.previewWithoutChapter`、`lastTurn.tools`。同轮里 `mofang_chapter` 在
  `mofang_paragraph_preview` 之前才算“先查后改”；先 preview 后 chapter 或没查，记成
  `previewWithoutChapter`，不装绿。
- **`compat` 增第七项 `session/event`**：真调一次 `root.on` 再注销；宿主不给这个能力时
  health 会红，不把“收不到事件”说成正常。

### 没做（用户 2026-11-26 答 S2=A）

- 挂件/浮层不做：纯状态挂件与状态行重复；有行动价值的“待采用提醒”要先等墨坊加
  “列出全部待采用候选”的端点。

## 0.3.0 —— 2026-11-26

这一版只做连接件的三件事：**错误不再说谎、版本错位能被看见、客户端跟随 fallback**。
判据 64 条离线 + 8 条反证（`test/counter-proof.mjs`）。

### 修

- **`mofang_paragraph_pending` 把读失败说成“没有候选”**：HTTP 400/500 时 value 里
  `note` 带着原因，render 却直接回“没有待采用候选”（note 被丢掉）。模型会据此重出候选。
  现在 `error` 字段进 render，并明说“这不等于没有候选”；错误分支不再带“没连上”的 hint。
- **`mofang_chapter` 部分失败装 0**：`/chapters/annotations` 或 `/review/structure` 回 500 时，
  render 是“未收口批注 0 条”、没有指标、error 空 —— 正是“0 条批注”的谎。
  现在 `annotations_error` / `metrics_error` 如实进 value 与 render。

### 加

- **`lib/compat.js`**：宿主能力三态（webServer / systemPrompt / tools / configEditor /
  clientModules / effect），结论进 `health.compat`。照 dsh-fangcun 的口径：判据是运行时
  真实形状，不比版本号；**只提醒、不退出**。
- **墨坊契约探针**：`probe()` 顺带读 `Server: NovelForgeAPI/x` 与 `/state` 形状，
  结论进 `health.mofang.api`；`/state` 缺 stages / chapter_target_words / budget 时给 warnings。
- **设置页版本区**：显示插件版本、墨坊 API（Server 头）、宿主自检 summary 与 warnings；
  health 主路径被占时跟到 `/mofang/api/health.json`。
- **兼容登记**：`dsh.compatibility.dshReleases` 补 `0.2.2-rc.5: compatible`（本机 health 全绿；
  preview/pending 尚未实跑，所以不写 verified）。

### 没动

- 墨坊本体。`GET /chapters/paragraph/pending` 在真机上恒 400（`int(parse_qs list)`），
  那是墨坊的 bug，插件改不了；本版只保证**失败时如实说**。

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
