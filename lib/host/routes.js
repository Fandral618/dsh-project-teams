/**
 * Host HTTP API of Project Teams.
 *
 * The browser half of the bundle calls these methods on its own origin. Every
 * call is fenced by the Host connection policy, and every mutating call is
 * authorized here by the *service*, not by the page: the page sends intent, the
 * Host decides.
 *
 * Reads use `GET`, writes use `POST`. The method name is the path suffix, e.g.
 * `POST /project-teams/api/tasks.claim`.
 *
 * @module project-teams/lib/host/routes
 */

import { PtError, optionalString, readJsonBody, requireInt, requireString } from './http.js'
import { ownerActor } from './permissions.js'

/** Methods that never mutate state (may be called with GET). */
export const READ_METHODS = Object.freeze(new Set([
  'status',
  'projects.list',
  'projects.get',
  'team.list',
  'tasks.list',
  'tasks.get',
  'messages.list',
  'delivery.list',
  'delivery.diff',
  'decisions.list',
  'activity.list',
  'overview.get',
  'dashboard.get',
  'budgets.get',
  'projectTemplates.list',
  'templates.list',
  'delivery.verify',
  'export.project',
  'm0.get',
]))

/**
 * Build the method table.
 *
 * @param {{
 *   service: import('./service.js').ProjectTeamsService,
 *   dispatcher: import('./dispatcher.js').MessageDispatcher,
 *   adapter: import('./session-adapter.js').SessionAdapter,
 *   config: import('./config.js').ResolvedConfig,
 *   listPresets: () => Promise<string[]>,
 *   readProbe: () => Promise<Record<string, any> | null>,
 *   runProbe: (options: {reuse?: boolean}) => Promise<Record<string, any>>,
 *   verifyProbe: () => Promise<Record<string, any>>,
 * }} deps - dependencies.
 * @returns {Record<string, (body: Record<string, any>, signal: AbortSignal) => Promise<unknown>>} method table.
 */
