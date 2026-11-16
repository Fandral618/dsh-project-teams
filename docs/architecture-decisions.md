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

## ADR-12 — 工具定义不依赖宿主的私有辅助函数

**决策**：`lib/host/dsh-tools.js` 先尝试导入 `@deepseek-ai/dsh-tools` 的实现，导入失败时回退到
`lib/host/tool-def.js`（同契约的本地编译器：参数 DSL→JSON Schema、输出 schema 归一化、参数校验）。

**理由**：Desktop Host 能解析 `@deepseek-ai/*`（其模块图锚定安装目录），但 `dsh` CLI 启动一个 linked 插件目录时
会 `ERR_MODULE_NOT_FOUND` —— 这会挡住隔离 profile 的重启验证，也意味着插件只能在 Desktop 里跑。
回退实现让 bundle 在两种运行时都能激活；Desktop 行为不变。

**代价**：本地编译器必须与宿主契约保持一致；用 51 个测试 + 真实工具调用（`pt_owner`、`pt_context`）持续校验。

## ADR-13 — 角色模板是数据，不是代码

**决策**：`bot_templates(role, version, prompt_text, tool_policy)`；Bot 记录创建时的 `template_id/version`，
`briefFor()` 用它渲染。编辑模板产生新版本（`templates.write` → `upsertTemplate`），既有 Bot 不被静默改写。

**理由**：规格 §4.1 把模板列为 P0 表；把它放进数据库使「角色说明」可审计、可版本化、可在不改代码的情况下调整。

## ADR-14 — 令牌预算用宿主 token 计量，不估算

**决策**：通过 `ctx.tokenMeter.measure(session).totalTokens` 采样，run 记 `tokens_base`（启动基线）与
`tokens_used`（增量）；`per_run_token_limit` 在提交/验证处强制，`daily_token_limit` 在启动新 run 时强制。

**理由**：该服务是会话日志的确定性回放，不产生模型调用；估算（例如按字符数）会给出无法解释的数字。
不可用时明确记为 `usage_source: unavailable`，而不是编造 0。

## ADR-15 — 批准与执行是两步，执行前重验证

**决策**：`decideChange` 只记录审批；真正合并由 `executeMerge` 在**执行时**重新读取门禁、分支和工作区状态，
并要求目标分支仍等于评审时的 base commit。

**理由**：规格 §6.3 明确「合并前重验当前 commit 与 base 是否仍满足检查，不复用过期报告」。
把审批与执行分开，使「批准」不隐含「随时可合并」，也让执行可以重复调用而不会二次合并（幂等）。
执行器只接受 `APPROVED` 的变更单，模型无法用执行端点绕过审批。

## ADR-16 — 双审与"交叉模型"用策略 + 预设表达

**决策**：`projects.policy.reviewCount` 决定需要几个独立 reviewer 的批准；`requestReview` 为每个 active reviewer 各建一份
评审（各自独立的只读 checkout）；门禁按 reviewer 去重后要求 N 个 APPROVE，任一拒绝即 FAIL。
「交叉模型」不引入新机制：额外 reviewer 用不同 Agent 预设创建（预设决定模型路由），例如 `reviewer#2` 用 `standard`。

**理由**：避免为"多模型"再造一套 provider 抽象；DSH 的模型选择本来就绑定在会话预设上，复用它是唯一不会漂移的做法。
独立 checkout 保证两个评审看到的是同一个 commit 的同一份快照，且各自改动会被树哈希发现。

## ADR-17 — 权限用能力集合，角色只是标签

**决策**：`permissions.js` 的操作表写成「需要哪个能力」，状态机的转移表也改成能力列表；内置角色映射到固定能力集，
自定义角色在角色模板 `tool_policy.capabilities` 里声明；未知角色默认只有 `message`。

**理由**：规格 §0.4 P1 要求自定义角色。若继续按角色字面量写 ACL，每加一个角色都要改矩阵、状态机、路由与测试，
必然漂移。能力集合把「加角色」变成「发一个模板」，默认拒绝保证拼写错误落在安全侧。

**代价**：错误信息从「角色不允许」变成「角色不允许（需要 x，持有 y）」，测试同步更新。

## ADR-18 — 项目模板是策略预设，不是脚手架

**决策**：迁移 v3 建 `project_templates`，内置 `web-node` / `python` / `minimal`；`createProject` 接受 `templateId`，
模板 policy 作为基线、显式字段覆盖；Owner 可发布自己的模板（`projectTemplates.write`）。

**理由**：新项目的失败大多来自「忘记配检查」。模板把常见策略固化成一次选择，同时保留覆盖能力；模板是数据，
所以发布模板不需要发版。

## ADR-19 — 频道是寻址方式，不是新表

**决策**：频道消息按成员**扇出**成多条 `messages` 行并共享 `thread_id`，
地址形式为 `all` / `role:<名称>` / `custom:<名称>`（后者来自 `policy.channels`）。

**理由**：一行一收件人可以让投递、重试、死信、幂等、回执和「消息」视图完全复用点对点机制；
若引入独立频道表与成员表，就要为审核、离线、去重各写一套并行逻辑。

**推论**：频道本身没有状态，「谁在频道里」由角色/策略实时解析，因此人员变动不需要重建频道。

## ADR-20 — PR 与回滚都是「有记录的变更」，不是顺手执行的命令

**决策**：`createPullRequest` 只接受 `APPROVED` 的 merge 变更单，且要求门禁仍为 PASS；它推送运行分支并用
`gh pr create` 开 PR，PR 正文由门禁读取的同一批行生成（验收标准、commit、检查、评审、审批、门禁结论）。
`rollbackMerge` 只接受 `EXECUTED` 的变更单，用 `git revert -m 1` 生成 revert 提交，把原单标为 `ROLLED_BACK`，
并新建一张 `rollback` 变更单留痕。

**理由**：规格 §6.3 要求合并前重验、不许悄悄覆盖。PR 与回滚同样必须留下可审计的「谁、对哪个 commit、为什么」；
把 gh 与 git 的副作用包在服务层，意味着工具、UI 和测试走同一条路径，且 PR 管线可注入（测试不需要网络）。

**限制**：PR 需要仓库配好 `origin` 且 `gh` 已登录；回滚要求本地仓库在目标分支且干净，冲突时终止并保持仓库不变。
