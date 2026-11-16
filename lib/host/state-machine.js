/**
 * Task state machine — a pure reducer.
 *
 * Every task change in the plugin is decided here, by code, from the current
 * state plus an action. Model text cannot move a task: the tools and the HTTP
 * API both call {@link reduce}, and the service persists the result in one
 * transaction with the event row.
 *
 * The transition table is the one in `docs/task-state-machine.md`.
 *
 * @module project-teams/lib/host/state-machine
 */

/** Task states. */
export const TASK_STATES = Object.freeze([
  'DRAFT',
  'READY',
  'ASSIGNED',
  'RUNNING',
  'IN_REVIEW',
  'VERIFIED',
  'DONE',
  'BLOCKED',
  'REWORK',
  'CANCELLED',
])

/** TaskRun states (separate axis from the task state). */
export const RUN_STATES = Object.freeze(['active', 'completed', 'failed', 'cancelled', 'paused', 'recovery_required'])

/** Terminal task states. */
export const TERMINAL_TASK_STATES = Object.freeze(['DONE', 'CANCELLED'])

/**
 * One transition rule.
 * @typedef {Readonly<{
 *   from: readonly string[],
 *   to: string,
 *   roles: readonly string[],
 *   description: string,
 * }>} TransitionRule
 */

/** Action key = the action name the service accepts. */
export const TRANSITIONS = Object.freeze({
  submit: { from: ['DRAFT'], to: 'READY', roles: ['owner', 'pm', 'developer', 'qa'], description: 'draft accepted as a runnable task' },
  assign: { from: ['READY'], to: 'ASSIGNED', roles: ['owner', 'pm'], description: 'task assigned to a bot by the coordinator' },
  claim: { from: ['READY'], to: 'ASSIGNED', roles: ['developer', 'qa', 'reviewer'], description: 'bot claimed an unassigned task' },
  start: { from: ['ASSIGNED'], to: 'RUNNING', roles: ['developer', 'qa', 'owner', 'pm'], description: 'execution started with a workspace lease' },
  block: { from: ['ASSIGNED', 'RUNNING'], to: 'BLOCKED', roles: ['owner', 'pm', 'developer', 'qa', 'reviewer'], description: 'work cannot continue; a reason is recorded' },
  unblock: { from: ['BLOCKED'], to: 'ASSIGNED', roles: ['owner', 'pm'], description: 'the blocking cause is resolved' },
  submit_review: { from: ['RUNNING'], to: 'IN_REVIEW', roles: ['developer', 'qa'], description: 'an artifact exists for the current head commit' },
  verify: { from: ['IN_REVIEW'], to: 'VERIFIED', roles: ['system', 'owner'], description: 'every required machine check and the review passed' },
  reject: { from: ['IN_REVIEW'], to: 'REWORK', roles: ['reviewer', 'owner', 'system'], description: 'review findings require changes' },
  rework_ready: { from: ['REWORK'], to: 'READY', roles: ['owner', 'pm'], description: 'rework is scoped and can be claimed again' },
  complete: { from: ['VERIFIED'], to: 'DONE', roles: ['system', 'owner'], description: 'completion policy satisfied, including approvals' },
  cancel: {
    from: ['DRAFT', 'READY', 'ASSIGNED', 'RUNNING', 'IN_REVIEW', 'BLOCKED', 'REWORK', 'VERIFIED'],
    to: 'CANCELLED',
    roles: ['owner', 'pm'],
    description: 'task abandoned; runs are cancelled without destroying work',
  },
  recover: { from: ['RUNNING'], to: 'BLOCKED', roles: ['system', 'owner'], description: 'a run lost its lease and needs a human decision' },
})

/**
 * Validate one transition.
 *
 * @param {string} state - current task state.
 * @param {string} action - requested action.
 * @param {{role: string, actorKind: 'owner'|'bot'|'system'}} actor - acting identity.
 * @returns {{ok: true, from: string, to: string, description: string} | {ok: false, code: string, message: string}} result.
 */
export function reduce(state, action, actor) {
  const rule = TRANSITIONS[action]
  if (rule === undefined) {
    return { ok: false, code: 'UNKNOWN_ACTION', message: `unknown task action "${action}"` }
  }
  if (!rule.from.includes(state)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      message: `action "${action}" is not allowed from ${state} (allowed from ${rule.from.join(', ')})`,
    }
  }
  if (!rule.roles.includes(actor.role)) {
    return {
      ok: false,
      code: 'ROLE_FORBIDDEN',
      message: `role "${actor.role}" may not perform "${action}"`,
    }
  }
  if (action === 'complete' && actor.role === 'system' && actor.kind !== 'system' && actor.kind !== 'owner') {
    return { ok: false, code: 'ROLE_FORBIDDEN', message: 'only the gate or the owner may complete a task' }
  }
  return { ok: true, from: state, to: rule.to, description: rule.description }
}

/**
 * States from which a task may be claimed by a bot.
 * @param {string} state - task state.
 * @returns {boolean} claimable.
 */
export function isClaimable(state) {
  return state === 'READY'
}

/**
 * Whether a task can still change.
 * @param {string} state - task state.
 * @returns {boolean} terminal flag.
 */
export function isTerminal(state) {
  return TERMINAL_TASK_STATES.includes(state)
}
