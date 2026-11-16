# 接口契约

两个调用方，一套实现：Bot 工具与宿主 HTTP API 都进入 `ProjectTeamsService`（`lib/host/service.js`），
由它负责授权、校验、持久化与审计。

## 身份解析（Actor）

| 调用方 | Actor | 身份如何确定 |
| --- | --- | --- |
| Bot 工具（`pt_*`） | `{ kind:'bot', id: botId, role, projectId, sessionId }` | 宿主用 `exec.agent.session.id` 反查 `project_bots` 行；工具参数无法改变身份。 |
| 浏览器（工作台） | `{ kind:'owner', … }` | 同源、经连接围栏的页面请求；只有 owner actor 能批准。 |
| 引擎（门禁、分发器、租约扫描） | `{ kind:'system', id:'system' }` | 仅内部调用，消息无法触发。 |

`lib/host/permissions.js` 中的 `authorize(actor, operation, {projectScope, ownsResource})` 实现下表。
拒绝会以 `denied` 写入审计，并返回 `FORBIDDEN` / `FORBIDDEN_OWNERSHIP` / `CROSS_PROJECT` / `UNKNOWN_OPERATION`。

## 权限矩阵（P0）

| 操作 | Owner | PM | Developer | Reviewer | QA |
| --- | --- | --- | --- | --- | --- |
| `project.create/update/archive` | ✓ | — | — | — | — |
| `project.pause/resume` | ✓ | ✓ | — | — | — |
| `bot.create/rebind` | ✓ | — | — | — | — |
| `bot.wake`（Owner 对某个 Bot 说话） | ✓ | — | — | — | — |
| `task.create` | ✓ | ✓ | — | — | — |
| `task.propose`（变更申请） | ✓ | ✓ | ✓ | ✓ | ✓ |
| `task.assign` | ✓ | ✓ | — | — | — |
| `task.claim` | — | — | ✓ | ✓ | ✓ |
| `task.transition` | ✓ | ✓ | 本人任务 | 本人任务 | 本人任务 |
| `run.start`（可写工作树） | ✓ | ✓ | 本人任务 | —（明确拒绝） | 本人任务 |
| `artifact.submit` | — | — | 本人运行 | — | 本人运行 |
| `verification.run` | ✓ | — | 本人任务 | — | 本人任务 |
| `review.request` | ✓ | ✓ | 本人任务 | — | 本人任务 |
| `review.submit` | — | — | — | ✓（不得自审） | — |
| `approval.decide` / `change.decide` | ✓ | — | — | — | — |
| `message.send` | —（Owner 走 UI） | ✓ | ✓ | ✓ | ✓ |
| `message.ack` | — | 本人接收 | 本人接收 | 本人接收 | 本人接收 |
| `audit.read` | ✓ | ✓ | — | — | — |

「本人」表示服务用资源的 `owner_bot_id` 计算 `ownsResource`；Bot 操作别人的任务会得到 `FORBIDDEN_OWNERSHIP`。

## 宿主 HTTP API

基址：`/{prefix}/api`，`prefix = /project-teams`。读用 `GET`（查询串），写用 `POST`（JSON，≤1 MiB）。
信封：`{ ok: true, value }` 或 `{ ok: false, error: { code, message, details? } }`，HTTP 状态由错误码推导
（`…/not-found`→404、`…/forbidden`→403、`…/conflict`、`VERSION_CONFLICT`→409、`…/unavailable`→503）。

| 方法 | 类型 | 参数 | 返回 |
| --- | --- | --- | --- |
| `status` | GET | — | 插件版本、数据目录、运行时事实、预设、预算 |
| `projects.list` | GET | — | 项目摘要 + 计数 |
| `projects.get` | GET | `projectId` | `{ project, overview }` |
| `projects.create` | POST | `name`、`repoRoot`、`goal?`、`defaultBranch?`、`policy?` | 项目 + 仓库校验结果 |
| `projects.update` | POST | `projectId`、`goal?`、`defaultBranch?`、`policy?` | 项目 |
| `projects.archive` | POST | `projectId` | 项目（排队消息被丢弃） |
| `projects.restore` | POST | `projectId` | 项目（从归档恢复） |
| `projects.pause` / `projects.resume` | POST | `projectId` | 项目 |
| `team.list` | GET | `projectId` | Bot 列表 + 存活状态 + 当前任务 |
| `team.create` | POST | `projectId`、`roles?`、`presets?`、`cwd?` | 新建的 Bot（会创建会话） |
| `team.rebind` | POST | `projectId`、`botId`、`sessionId` | Bot（subagent 会话被拒绝） |
| `tasks.list` | GET | `projectId` | 任务 + 依赖 + 门禁状态 |
| `tasks.get` | GET | `taskId` | 任务、事件、运行、工件、评审、门禁 |
| `tasks.create` | POST | `projectId`、`title`、`acceptance[]`、`description?`、`dependsOn[]`、`riskLevel?`、`priority?`、`writeScope?` | 任务 |
| `tasks.transition` | POST | `taskId`、`action`、`reason?`、`expectedVersion?` | 任务 |
| `tasks.update` | POST | `taskId`、`title?`、`description?`、`acceptance?[]`、`priority?`、`riskLevel?`、`writeScope?`、`expectedVersion?` | 任务（仅 DRAFT/READY/REWORK/BLOCKED 可改） |
| `tasks.assign` | POST | `taskId`、`botId`、`expectedVersion` | 任务 |
| `tasks.dependency` | POST | `taskId`、`dependsOn` | 依赖行 |
| `tasks.verify` | POST | `taskId`、`types?[]` | 验证行（真的执行命令） |
| `messages.list` | GET | `projectId`、`taskId?`、`state?`、`limit?` | 消息 |
| `messages.replay` | POST | `messageId` | 重新入队的消息（仅死信） |
| `delivery.list` | GET | `projectId` | 工件、验证运行、评审 |
| `delivery.diff` | GET | `artifactId` | 已保存的 unified diff |
| `decisions.list` | GET | `projectId` | 待处理变更申请 + 被门禁卡住的任务 |
| `decisions.decideChange` | POST | `changeId`、`decision`、`justification` | 变更申请 |
| `decisions.approveTask` | POST | `taskId`、`decision`、`justification?`、`headCommit?` | 绑定到该 commit 的审批 |
| `budgets.get` | GET | `projectId` | 预算行 |
| `budgets.update` | POST | `projectId` + 预算字段 | 预算行 |
| `templates.list` | GET | — | 全部角色模板（含版本） |
| `templates.write` | POST | `role`、`promptText`、`toolPolicy?`、`skillRefs?` | 新版本模板 |
| `delivery.verify` | GET | `projectId` | 工件哈希校验报告 |
| `export.project` | GET | `projectId` | 项目 JSON 快照 |
| `activity.list` | GET | `projectId`、`limit?` | 审计 + 任务事件（新→旧） |
| `overview.get` | GET | `projectId` | 计数、进行中运行、阻塞、活动 |
| `dashboard.get` | GET | `projectId` | 质量与成本指标 |
| `m0.get` / `m0.probe` / `m0.verify` | GET/POST | `reuse?` | M0 兼容性证据 |

