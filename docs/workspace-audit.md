# U0 — 现有系统审计（Project Teams v1.1 工作台升级）

审计对象：本仓库中已安装并运行于 DSH Desktop 的 Project Teams 插件（package `1.9.0`，产品里程碑 v1.1）。
基线：`v1.8.0`（`53f40bf`），工作区干净。本文档在 v1.1 升级前编写，随实现同步更新。

> 说明：目录曾在本轮开发中被外部清空（含 `.git`），已从 GitHub 恢复到 `v1.8.0` 并重新落地未推送的改动；
> 本文档在恢复后重新补入仓库。

## 1. Host / Client / 入口 / 存储

| 层 | 现状（复用，不重建） |
| --- | --- |
| Host 入口 | `index.js` → `lib/host/index.js#applyHost`；`inject = [webServer, connection, sessionController, sessions, agents, tools, systemPrompt]` |
| 业务服务 | `lib/host/service.js` 单一实现（70+ 方法）；路由与模型工具都调用它，没有第二套任务/消息/会话系统 |
| HTTP API | `lib/host/routes.js` 43 条（`projects/team/tasks/messages/delivery/decisions/activity/timeline/canvas/budgets/templates/m0/status`） |
| Client | `client.js`，`window.__ModuleLoader__.load({ id: 'dsh-project-teams', factory(require) })`，只依赖模块表里的 `react` |
| 入口注册 | `sidebar.panellist`（主导航图标行）+ keyed `main`（面板体）+ 插件行/详情页/设置页复用 |
| 存储 | SQLite（`node:sqlite`），schema v4；项目/Bot(Session)/任务/运行/消息/工件/评审/检查/变更/审批/审计/预算/模板/画布布局 |
| 会话 | `SessionAdapter` 走 `sessionController`；每个 Bot 是**独立 DSH Session**，不是任何代理的子代理 |

## 2. U1–U6 复用与增量清单

| 阶段 | 复用（不改） | 增量 |
| --- | --- | --- |
| U1 工作台 | 入口 slot、11 个既有面板、全部既有路由 | 工作台壳（左栏/顶栏/主区/右 Inspector/底部时间线）、五主视图 + 「更多」分组 |
| U2 画布 | `team.list`、`projects.*` | 迁移 **v4**（`canvas_nodes` / `canvas_views`）、`canvas.get` / `canvas.save`、零依赖画布组件 |
| U3 连线 | `messages`、`task_events`、`timeline.get` | 只读投影 `canvas.edges`（协作/通信/交接三类）、`messages.list` 的 `between`/`threadId` 过滤 |
| U4 Inspector | `tasks.get`、`delivery.list`、`messages.list`、`bot.wake` | 右侧详情面板 + `team.wake` 路由（Bot 发消息） |
| U5 精修 | 既有样式对象 | `TOKENS`、正交连线、窄窗堆叠、加载/空态、首次自动适配 |
| U6 回归 | 既有 66 项测试、安装/迁移脚本 | 画布与迁移测试（共 69 项）、`verify:restart` 复核、文档与截图、v1.9.0 |

## 3. UI 差距（升级前）

1. 没有统一工作台，需在多个标签页之间切换；没有「一个项目=一个团队」的主视图。
2. 没有画布：Bot 只有表格形态，看不到拓扑、协作与消息走向。
3. 右侧没有常驻 Inspector；Bot 细节分散在团队页与任务页。
4. 时间线是独立标签页，不在主视图常驻。
5. 状态色/字体层级/空状态分散，无统一 token。

## 4. 兼容性与技术风险

| 风险 | 结论 / 应对 |
| --- | --- |
| **React Flow 不可用** | DSH 安装包与 profile 中都没有 `@xyflow/react`/`reactflow`；Client 模块 `require` 只能解析模块表（react 等），不能加载 npm 包或 URL。**决定**：自研零依赖画布（DOM 节点 + SVG 连线），交互对齐常见画布行为 |
| 布局持久化 | 迁移 v4 只新增表，旧版本插件忽略即可；用真实库副本验证 v3→v4 数据不变 |
| 画布假连线 | 边全部由 `messages`（真实收发方/时间/类型）与 `task_events`（assign/交接）计算；无数据即无连线 |
| 打开原生会话 | DSH 未向插件暴露「跳转到某 Session」的公开 API；提供「复制 Session id」+ Inspector 详情，不伪造跳转 |
| 性能 | `canvas.get` 一次返回节点+边+视口；消息按 Bot 对做 SQL 聚合 |
| 主题 | **不做深色模式（业主决定）**；只保证浅色主题，组件使用 `--dsw-*` 变量与中性 fallback，不 monkeypatch DOM |
| 回滚 | 代码：`git checkout v1.8.0` 后重装 bundle；数据：v4 只增表，旧代码忽略；`~/.dsh/project-teams/project-teams.db` 不动既有列 |

## 5. 基线测试

```
$ npm test          # v1.8.0 基线：66 / 66
```

升级结束时为 **69 / 69**，且 `npm run verify:restart` 通过（两进程重启 + 卸载残留）。
