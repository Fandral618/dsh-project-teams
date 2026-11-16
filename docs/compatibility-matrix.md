# Project Teams — DSH 兼容性矩阵（M0 实测）

实测时间：2026-11-16。每一行都注明**实际使用的 API**、**证据位置**以及**不可用时的降级方案**。

## 安装环境身份

| 事实 | 值 | 来源 |
| --- | --- | --- |
| DSH 版本 | `0.2.2-rc.3` | `resources/app.asar` 内 `@deepseek-ai/dsh/package.json`，以及运行中 Host 上报的 `WebBootGraph.release` |
| DSH commit | `38a6a5c` | `state/activation.json` 中的 `WebBootGraph.release.commit` |
| 发行形态 | Electron Desktop（`app.asar`），Electron `44.7.0` | `DSH_NODE_EXECUTABLE` + 宿主记录的 `process.versions` |
| 宿主运行时 | Node `24.21.0`、Chromium `152.0.7977.130` | 宿主记录 |
| Profile | `desktop`（base + web-app + 11 个第三方 bundle） | `$DSH_PROFILE_DIR/cordis.patch.yml`、`package.json` |
| Web GUI | `http://127.0.0.1:62675`，由 `@deepseek-ai/dsh-host-webserver` 提供 | 运行时 URL + 桌面端 `lib/webserver.js` |
| 插件 bundle | `dsh-project-teams@0.2.0`，经 `plugin_manager install_bundle` 安装 | 安装结果 `application: applied`，行 `include:project-teams` |
| 数据根目录 | `$DSH_HOME/project-teams`（即 `~/.dsh/project-teams`） | `state/activation.json` |
| 参考文档 | `dsh/docs/subsystems/{session,slots,typert,web-client,web-server,system-prompt}.md`、`docs/cordis-api/context.md`、各包 `README.md`，以及下列包的安装版源码 | 用 ASAR 感知运行时从 `app.asar` 读取 |

本会话**没有** `cordis_inspect_list` / `cordis_inspect_query` 工具（`tool-cordis` 宿主 provider 已挂载，但当前
Agent 预设没有暴露这两个工具）。因此每条 API 都以「安装版 `.d.ts`/`src` + 现场实验」双重核实，这正是
`dsh-doc` Skill 规定的降级路径。

## 结论总览

| 编号 | 检查点 | 结论 | 证据 |
| --- | --- | --- | --- |
| C01 | 创建真正独立的 Session | PASS | `state/m0.json`：两个会话，`parentSessionId: null`、`origin: null` |
| C02 | 重启/重新激活后仍能识别与恢复 | PASS（有限制） | 后续激活写出的 `state/m0-verify-*.json`；`~/.dsh/sessions/<cwd>/<session>/session.v4.jsonl.zstd` |
| C03 | 向指定 Session 投递消息 | PASS | `state/m0.json` 中 `delivery.accepted: true`，且标记文本出现在 B 自己的派生日志里 |
| C04 | 按会话绑定角色配置 | PASS | `state/m0.json`：A 为 `standard`、B 为 `ptc` |
| C05 | Cordis 注入、生命周期、工具注册 | PASS | 宿主日志 `project-teams: host ready (… store=ready)`；`pt_*` 工具已注册并被真实 Bot 调用 |
| C06 | Client UI 插槽与声明式注册 | PASS（结构验证） | `state/activation.json` → `clientRegistration.entries[0].id = "dsh-project-teams"`；slot key 与安装版客户端代码逐项对照 |
| C07 | Host↔Client 数据通道 | PASS（含适配说明） | `ctx.webServer.register({kind:'prefix'})` + `ctx.connection.requestRejection` |
| C08 | 插件持久安装/启停 | PASS | `install_bundle` → `applied`；`set_plugin` 停用/启用 → `applied` |
| C09 | 文件与命令能力 | PASS | 宿主进程可用 Node `fs`/`child_process`；命令一律通过 `execFile` 参数数组执行 |
| C10 | Git / CI 集成 | PASS（仅本地） | `execFile('git', [...])`；P0 不接远程 PR |
| C11 | 事务持久化 | PASS | `node:sqlite` 探针 `sqlite: true`；实测库中 17 张表 + 部分唯一索引 |

## C01 — Session 创建

- API：`ctx.sessionController.create(request: SessionCreateRequest): Promise<SessionCreateValue>`
  （`@deepseek-ai/dsh-api-session-controller`，`src/types.ts`），请求字段
  `{ workspaceId?, cwd?, sessionId?, agentPreset? }`，返回 `{ sessionId, agentPreset? }`。
