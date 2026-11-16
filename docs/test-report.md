# 测试报告

日期：2026-11-16 · DSH `0.2.2-rc.3`（Electron 44.7 / Node 24.21）· 插件 `0.2.0`

## 一、自动化测试

```sh
cd project-teams
npm test                      # 全部
node --test "tests/unit/*.test.js"
node --test "tests/integration/*.test.js"
node --test "tests/security/*.test.js"
```

| 套件 | 数量 | 结果 | 覆盖内容 |
| --- | --- | --- | --- |
| `tests/unit/state-machine.test.js` | 13 | **全部通过** | 转移表可达性、非法/未知动作、角色拒绝、终态、权限矩阵（仅 Owner 可批准、归属校验、跨项目、未知操作） |
| `tests/integration/engine.test.js` | 48 | **全部通过** | 团队创建（4 个不同 Session + 各自预设 + 角色说明）、仓库校验、验收标准守卫、依赖环拒绝、原子认领竞争、拒绝审计、消息幂等、死信与重投、循环预算、跨项目拒绝、暂停、并行工作树隔离、评审者无可写工作树、worktree→commit→检查→盲审→门禁→DONE 全链路、失败检查拦住批准者、新 commit 使评审过期、"skip review" 文本无效、高风险需 Owner 按 commit 批准、租约过期恢复、归档行为、活动记录、工件 diff 落盘、**工作树位于仓库内（沙箱回归）**、**中断 Bot 卡住的回合**、**写入范围越界告警**、**已决评审不被新的待处理请求遮蔽（回归）** |
| `tests/security/security.test.js` | 8 | **全部通过** | 路径围栏、路径段校验（含 Windows 设备名）、Bot 不能批准、批准绑定 revision、subagent 会话不能当成员、不可信消息框、Owner 不可被冒充、PM 不能归档/认领 |
| **合计** | **69** | **69 通过 / 0 失败** | |

运行时间约 50 秒（集成测试为每个用例创建真实 `git init` 仓库与真实 worktree）。
另有结构门禁：`node --check` 覆盖全部发布模块；`node scripts/demo-repo.mjs` 生成的演示仓库 build 检查通过、3 个测试通过。

## 二、运行中宿主的实测（M0）

由插件自己在运行中的 Desktop 宿主内执行，证据写在 `$DSH_HOME/project-teams/state/`：

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 宿主插件激活、服务齐备 | PASS | 日志 `project-teams: host ready (… store=ready)` |
| 前端半体进入 boot graph | PASS | `activation.json` → `clientRegistration.entries[0] = { id: dsh-project-teams, rev: f371b1ab5cf8, immediately: true }`，release `0.2.2-rc.3 / 38a6a5c` |
| 两个普通 Session、id 不同 | PASS | `m0.json` |
| 都不是子代理 | PASS | `parentSessionId: null`、`origin: null` |
| 按会话绑定预设 | PASS | `a: standard`、`b: ptc` |
| A→B 投递被接受 | PASS | `delivery.accepted: true`、`path: live` |
| 消息落在 B 自己的日志里 | PASS | `delivered-to-b-log: true`、`not-delivered-to-a-log: true` |
| 再次激活后可重新识别 | PASS | `m0-verify-1794814059194.json` → `verdict: PASS` |
| 安装 / 停用 / 启用 | PASS | `install_bundle` → `applied`；`set_plugin` 停用→启用均 `applied` |

## 三、真实端到端运行（真人授权，真实模型、真实 Git、真实门禁）

项目：`演示·账号系统`（`prj_6c6b4ca69a73`），仓库为 `scripts/demo-repo.mjs` 生成的演示仓库
（基线 commit `2c6bb95`，策略检查 `build=node --check src/app.js`、`test=node --test test/signup.test.js`）。