export function buildRoutes(deps) {
  const { service, dispatcher, adapter, config } = deps
  const owner = ownerActor()

  /** @type {Record<string, (body: Record<string, any>, signal: AbortSignal) => Promise<unknown>>} */
  const methods = {
    'status': async () => ({
      plugin: 'dsh-project-teams',
      version: '1.4.0',
      dataDir: config.dataDir,
      environment: adapter.environment(),
      presets: await deps.listPresets(),
      config: {
        maxParallelRuns: config.maxParallelRuns,
        maxMessagesPerTask: config.maxMessagesPerTask,
        maxMessagesPerHour: config.maxMessagesPerHour,
        maxRetries: config.maxRetries,
        enableAutoWake: config.enableAutoWake,
      },
    }),

    'm0.get': async () => ({ record: await deps.readProbe() }),
    'm0.probe': async (body) => deps.runProbe({ reuse: body.reuse === true }),
    'm0.verify': async () => deps.verifyProbe(),

    // ------------------------------------------------------------- projects
    'projects.list': async () => service.listProjects(owner),
    'projects.get': async (body) => {
      const projectId = requireString(body, 'projectId')
      return { project: service.projectSummary(service.project(projectId)), overview: service.overview(owner, projectId) }
    },
    'projectTemplates.list': async () => service.listProjectTemplates(owner),
    'projectTemplates.write': async (body) => service.upsertProjectTemplate(owner, {
      name: requireString(body, 'name'),
      description: optionalString(body, 'description') ?? '',
      policy: body.policy !== null && typeof body.policy === 'object' ? body.policy : {},
    }),
    'projects.create': async (body) => service.createProject(owner, {
      name: requireString(body, 'name'),
      goal: optionalString(body, 'goal') ?? '',
      repoRoot: requireString(body, 'repoRoot'),
      defaultBranch: optionalString(body, 'defaultBranch'),
      policy: body.policy !== null && typeof body.policy === 'object' ? body.policy : undefined,
      templateId: optionalString(body, 'templateId'),
    }),
    'projects.update': async (body) => service.updateProject(owner, requireString(body, 'projectId'), {
      goal: optionalString(body, 'goal'),
      defaultBranch: optionalString(body, 'defaultBranch'),
      policy: body.policy !== null && typeof body.policy === 'object' ? body.policy : undefined,
    }),
    'projects.archive': async (body) => service.archiveProject(owner, requireString(body, 'projectId')),
    'projects.restore': async (body) => service.restoreProject(owner, requireString(body, 'projectId')),
    'projects.pause': async (body) => service.setPaused(owner, requireString(body, 'projectId'), body.paused !== false),
    'projects.resume': async (body) => service.setPaused(owner, requireString(body, 'projectId'), false),

    // ----------------------------------------------------------------- team
    'team.list': async (body) => service.listTeam(owner, requireString(body, 'projectId')),
    'team.create': async (body) => service.createTeam(owner, requireString(body, 'projectId'), {
      roles: Array.isArray(body.roles) ? body.roles.map(String) : undefined,
      presets: body.presets !== null && typeof body.presets === 'object' ? body.presets : undefined,
      cwd: optionalString(body, 'cwd'),
    }),
    'team.rebind': async (body) => service.bindSession(
      owner,
      requireString(body, 'projectId'),
      requireString(body, 'botId'),
      requireString(body, 'sessionId'),
    ),

    // ---------------------------------------------------------------- tasks
    'tasks.list': async (body) => service.listTasks(owner, requireString(body, 'projectId')),
    'tasks.get': async (body) => service.taskDetail(requireString(body, 'taskId')),
    'tasks.create': async (body) => service.createTask(owner, requireString(body, 'projectId'), {
      title: requireString(body, 'title'),
      description: optionalString(body, 'description') ?? '',
      acceptance: Array.isArray(body.acceptance) ? body.acceptance.map(String) : [],
      dependsOn: Array.isArray(body.dependsOn) ? body.dependsOn.map(String) : [],
      priority: body.priority === undefined ? 50 : requireInt(body, 'priority'),
      riskLevel: optionalString(body, 'riskLevel'),
      writeScope: optionalString(body, 'writeScope') ?? '',
    }),
    'tasks.update': async (body) => service.updateTask(owner, requireString(body, 'taskId'), {
      title: optionalString(body, 'title'),
      description: optionalString(body, 'description'),
      acceptance: Array.isArray(body.acceptance) ? body.acceptance.map(String) : undefined,
      priority: body.priority === undefined ? undefined : requireInt(body, 'priority'),
      riskLevel: optionalString(body, 'riskLevel'),
      writeScope: optionalString(body, 'writeScope'),
      expectedVersion: body.expectedVersion === undefined ? undefined : requireInt(body, 'expectedVersion'),
    }),
    'tasks.transition': async (body) => service.transition(owner, requireString(body, 'taskId'), requireString(body, 'action'), {
      reason: optionalString(body, 'reason'),
      expectedVersion: body.expectedVersion === undefined ? undefined : requireInt(body, 'expectedVersion'),
    }),
    'tasks.assign': async (body) => service.assignTask(
      owner,
      requireString(body, 'taskId'),
      requireString(body, 'botId'),
      requireInt(body, 'expectedVersion'),
    ),
    'tasks.dependency': async (body) => service.addDependency(owner, requireString(body, 'taskId'), requireString(body, 'dependsOn')),
    'tasks.verify': async (body) => service.runVerification(owner, requireString(body, 'taskId'), Array.isArray(body.types) ? body.types.map(String) : undefined),

    // --------------------------------------------------------------- budgets
    'budgets.get': async (body) => {
      const projectId = requireString(body, 'projectId')
      service.require(owner, 'task.read', { projectScope: projectId })
      return service.budget(projectId)
    },
    'budgets.update': async (body) => service.updateBudgets(owner, requireString(body, 'projectId'), {
      maxParallelRuns: body.maxParallelRuns === undefined ? undefined : requireInt(body, 'maxParallelRuns'),
      perRunMessageLimit: body.perRunMessageLimit === undefined ? undefined : requireInt(body, 'perRunMessageLimit'),
      hourlyMessageLimit: body.hourlyMessageLimit === undefined ? undefined : requireInt(body, 'hourlyMessageLimit'),
      maxRetries: body.maxRetries === undefined ? undefined : requireInt(body, 'maxRetries'),
      maxReviewRounds: body.maxReviewRounds === undefined ? undefined : requireInt(body, 'maxReviewRounds'),
      perRunTokenLimit: body.perRunTokenLimit === undefined ? undefined : requireInt(body, 'perRunTokenLimit'),
      dailyTokenLimit: body.dailyTokenLimit === undefined ? undefined : requireInt(body, 'dailyTokenLimit'),
    }),
    'templates.list': async () => service.listTemplates(owner),
    'templates.write': async (body) => service.upsertTemplate(owner, {
      role: requireString(body, 'role'),
      promptText: requireString(body, 'promptText'),
      toolPolicy: body.toolPolicy !== null && typeof body.toolPolicy === 'object' ? body.toolPolicy : undefined,
      skillRefs: Array.isArray(body.skillRefs) ? body.skillRefs.map(String) : undefined,
    }),
    // ------------------------------------------------------------- messages
    'messages.list': async (body) => service.listMessages(owner, requireString(body, 'projectId'), {
      taskId: optionalString(body, 'taskId'),
      state: optionalString(body, 'state'),
      limit: body.limit === undefined ? 100 : requireInt(body, 'limit'),
    }),
    'messages.replay': async (body) => dispatcher.replay(requireString(body, 'messageId')),

    // ------------------------------------------------------------- delivery
    'delivery.list': async (body) => {
      const projectId = requireString(body, 'projectId')
      service.require(owner, 'task.read', { projectScope: projectId })
      const artifacts = service.db.prepare(
        `SELECT a.*, t.title, t.status AS task_status FROM artifacts a JOIN tasks t ON t.id = a.task_id WHERE a.project_id = ? ORDER BY a.created_at DESC LIMIT 100`,
      ).all(projectId)
      const verification = service.db.prepare(
        `SELECT v.* FROM verification_runs v JOIN tasks t ON t.id = v.task_id WHERE t.project_id = ? ORDER BY v.created_at DESC LIMIT 200`,
      ).all(projectId)
      const reviews = service.db.prepare(
        `SELECT r.*, t.title FROM reviews r JOIN tasks t ON t.id = r.task_id WHERE t.project_id = ? ORDER BY r.requested_at DESC LIMIT 100`,
      ).all(projectId)
      return {
        artifacts: artifacts.map((row) => ({ ...row, summary: JSON.parse(row.summary || '{}') })),
        verification,
        reviews: reviews.map((row) => ({ ...row, findings: JSON.parse(row.findings || '[]') })),
      }
    },
    'delivery.diff': async (body) => ({ diff: await service.artifactDiff(requireString(body, 'artifactId')) }),
    'delivery.verify': async (body) => service.verifyArtifacts(owner, requireString(body, 'projectId')),
    'export.project': async (body) => service.exportProject(owner, requireString(body, 'projectId')),

    // ------------------------------------------------------------ decisions
    'decisions.list': async (body) => service.listDecisions(owner, requireString(body, 'projectId')),
    'decisions.decideChange': async (body) => service.decideChange(
      owner,
      requireString(body, 'changeId'),
      requireString(body, 'decision'),
      optionalString(body, 'justification') ?? '',
    ),
    'decisions.executeMerge': async (body) => service.executeMerge(owner, requireString(body, 'changeId')),
    'decisions.approveTask': async (body) => service.decideTaskApproval(owner, {
      taskId: requireString(body, 'taskId'),
      decision: requireString(body, 'decision'),
      justification: optionalString(body, 'justification') ?? '',
      headCommit: optionalString(body, 'headCommit'),
    }),

    // ------------------------------------------------------------- activity
    'activity.list': async (body) => service.activity(owner, requireString(body, 'projectId'), body.limit === undefined ? 100 : requireInt(body, 'limit')),
    'overview.get': async (body) => service.overview(owner, requireString(body, 'projectId')),
    'dashboard.get': async (body) => service.dashboard(owner, requireString(body, 'projectId')),
  }

  // Read methods accept no body; a mutating method reached without a body is
  // still fine because every required field is validated above.
  return methods
}