- 官方策略：`create` 与 `fork` 是仅有的「直接创建新 Agent」的操作。
- 实验：`runProbe()` 在 `~/.dsh/project-teams/m0` 创建 A/B 两个会话，再用
  `ctx.sessionController.list({})` 回读 `SessionSummary[]`。
- 结果：id 不同（`session-5d3049cf…` / `session-5e8e2ae2…`），`parentSessionId: null`、`origin: null`、
  `agentAvailable: true`。
- 独立性判据：无父会话、非 `origin: 'subagent'`，并在会话列表中作为普通行出现 —— 它们不是创建者的子代理。
- 不可用时：只做「绑定已有独立 Session」（`team.rebind`），并把 Bot 标为 `NEEDS_REBIND`。

## C02 — 恢复与重新识别

- `sessionController.list()` 读取身份时不激活 Agent（`SessionSummary.agentAvailable` 区分两者）。
- `sessionController.prompt(...)` 的官方描述是「显式恢复该会话后提交一个 prompt」，因此冷会话由投递本身恢复；
  适配器把投递路径（`live` / `cold-resume`）记录到消息行。
- 实验：插件再次激活时，`list()` 与实时 store 重新读到了两个会话，且 M0 标记仍留在 B 的派生日志中
  → `state/m0-verify-1794811206266.json` `verdict: PASS`。
- 持久底座：`~/.dsh/sessions/--C-Users-Administrator-.dsh-project-teams-m0--/<sessionId>/session.v4.jsonl.zstd`。
- 限制：**进程级重启**无法在宿主内部自测（会杀掉正在验证的会话），已在运行手册中作为人工步骤列出。

## C03 — 向指定会话投递消息

- API：`ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue'|'steer', content: [{type:'text',text}] })`
  → `{ accepted: true }`。`requestId` 是持久化在已接受输入上的幂等标识；`queue` = 下一轮，`steer` = 最近一个 step。
- 另有「仅活动 Agent 可用」路径：`ctx.agents.get(sessionId)` → `Agent.{status, steer, followup, inbox.append}`；
  本插件的投递统一走控制器，使冷/热会话共用一条实现，活动路径只用于读取 `status`。
- 实验：一次 `prompt` → `accepted: true`，标记随后出现在 B 的 `deriveMessages()` 中，**且不在 A 中**。
- 语义：接收输入 ≠ 接收方已处理。因此 `message_deliveries` 把 `已投递` 与 `已处理` 分开，后者要求接收方
  通过 Bot 工具显式确认。

## C04 — 按会话的角色配置

- 预设：`ctx.agentPresets.list()`（`@deepseek-ai/dsh-agent-preset-registry`）列出组合进来的预设，
  `presetForSession(session)` 返回记录在会话上的预设。本 profile 组合了 `standard`、`ptc`、`minimal`、`cordis`。
- 实验：A 用 `standard`、B 用 `ptc` 创建，回读各自预设不同 → `preset-distinct: true`。
- 预设之外的角色说明以「角色说明消息」形式写入 Bot 自己的会话日志（可审计），权限则由代码中的 ACL 强制执行。

## C05 — Cordis 注入与生命周期

- 形式：`export const inject = [...]; export function apply(ctx, config)`。
- 注入：`webServer`、`connection`、`sessionController`、`sessions`、`agents`、`tools`、`systemPrompt`。
  可选服务用 `ctx.get(name, false)`（`cordis-api/context.md` 明确其为「不要求 inject 的读取」），
  这样缺 `agentPresets` / `clientModules` 时是降级而不是卡死。
- 生命周期：所有注册都在 `ctx.effect(...)` 内；自检定时器由 disposer 清理。停用插件行后路由与工具消失
  （`set_plugin enabled:false → true` 两次均 `applied`）。

## C06 — Client UI 插槽

- 声明式注册：`ctx.slots.inject(key, () => ctx.slots.register({ name, id|key, order, label }, Component))`。
- 使用的 slot（来源：`docs/subsystems/slots.md` 与安装版客户端代码）：
  - `sidebar.panellist` —— root 作用域的**列表**面板行；同一 id 在布局的 **keyed** `main` 槽渲染面板主体。
    安装版 `dsh-client-ui-layout` 的实现是 `renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })`，
    因此面板 id 必须与 panellist 的 id 一致。
  - `settings.plugins.tab`、`plugins.row.config`、`plugins.bundle.config` —— 设置页标签与插件行/详情页。
- 浏览器模块：`client.js` 是 `window.__ModuleLoader__.load({ id, factory })` 模块，id 等于包名（已在 boot graph 中核实）。
- **未验证**：面板在用户页面上的实际渲染效果。Desktop 关闭了普通浏览器访问
  （`lib/webserver.js` → `decideDesktopBrowserAccess`），本会话没有浏览器控制工具，因此无法截图；
  用户自己的窗口就是渲染面。结构证据是 boot graph 行 + 语法门禁 + slot key 对照。