| 事实 | 值 |
| --- | --- |
| Bot 会话 | 4 个独立 Session（pm / developer / reviewer / qa），预设 `ops-ptc` |
| 任务 | `T-4` 从 DRAFT → READY → ASSIGNED → RUNNING → IN_REVIEW → VERIFIED → **DONE** |
| 事件链 | `start@bot`、`artifact@bot`、`submit_review@bot`、`verify@owner`、`complete@owner`（全部写入 `task_events`，只追加） |
| 分支 / 工作树 | `pt/T-4/run_e4e9cd3bb470`，位于 `demo-repo/.project-teams/runs/run_e4e9cd3bb470/worktree` |
| 提交 | `e3c5584 feat: validate signup/login input and compare real password hashes`（+155/−18，仅 `src/app.js`、`test/signup.test.js`） |
| 工件 | `art_a38acef91d56`，diff 落盘 + SHA-256 |
| 机器证据 | `build=PASS(exit 0)`、`test=PASS(exit 0)`，各带日志路径与日志 SHA-256 |
| 独立评审 | `rev_bc3482cf4815` = `APPROVE`，绑定 head `e3c558462f`；评审上下文由引擎构建，不含开发者自评 |
| 消息 | 41 条，其中 30 条 `PROCESSED`（接收方主动确认）、11 条 `DELIVERED` |
| 审计 | 110 行 |
| 端到端结论 | **门禁 PASS → 任务 DONE，工件、commit、检查日志、评审、事件链全部可追溯** |

### 真实运行发现并修复的两个缺陷（这是自动化测试无法替代的）

1. **工作树落在 Bot 沙箱工作区之外。** 原先 worktree 放在 `$DSH_HOME/projects/...`，而 Bot 会话的文件沙箱
   作用域是它的工作目录（仓库），因此开发者的写文件请求被拒绝，任务卡在一个等待用户批准的网关提示上；
   我为此新增了 `bot.interrupt`（Owner 可中断卡住的回合）用于恢复。
   **修复**：worktree 改到仓库内 `<repo>/.project-teams/runs/<run>/worktree`，并把该目录写入
   `.git/info/exclude`（不污染用户工作区与 `.gitignore`）。
   **回归测试**：「the run worktree lives INSIDE the project repository (sandbox regression)」。
   修复后同一个任务在 5 分钟内完成提交，主仓库始终保持干净。

2. **已决评审被更新的待处理请求遮蔽。** 开发者重复请求评审导致同一 head 上出现两行评审，门禁只取最新一行
   （仍是 PENDING），于是即便评审已给 `APPROVE`、两项检查都 PASS，任务仍停在 `IN_REVIEW`。
   **修复**：`requestReview` 对 `(task, head)` 幂等（已有未决评审则复用）；门禁改为按 **commit** 选择
   「已决的最新评审」，并区分 `PENDING` / `STALE` / 缺失。
   **回归测试**：「a decided verdict for the head is not hidden by a newer pending request」。
   修复后 `gate` 对同一份真实数据返回 `PASS`，任务随即进入 `VERIFIED → DONE`。

### 协作行为观察（真实模型，非脚本）

- PM Bot 主动把项目目标拆成 `T-2`、`T-3`，随后又通知开发者「只做 T-1/T-4，不要认领这两个草稿」，并下发验收口径。
- QA Bot 在开发者动手前做了预检，**发现基线代码的真实缺陷**：`login` 只比较密码长度，任何等长密码都能登录。
  该缺陷最终由开发者用 scrypt + 每账号随机盐修掉，评审结论中也确认了修复点。
- QA 同时报告：`node --test` 在他们自己的沙箱里 `spawn EPERM`（环境限制）。这恰好说明「AI 自评不能当证据」：
  真正的检查由宿主在 `pt_verify_run` 中执行，并以退出码 + 日志哈希为证。
- 评审者通过 `pt_review action=context` 读取引擎构建的盲审上下文，未接触开发者对话。

## 四、验收项对照（AT-01 … AT-20）

