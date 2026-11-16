# 架构决策记录（ADR）

每条决策写明它回应的约束、被否决的替代方案，以及「什么情况下该决策被推翻」。

## ADR-01 — Bot 是用 `sessionController.create` 创建的普通会话

**决策**：项目成员是 `project_bots` 表中的一行，持有 `session_id`。会话通过
`ctx.sessionController.create({ cwd, agentPreset })` 创建，即官方「为一个新对话创建一个普通 Session」的操作。

**理由**：产品核心主张是成员彼此平等。subagent 由 Subagent 运行时创建，带 `origin: 'subagent'` 与
`parentSessionId`；M0 探针显式断言 `parentSessionId === null && origin === null`，因此「误用子代理」是可检测的，
而不是靠自觉。

**否决**：原生 Agent Teams（子代理树 + 共享 checkout，既不满足独立历史也不满足独立权限）；fork 开发者会话当评审
（会把开发上下文带进评审）。

**推翻条件**：未来 DSH 取消 `sessionController.create` 或要求普通会话必须有父会话。届时 M1 降级为
「绑定已有独立 Session」（`team.rebind`），并把 Bot 标 `NEEDS_REBIND` 等人工处理。

## ADR-02 — 只有一条投递路径：`sessionController.prompt`

**决策**：所有消息与角色说明都用 `sessionController.prompt({ requestId, sessionId, mode, content })` 投递。
活动 Agent 路径（`agents.get(id).followup/steer/inbox.append`）只用于读取 `status`。

**理由**：一条路径意味着冷/热会话不会行为分叉；控制器自身的策略（「显式恢复会话后提交 prompt」）就是离线投递的安全保证。
`requestId` 是随已接受输入持久化的幂等标识。

**否决**：热会话直接塞 inbox + 冷会话另走恢复，两套行为、两套测试、两种失败模式。

**推论**：`已投递` 只表示宿主接受了输入；`已处理` 只在接收方通过 `pt_message_ack` 确认时记录。

## ADR-03 — Host↔Client 用 HTTP 前缀路由，不用生成的 Typert Remote

**决策**：前端在自身源上调用 `GET|POST /project-teams/api/<method>`；宿主注册一条前缀路由，逐个请求用
`ctx.connection.requestRejection` 围栏，返回 `{ ok, value }` / `{ ok, error }`。

**理由**：页面只能调用「由仓库 Typert 生成器写进 bundle」的 Remote 命名空间，而该生成器不在 Desktop 发行包内；
手写描述符属于未验证的内部接口，升版即碎。HTTP 前缀路由是 `dsh-host-webserver` 文档化的公开 seam，
本 profile 内的第三方 bundle 同样用它。

**推论（实测）**：桌面端默认拒绝普通浏览器请求（`403 Browser access is disabled`，发生在路由之前）。
这是安装设置而非插件能力，因此宿主行为用「宿主自己写出的证据文件」验证，交互面是页面内工作台。

## ADR-04 — 用 `node:sqlite`

**决策**：`lib/host/db.js` 用 `DatabaseSync` 打开 `$DSH_HOME/project-teams/project-teams.db`，WAL、
`foreign_keys = ON`、`schema_version` 迁移表。

**理由**：宿主是 Electron 44 / Node 24.21，内置 `node:sqlite`。没有原生模块、没有构建步骤、没有依赖 ——
这点很关键，因为 bundle 是被 `plugin_manager` 装进 profile 的，不是仓库构建产物。
真正重要的不变量写成 SQL 约束而不是约定：`UNIQUE(project_id, session_id)`（一个会话只属于一个项目）、
`UNIQUE(project_id, idempotency_key)`（消息去重）、部分唯一索引 `one_active_run`（一个任务一个活动租约）。

**否决**：`better-sqlite3`（插件安装路径里编原生模块）、JSON 文件（没有事务状态机）、外部数据库（与单机 P0 冲突）。

## ADR-05 — 纯状态机 + 事务化服务

**决策**：`state-machine.js` 是 `(state, action, actor)` 的纯 reducer，转移表显式；`service.js` 在一个 SQLite 事务里
执行带守卫的转移，同时写 `task_events` 与 `audit_events`。

**理由**：「非法转移」「角色不允许」必须是不依赖模型就能测试的判定；纯函数让转移表本身成为文档。

