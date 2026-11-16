# 任务状态机、守卫与门禁

权威实现：`lib/host/state-machine.js`（纯 reducer）+ `lib/host/service.js`（守卫与事务）。
一次转移只有在**全部**条件成立时才会落库：动作存在、当前状态在允许列表、角色在允许列表、版本匹配、
动作专属守卫通过、任务不是终态。

## 任务状态

```text
DRAFT ──submit──▶ READY ──assign/claim──▶ ASSIGNED ──start──▶ RUNNING ──submit_review──▶ IN_REVIEW
                    │                        │                    │                          │
                    │                        └──block──▶ BLOCKED ◀─┘                    verify│
                    │                                     │                                 ▼
                    │                                  unblock                          VERIFIED
                    │                                     │                                 │
                    └──cancel──▶ CANCELLED ◀──────────────┴───────────────┐         complete│
                                                                           │                 ▼
   IN_REVIEW ──reject──▶ REWORK ──rework_ready──▶ READY                     │               DONE
   RUNNING  ──recover──▶ BLOCKED（租约丢失，需人工决定）
```

| 动作 | 从 | 到 | 允许角色 | 守卫 |
| --- | --- | --- | --- | --- |
| `submit` | DRAFT | READY | owner, pm, developer, qa | 至少一条验收标准；依赖插入时已做环检测 |
| `assign` | READY | ASSIGNED | owner, pm | 被分配者在同一项目；所有依赖 `DONE`；版本 |
| `claim` | READY | ASSIGNED | developer, qa, reviewer | 原子 `UPDATE … WHERE version = ? AND status='READY'`；依赖 `DONE`；角色需有可写通道 |
| `start` | ASSIGNED | RUNNING | developer, qa, owner, pm | 项目 `active`；并行运行预算；创建 worktree + 分支；schema 层「一任务一个活动租约」 |
| `block` | ASSIGNED, RUNNING | BLOCKED | 任一项目角色 | 必须给理由（写入 `blocked_reason` 与事件） |
| `unblock` | BLOCKED | ASSIGNED | owner, pm | — |
| `submit_review` | RUNNING | IN_REVIEW | developer, qa | 存在工件，且其 commit 等于 `tasks.head_commit` |
| `verify` | IN_REVIEW | VERIFIED | system, owner | `gate(task).status === 'PASS'` |
| `reject` | IN_REVIEW | REWORK | reviewer, owner, system | 评审返回「要求修改」时自动触发 |
| `rework_ready` | REWORK | READY | owner, pm | — |
| `complete` | VERIFIED | DONE | system, owner | `gate(task).status === 'PASS'`（含按风险的批准） |
| `cancel` | 任一非终态 | CANCELLED | owner, pm | 取消活动运行，工作树与分支保留 |
| `recover` | RUNNING | BLOCKED | system, owner | 由租约扫描发出，模型无法触发 |

终态：`DONE`、`CANCELLED`。终态任务拒绝除 `cancel` 之外的任何转移。

## 运行状态（独立轴）

| 状态 | 含义 | 进入方式 |
| --- | --- | --- |
| `active` | 持有租约，工作树打开 | `start` |
| `completed` | 工件已提交，运行关闭 | `submit_artifact` |
| `cancelled` | 任务取消；工作树与分支保留以便检查 | `cancel` |
| `paused` | 运行期间项目被暂停 | `projects.pause` |
| `recovery_required` | 租约过期；引擎拒绝自动重跑 | 租约扫描 |
| `failed` | 预留给执行器显式失败 | P1 |

租约 30 分钟，通过 `pt_run` 心跳延长。过期会把运行标为 `recovery_required`、阻塞任务并写审计 ——
引擎**绝不**自行重跑不可逆命令。

## 门禁

`evaluateGate`（`lib/host/verify.js`）：

1. 没有 `head_commit` → `INCOMPLETE`。
2. 当前 head 没有工件 → `INCOMPLETE`（完全没有工件）或 `STALE`（只有旧工件）。
3. 每个**必需**检查：以该 commit 的最新证据为准。`FAIL` → `FAIL`；缺失 → `INCOMPLETE`；只有别的 commit 的证据 → `STALE`。
4. 最新评审：没有评审 → `INCOMPLETE`；未出结论 → `INCOMPLETE`；绑定到别的 commit → `STALE`；
   `CHANGES_REQUESTED` → `FAIL`；`APPROVE` 却带 blocker/critical 问题项 → `FAIL`。
5. 风险 `high`（或策略 `requireApprovalForDone`）：必须有
   `(subject_type='task', subject_id, subject_revision = head)` 的 `APPROVE` 审批，否则 `NEEDS_HUMAN`
   （Owner 拒绝则为 `FAIL`）。
6. 优先级：`STALE` > `FAIL` > `NEEDS_HUMAN` > `INCOMPLETE` > `PASS`。

评审必要但不充分；在策略要求人工时，机器证据同样不充分。

## 自动推进

`advanceFromEvidence(taskId)` 在评审出结论、验证结束、审批落库后触发。它最多自动走两步
（`IN_REVIEW → VERIFIED → DONE`），每一步都重新读取任务与门禁，遇到第一次拒绝即停止。
评审「要求修改」则把任务转 `REWORK`。任何一步都无法由 Bot 消息触发。

## 任务编辑

`updateTask` 只允许在 `DRAFT` / `READY` / `REWORK` / `BLOCKED` 改标题、描述、验收标准、优先级、风险与写入范围，
角色限 Owner/PM，需要 `expectedVersion`，并写一条 `edit` 事件与审计。一旦开始执行（`RUNNING` 及之后）就拒绝编辑：
验收标准是评审与门禁判定所依据的合约，事后修改等于静默绕过评审。

## 版本与幂等

- `tasks.version` 每次变更递增；调用方传 `expectedVersion`，不匹配返回 `VERSION_CONFLICT`（HTTP 409）。
- `claim` 是一条条件 `UPDATE`，只有 `changes === 1` 算成功。
- 消息插入以 `(project_id, idempotency_key)` 唯一；重复键返回原行并写 `deduplicated` 审计。
- 投递用 `QUEUED → CLAIMED → DELIVERED`，领取也是条件 `UPDATE`，因此两次 tick 不会重复投递。

## 写入范围

任务的 `write_scope`（逗号分隔路径前缀）在提交工件时被检查：落在范围外的文件写入
`artifacts.summary.outOfScope`，并生成一条 `attention` 决策，提示 Owner 注意范围扩张。
P0 只提示不阻断；是否阻断由策略决定（P1）。

## 合并执行（P1，规格 §6.3）

Bot 只能 `propose` 一个 `merge` 提案；Owner 在决策收件箱批准后，还有一个**独立的执行步骤**
（`decisions.executeMerge` / `pt_owner execute_merge`），执行时逐项重验、绝不复用旧报告：

1. 变更单必须是 `APPROVED`（`PENDING` 拒绝执行；执行器自己不做任何批准）；
2. 任务门禁对当前 head 仍为 `PASS`；
3. 仓库必须位于目标分支（默认 `projects.default_branch`）、工作区干净；
4. 目标分支必须仍停在评审时的 base commit —— 否则报 `merge/base-moved`，要求重新检查并重新审批；
5. 用 `git merge --no-ff` 生成可见的集成点；冲突则 `git merge --abort` 并报 `merge/conflict`，仓库保持不变；
6. 成功后变更单转 `EXECUTED`，写审计与任务事件 `merge`；重复调用返回「已合并」，不会二次合并。
