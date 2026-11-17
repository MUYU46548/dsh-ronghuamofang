# dsh-novelforge

绒花墨坊（NovelForge）× DSH 的薄插件：让 DSH 会话**看得见判据、出得了候选**，**采用仍归作者**。

## 它解决什么

没有插件时，DSH 会话里只有一个"能调模型的壳"——模型不知道墨坊在、不知道这一章有几段、
哪几段被批注、六项结构指标哪一项越线，于是只能凭感觉整章重写。
这和"纯 MCP"没区别：工具在那儿，但没人告诉它什么时候该用、用了之后算不算数。

装上这个插件后：

- **规则段进系统提示词**：改稿前先查判据、只算不落、采用归作者（静态段，不破提示词缓存）
- **5 个工具**：`mofang_status` / `mofang_chapter` / `mofang_paragraph_preview` /
  `mofang_paragraph_pending` / `mofang_paragraph_drop`
- **一行现状**：`绒花墨坊 · 已连接 · 《书名》 · 第 3 阶段 · 未收口批注 2 条`
- **`/mofang/health.json`**：插件自证（规则段/工具/路由注册没、墨坊连没连）

## 明确不做

- **没有"采用"工具**：采用候选会把候选写进正文，那是作者的签字动作；
  墨坊的 `/chapters/paragraph/apply` 要求 GUI 双因子，Agent 调必然 403。
- 不改墨坊代码、不读墨坊数据文件：只走 `127.0.0.1:8765` 的本机 HTTP（非回环直接拒绝）。
- 不推挂件/浮层（还没做；见 AGENTS.md 的"未做"一节）。

## 安装（开发态）

```powershell
# 1. 起墨坊服务（桌面端打开即可，或命令行）
python scripts/nf_api.py --port 8765

# 2. 把插件挂进 DSH profile（改完代码要重启 DSH 才生效）
dsh plugin --profile desktop add link:E:\CODE\CangKu\dsh-novelforge

# 3. 验证：看 health（把 <端口> 换成 DSH 的实际端口）
curl.exe http://127.0.0.1:<端口>/mofang/health.json
```

`health.json` 里该看到 `prompt.rules: true`、`tools.names` 有 5 个、`mofang.reachable: true`。
哪一项是 false，`error` 字段会说原因 —— 不用猜"装了怎么没反应"。

## 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `MOFANG_API` | `http://127.0.0.1:8765` | 墨坊服务基址；**只接受回环地址** |

## 开发

```powershell
npm test                               # 30 条离线用例（假宿主 + 假 HTTP），不需要 DSH
$env:MOFANG_API='http://127.0.0.1:18765'; npm test   # 额外跑真机冒烟（要真墨坊）
```

真机冒烟怎么起墨坊：`python scripts/nf_api.py --port 18765 --allow-fake`
（`--allow-fake` 只影响模型调用，本插件的读接口不受影响）。

## 边界与已知限制

- DSH 仍是 `0.2.2-rc`：插件 API 与宿主形态都会变。`engines.dsh` **只写下限不写上界**
  （写上界会让升级后插件静默消失），运行期自检结果进 `health`。
- 契约版本 `CONTRACT_VERSION = 1`：墨坊改了这几个端点的字段/语义就 +1。
- 未在真机 DSH 里装过（本次只做到离线 30/30 + 对真墨坊 2/2）。装的时候看 `health.json`。
