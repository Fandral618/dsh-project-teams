/**
 * Owner-scope tools.
 *
 * These let the human drive project setup and execution from their own chat
 * instead of the workbench. They are the *same* service calls the workbench
 * makes, with the owner actor — and they deliberately exclude every authority
 * operation: approving a revision, deciding a change request, pausing or
 * archiving a project, or editing a policy stay UI-only, so a model can never
 * grant itself an approval.
 *
 * They are registered for Sessions that are not project Bots; a Bot sees the
 * `pt_*` portfolio from `tools.js` instead.
 *
 * @module project-teams/lib/host/owner-tools
 */

import { defineTool } from './dsh-tools.js'
import { ownerActor } from './permissions.js'
import { safeJson } from './verify.js'

/**
 * Shared output contract: one-line summary plus JSON text.
 * @returns {Record<string, any>} tool output declaration.
 */
function output() {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        summary: { type: 'string', required: true },
        data: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: `owner: ${value.summary}` }],
  }
}

/**
 * Serialize a result for the `data` field.
 * @param {unknown} value - result.
 * @returns {string} JSON text.
 */
function json(value) {
  return JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? Number(inner) : inner), 2)
}

/**
 * Register the owner tools.
 *
 * @param {any} ctx - plugin context.
 * @param {{
 *   service: import('./service.js').ProjectTeamsService,
 *   isBotSession: (sessionId: string) => boolean,
 * }} deps - dependencies.
 * @returns {void}
 */