| 编号 | 场景 | 结果 | 位置 |
| --- | --- | --- | --- |
| AT-01 | 两个项目各 4 Bot，Session id 唯一且非 subagent | **PASS** | 团队测试 + M0 探针 + 真实运行 |
| AT-02 | A 项目 Bot 读写 B 项目 | **PASS** | 跨项目测试（消息 + 认领） |
| AT-03 | 两个 Bot 抢同一任务 | **PASS** | 一个成功，另一个 `VERSION_CONFLICT` |
| AT-04 | 依赖成环 | **PASS** | 拒绝且数据库不变 |
| AT-05 | 给离线 Bot 发消息 | **PASS** | 退避重试 + 死信 + 重投；冷会话经 `prompt` 恢复 |
| AT-06 | 重复消息 ID | **PASS** | 一行、一次投递、`deduplicated` 审计 |
| AT-07 | 两个并行代码任务 | **PASS** | 工作树/分支互不相同、互不可见 |
| AT-08 | 提交信息写「跳过评审」 | **PASS** | 门禁不受影响 |
| AT-09 | 评审者试图改代码 | **PASS** | 无可写工作树，`run.start` 被矩阵拒绝 |
| AT-10 | CI 失败但评审说通过 | **PASS** | 门禁 `FAIL`，任务不会 DONE |
| AT-11 | 评审通过后又有新 commit | **PASS** | 门禁 `STALE`；批准绑定 revision |
| AT-12 | Bot 要求部署/合并 | **PASS** | 只能 `pt_change_propose`，无执行路径 |
| AT-13 | 执行中重启 | **PARTIAL** | 租约过期 → `recovery_required` + 阻塞 + 审计，不自动重跑；进程级重启为人工步骤 |
| AT-14 | 预算/重试上限 | **PASS** | 死信、并行预算、每任务消息预算 |
| AT-15 | 暂停项目 | **PASS** | 拒绝新运行，暂停在途运行，保留工作树 |
| AT-16 | 升级/卸载 | **PASS（安装/停用）/ PARTIAL（升级）** | 停用/启用循环在真实宿主验证；数据目录不动 |
| AT-17 | 角色/项目越权 | **PASS** | 权限矩阵 + 归属 + 跨项目，拒绝写审计 |
| AT-18 | 满足真实门禁并由 Owner 批准 → DONE | **PASS** | 高风险流程测试 + 真实运行 `T-4` |
| AT-19 | 同伴消息伪造 system 指令 | **PASS** | 来源头 + 文本无授权能力；安全套件覆盖 |
| AT-20 | Bot 间无限回复 | **PASS** | 每任务预算触发 `NEEDS_ATTENTION` 决策并拒绝 |

## 五、仍未验证的部分

1. **工作台视觉呈现**：Desktop 对普通浏览器一律返回 `403 Browser access is disabled`，本会话也没有浏览器控制工具。
   已验证：Client bundle 在 boot graph 中（`rev f371b1ab5cf8`）、slot key 与安装版客户端代码逐项一致、语法门禁通过。
   界面实际渲染需要你在自己的窗口里确认（打开左侧「项目团队」即可）。
2. **整机重启**：无法在宿主内部执行（会杀掉执行验证的会话）。重启安全性依据是 Session 持久日志 + 重新激活后的
   身份复认（`m0-verify-*`）。运行手册给出人工步骤。
3. **升级（跨 schema）**：只验证了同版本的停用/启用与重新安装；跨 schema 升级需按运行手册先备份。

## 六、v1.1.0 补齐轮（对照规格书正文的 9 处缺口）

| 缺口 | 处理 | 验证 |
| --- | --- | --- |
| ① 任务编辑 | `updateTask` + `tasks.update` 路由 + `pt_task action=edit` + `pt_owner task_edit` + 工作台内联编辑 | 新测试「a task can be edited…」；现场对 T-2 编辑成功（v2） |
| ② 角色模板表 | 迁移 v2 建 `bot_templates` 并版本化；`briefFor()` 按 Bot 自己的模板版本渲染；`templates.list/write` 路由 + `upsertTemplate` | 迁移实测：4 个模板 + 4 个 Bot 绑定 `template_id` |
| ③ 每项目 4–8 Bot | 去掉 `UNIQUE(project_id, role)`，加 `label`（`developer#2`），`createTeam` 接受重复角色 | 新测试「a project can hold more than four Bots」 |
| ④ 令牌预算 | `ctx.tokenMeter.measure()` 采样 → `task_runs.tokens_used/base`；`per_run_token_limit`/`daily_token_limit` 在执行点强制 | 新测试「token budgets are measured and enforced」；现场写入预算 |
| ⑤ Run 心跳 | `pt_run` 工具（heartbeat/status）+ 提交/验证/评审时自动续租 | 工具注册 + 代码路径；现场会话可用 |
| ⑥ Reviewer 只读 checkout | 每个评审创建 detached worktree，记录 tree 哈希，判定时校验并在结论后清理 | 代码路径 + 评审流程测试；树被改动即拒绝结论 |
| ⑦ 消息搜索/线程 | `messages.list` 支持 `query`/`threadId`；工作台搜索框 + 线程聚合统计 | 客户端实现 + 服务端 LIKE 搜索 |
| ⑧ 设置/导出 UI | 策略编辑、预算编辑、项目 JSON 导出、工件完整性校验按钮 | 现场：`verify_artifacts` 1/1 ok；`export` 5 个任务 |
| ⑨ 工件 hash 校验 | `verifyArtifacts` + `delivery.verify` 路由 | 新测试「artifact hashes are verified…」（含篡改检测） |

