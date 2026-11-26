# dsh-novelforge

绒花墨坊（NovelForge）× DSH 的薄插件：让 DSH 会话**看得见判据、出得了候选**，**采用仍归作者**。
在 DSH 设置里可以直接改墨坊地址与请求超时，不用碰环境变量。

## 它解决什么

没有插件时，DSH 会话里只有一个"能调模型的壳"——模型不知道墨坊在、不知道这一章有几段、
哪几段被批注、六项结构指标哪一项越线，于是只能凭感觉整章重写。
这和"纯 MCP"没区别：工具在那儿，但没人告诉它什么时候该用、用了之后算不算数。

装上这个插件后：

- **规则段进系统提示词**：改稿前先查判据、只算不落、采用归作者（静态段，不破提示词缓存）
- **5 个工具**：`mofang_status` / `mofang_chapter` / `mofang_paragraph_preview` /
  `mofang_paragraph_pending` / `mofang_paragraph_drop`
- **一行现状**：`绒花墨坊 · 已连接 · 《书名》 · 第 3 阶段 · 未收口批注 2 条`
- **设置页**：DSH 设置 →「绒花墨坊」——看状态、改地址、改超时、点「测试连接」
- **会话级自证**：订阅 `session/event`，把 `mofang_*` 调用顺序记到
  `~/.dsh/dsh-novelforge/tools.jsonl`（只记工具名，不记参数）；`health.proof` 直接出
  “先查判据再出候选”的数
- **`/mofang/health.json`**：插件自证（规则段/工具/路由/设置页注册没、墨坊连没连、连接参数从哪来）
  - 还报**宿主能力三态**（`compat`：webServer / systemPrompt / tools / configEditor / clientModules / effect）
  - 以及**墨坊契约线索**（`mofang.api`：`Server` 头 + `/state` 形状；墨坊 body 里没有 API 版本）

## 明确不做

- **没有"采用"工具**：采用候选会把候选写进正文，那是作者的签字动作；
  墨坊的 `/chapters/paragraph/apply` 要求 GUI 双因子，Agent 调必然 403。
- 不改墨坊代码、不读墨坊数据文件：只走 `127.0.0.1:8765` 的本机 HTTP（非回环直接拒绝）。
- 不推挂件/浮层（还没做；见 AGENTS.md 的"未做"一节）。

## 安装

在 DSH 的 **插件** 页里安装本地目录 `E:\CODE\CangKu\dsh-novelforge`，或（开发态）：

```powershell
# 1. 起墨坊服务（桌面端打开即可，或命令行）
python scripts/nf_api.py --port 8765

# 2. 把插件挂进 DSH profile
dsh plugin --profile desktop add link:E:\CODE\CangKu\dsh-novelforge
```

## 设置

DSH 设置 →「绒花墨坊」：

| 字段 | 留空时 | 说明 |
|---|---|---|
| 墨坊地址 | `http://127.0.0.1:8765` | **只接受回环**（`127.0.0.1` / `localhost` / `[::1]`）——书稿不出这台机器 |
| 超时（毫秒） | `15000` | 单次请求上限，范围 `1000`–`120000` |

保存后写进 DSH profile 的那一行配置，插件重启一次生效。**「恢复默认」= 清空两项**，
回到下面的环境变量 / 内置默认值。

## 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `MOFANG_API` | `http://127.0.0.1:8765` | 墨坊服务基址；**只接受回环地址**。被设置页覆盖 |
| `MOFANG_TIMEOUT_MS` | `15000` | 单次请求超时。被设置页覆盖 |

优先级：**设置页 > 环境变量 > 内置默认**。`health.connection` 会写明当前值来自哪一层
（`baseUrlSource` / `timeoutMsSource`）——排查"我设了 8766 怎么还连 8765"时看这个。

## 验证

```powershell
curl.exe http://127.0.0.1:<端口>/mofang/health.json
```

该看到 `prompt.rules: true`、`tools.names` 有 5 个、`mofang.reachable: true`、
`settings.writable: true`、`client.available: true`，以及
`compat.summary` 是「全部 7 项宿主能力正常」、`mofang.api.server` 里带 `NovelForgeAPI/x`、
`proof.enabled: true`（跑过一轮后 `proof.turns` 会有数）。
哪一项是 false，`error` 字段会说原因 —— 不用猜"装了怎么没反应"。

> 若 `routes.conflicts` 里出现 `/mofang/health.json`，说明这个路径被上一代代码的残留注册占着
> （0.1.0 没留住 `web.register` 的清理函数）。此时健康检查自动退到 `/mofang/api/health.json`，
> **重启一次 DSH** 后残留消失，就回到原路径。

## 开发

```powershell
npm test                               # 70 条离线用例（假宿主 + 假 HTTP），不需要 DSH
node test/counter-proof.mjs            # 反证：把 9 条修复改回坏版本，确认测试真会红，然后还原
$env:MOFANG_API='http://127.0.0.1:18765'; npm test   # 额外跑真机冒烟（要真墨坊）
npm pack --dry-run                     # 验发布包内容
```

真机冒烟怎么起墨坊：`python scripts/nf_api.py --port 18765 --allow-fake`
（`--allow-fake` 只影响模型调用，本插件的读接口不受影响）。

改完代码要让它生效：这个 profile 开着 HMR，在插件页里把本 bundle 关掉再打开即可
（它会按磁盘比较替换 `link:` 包的代码）。**动了路由表就要重启 DSH**，否则旧代码的僵尸注册清不掉。

## 边界与已知限制

- DSH 仍是 `0.2.2-rc`：插件 API 与宿主形态都会变。`engines.dsh` **只写下限不写上界**
  （写上界会让升级后插件静默消失）；运行期自检结果进 `health.compat`（六项三态 + warnings）。
- **版本冲突只提醒、不自动修**：插件不比版本号，只报形状。墨坊 body 里没有 API 版本，
  `Server: NovelForgeAPI/x` 是唯一线索；`/state` 形状不对会进 `health.mofang.api.warnings`。
- 契约版本 `CONTRACT_VERSION = 1`：墨坊改了这几个端点的字段/语义就 +1（目前仅登记，没有对端可比）。
- **自证账本**只在 `~/.dsh/dsh-novelforge/tools.jsonl`：只记时间/会话/轮次/工具名/序号，
  不记参数与正文（`feedback` 里可能有书稿或私事），上限 500 行。
- 墨坊安装版（≤ 2026-11-25）的 `GET /chapters/paragraph/pending` 有解析 bug（恒 400），
  插件会如实报「候选读不出来」；修在墨坊侧，不在本插件。
- 段落清单**按窗口**给（默认 40 段、上限 80，`para_from` 可定位后半段）：
  第 1 章有 273 段，整表渲染一次就吃掉一截上下文预算。
- 未做：挂件/浮层（用户 2026-11-26 裁：纯状态挂件不做；“待采用提醒”要等墨坊 pending 列表端点）。
