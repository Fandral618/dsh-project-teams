# 运行手册

## 日常操作

| 情况 | 处理方式 |
| --- | --- |
| Bot 空闲 | 它在等消息或任务。团队页显示 `在线` / `冷会话`（有 Session 但无活动 Agent）/ `缺失`。 |
| 消息处于 `已入队` | 分发器按退避重试（1 秒 → 60 秒）。在「消息」页看 `attempts` 与 `error_code`。 |
| 消息进入 `死信` | 先看失败原因（比如目标 Session 不存在），修好后点「重投」。重投复用同一消息 id，业务副作用仍然只有一次。 |
| 任务 `阻塞` | 原因写在任务行上：依赖未完成、显式阻塞理由，或运行租约过期。 |
| 运行处于 `需恢复` | 租约在运行期间过期。先检查工作树 `<仓库>/.project-teams/runs/<运行>/worktree` 与分支 `pt/<任务>/<运行>`，再决定解阻重跑或取消。引擎**不会**自动重跑不可逆命令。 |
| 门禁 `未完成` | 缺东西：当前 commit 的工件、必需检查或评审结论。原因列表会指明是哪一项。 |
| 门禁 `已过期` | 出现了更新的 commit。对那个 commit 重新跑检查、重新请求评审，旧证据不可复用。 |
| 门禁 `待人工` | 风险为 `high` 或策略要求 Owner 批准。到「决策」页审批，批准绑定到具体 commit。 |
| 门禁 `不通过` | 必需检查失败，或评审要求修改（任务转入 `返工`）。看「交付 → 机器证据」与日志路径。 |

## 暂停与恢复

`暂停项目` 会阻止新运行，并把正在运行的任务置为暂停（工作树保留），排队中的消息不会被丢弃。
`恢复项目` 重新激活项目；被暂停的运行需要其 Bot 明确重启。

`归档` 更彻底：拒绝新任务与新运行，排队消息标记为已丢弃；已有数据与分支保留。

## 备份

在宿主空闲时备份整个数据目录：

```sh
# 建议先停 DSH；若不停，请连同 -wal 一起复制以保证 WAL 一致
cp -a ~/.dsh/project-teams ~/backups/project-teams-$(date +%F)
```

内容包括：`project-teams.db`（及 `-wal`、`-shm`）、`state/`（激活与 M0 证据）、`projects/`（工作树、diff、检查日志）。
Git 仓库本身属于你，不在备份范围内。

恢复：停 DSH → 替换目录 → 启动 DSH → 确认日志 `store=ready`。工件行保存的是绝对路径，恢复到同一 `$DSH_HOME` 时「交付」页的链接仍然有效。

## 故障处理

| 故障 | 症状 | 处理 |
| --- | --- | --- |
| 无 `node:sqlite` | 日志 `node:sqlite is unavailable`；工作台显示降级状态页 | 换用 Node ≥ 22 且带 SQLite 的 DSH 版本；profile 其他功能不受影响。 |
| 迁移失败 | 日志 `database migration failed: …`；只剩状态页 | 用最近备份恢复；记录 schema 版本后反馈。 |
| schema 比插件新 | `database schema N is newer than this plugin` | 安装对应版本的新插件；**不要**删库。 |
| Session 丢失 | Bot 显示 `缺失`，投递进死信 | 在「团队」页用**重新绑定**把已有独立 Session 绑上去；subagent 会话会被拒绝。 |
| 写句柄被占用 | Session 控制器返回 `session/writer-held` | 该会话在另一个窗口/进程打开着，关闭后重试。 |
| 前缀路由冲突 | 激活失败提示 duplicate prefix route | 已有一行挂载了 Project Teams，只保留一行启用。 |
| 前端未加载 | 刷新后没有侧栏图标 | 看 `state/activation.json` 的 `clientRegistration.entries`，再刷新页面。 |

## 回滚

1. `plugin_manager set_plugin include:project-teams enabled:false`（或 `dsh plugin remove`）。
2. 若上一版本使用了不同 schema，恢复升级前的数据库备份；插件会拒绝在更新的 schema 上运行。
3. 刷新页面。侧栏图标消失，数据目录不受影响。

## 重启验证（自动化）

```sh
npm run verify:restart
```

在临时 `DSH_HOME` + 临时 profile 中安装本 bundle，真实启动两次 Host 进程：第一次跑 M0 探针创建两个会话，
第二次从冷会话持久日志重新识别并读回投递标记，输出 `verdict: PASS`。**不会**接触你的日常 profile。

## 预算与成本

`设置 → 预算` 可改并行数、每任务/每小时消息上限、重试上限、单次运行与 24 小时令牌上限（0=不限）。
令牌数由宿主 token 计量服务按会话日志回放得出，不产生模型调用；超限会生成 `NEEDS_ATTENTION` 决策并拒绝后续执行。

## 手工端到端验收（约 5 分钟）

1. `node scripts/demo-repo.mjs D:/tmp/pt-demo`，复制脚本打印的策略检查。
2. 新建项目指向该路径、粘贴策略检查、生成团队。
3. 新建任务（标题/描述/验收标准）→ 提交 → 分配给开发者 Bot。
4. 在开发者 Bot 的会话里：`pt_task` → `claim`，`pt_task` → `start`（拿到工作树路径），**只在该路径内**改文件，
   `pt_task` → `submit_artifact`，`pt_verify_run`，`pt_review` → `request`。
5. 在评审 Bot 的会话里：`pt_review` → `context`，然后 `pt_review` → `submit`。
6. 「交付」页能看到工件、检查行与评审；门禁 `通过` 时任务进入 `完成`（高风险则等待你审批）。
7. 故意让一个测试失败，从第 4 步重来：即使评审给「批准」，门禁也必须保持 `不通过`。

## 已知限制

- 仅在 DSH Desktop `0.2.2-rc.3` 实测；兼容性矩阵逐条列出所用接口与降级方案。
- 插件自身没有执行「重启整机」验证（会杀掉正在验证的会话）。重启安全性依据是 Session 存储的持久日志与重新激活后的身份复认。
- 工作台渲染通过结构验证（boot graph、slot key、语法门禁）确认，未用截图验证：Desktop 默认关闭普通浏览器访问。
- P0 每个项目每个角色一个 Bot。一个项目要两个开发者，需要放宽 `project_bots` 的角色唯一约束，并把按角色的路由改为按 bot id。
