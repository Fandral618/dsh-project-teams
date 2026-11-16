# 安装与升级

## 环境要求

| 项目 | 本机实测值 |
| --- | --- |
| DSH Desktop | `0.2.2-rc.3`（详见 `docs/compatibility-matrix.md`） |
| 宿主运行时 | Electron 44.7 / Node 24.21（**必须有内置 `node:sqlite`**） |
| `git` | 在 `PATH` 中；目标仓库至少有一个 commit |
| Profile 服务 | `webServer`、`connection`、`sessionController`、`sessions`、`agents`、`tools`、`systemPrompt` |

## 安装

### 方式一：通过 Harness 界面（推荐）

1. 打开 **插件 → 添加插件 → 本地目录**，选择本目录（含 `dsh.bundle.patch` 的 `package.json` 那一层）。
2. 确认出现插件行 **Project Teams**（项目团队）且处于启用状态；行 id 是 `project-teams`（entry 为 `include:project-teams`）。
3. 刷新一次页面，左侧栏出现「项目团队」图标。

### 方式二：通过 CLI

```sh
dsh plugin --profile <profile> add /本目录的绝对路径/project-teams
```

`plugin_manager` / `dsh plugin` 负责把包链接进 profile 并把 bundle 追加到 `dsh.profile.bundles`。
**不要**手工改 profile 的 `package.json`、`cordis.patch.yml`，也不要在 profile 目录里跑 `pnpm`。

## 安装后的自检

1. **宿主日志** `~/.dsh/logs/desktop-next.log` 应出现：

   ```text
   project-teams: host ready (dsh node 24.21.0, sessionController=true, webServer=true, sqlite=true, store=ready)
   ```

2. **数据目录** `$DSH_HOME/project-teams/` 下出现 `project-teams.db` 与 `state/activation.json`。
3. **激活记录** `state/activation.json` 中的 `clientRegistration.entries[]` 应有一行 `id: "dsh-project-teams"`；
   该行即宿主为浏览器编排的 Client bundle，缺失说明前端半体没有被发布。
4. **工作台**：左侧栏点「项目团队」，「设置」页显示运行时事实与 M0 探针按钮。
5. **M0 探针（可选，会创建两个会话）**：设置 → *运行探针*，页面内直接显示判定与每项检查，同时写入 `state/m0.json`。

## 升级

1. 替换包内容（或安装新版本目录）。
2. 禁用并重新启用该插件行，或重启 DSH。**替换已安装的包必须重启该 Loader entry 才会加载新的模块代**；只改 manifest 不会被感知。
3. 观察日志是否出现 `store=ready`。若执行了数据库迁移，先备份旧文件。

数据库 schema 比插件新时会明确拒绝启动，而不是静默降级：

```text
project-teams: database schema N is newer than this plugin (M)
```

## 卸载

- **停用插件行**：路由、工具、系统提示词段、定时器与数据库句柄都属于插件 fiber，停用即全部释放。
- **移除 bundle**：

  ```sh
  dsh plugin --profile <profile> remove dsh-project-teams
  ```

- 数据目录默认保留。删除 `$DSH_HOME/project-teams` 是显式的数据删除动作；插件**不会**删除你的源码仓库、worktree 或分支。

## 展示资源

bundle 随包提供 `locale/en.json`、`locale/zh.json`、自制 `icon.svg` 与 `docs/DETAIL.md`（由 `meta.detail` 指向）。
插件管理器的详情页/列表中可以直接看到标题、描述、详情与图标，无需激活插件。