### 进程级重启：已在隔离 profile 中真实验证

`npm run verify:restart` 用临时 `DSH_HOME` + 临时 profile（`pt-restart`），把 bundle 装进去后
**两次真实启动 Host 进程**（pid 9248 → pid 9488），第一次运行 M0 探针创建两个会话，第二次从持久日志里
重新识别它们并读回投递标记：

```json
{ "verdict": "PASS", "aFound": true, "bFound": true, "durableMarkerPresent": true }
```

第二次启动读的是**冷会话的持久日志**（`sessionController.events` 分页），因此这条证据覆盖了
「重启后仍能识别会话并读回投递内容」，也覆盖了冷会话读取路径。

### 本轮同时修掉的移植性问题

插件原先静态导入 `@deepseek-ai/dsh-tools` 的 `defineTool`。该导入只在 Desktop Host 内可解析
（Desktop 的模块图锚定了 DSH 包），而 `dsh` CLI 启动一个 **linked 插件目录** 时会
`ERR_MODULE_NOT_FOUND`。改为 `lib/host/dsh-tools.js`：优先用宿主实现，不可解析时回退到
`lib/host/tool-def.js`（同契约的本地编译器：参数 DSL→JSON Schema、输出 schema、参数校验）。
Desktop 行为不变（仍用宿主实现），CLI/profile 隔离启动也能激活 —— 这正是重启验证得以完成的前提。

## 七、界面实测（M6 的 UI 缺口已关闭）

方法：在运行中的 Desktop 窗口上做真实交互取证 —— 由于本机 RDP 会话中途断开使屏幕 DC 失效，
最终采用 **UI Automation**（`InvokePattern`，不需要鼠标输入）切换标签页 + **PrintWindow** 抓取窗口位图。
全程只做「切换标签页」这类只读导航，没有点击任何会改状态的按钮。

| 标签页 | 实测内容 | 截图 |
| --- | --- | --- |
| 总览 | 项目卡（目标/仓库/分支/状态计数 草稿3·完成1·已取消1）、进行中的运行、阻塞任务、需要你处理 2 项、活动记录（project.export / budget.write / task.edit / artifact.verify / task.claim 拒绝 等真实审计行） | `docs/screenshots/01-overview.png` |
| 团队 | 4 个 Bot，独立 Session id + 复制按钮、预设 ops-ptc、存活状态「在线」、当前任务「空闲」、重新绑定 | `docs/screenshots/02-team.png` |
| 任务 | 新建任务表单（标题/风险/依赖/描述/验收标准）+ 任务列表：T-1 已取消、T-4 完成·门禁通过、T-2/T-3/T-5 草稿，操作列（查看/提交/取消） | `docs/screenshots/03-tasks.png` |
| 交付 | 工件 art_a38acef91d56（commit e3c5584、2 文件、diff sha256 011025a231a2）、4 条机器证据全部 `通过` exit 0 且带命令与日志路径、AI 评审记录含 5 条 nit/minor findings | `docs/screenshots/04-delivery.png` |
| 消息 | 搜索框 + 线程/任务聚合提示；真实 PM↔开发者↔评审消息，状态「已处理」 | `docs/screenshots/05-messages.png` |
| 决策 | 「等待 Owner 决定」：一条引擎的 `attention`（T-4 消息预算 40 用尽）+ **PM Bot 自己写的合并提案**（分支 pt/T-4/run_e4e9cd3bb470、门禁依据、已知限制、等待 owner 决定），带「批准/拒绝」 | `docs/screenshots/06-decisions.png` |
| 设置 | 宿主事实（插件版本 1.1.0、Session 控制器 true、SQLite true、预设列表）、M0 探针按钮、可编辑的项目策略 JSON | `docs/screenshots/07-settings.png` |