/**
 * Mount the `/project-teams/api` prefix route.
 *
 * @param {any} ctx - plugin context.
 * @param {string} prefix - route prefix without a trailing slash.
 * @param {Record<string, (body: Record<string, any>, signal: AbortSignal) => Promise<unknown>>} methods - method table.
 * @param {(res: any, error: unknown) => void} writeError - error writer.
 * @param {(res: any, value: unknown) => void} writeOk - success writer.
 * @returns {void}
 */
export function mountRoutes(ctx, prefix, methods, writeError, writeOk) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: `${prefix}/api`,
    handler: async (req, res) => {
      if (ctx.connection.requestRejection(req) !== undefined) {
        writeError(res, new PtError('request/forbidden', 'request rejected by the Host connection policy', 403))
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://project-teams.internal')
        const suffix = url.pathname.startsWith(`${prefix}/api/`) ? url.pathname.slice(`${prefix}/api/`.length) : ''
        if (suffix === '' || suffix.includes('/')) {
          throw new PtError('api/not-found', `unknown Project Teams API method "${suffix}"`, 404)
        }
        const handler = Object.hasOwn(methods, suffix) ? methods[suffix] : undefined
        if (typeof handler !== 'function') {
          throw new PtError('api/not-found', `unknown Project Teams API method "${suffix}"`, 404)
        }
        const readOnly = READ_METHODS.has(suffix)
        const body = readOnly && (req.method === 'GET' || req.method === 'HEAD')
          ? Object.fromEntries(url.searchParams.entries())
          : await readJsonBody(req)
        if (!readOnly && req.method !== 'POST') {
          throw new PtError('api/method-not-allowed', `${req.method} is not allowed on a mutating method`, 405)
        }
        const controller = new AbortController()
        res.once('close', () => controller.abort())
        const value = await handler(body, controller.signal)
        writeOk(res, value)
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'project-teams: host http api')
}