## C07 — Host↔Client 数据通道

- 路由注册：`ctx.webServer.register({ kind: 'prefix', path: '/project-teams/api', handler(req,res) })`，
  返回 disposer 由 `ctx.effect` 持有。
- 请求围栏：`ctx.connection.requestRejection(req)`，与桌面外壳自身路由使用同一判定。
- 信封：`{ ok: true, value }` / `{ ok: false, error: { code, message, details? } }`，请求体上限 1 MiB，
  `cache-control: no-store`、`nosniff`。
- **桌面端实测注意**：普通外部客户端请求在路由之前就被拒绝，返回 `403 Browser access is disabled`（本次
  Desktop 代际以「关闭普通浏览器访问」启动）。页面内请求携带渲染器凭据头，正常放行。这是安装设置而非插件能力。
  因此宿主行为用「宿主进程自己写出的证据文件」来验证，交互面是页面内工作台。
- 已否决的替代方案：手写 Typert Remote 描述符。`ctx.typert.register()` 需要仓库 Typert 生成器产出的
  contribution，而该生成器不在 Desktop 发行包内；手写属于未验证的内部接口，版本漂移即失效。
  HTTP 前缀路由是公开 seam，本 profile 内已安装的第三方 bundle 同样采用它。

## C08 — Bundle 安装

- `plugin_manager install_bundle`（`target` 为包目录绝对路径）：`application: applied`、`bundle: dsh-project-teams`、
  退出码 0，依赖被链接进 profile。
- 前端半体由 manifest 声明：`dsh.client = { platform: 'web', immediately: true, inject: [...] }` + `./client` 导出；
  宿主把它编排进 `WebBootGraph.entries`。
- 实测限制：**仅改 manifest 不会被感知**（需 entry 重启）；替换已安装的包需要重启该 Loader entry 才会加载新模块代。
  运行手册记录了本机使用的「停用→启用」循环。

## C09 — 文件与命令能力

- 宿主进程拥有本机不受限的 `fs`/`child_process`。插件不依赖这种不受限能力：所有命令都通过 `execFile` 参数数组执行
  （不经过 shell），cwd 必须是受管运行目录内，带超时，输出写入受管工件目录。
- 沙箱说明：工作树隔离用于避免写入冲突，**不是**操作系统安全边界，`docs/threat-model.md` 已明确。

## C10 — Git 集成

- 通过 `execFile('git', [...])` 调用 CLI，运行时校验版本。
- P0：本地分支 + worktree + commit + diff；不做远程 PR；没有明确的人工批准记录不会合并到目标分支。

## C11 — 持久化

- 宿主运行时内置 `node:sqlite`（`DatabaseSync`、`StatementSync`）：`state/activation.json` 中 `sqlite: true`。
- 实测库：17 张表、`schema_version = 1`、部分唯一索引
  `CREATE UNIQUE INDEX one_active_run ON task_runs (task_id) WHERE status = 'active'`。
- 结论：存储不需要原生模块、不需要构建步骤，也不给 profile 增加依赖。

## 现场实证：真实多 Agent 运行

M0 之后，同一个插件用**真实 Bot 会话**跑通了一次协作（详见 `docs/test-report.md`「真实端到端」）：
4 个独立 Session、PM 自行拆解任务、QA 预检发现基线代码真实缺陷、Bot 间 11 条可追踪消息（含 `已处理` 回执）、
开发者在隔离 worktree 中提交工件并通过门禁。

## 遗留缺口

1. 进程级重启未在宿主内自测（运行手册有人工步骤）。
2. Client 渲染没有截图验证（C06）。
3. 外部 HTTP 请求被桌面「浏览器访问」开关拦住（C07）；插件内工作台是面向用户的验证面。
4. 若 profile 没有 preset 注册表，`agentPreset` 记为 `null`，会话仍可创建（降级而非阻断）。

## 真实运行修正的两个设计缺陷

第一次真人授权的真实运行暴露了两处只有真跑才会发现的问题，均已修复并加回归测试：

1. **运行工作树落在 Bot 文件沙箱之外**（原先在 `$DSH_HOME` 下）→ 开发者写文件被拒绝。改为仓库内
   `<repo>/.project-teams/runs/<run>/worktree`，并写入 `.git/info/exclude`；新增 `bot.interrupt` 用于中断卡住的回合。
2. **已决评审被更新的待处理评审请求遮蔽**，导致门禁只看到 `PENDING`。改为按 commit 选择「已决的最新评审」，
   并让 `requestReview` 对 `(task, head)` 幂等。

详见 `docs/test-report.md` 第三节。
