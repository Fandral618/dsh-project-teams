/**
 * DSH Session Adapter.
 *
 * Every Host-side dependency on the running DSH session subsystem passes
 * through this module, so the business layers never hard-code a host API:
 *
 * - `ctx.sessionController.create` creates an ORDINARY childless Session and
 *   starts its Agent (no `origin: 'subagent'`, no `parentSessionId`);
 * - `ctx.sessionController.prompt` admits a durable user message and resumes a
 *   cold Session when it has no live Agent;
 * - `ctx.sessionController.list` reads Session identity without activating an
 *   Agent;
 * - `ctx.sessions.get` reads the live Session object for durable-log evidence.
 *
 * Verified against DSH 0.2.2-rc.3 (`docs/compatibility-matrix.md`, C01–C04).
 *
 * @module project-teams/lib/host/session-adapter
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { PtError } from './http.js'

/**
 * @typedef {Readonly<{
 *   sessionId: string,
 *   agentPreset?: string,
 *   presetRejected?: string,
 *   presetFailure?: string,
 * }>} CreatedSession
 */

/**
 * @typedef {Readonly<{
 *   targetSessionId: string,
 *   accepted: boolean,
 *   path: 'live' | 'cold-resume',
 *   requestId: string,
 *   mode: 'queue' | 'steer',
 * }>} DeliveryReceipt
 */

/**
 * Read one optional Cordis service without failing activation when the profile
 * does not compose it.
 *
 * `ctx.get(name)` is the documented "read a service from the store without the
 * inject requirement" seam (Cordis API, `ctx.get(name, strict?)`), so a profile
 * that omits an optional service degrades instead of blocking this plugin.
 * @param {any} ctx - plugin context.
 * @param {string} name - service name.
 * @returns {any} the service, or undefined.
 */
export function optionalService(ctx, name) {
  try {
    if (typeof ctx.get === 'function') return ctx.get(name, false)
    return ctx[name]
  } catch {
    return undefined
  }
}

/**
 * The DSH Session Adapter bound to one plugin context.
 */
export class SessionAdapter {
  /**
   * @param {any} ctx - plugin context carrying `sessionController`, `sessions` and `agents`.
   */
  constructor(ctx) {
    this.ctx = ctx
  }

  /**
   * Identity facts about the running host, recorded as compatibility evidence.
   * @returns {Record<string, unknown>} environment facts.
   */
  environment() {
    return {
      electron: process.versions.electron ?? null,
      node: process.versions.node,
      chrome: process.versions.chrome ?? null,
      platform: process.platform,
      dshProfile: process.env.DSH_PROFILE ?? null,
      dshInstallDir: process.env.DSH_INSTALL_DIR ?? null,
      hasSessionController: typeof this.ctx.sessionController?.create === 'function',
      hasSessions: typeof this.ctx.sessions?.create === 'function',
      hasAgents: typeof this.ctx.agents?.get === 'function',
      hasWebServer: typeof this.ctx.webServer?.register === 'function',
      hasConnection: typeof this.ctx.connection?.requestRejection === 'function',
      hasTools: typeof this.ctx.tools?.register === 'function',
      hasSystemPrompt: typeof this.ctx.systemPrompt?.section === 'function',
      sqlite: hasSqlite(),
    }
  }

  /**
   * Create one ordinary, independent Session.
   *
   * The request names only a directory and an optional Agent preset: an
   * ordinary Session has no parent and no subagent origin, which is what makes
   * a project Bot a peer rather than a child of the creating Agent.
   *
   * @param {{cwd: string, agentPreset?: string, title?: string}} input - creation input.
   * @returns {Promise<CreatedSession>} created Session identity.
   */
  async createSession(input) {
    const controller = this.ctx.sessionController
    if (typeof controller?.create !== 'function') {
      throw new PtError('session/unavailable', 'this Host does not expose ctx.sessionController.create', 503)
    }
    /** @type {Record<string, unknown>} */
    const request = { cwd: input.cwd }
    if (input.agentPreset !== undefined && input.agentPreset !== '') request.agentPreset = input.agentPreset
    let value
    try {
      value = await controller.create(request)
    } catch (error) {
      // A preset the deployment does not roster must not block Session creation;
      // the failure is reported to the caller so it becomes visible evidence.
      if (request.agentPreset !== undefined) {
        const reason = error instanceof Error ? error.message : String(error)
        const fallback = await controller.create({ cwd: input.cwd })
        if (input.title !== undefined) await this.rename(fallback.sessionId, input.title)
        return {
          sessionId: String(fallback.sessionId),
          agentPreset: fallback.agentPreset === undefined ? undefined : String(fallback.agentPreset),
          presetRejected: request.agentPreset,
          presetFailure: reason,
        }
      }
      throw error
    }
    const sessionId = String(value.sessionId)
    if (input.title !== undefined) await this.rename(sessionId, input.title)
    return {
      sessionId,
      agentPreset: value.agentPreset === undefined ? undefined : String(value.agentPreset),
    }
  }

  /**
   * Rename a Session. Best effort: a rename failure never fails the operation
   * that created the Session.
   * @param {string} sessionId - target Session.
   * @param {string} title - new title.
   * @returns {Promise<void>} resolves after the attempt.
   */
  async rename(sessionId, title) {
    try {
      await this.ctx.sessionController.rename({ sessionId, title })
    } catch {
      // Title is presentation only.
    }
  }