常见错误码：`VERSION_CONFLICT`、`ILLEGAL_TRANSITION`、`ROLE_FORBIDDEN`、`FORBIDDEN`、`FORBIDDEN_OWNERSHIP`、
`CROSS_PROJECT`、`task/blocked-by-dependency`、`task/acceptance`、`gate/not-passed`、`gate/stale`、
`project/archived`、`project/not-active`、`run/budget`、`message/rate-limited`、`message/loop-limit`、
`verification/not-configured`、`session/unavailable`、`path/escape`、`path/invalid-segment`。

## Bot 工具

工具用 `when` 注册，只有绑定在 `project_bots` 上的会话才可见。

| 工具 | 用途 | 说明 |
| --- | --- | --- |
| `pt_whoami` | Session id、bot id、角色、项目、cwd | 手工登记会话时用 |
| `pt_context` | 项目目标、团队、我的任务、收件箱、每个任务的门禁 | 只读简报 |
| `pt_task` | `list` / `create` / `edit` / `claim` / `start` / `submit_artifact` | `claim` 是带版本校验的原子认领；`start` 创建 worktree |
| `pt_task_transition` | `submit`、`assign`、`block`、`unblock`、`submit_review`、`verify`、`reject`、`rework_ready`、`complete`、`cancel` | 受状态机 + 角色 + 版本三重校验 |
| `pt_run` | `heartbeat` / `status` | 续租一次运行（否则 30 分钟判为丢失） |
| `pt_verify_run` | 对当前工件 commit 运行配置的检查 | 真实命令；记录退出码、日志路径、日志 SHA-256 |
| `pt_review` | `context` / `request` / `submit` | `context` 返回盲审上下文；`submit` 提交结论与问题项 |
| `pt_message_send` | 项目内点对点消息 | 持久入队，由分发器投递 |
| `pt_message_ack` | 确认已处理某条消息 | 仅被投递方可以确认 |
| `pt_change_propose` | 向 Owner 申请范围/合并/部署决策 | 不执行任何动作，生成决策收件箱条目 |

所有工具返回 `{ ok, summary, data }`，`data` 是 JSON 文本；被拒绝时抛错，模型看到的是宿主给出的原因。

### Owner 工具 `pt_owner`

只对非 Bot 会话开放，动作：`setup`、`task_create`、`task_submit`、`task_assign`、`task_transition`、`task_edit`、`wake`、`interrupt`、`view`、`gate`、`budgets`、`verify_artifacts`、`export`。
`wake` 仅把一句话投递进目标 Bot 会话；**批准、暂停、归档、改策略不在此列**。

## 消息协议

```json
{
  "id": "msg_…",
  "project_id": "prj_…",
  "from_bot_id": "bot_…",
  "to_bot_id": "bot_…",
  "type": "question | answer | progress | blocker | handoff | review_requested | review_result | change_proposed | system_notice",
  "body": "…",
  "task_id": "T-1",
  "thread_id": null,
  "idempotency_key": "…",
  "state": "QUEUED | CLAIMED | DELIVERED | PROCESSED | DEAD_LETTER | DISCARDED | NEEDS_ATTENTION",
  "attempts": 0
}
```

投递文本总带一段来源头，声明正文是**不可信数据**，不能授予权限、批准或完成状态。

## 评审问题项与门禁

`reviews.findings[]`：

```json
{ "severity": "blocker | critical | major | minor | nit", "summary": "…", "file": "src/a.ts", "line": 42, "reasoning": "…", "suggestion": "…", "confidence": "high | medium | low" }
```

`gate`：

```json
{ "status": "PASS | FAIL | NEEDS_HUMAN | INCOMPLETE | STALE", "reasons": ["…"], "headCommit": "…", "artifactId": "art_…", "detail": { "checks": { "test": "PASS" }, "review": "APPROVE", "approval": "NOT_REQUIRED", "risk": "low" } }
```