截图同时证明了两件事：UI 不是静态数据（所有值随宿主变化），以及**Bot 会主动写合并提案而不是自行合并**。

## 八、P1 增量（v1.2.0）

- **归档恢复**：`restoreProject` + `projects.restore` 路由 + 工作台按钮；恢复后项目可再次接单，归档/恢复都写审计（新测试覆盖，含 Bot 越权被拒）。
- **质量/成本面板**：`dashboard(projectId)` 从任务事件、运行、检查、评审、审批行计算完成率、返工率、平均周期、检查通过率、findings 严重度分布、令牌用量（含 24h 与预算）、消息/死信、决策计数；工作台新增「质量」标签页。
- **角色模板编辑**：设置页列出模板版本并支持「发布新版本」；新版本只影响之后创建的 Bot（新测试断言既有 Bot 仍为 v1）。

## 九、P1 增量（v1.3.0）：合并执行器

- 新测试三条：①未批准的合并不能执行、Bot 也不能执行已批准的合并；②批准后执行生成 `--no-ff` 合并提交（两个父提交、
  目标分支含改动）、变更单转 `EXECUTED`、写审计与任务事件、再次调用返回「已合并」；③工作区脏、
  目标分支被推进（`merge/base-moved`）、当前不在目标分支三种情况全部拒绝且仓库不被改动。
- 修复同类问题：工件摘要里补记 `baseCommit`（原先只在 run 行上有，执行器无从校对评审基线）。
- 决策收件箱现在展示所有提案的状态，并对「已批准 + merge」显示**执行合并**按钮。

## 十、P1 增量（v1.4.0）：双审 / 交叉模型

- `policy.reviewCount = 2` 时，`requestReview` 为两个 reviewer 各建一份评审（各自独立 checkout），返回 `requested[]/requiredReviews`。
- 门禁按 reviewer 去重：两个 APPROVE → `PASS`；只有一个 → `INCOMPLETE`（原因写明 1/2）；任一 CHANGES_REQUESTED → `FAIL`。
- 新测试两条（双批准通过、单批准不足 / 一批准一拒绝则 FAIL）。「交叉模型」由第二位 reviewer 的 Agent 预设表达（测试里用 `reviewer#2: standard`）。

## 十一、P1 增量（v1.5.0）：项目模板 + 自定义角色

- **能力化 ACL**：操作矩阵与状态机都按能力判定（coordinate / write / review / verify / message）；内置角色映射固定，
  自定义角色在角色模板 `tool_policy.capabilities` 声明；未知角色默认只有 `message`。
- **自定义角色**：`upsertTemplate` 接受任意合法角色名，非内置角色必须声明能力；`createTeam` 只要存在模板即可建该角色的 Bot；
  `requestReview` 的评审池与 `submitReview` 的权限都按能力筛选。
  测试覆盖：`architect`（仅 review）不能认领任务但可作评审者；`frontend`（仅 write）可认领、开跑、提交。
- **项目模板**：迁移 v3 + 内置 `web-node`/`python`/`minimal`；`projects.create` 支持 `templateId`，显式字段覆盖模板值；
  Owner 可发布自定义模板，Bot 不能；工作台「项目」页新增模板下拉。

## 十二、P1 增量（v1.6.0）：频道/群组消息 + Timeline

- **频道消息**：`sendChannelMessage` 按 `all` / `role:<角色>` / `custom:<名称>`（来源 `policy.channels`）解析成员，
  为每个成员生成一条消息行并共享 `thread_id`，复用投递/重试/幂等机制；发送者不会收到自己的广播。
  `pt_message_send` 新增 `channel` 参数。
