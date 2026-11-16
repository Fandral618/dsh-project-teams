/**
 * Role permissions.
 *
 * The matrix in `docs/api-contracts.md` §Permissions is implemented here as
 * code. Both callers — a Bot through a model tool and the human through the
 * Host API — are resolved to an {@link Actor} and pass through the same
 * assertions, so hiding a button in the UI is never the security boundary.
 *
 * @module project-teams/lib/host/permissions
 */

/** Roles a project Bot may hold (P0). */
export const ROLES = Object.freeze(['pm', 'developer', 'reviewer', 'qa'])

/**
 * @typedef {Readonly<{
 *   kind: 'owner'|'bot'|'system',
 *   id: string,
 *   role: string,
 *   projectId: string | null,
 *   sessionId?: string,
 * }>} Actor
 */

/**
 * The human owner of this installation.
 * @returns {Actor} owner actor.
 */
export function ownerActor() {
  return Object.freeze({ kind: 'owner', id: 'owner', role: 'owner', projectId: null })
}

/**
 * The deterministic service itself (gate evaluation, dispatcher, scheduler).
 * @param {string | null} projectId - project scope, if any.
 * @returns {Actor} system actor.
 */
export function systemActor(projectId = null) {
  return Object.freeze({ kind: 'system', id: 'system', role: 'system', projectId })
}

/**
 * A project Bot. `id` is the bot row id (what ownership compares), and
 * `sessionId` is the DSH Session the call arrived from.
 * @param {{botId: string, role: string, projectId: string, sessionId?: string}} input - bot identity.
 * @returns {Actor} bot actor.
 */
export function botActor(input) {
  return Object.freeze({
    kind: 'bot',
    id: input.botId,
    role: input.role,
    projectId: input.projectId,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  })
}

/**
 * One permission rule: which roles may call which operation.
 *
 * `own` marks operations a Bot may only perform on a resource it owns; the
 * service passes the ownership answer through `context.ownsResource`.
 */
const MATRIX = Object.freeze({
  'project.create': { roles: ['owner'] },
  'project.update': { roles: ['owner'] },
  'project.archive': { roles: ['owner'] },
  'project.pause': { roles: ['owner', 'pm'] },
  'project.resume': { roles: ['owner', 'pm'] },
  'bot.create': { roles: ['owner'] },
  'template.write': { roles: ['owner'] },
  'budget.write': { roles: ['owner'] },
  'project.export': { roles: ['owner'] },
  'bot.rebind': { roles: ['owner'] },
  'bot.retire': { roles: ['owner'] },
  // Waking a Bot from the owner's own Session (the human telling a member to do
  // something). A Bot cannot wake another Bot through this operation.
  'bot.wake': { roles: ['owner'] },
  // Abort one Bot's stuck turn (an unanswered approval, a runaway step).
  'bot.interrupt': { roles: ['owner'] },
  'task.create': { roles: ['owner', 'pm'] },
  'task.edit': { roles: ['owner', 'pm'] },
  'task.propose': { roles: ['owner', 'pm', 'developer', 'reviewer', 'qa'] },
  'task.assign': { roles: ['owner', 'pm'] },
  'task.claim': { roles: ['developer', 'qa', 'reviewer'], own: true },
  'task.transition': { roles: ['owner', 'pm', 'developer', 'reviewer', 'qa', 'system'], own: true },
  'task.read': { roles: ['owner', 'pm', 'developer', 'reviewer', 'qa', 'system'] },
  'run.start': { roles: ['developer', 'qa', 'owner', 'pm'], own: true },
  'run.heartbeat': { roles: ['developer', 'qa'], own: true },
  'run.finish': { roles: ['developer', 'qa', 'owner', 'system'], own: true },
  'artifact.submit': { roles: ['developer', 'qa'], own: true },
  'verification.run': { roles: ['developer', 'qa', 'owner', 'system'], own: true },
  'review.request': { roles: ['developer', 'qa', 'owner', 'pm'], own: true },
  'review.submit': { roles: ['reviewer'], own: true },
  'approval.decide': { roles: ['owner'] },
  // Executing an already-approved merge; it never decides anything itself.
  'merge.execute': { roles: ['owner'] },
  'change.decide': { roles: ['owner'] },
  'change.propose': { roles: ['owner', 'pm', 'developer', 'reviewer', 'qa'] },
  'message.send': { roles: ['owner', 'pm', 'developer', 'reviewer', 'qa'] },
  'message.ack': { roles: ['pm', 'developer', 'reviewer', 'qa'], own: true },
  'audit.read': { roles: ['owner', 'pm'] },
})

/**
 * Decide one operation.
 *
 * @param {Actor} actor - acting identity.
 * @param {string} operation - operation key from the matrix.
 * @param {{ownsResource?: boolean, projectScope?: string | null}} [context] - resource context.
 * @returns {{ok: true} | {ok: false, code: string, message: string}} decision.
 */
export function authorize(actor, operation, context = {}) {
  const rule = MATRIX[operation]
  if (rule === undefined) {
    return { ok: false, code: 'UNKNOWN_OPERATION', message: `unknown operation "${operation}"` }
  }
  if (!rule.roles.includes(actor.role) && !rule.roles.includes(actor.kind)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `role "${actor.role}" may not perform "${operation}"`,
    }
  }
  if (rule.own === true && actor.kind === 'bot' && context.ownsResource !== true) {
    return {
      ok: false,
      code: 'FORBIDDEN_OWNERSHIP',
      message: `bot ${actor.id} does not own the target of "${operation}"`,
    }
  }
  if (
    actor.projectId !== null
    && context.projectScope !== undefined
    && context.projectScope !== null
    && context.projectScope !== actor.projectId
  ) {
    return {
      ok: false,
      code: 'CROSS_PROJECT',
      message: `actor ${actor.id} is bound to project ${actor.projectId}, not ${context.projectScope}`,
    }
  }
  return { ok: true }
}

/**
 * Whether a role may write engineering files. Reviewer and PM are read-only in
 * P0: only `developer` and `qa` (test scope) hold a writable worktree.
 * @param {string} role - bot role.
 * @returns {boolean} writable.
 */
export function canWriteCode(role) {
  return role === 'developer'
}

/**
 * Whether a role may run arbitrary verification commands.
 * @param {string} role - bot role.
 * @returns {boolean} allowed.
 */
export function canRunVerification(role) {
  return role === 'developer' || role === 'qa' || role === 'owner' || role === 'system'
}