**推论**：所有变更都要 `expectedVersion`，冲突返回 `VERSION_CONFLICT`；原子认领写成
`UPDATE … WHERE id = ? AND version = ? AND status = 'READY'`，以 `changes === 1` 为唯一成功条件。

## ADR-06 — 每次运行一个 Git worktree，分支 `pt/<task>/<run>`

**决策**：`WorktreeManager` 在**仓库内** `<repo>/.project-teams/runs/<run>/worktree` 下创建 worktree，分支
`pt/<task>/<run>`，从记录的 `base_commit` 切出；git 一律 `execFile('git', args)`。该目录写入仓库的
`.git/info/exclude`，因此不会污染用户的工作区状态或 `.gitignore`。

**理由**：并行开发者不能共享可写 checkout；提交必须能从 `base..head` 复现。参数数组消除 shell 元字符风险；
`containPath` 拒绝越出受管根目录的路径；`safeSegment` 拒绝路径穿越与 Windows 设备名。

**推论**：取消任务只撤销租约并保留工作树与分支（未提交的工作仍可检查）；绝不自动合并到主分支。

**为什么必须在仓库内**：第一次真人授权的真实运行暴露了设计缺陷 —— 工作树原先放在 `$DSH_HOME` 下，
落在 Bot 会话的文件沙箱（作用域 = 其工作目录 = 仓库）之外，Bot 的写文件请求被拒绝，任务卡在等待用户批准的
网关提示上。改为仓库内路径后同一任务立即顺利完成。回归测试：`tests/integration/engine.test.js`
的「sandbox regression」用例断言工作树位于仓库内且 `.git/info/exclude` 含该目录。

## ADR-07 — 门禁只消费证据，不消费主张

**决策**：`evaluateGate` 组合四类证据：绑定当前 `head_commit` 的工件、同一 commit 的机器验证行、同一 commit 的最新评审、
按风险要求的 Owner 批准。输出 `PASS | FAIL | NEEDS_HUMAN | INCOMPLETE | STALE`。

**理由**：Bot 说「测试通过」必须无法满足门禁；绑定到别的 commit 的证据同样不能。`STALE` 优先于 `FAIL`，
这样人看到的是真实原因（有新提交）而不是令人困惑的失败。

**否决**：让评审的 `APPROVE` 直接把任务完成（带 blocker 的 APPROVE 会被判为自相矛盾并拒绝；缺少机器证据则是 `INCOMPLETE`）。

## ADR-08 — 盲审上下文由引擎构建

**决策**：`requestReview` 用任务行、工件 diff、验证行拼出评审输入并作为消息投递；不包含开发者的对话历史与自评，
评审者通过 `pt_review` → `context` 读到同一份上下文。

**理由**：评审者不能被作者带节奏。diff 仍然是不可信输入（提示词里如此声明），门禁也不依赖评审者对它的好恶。

**推论**：`reviews.context` 落库，评审看到的内容可审计；评审被绑定到 `(artifact_id, base_commit, head_commit)`。

## ADR-09 — 工作台只读宿主状态，页面不持有权威

**决策**：Client 注册 `sidebar.panellist` 行与同 id 的 keyed `main` 面板，只渲染宿主 API 返回的数据；
每个写操作都是宿主方法，重新做一次授权。

**理由**：隐藏按钮不是权限系统。同时「批准」只走 Owner 的 HTTP 路径 —— 工具层从不暴露
`decideTaskApproval` / `decideChange`，所以模型即使被要求也无法批准。

## ADR-10 — 依赖缺失时降级，不拖垮 profile

**决策**：可选服务用 `ctx.get(name, false)` 读取；`node:sqlite` 不可用时仍挂载状态面并记录降级，而不是让整行激活失败。

**理由**：一个插件激活失败会连带影响无关的行。只读状态面能让人看到「为什么引擎不可用」。

## ADR-11 — Owner 也能在对话里驱动项目（`pt_owner`）

**决策**：为非 Bot 会话注册 `pt_owner` 工具（setup / task_create / task_submit / task_assign / wake / view / gate），
只拥有**非授权类**能力；批准、暂停、归档、改策略仍然只能在决策页完成。

**理由**：UI 与模型工具应当共享同一个业务 Service（规格 §9）；而「授权」类动作保持仅人类可达，避免模型自批。
`wake` 只是把一条指令投递进某个 Bot 会话（等价于 UI 的「对该 Bot 说句话」），它不产生任何正式状态变更。
