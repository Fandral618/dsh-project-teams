/**
 * Role permissions, expressed as capabilities.
 *
 * A Bot's role is a label; what it may do is a set of CAPABILITIES. The four
 * built-in roles map to fixed sets, and a custom role declares its own set in its
 * template's `tool_policy.capabilities` (spec §0.4 P1: custom roles). Everything
 * else in the engine authorizes against capabilities, so adding a role such as
 * `frontend` or `architect` never touches the ACL code.
 *
 * The matrix in `docs/api-contracts.md` is generated from this file.
 *
 * @module project-teams/lib/host/permissions
 */

/** Roles the plugin ships with. A project may also use any role that has a template. */
export const BUILTIN_ROLES = Object.freeze(['pm', 'developer', 'reviewer', 'qa'])

/** Every capability the engine understands. */
export const CAPABILITIES = Object.freeze(['coordinate', 'write', 'review', 'verify', 'message'])

/** Capabilities of the built-in roles. */
const BUILTIN_CAPABILITIES = Object.freeze({
  pm: Object.freeze(['coordinate', 'message']),
  developer: Object.freeze(['write', 'message']),
  reviewer: Object.freeze(['review', 'message']),
  qa: Object.freeze(['write', 'verify', 'message']),
})

/**
 * @typedef {Readonly<{
 *   kind: 'owner'|'bot'|'system',
 *   id: string,
 *   role: string,
 *   projectId: string | null,
 *   sessionId?: string,
 *   capabilities?: ReadonlySet<string>,
 * }>} Actor
 */

/**
 * Capabilities of one role, from its template's `tool_policy.capabilities` when
 * declared, otherwise from the built-in table. An unknown role with no declared
 * capabilities gets only `message`, so a typo cannot grant authority.
 *
 * @param {string} role - role label.
 * @param {Record<string, any>} [toolPolicy] - the role template's tool policy.
 * @returns {Set<string>} capabilities.
 */
export function capabilitiesForRole(role, toolPolicy) {
  const declared = Array.isArray(toolPolicy?.capabilities)
    ? toolPolicy.capabilities.map(String).filter((entry) => CAPABILITIES.includes(entry))
    : []
  if (declared.length > 0) return new Set(declared)
  const builtin = BUILTIN_CAPABILITIES[role]
  return new Set(builtin === undefined ? ['message'] : builtin)
}

/**
 * The human owner of this installation.
 * @returns {Actor} owner actor.
 */
export function ownerActor() {
  return Object.freeze({ kind: 'owner', id: 'owner', role: 'owner', projectId: null, capabilities: new Set(CAPABILITIES) })
}

/**
 * The deterministic service itself (gate evaluation, dispatcher, scheduler).
 * @param {string | null} projectId - project scope, if any.
 * @returns {Actor} system actor.
 */
export function systemActor(projectId = null) {
  return Object.freeze({ kind: 'system', id: 'system', role: 'system', projectId, capabilities: new Set(CAPABILITIES) })
}

/**
 * A project Bot. `id` is the bot row id (what ownership compares), `sessionId` is
 * the DSH Session the call arrived from, and `capabilities` is resolved from the
 * Bot's role template.
 * @param {{botId: string, role: string, projectId: string, sessionId?: string, capabilities?: ReadonlySet<string>}} input - bot identity.
 * @returns {Actor} bot actor.
 */
export function botActor(input) {
  return Object.freeze({
    kind: 'bot',
    id: input.botId,
    role: input.role,
    projectId: input.projectId,
    capabilities: input.capabilities ?? capabilitiesForRole(input.role),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
  })
}

/**
 * One permission rule.
 *
 * - `ownerOnly` — the human owner and nobody else (approvals, policy, merge execution).
 * - `member` — any project member (owner included).
 * - `any` — at least one of these capabilities.
 * - `own` — a Bot may only act on a resource it owns (the service passes `ownsResource`).
 */
const MATRIX = Object.freeze({
  'project.create': { ownerOnly: true },
  'project.update': { ownerOnly: true },
  'project.archive': { ownerOnly: true },
  'project.restore': { ownerOnly: true },
  'project.export': { ownerOnly: true },
  'project.pause': { any: ['coordinate'] },
  'project.resume': { any: ['coordinate'] },
  'bot.create': { ownerOnly: true },
  'bot.rebind': { ownerOnly: true },
  'bot.repair': { ownerOnly: true },
  'bot.retire': { ownerOnly: true },
  'template.write': { ownerOnly: true },
  'budget.write': { ownerOnly: true },
  // Waking a Bot from the owner's own Session (the human telling a member to do
  // something). A Bot cannot wake another Bot through this operation.
  'bot.wake': { ownerOnly: true },
  // Abort one Bot's stuck turn (an unanswered approval, a runaway step).
  'bot.interrupt': { ownerOnly: true },
  'task.create': { any: ['coordinate'] },
  'task.edit': { any: ['coordinate'] },
  'task.propose': { member: true },
  'task.assign': { any: ['coordinate'] },
  'task.claim': { any: ['write'] },
  'task.transition': { member: true },
  'task.read': { member: true },
  'run.start': { any: ['write'], own: true },
  'run.heartbeat': { any: ['write'], own: true },
  'run.finish': { any: ['write'], own: true },
  'artifact.submit': { any: ['write'], own: true },
  'verification.run': { any: ['write', 'verify'] },
  'review.request': { any: ['write'], own: true },
  'review.submit': { any: ['review'] },
  'approval.decide': { ownerOnly: true },
  'change.decide': { ownerOnly: true },
  // Executing an already-approved merge; it never decides anything itself.
  'merge.execute': { ownerOnly: true },
  'pr.create': { ownerOnly: true },
  'merge.rollback': { ownerOnly: true },
  'change.propose': { member: true },
  'message.send': { any: ['message'] },
  'message.broadcast': { ownerOnly: true },
  'message.ack': { any: ['message'], own: true },
  'audit.read': { any: ['coordinate'] },
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
  if (rule.ownerOnly === true) {
    if (actor.kind !== 'owner') {
      return { ok: false, code: 'FORBIDDEN', message: `role "${actor.role}" may not perform "${operation}"` }
    }
  } else if (rule.member !== true) {
    const capabilities = actor.capabilities ?? (actor.kind === 'owner' ? new Set(CAPABILITIES) : capabilitiesForRole(actor.role))
    if (!rule.any.some((capability) => capabilities.has(capability))) {
      const held = [...capabilities].sort().join(',') || 'none'
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: `role "${actor.role}" may not perform "${operation}" (needs ${rule.any.join('|')}, holds ${held})`,
      }
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
 * Whether a role may write engineering files (capability `write`).
 * @param {string} role - bot role label.
 * @param {Record<string, any>} [toolPolicy] - role template tool policy.
 * @returns {boolean} writable.
 */
export function canWriteCode(role, toolPolicy) {
  return capabilitiesForRole(role, toolPolicy).has('write')
}

/**
 * Whether a role may run arbitrary verification commands.
 * @param {string} role - bot role label.
 * @param {Record<string, any>} [toolPolicy] - role template tool policy.
 * @returns {boolean} allowed.
 */
export function canRunVerification(role, toolPolicy) {
  const capabilities = capabilitiesForRole(role, toolPolicy)
  return capabilities.has('write') || capabilities.has('verify')
}