- **Owner 广播**：`messages.broadcast`（ownerOnly）向频道发系统通告，写入每个 Bot 的会话；Bot 无法调用。
- **Timeline**：`timeline.get` / 工作台「时间线」标签页把任务事件、审计、消息、检查、评审、审批合并成一条时间序，
  支持类型筛选与任务过滤。新测试三条（频道扇出与投递、广播权限、时间线合并与排序）。

## 十三、P1 增量（v1.7.0）：PR 集成与回滚

- **PR**：`decisions.createPR`（ownerOnly）对已批准且门禁 PASS 的工件推送分支并用 `gh pr create` 开 PR；
  正文由引擎从验收标准、commit、检查、评审、审批、门禁结论生成。仓库没有 `origin` 时明确拒绝（`pr/no-remote`）。
  测试用可注入的 `prTools` 记录调用顺序（remote → push → gh）与 URL 落库、审计，并覆盖无 remote 的拒绝路径。
- **回滚**：`decisions.rollbackMerge`（ownerOnly）只接受 `EXECUTED` 的合并单，`git revert -m 1` 生成 revert 提交，
  原单转 `ROLLED_BACK`，另建 `rollback` 变更单留痕。测试验证文件被移除、状态与审计、二次回滚被拒。

## 十四、收尾验证（v1.8.0）

### 进程级重启 + 卸载残留（`npm run verify:restart`）

在临时 `DSH_HOME` + 临时 profile 中安装本 bundle，真实启动**两个** Host 进程，然后卸载：

```json
{
  "verdict": "PASS",
  "boots": [{ "label": "boot-1", "pid": 6388 }, { "label": "boot-2", "pid": 8064 }],
  "verify": { "verdict": "PASS", "aFound": true, "bFound": true, "durableMarkerPresent": true },
  "uninstall": { "installedBefore": true, "installedAfter": false, "dataKept": true }
}
```

第二次启动从**冷会话持久日志**重新识别两个会话并读回投递标记；卸载后 profile 不再列出该 bundle，
而 `project-teams.db` 仍在（数据不被删除）。这同时覆盖 AT-13（重启）与 AT-16（卸载）。

### UI 证据

`docs/screenshots/` 里有 7 张真实窗口截图（总览/团队/任务/交付/消息/决策/设置）与 1 张标签行截图
（显示新增的**时间线**与**质量**）；`09-quality-metrics.json` 记录质量面板渲染的实时数值
（完成率 20%、检查通过率 100%、findings minor 1 / nit 4、消息 58）。
像素级截取在会话断开后不可用（屏幕 DC 失效），原因与替代方法写在 `docs/screenshots/README.md`。

## 十五、v1.1 工作台（U1/U2 Host 侧）

- 迁移 **v4** 新增 `canvas_nodes` / `canvas_views`（只增表）；真实库副本 v3→v4 后数据不变（1 项目 / 5 任务 / 58 消息）。
- `canvas.get`：真实节点 + 三类连线（collaboration 由能力推导、communication 由真实消息聚合、handoff 由交接消息与 assign 事件）。无数据即无连线。
- `canvas.save`：仅接受本项目 Bot，坐标有界，缩放夹在 0.3–2.5，写审计。
- `messages.list` 增加 `between`/`threadId` 过滤，供连线详情使用。
- 新增 3 条测试，总数 69。

## 十六、v1.1 工作台（U1–U4 客户端）

- 统一 Workspace 壳：顶栏（项目/状态/Session 数/待审批/刷新）、五视图（Overview / Canvas / Sessions / Tasks / Deliveries）、
  原 11 个面板降为「更多」分组（项目/团队/消息/时间线/质量/决策/设置），功能未删。
- 左侧栏：项目切换 + 真实 Bot 列表（角色色点、存活状态、当前任务）；点击 Bot 打开右侧 Inspector。
- 画布：零依赖自研（DOM 节点 + SVG 连线），支持拖动、滚轮缩放、平移、适配视图、重置；坐标与视口经 `canvas.save` 持久化；
  节点显示真实 Session id、存活、当前任务、阻塞；连线分「协作关系/实际通信/任务交接」三类并可筛选，标签显示 `×次数 · 最近时间`。
