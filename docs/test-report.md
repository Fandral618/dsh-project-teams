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
| `tests/integration/engine.test.js` | 26 | **全部通过** | 团队创建（4 个不同 Session + 各自预设 + 角色说明）、仓库校验、验收标准守卫、依赖环拒绝、原子认领竞争、拒绝审计、消息幂等、死信与重投、循环预算、跨项目拒绝、暂停、并行工作树隔离、评审者无可写工作树、worktree→commit→检查→盲审→门禁→DONE 全链路、失败检查拦住批准者、新 commit 使评审过期、"skip review" 文本无效、高风险需 Owner 按 commit 批准、租约过期恢复、归档行为、活动记录、工件 diff 落盘、**工作树位于仓库内（沙箱回归）**、**中断 Bot 卡住的回合**、**写入范围越界告警**、**已决评审不被新的待处理请求遮蔽（回归）** |
| `tests/security/security.test.js` | 8 | **全部通过** | 路径围栏、路径段校验（含 Windows 设备名）、Bot 不能批准、批准绑定 revision、subagent 会话不能当成员、不可信消息框、Owner 不可被冒充、PM 不能归档/认领 |
| **合计** | **47** | **47 通过 / 0 失败** | |

运行时间约 40 秒（集成测试为每个用例创建真实 `git init` 仓库与真实 worktree）。
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
