# Project Teams for DSH（项目团队）

[中文](#中文) · **English summary:** a DeepSeek Harness (DSH) plugin that turns a project into a team of
**long-lived, mutually independent DSH Sessions** — PM, Developer, Reviewer, QA. Members talk to each other
directly but are not subagents of any Agent; a deterministic Host engine (SQLite + pure state machine)
owns tasks, dependencies, leases, message delivery, git-worktree isolation, blind review and the
verification gate. A Bot can never approve its own work: machine evidence and a human owner decide.
Installed bundle, MIT licensed. Docs are in Chinese; see `docs/test-report.md` for the real end-to-end run.

一个项目一组**长期存在、彼此独立的 DSH Session**：PM、开发者（Developer）、评审（Reviewer）、QA。
Bot 之间直接沟通，而所有正式状态变更由 Host 侧确定性引擎掌握。

- **独立会话，不是子代理。** 每个 Bot 都是通过 `sessionController.create` 创建的普通 Session，
  有自己的 Agent 预设与角色说明；没有任何 Bot 是别的 Agent 的子代理，也不继承别人的对话历史。
- **确定性协调。** 任务、依赖、认领、租约、预算与审批都在代码里执行（SQLite 事务 + 纯状态机）。
  模型文字无法改变任务状态、授予权限或完成评审。
- **隔离的工程执行。** 每个写入型任务运行在自己的 `git worktree` + 分支里（位于仓库内
  `<仓库>/.project-teams/runs/<run>/worktree`，因此 Bot 的沙箱允许写入），commit、diff、命令日志都作为
  可追溯工件保存。
- **独立评审与真实门禁。** 评审者在自己的会话里拿到「盲审上下文」（需求、验收标准、diff、机器证据）；
  build/test/扫描证据来自真实命令退出码；出现新 commit 时旧评审与旧证据立刻失效；高风险工作需要 Owner
  针对确切 commit 的显式批准。
- **工作台，而不是聊天记录。** 项目、团队、任务、消息、交付、决策、设置七个视图，全部渲染宿主状态。

## 安装

```sh
# 在 profile shell 中，用本目录的绝对路径
dsh plugin --profile <profile> add /绝对路径/project-teams
```

或在 Harness 内：**插件 → 添加插件 → 本地目录**，选中本目录。
详细步骤与自检见 [`docs/installation.md`](docs/installation.md)，运维/备份/回滚见 [`docs/runbook.md`](docs/runbook.md)。

## 使用

1. 左侧栏打开 **项目团队**（或 设置 → 插件 → 项目团队）。
2. **项目** → 选一个本地 Git 仓库新建项目（仓库至少有一个 commit），粘贴策略检查，例如：

   ```json
   [
     { "type": "build", "command": "node --check src/app.js", "required": true },
     { "type": "test",  "command": "node --test test/signup.test.js", "required": true }
   ]
   ```

3. **团队** → *生成 4 个 Bot*。宿主创建四个独立 Session 并完成绑定。
4. **任务** → 写清标题、描述与验收标准，提交后分配给开发者 Bot。
5. 开发者在自己的会话里：`pt_task` → `claim`，`pt_task` → `start`（拿到隔离工作树），在工作树内改代码，
   `pt_task` → `submit_artifact` 提交工件，`pt_verify_run` 跑检查，`pt_review` → `request` 请求评审。
   评审者用 `pt_review` → `context` 读盲审上下文，再用 `pt_review` → `submit` 给结论。
6. **交付** 页看工件、机器证据与评审；**决策** 页只有你能批准高风险版本、合并或预算超限。

`scripts/demo-repo.mjs` 会生成一个可丢弃的示例仓库（含 build 检查与 3 个测试），几分钟就能跑完整流程。

## 环境要求

- DSH Desktop `0.2.2-rc.3`（Node 24 运行时 —— 插件使用内置 `node:sqlite`）。
- `git` 在 `PATH` 中。
- profile 组合了 `webServer`、`connection`、`sessionController`、`sessions`、`agents`、`tools`、`systemPrompt`
  （Desktop 的 `base` + `web-app` 已包含）。

## 这个插件不做什么

- 不做多人 RBAC、云端沙箱、远程 CI / PR 集成（P2 范围）。
- 工作树隔离只防写入冲突，**不是**操作系统安全边界。
- 评审结论永不替代机器证据；任何 Bot 都无法批准自己的工作。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) | 用到的每个 DSH 接口与现场证据（M0） |
| [`docs/architecture-decisions.md`](docs/architecture-decisions.md) | 为什么是独立会话、HTTP API、SQLite、worktree、盲审 |
| [`docs/api-contracts.md`](docs/api-contracts.md) | 宿主 API、工具契约、权限矩阵 |
| [`docs/task-state-machine.md`](docs/task-state-machine.md) | 任务/运行状态表、守卫、门禁规则 |
| [`docs/threat-model.md`](docs/threat-model.md) | 威胁与代码级缓解 |
| [`docs/test-report.md`](docs/test-report.md) | 测试命令、结果、AT 对照、真实端到端记录 |
| [`docs/installation.md`](docs/installation.md) | 安装、自检、升级 |
| [`docs/runbook.md`](docs/runbook.md) | 运维、恢复、备份、回滚 |

## 测试

```sh
npm test            # 47 个测试：单元 + 集成 + 安全
npm run test:unit
npm run test:integration
npm run test:security
```

集成测试使用真实 SQLite 与真实 `git worktree`（临时仓库），只把 DSH 会话边界替换为假实现 ——
真实边界由运行中宿主内的 M0 探针与一次真实多 Agent 端到端运行覆盖。