- Inspector：Bot 身份/Session、存活、预设、当前任务（可跳到任务视图）、Git 分支与 worktree、阻塞原因、收发消息摘要、
  工件与检查摘要；操作「复制 Session id」「发消息」（真实 `team.wake`）、「打开任务」「打开交付视图」。点击连线时显示该方向的消息历史与关联任务。
- 底部事件时间线常驻（时间戳 + 类型 + 摘要），可展开到完整时间线视图。
- 后台 5 秒轮询不再点亮工具栏忙碌态（只有用户操作才显示「处理中…」）。
- 真实窗口验证：4 个真实节点（含 session id）、真实连线标签（通信 ×9 · 15:37、交接 ×1 · 15:24 等）、
  底部 40 条真实审计事件；截图 `docs/screenshots/10-workspace.png`，可访问性文本 `10-workspace-uia.txt`。

## 十七、v1.1 工作台（U5 精修 / U6 发布）

- **设计 token**：`TOKENS`（圆角/间距/字号/状态色）用于新壳层；画布与节点改用主题变量表面。（按业主决定：**不做深色模式**，界面只保证浅色主题；组件仍使用主题变量，未来若需要再补深色不影响结构。）
- **正交连线**：改为「右出 → 水平 → 垂直 → 水平 → 左入」带圆角路由，不再斜穿节点；标签固定在垂直段上。
- **窄窗适配**：`useViewportWidth()` 在 <1180px 时三列降级为纵向堆叠（左栏 → 主区 → Inspector），画布保底 320px。
- **加载/空态**：画布数据到达前显示「正在读取团队与消息…」，无 Bot 时提示去团队页生成。
- **首次自动适配**：每个项目首次打开自动 fit 一次，之后视口归用户。
- **测试**：`npm test` 69/69；`npm run verify:restart` 复核（两进程重启 + 卸载残留）。

## 十八、浏览器内真实点击验证（CDP）

在启用「浏览器访问」后，用无头 Chrome + DevTools 协议驱动真实页面：

- **已验证**：打开工作台（4 Session / 待审批 2 / 五视图 / 左栏四个 Bot）；画布渲染四个真实节点（内联坐标 80/80、368/80、80/282、368/282，元素含真实 `session-…`）；
  **滚轮缩放** 100% → 128%，且 `canvas_views` 由 `{x:67,y:60,zoom:1.4}` 变为 `{x:-63,y:43,zoom:1.2822}`（界面驱动的持久化）；
  刷新后画布 transform 恢复为 `translate(-62.58px,43.43px) scale(1.28226)`，与 DB 一致。
- **未验证（本轮环境限制）**：节点拖动。CDP 坐标点落在宿主应用的标题元素上（`elementFromPoint` 返回 `H2.…title`），说明在该浏览器标签页里工作台与会话视图同时渲染、会话层在上，合成鼠标事件到不了画布；
  挂到节点上的探针收不到任何 `pointerdown`。因此「拖不动」是**测试环境现象**，尚不能判定为产品缺陷；下轮需在只渲染工作台的页面状态下重测。
- 顺带加固：节点拖动改为按下时注册 window 级 `pointermove/pointerup`（会话结束即移除），不再依赖 pointer capture——即使画布被其它层覆盖也能正确结束手势。

### 拖动验证的当前结论（2026-11-16）

- 用 CDP 在真实页面上派发 `pointerdown → 6×pointermove → pointerup`，节点诊断日志收到 8 条 **`isTrusted: true`** 事件，
  坐标与目标 Bot 都正确 —— 说明画布的指针处理链路是接通的，不是「点不到」。
- 但该次拖动后 `canvas_nodes` 未变化，且节点在 DOM 里消失（选择器找不到），因此**拖动持久化尚未被证实**。
  已修两处真实隐患：(1) 手势改用 window 级 `pointermove/pointerup`，不再依赖 pointer capture；
  (2) `persist` 从 `setPositions` 的状态更新函数里移出，改为从 `positionsRef` 读取最新值后直接调用（在更新函数里做副作用
  在 React 跳过更新或组件卸载时会被丢弃）。
- 复现步骤（供下一次验证）：在浏览器标签页先点掉首启「预览版说明」弹窗 → 打开工作台 → Canvas → 确认节点 `elementFromPoint` 命中自身 →
  拖动 → 读 `canvas_nodes`。