export function registerOwnerTools(ctx, deps) {
  const { service, isBotSession } = deps
  const owner = ownerActor()

  ctx.tools.register(defineTool({
    name: 'pt_owner',
    description:
      'Owner-side Project Teams operations, using the same service the workbench uses. '
      + 'Actions: setup (create a project from a local Git repository and optionally generate the 4-Bot team), '
      + 'task_create (title + acceptance criteria), task_submit, task_assign, task_transition (block/unblock/cancel/rework_ready), '
      + 'wake (send an instruction into a Bot Session), interrupt (abort a stuck Bot turn), '
      + 'task_edit (title/description/acceptance while the task is still editable), budgets (token/message/parallel limits), '
      + 'verify_artifacts (hash check of every artifact file), export (JSON snapshot of the project), '
      + 'view (project summary with team, tasks and gates), gate (one task\'s verification gate). '
      + 'Approvals, pausing, archiving and policy edits are NOT available here: they stay in the workbench Decision Inbox.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['setup', 'task_create', 'task_submit', 'task_assign', 'task_transition', 'task_edit', 'execute_merge', 'create_pr', 'rollback_merge', 'repair_bot', 'wake', 'interrupt', 'view', 'gate', 'budgets', 'verify_artifacts', 'export', 'dashboard', 'timeline'],
        description: 'Operation.',
      },
      projectId: { type: 'string', description: 'Project id (or use projectName with action=setup).' },
      projectName: { type: 'string', description: 'Project name (setup).' },
      repoRoot: { type: 'string', description: 'Absolute path of a local Git repository with at least one commit (setup).' },
      goal: { type: 'string', description: 'Project goal (setup).' },
      checksJson: { type: 'string', description: 'JSON array of policy checks, e.g. [{"type":"test","command":"npm test","required":true}] (setup).' },
      generateTeam: { type: 'boolean', description: 'Create and bind the four Bot Sessions during setup (default true).' },
      taskId: { type: 'string', description: 'Task id for task_submit / task_assign / gate.' },
      title: { type: 'string', description: 'Task title (task_create).' },
      description: { type: 'string', description: 'Task description (task_create).' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'Acceptance criteria (task_create); at least one is required.' },
      riskLevel: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Risk level (task_create).' },
      role: { type: 'string', enum: ['pm', 'developer', 'reviewer', 'qa'], description: 'Target role for task_assign or wake.' },
      transition: { type: 'string', description: 'Transition for task_transition: block, unblock, submit_review, rework_ready, cancel, verify, complete, reject.' },
      botId: { type: 'string', description: 'Target bot id for interrupt.' },
      changeId: { type: 'string', description: 'Change request id (execute_merge / create_pr / rollback_merge).' },
      limit: { type: 'number', description: 'Row limit for timeline (default 20).' },
      reason: { type: 'string', description: 'Reason recorded with a transition.' },
      text: { type: 'string', description: 'Instruction delivered into the target Bot Session (wake).' },
      // Budgets (action=budgets). 0 means "unlimited" for the token limits.
      maxParallelRuns: { type: 'number', description: 'Maximum concurrent runs in the project.' },
      perRunMessageLimit: { type: 'number', description: 'Message budget per task.' },
      hourlyMessageLimit: { type: 'number', description: 'Message budget per hour per project.' },
      maxRetries: { type: 'number', description: 'Delivery retry cap before DEAD_LETTER.' },
      perRunTokenLimit: { type: 'number', description: 'Measured token budget of one run (0 = unlimited).' },
      dailyTokenLimit: { type: 'number', description: 'Measured token budget per project per 24h (0 = unlimited).' },
    },
    output: output(),
    async execute(args) {
      const action = String(args.action)
      const projectId = args.projectId === undefined ? '' : String(args.projectId)

      if (action === 'setup') {
        const policy = { checks: safeJson(String(args.checksJson ?? '[]'), []) }
        const project = await service.createProject(owner, {
          name: String(args.projectName ?? ''),
          goal: String(args.goal ?? ''),
          repoRoot: String(args.repoRoot ?? ''),
          policy,
        })
        let bots = []
        if (args.generateTeam !== false) {
          bots = await service.createTeam(owner, project.id, { presets: {} })
        }
        return {
          ok: true,
          summary: `project ${project.id} "${project.name}" with ${bots.length} bot(s)`,
          data: json({
            project: { id: project.id, name: project.name, repoRoot: project.repo_root, head: project.repository?.headCommit, policy },
            bots: bots.map((bot) => ({ id: bot.id, role: bot.role, sessionId: bot.session_id, preset: bot.agent_preset })),
          }),
        }
      }

      if (action === 'task_create') {
        const task = service.createTask(owner, projectId, {
          title: String(args.title ?? ''),
          description: String(args.description ?? ''),
          acceptance: args.acceptance,
          riskLevel: args.riskLevel,
        })
        return { ok: true, summary: `created ${task.id}`, data: json({ id: task.id, status: task.status, version: task.version }) }
      }

      if (action === 'task_submit') {
        const task = service.task(String(args.taskId ?? ''))
        const updated = service.transition(owner, task.id, 'submit', { expectedVersion: task.version })
        return { ok: true, summary: `${task.id} is ${updated.status}`, data: json({ id: updated.id, status: updated.status, version: updated.version }) }
      }

      if (action === 'task_assign') {
        const task = service.task(String(args.taskId ?? ''))
        const bot = service.db.prepare('SELECT * FROM project_bots WHERE project_id = ? AND role = ?').get(task.project_id, String(args.role ?? ''))
        if (bot === undefined) throw new Error(`project has no ${String(args.role ?? '')} bot`)
        const updated = service.assignTask(owner, task.id, bot.id, task.version)
        return { ok: true, summary: `${task.id} assigned to ${bot.role}`, data: json({ id: updated.id, status: updated.status, owner: updated.owner_bot_id }) }
      }

      if (action === 'task_edit') {
        const task = service.task(String(args.taskId ?? ''))
        const updated = service.updateTask(owner, task.id, {
          title: args.title === undefined ? undefined : String(args.title),
          description: args.description === undefined ? undefined : String(args.description),
          acceptance: args.acceptance === undefined ? undefined : args.acceptance,
          riskLevel: args.riskLevel === undefined ? undefined : String(args.riskLevel),
          expectedVersion: task.version,
        })
        return { ok: true, summary: `${task.id} updated (v${updated.version})`, data: json({ id: updated.id, status: updated.status, acceptance: updated.acceptance }) }
      }

      if (action === 'execute_merge') {
        const result = await service.executeMerge(owner, String(args.changeId ?? ''))
        return { ok: true, summary: result.alreadyMerged ? 'already merged' : `merged into ${result.into} at ${String(result.mergeCommit).slice(0, 12)}`, data: json(result) }
      }

      if (action === 'repair_bot') {
        const repaired = await service.repairBotSession(owner, projectId, String(args.botId ?? ''))
        return { ok: true, summary: 'bot ' + repaired.label + ' now runs in ' + repaired.session_id, data: json(repaired) }
      }

      if (action === 'create_pr') {
        const pr = await service.createPullRequest(owner, String(args.changeId ?? ''))
        return { ok: true, summary: 'pull request ' + pr.url, data: json(pr) }
      }

      if (action === 'rollback_merge') {
        const result = await service.rollbackMerge(owner, String(args.changeId ?? ''))
        return { ok: true, summary: 'reverted in ' + String(result.revertCommit).slice(0, 12), data: json(result) }
      }

      if (action === 'budgets') {
        const budget = service.updateBudgets(owner, projectId, {
          maxParallelRuns: args.maxParallelRuns === undefined ? undefined : Number(args.maxParallelRuns),
          perRunMessageLimit: args.perRunMessageLimit === undefined ? undefined : Number(args.perRunMessageLimit),
          hourlyMessageLimit: args.hourlyMessageLimit === undefined ? undefined : Number(args.hourlyMessageLimit),
          maxRetries: args.maxRetries === undefined ? undefined : Number(args.maxRetries),
          perRunTokenLimit: args.perRunTokenLimit === undefined ? undefined : Number(args.perRunTokenLimit),
          dailyTokenLimit: args.dailyTokenLimit === undefined ? undefined : Number(args.dailyTokenLimit),
        })
        return { ok: true, summary: 'budgets updated', data: json(budget) }
      }

      if (action === 'dashboard') {
        const metrics = service.dashboard(owner, projectId)
        return { ok: true, summary: 'completion ' + metrics.tasks.completionRate + '%, checks ' + metrics.checks.passRate + '%, findings ' + JSON.stringify(metrics.reviews.findings), data: json(metrics) }
      }

      if (action === 'timeline') {
        const rows = service.timeline(owner, projectId, { limit: args.limit === undefined ? 20 : Number(args.limit) })
        return { ok: true, summary: rows.length + ' timeline entr(ies)', data: json(rows) }
      }

      if (action === 'verify_artifacts') {
        const report = await service.verifyArtifacts(owner, projectId)
        return { ok: true, summary: `${report.ok}/${report.checked} ok, ${report.missing} missing, ${report.corrupted} corrupted`, data: json(report) }
      }

      if (action === 'export') {
        const snapshot = service.exportProject(owner, projectId)
        return { ok: true, summary: `exported ${snapshot.tasks.length} task(s)`, data: json({ project: snapshot.project.id, tasks: snapshot.tasks.length, messages: snapshot.messages.length, audit: snapshot.audit.length }) }
      }

      if (action === 'task_transition') {
        const task = service.task(String(args.taskId ?? ''))
        const updated = service.transition(owner, task.id, String(args.transition ?? ''), {
          reason: args.reason === undefined ? undefined : String(args.reason),
          expectedVersion: task.version,
        })
        return { ok: true, summary: `${task.id} → ${updated.status}`, data: json({ id: updated.id, status: updated.status, gate: updated.gate }) }
      }

      if (action === 'interrupt') {
        const result = await service.interruptBot(owner, { projectId, botId: String(args.botId ?? '') })
        return { ok: true, summary: `interrupted ${result.bot.role}: ${result.interrupted}`, data: json({ botId: result.bot.id, interrupted: result.interrupted }) }
      }

      if (action === 'wake') {
        const result = await service.wakeBot(owner, {
          projectId,
          role: args.role === undefined ? undefined : String(args.role),
          text: String(args.text ?? ''),
        })
        return {
          ok: true,
          summary: `woke ${result.bot.role} (${result.receipt.path})`,
          data: json({ botId: result.bot.id, sessionId: result.bot.session_id, receipt: result.receipt }),
        }
      }

      if (action === 'gate') {
        const task = service.task(String(args.taskId ?? ''))
        return { ok: true, summary: `gate ${service.gate(task.id).status}`, data: json({ task: task.id, status: task.status, gate: service.gate(task.id) }) }
      }

      if (action === 'view') {
        const project = service.projectSummary(service.project(projectId))
        const bots = await service.listTeam(owner, projectId)
        const tasks = service.listTasks(owner, projectId)
        const messages = service.listMessages(owner, projectId, { limit: 30 })
        return {
          ok: true,
          summary: `${project.name}: ${bots.length} bot(s), ${tasks.length} task(s)`,
          data: json({
            project,
            bots: bots.map((bot) => ({ id: bot.id, role: bot.role, sessionId: bot.session_id, liveness: bot.liveness.state, currentTask: bot.currentTask, preset: bot.agent_preset })),
            tasks: tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, owner: task.owner_bot_id, gate: task.gate.status, head: task.head_commit })),
            messages: messages.map((message) => ({ id: message.id, type: message.type, from: message.from_bot_id, to: message.to_bot_id, state: message.state, task: message.task_id })),
          }),
        }
      }

      throw new Error(`unsupported action "${action}"`)
    },
  }), {
    when: ({ agent }) => {
      const sessionId = agent?.session?.id
      return sessionId !== undefined && isBotSession(String(sessionId)) === false
    },
  })
}