  /**
   * Admit one durable user message into a target Session, resuming it when cold.
   *
   * `mode: 'queue'` appends to the next-turn inbox; `mode: 'steer'` asks for the
   * nearest step of a running turn. The returned receipt is the Host's
   * acceptance of the INPUT — it is not proof that the receiving Bot processed
   * the message, which the message service records separately.
   *
   * @param {{targetSessionId: string, text: string, mode?: 'queue'|'steer', signal?: AbortSignal}} input - delivery input.
   * @returns {Promise<DeliveryReceipt>} acceptance receipt.
   */
  async deliver(input) {
    const controller = this.ctx.sessionController
    if (typeof controller?.prompt !== 'function') {
      throw new PtError('session/unavailable', 'this Host does not expose ctx.sessionController.prompt', 503)
    }
    const live = this.isLive(input.targetSessionId)
    const requestId = randomUUID()
    const mode = input.mode ?? 'queue'
    const controllerSignal = input.signal ?? new AbortController().signal
    const value = await controller.prompt(
      {
        requestId,
        sessionId: input.targetSessionId,
        mode,
        content: [{ type: 'text', text: input.text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      controllerSignal,
    )
    if (value?.accepted !== true) {
      throw new PtError('message/not-accepted', `Host rejected the prompt for ${input.targetSessionId}`, 502)
    }
    return { targetSessionId: input.targetSessionId, accepted: true, path: live ? 'live' : 'cold-resume', requestId, mode }
  }

  /**
   * Whether a Session currently owns a live Agent.
   * @param {string} sessionId - Session identity.
   * @returns {boolean} live flag.
   */
  isLive(sessionId) {
    try {
      return this.ctx.agents?.get(sessionId) !== undefined
    } catch {
      return false
    }
  }

  /**
   * Probe one Session's identity and independence.
   * @param {string} sessionId - Session identity.
   * @returns {Promise<Record<string, unknown>>} identity facts.
   */
  async inspectSession(sessionId) {
    /** @type {any} */
    let summary
    try {
      const list = await this.ctx.sessionController.list({})
      summary = list?.items?.find((item) => String(item.sessionId) === sessionId)
    } catch (error) {
      summary = undefined
      if (error instanceof Error && /not-found/i.test(error.message)) summary = undefined
    }
    const live = this.ctx.sessions?.get?.(sessionId)
    const header = live?.header
    return {
      sessionId,
      found: summary !== undefined || live !== undefined,
      live: live !== undefined,
      parentSessionId: summary?.parentSessionId === undefined ? header?.parentSessionId ?? null : String(summary.parentSessionId),
      origin: summary?.origin ?? null,
      cwd: summary?.cwd ?? header?.cwd ?? null,
      running: summary?.running ?? false,
      agentAvailable: summary?.agentAvailable ?? live !== undefined,
      agentPreset: live === undefined ? null : (optionalService(this.ctx, 'agentPresets')?.presetForSession?.(live) ?? null),
    }
  }

  /**
   * Read the text of the most recent durable user messages of one Session.
   * @param {string} sessionId - Session identity.
   * @param {number} [limit] - number of messages to return.
   * @returns {string[]} newest-last text bodies.
   */
  async recentUserTexts(sessionId, limit = 5) {
    const live = this.ctx.sessions?.get?.(sessionId)
    if (live === undefined) {
      // A cold Session has no live object, but its durable log is exactly what a
      // restart check must read: page it without activating an Agent.
      return this.durableUserTexts(sessionId, limit)
    }
    const messages = live.deriveMessages()
    /** @type {string[]} */
    const texts = []
    for (const message of messages) {
      if (message.role !== 'user') continue
      const text = (message.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      if (text.trim() !== '') texts.push(text)
    }
    return texts.slice(-limit)
  }

  /**
   * Read the last user messages of a COLD Session from durable storage.
   *
   * `sessionController.events` is the cold-safe history read: it takes a durable
   * address, never resumes the Agent, and returns committed log records. This is
   * what makes a delivered message verifiable after a process restart.
   *
   * @param {string} sessionId - Session id.
   * @param {number} [limit] - number of messages to return.
   * @returns {Promise<string[]>} newest-last text bodies.
   */
  async durableUserTexts(sessionId, limit = 5) {
    const controller = this.ctx.sessionController
    if (typeof controller?.events !== 'function') return []
    try {
      const page = await controller.events(
        { address: { kind: 'session', sessionId }, maxMessages: Math.max(20, limit * 4) },
        new AbortController().signal,
      )
      /** @type {string[]} */
      const texts = []
      for (const record of page?.records ?? []) {
        const event = record?.event
        if (event?.type !== 'user/message') continue
        const content = Array.isArray(event.data?.content) ? event.data.content : []
        const text = content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n')
        if (typeof text === 'string' && text.trim() !== '') texts.push(text)
      }
      return texts.slice(-limit)
    } catch {
      return []
    }
  }
}

/** Cached result of the built-in SQLite availability probe. @type {boolean | undefined} */
let sqliteAvailable

/**
 * Whether the built-in `node:sqlite` module can open a database in this Host
 * runtime. The store uses the same module, so this probe is the compatibility
 * answer for the persistence requirement (C11).
 * @returns {boolean} availability.
 */
export function hasSqlite() {
  if (sqliteAvailable !== undefined) return sqliteAvailable
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE probe (a INTEGER)')
    db.close()
    sqliteAvailable = true
  } catch {
    sqliteAvailable = false
  }
  return sqliteAvailable
}
