/**
 * Test harness: a real SQLite store and a real git repository, with the DSH
 * Session subsystem replaced by a fake adapter.
 *
 * The spec asks for a two-track Session adapter test strategy: the Host-facing
 * behaviour (real DSH Sessions) is verified by the M0 probe inside the running
 * Host, while the business rules here run against the same adapter interface so
 * they can be executed without a GUI.
 *
 * @module project-teams/tests/helpers
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../lib/host/db.js'
import { resolveConfig } from '../lib/host/config.js'
import { MessageDispatcher } from '../lib/host/dispatcher.js'
import { ownerActor, botActor } from '../lib/host/permissions.js'
import { ProjectTeamsService } from '../lib/host/service.js'
import { WorktreeManager } from '../lib/host/worktree.js'

/** Fake Session adapter recording every delivery. */
export class FakeSessionAdapter {
  constructor() {
    this.counter = 0
    /** @type {Map<string, {cwd: string, preset: string | null, texts: string[], live: boolean}>} */
    this.sessions = new Map()
    /** @type {Array<{targetSessionId: string, text: string, mode: string}>} */
    this.deliveries = []
    this.failNext = 0
  }

  environment() {
    return {
      electron: null,
      node: process.versions.node,
      platform: process.platform,
      dshProfile: 'test',
      dshInstallDir: null,
      hasSessionController: true,
      hasSessions: true,
      hasAgents: true,
      hasWebServer: true,
      hasConnection: true,
      hasTools: true,
      hasSystemPrompt: true,
      sqlite: true,
    }
  }

  async createSession(input) {
    this.counter += 1
    const sessionId = `session-test-${this.counter}`
    this.sessions.set(sessionId, { cwd: input.cwd, preset: input.agentPreset ?? null, texts: [], live: true })
    return { sessionId, agentPreset: input.agentPreset }
  }

  async rename() {}

  async deliver(input) {
    if (this.failNext > 0) {
      this.failNext -= 1
      const error = new Error('simulated delivery failure')
      error.code = 'session/unavailable'
      throw error
    }
    const target = this.sessions.get(input.targetSessionId)
    if (target === undefined) {
      const error = new Error(`session ${input.targetSessionId} is unknown`)
      error.code = 'session/not-found'
      throw error
    }
    const requestId = `req-${this.deliveries.length + 1}`
    this.deliveries.push({ targetSessionId: input.targetSessionId, text: input.text, mode: input.mode ?? 'queue', requestId })
    target.texts.push(input.text)
    return { targetSessionId: input.targetSessionId, accepted: true, path: target.live ? 'live' : 'cold-resume', requestId, mode: input.mode ?? 'queue' }
  }

  isLive(sessionId) {
    return this.sessions.get(sessionId)?.live === true
  }

  async inspectSession(sessionId) {
    const session = this.sessions.get(sessionId)
    const parent = this.parents?.get(sessionId) ?? null
    if (session === undefined) {
      return { sessionId, found: parent !== null, live: false, parentSessionId: parent, origin: parent === null ? null : 'subagent', cwd: null, running: false, agentAvailable: false, agentPreset: null }
    }
    return {
      sessionId,
      found: true,
      live: session.live,
      parentSessionId: parent,
      origin: parent === null ? null : 'subagent',
      cwd: session.cwd,
      running: false,
      agentAvailable: session.live,
      agentPreset: session.preset,
    }
  }

  recentUserTexts(sessionId, limit = 5) {
    return (this.sessions.get(sessionId)?.texts ?? []).slice(-limit)
  }
}

/**
 * Create a temporary git repository with one commit.
 * @param {Record<string, string>} [files] - initial files.
 * @returns {string} repository root.
 */
export function makeRepository(files = { 'README.md': '# demo\n' }) {
  const root = mkdtempSync(join(tmpdir(), 'pt-repo-'))
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Project Teams Test'])
  git(['config', 'user.email', 'test@localhost'])
  for (const [name, body] of Object.entries(files)) {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body, 'utf8')
  }
  git(['add', '--all'])
  git(['commit', '-q', '-m', 'initial commit'])
  return root
}

/**
 * Build one isolated environment: data dir, database, service, dispatcher.
 * @param {{checks?: Array<Record<string, unknown>>, requireApprovalForDone?: boolean}} [policy] - project policy.
 * @returns {{service: ProjectTeamsService, dispatcher: MessageDispatcher, adapter: FakeSessionAdapter, repoRoot: string, config: any, db: any, close: () => void}}
 */
export function makeEnvironment(policy = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'pt-data-'))
  const config = resolveConfig({ dataDir, m0AutoProbe: false, maxMessagesPerTask: 6, maxMessagesPerHour: 50, maxRetries: 3 })
  const opened = openDatabase(dataDir, { fileName: ':memory:' })
  const adapter = new FakeSessionAdapter()
  const worktree = new WorktreeManager({ dataDir, worktreeDir: '.project-teams', timeoutMs: 60_000 })
  const cancelled = []
  const service = new ProjectTeamsService({
    db: opened.db, config, adapter, worktree, logger: {},
    cancelAgent: async (sessionId) => { cancelled.push(sessionId); return true },
  })
  const dispatcher = new MessageDispatcher({ db: opened.db, config, adapter, logger: {} })
  const repoRoot = makeRepository()
  return {
    service,
    dispatcher,
    adapter,
    repoRoot,
    config,
    db: opened.db,
    close: () => opened.close(),
    cancelled,
    policy: { checks: policy.checks ?? [], requireApprovalForDone: policy.requireApprovalForDone === true },
  }
}

/**
 * Create a project plus its four-Bot team in one environment.
 * @param {ReturnType<typeof makeEnvironment>} env - environment.
 * @param {Record<string, unknown>} [policy] - extra policy.
 * @returns {Promise<{project: Record<string, any>, bots: Array<Record<string, any>>}>} project and bots.
 */
export async function seedProject(env, policy = {}) {
  const owner = ownerActor()
  const project = await env.service.createProject(owner, {
    name: `demo-${Math.random().toString(36).slice(2, 7)}`,
    goal: 'implement sign-up and sign-in',
    repoRoot: env.repoRoot,
    policy: { ...env.policy, ...policy },
  })
  const bots = await env.service.createTeam(owner, project.id, { presets: { pm: 'standard', developer: 'standard', reviewer: 'ptc', qa: 'standard' } })
  return { project, bots }
}

/**
 * Bot actor for one role of a team.
 * @param {Array<Record<string, any>>} bots - team rows.
 * @param {string} role - role name.
 * @returns {{bot: Record<string, any>, actor: any}} identity.
 */
export function actorOf(bots, role) {
  const bot = bots.find((entry) => entry.role === role)
  if (bot === undefined) throw new Error(`team has no ${role}`)
  return {
    bot,
    actor: botActor({ botId: bot.id, role: bot.role, projectId: bot.project_id, sessionId: bot.session_id }),
  }
}
