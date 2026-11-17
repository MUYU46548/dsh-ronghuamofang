# CHANGELOG

## 0.1.0 —— 2026-11-17

首个可用版本（离线 30/30，对真墨坊 2/2；**未在真机 DSH 里装过**）。

- `lib/http.js`：只连回环的墨坊 HTTP 客户端；连不上/超时/403 一律结构化返回，不抛。
- `lib/tools.js`：5 个工具 —— `mofang_status` / `mofang_chapter` / `mofang_paragraph_preview`
  / `mofang_paragraph_pending` / `mofang_paragraph_drop`。**没有"采用"**。
- `lib/prompt.js`：静态规则段（改稿纪律）+ 一行现状。
- `lib/health.js` + 路由 `/mofang/health.json`：规则段/工具/路由注册状态 + 墨坊连通性。
- 判据见 `AGENTS.md` §1；离线用例在 `test/`。
