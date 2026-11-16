/**
 * Task state machine and permission matrix — pure unit tests.
 * @module project-teams/tests/unit/state-machine.test
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { TASK_STATES, TRANSITIONS, isTerminal, reduce } from '../../lib/host/state-machine.js'
import { BUILTIN_ROLES, capabilitiesForRole, authorize, canWriteCode, ownerActor, systemActor } from '../../lib/host/permissions.js'

const actor = (role, kind = 'bot') => ({ kind, id: 'x', role, projectId: 'prj' })

test('every declared state is reachable from a transition target', () => {
  const targets = new Set(Object.values(TRANSITIONS).map((rule) => rule.to))
  for (const state of TASK_STATES) {
    assert.ok(state === 'DRAFT' || targets.has(state), `state ${state} is unreachable`)
  }
})

test('the legal transition chain DRAFT→DONE exists for the real actor path', () => {
  /** @type {Array<[string, any]>} */
  const steps = [
    ['submit', actor('pm')],
    ['assign', actor('pm')],
    ['start', actor('developer')],
    ['submit_review', actor('developer')],
    ['verify', { kind: 'system', id: 'system', role: 'system', projectId: 'prj' }],
    ['complete', { kind: 'system', id: 'system', role: 'system', projectId: 'prj' }],
  ]
  let state = 'DRAFT'
  for (const [action, who] of steps) {
    const result = reduce(state, action, who)
    assert.equal(result.ok, true, `${action} from ${state}: ${JSON.stringify(result)}`)
    state = result.to
  }
  assert.equal(state, 'DONE')
})

test('an illegal transition is rejected with a machine code', () => {
  const result = reduce('DRAFT', 'complete', actor('owner', 'owner'))
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ILLEGAL_TRANSITION')
})

test('an unknown action is rejected', () => {
  const result = reduce('READY', 'teleport', actor('pm'))
  assert.equal(result.ok, false)
  assert.equal(result.code, 'UNKNOWN_ACTION')
})

test('a role outside the rule is rejected', () => {
  const result = reduce('READY', 'assign', actor('qa'))
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ROLE_FORBIDDEN')
})

test('a reviewer cannot complete a task', () => {
  const result = reduce('VERIFIED', 'complete', actor('reviewer'))
  assert.equal(result.code, 'ROLE_FORBIDDEN', JSON.stringify(result))
})

test('DONE and CANCELLED are terminal', () => {
  assert.equal(isTerminal('DONE'), true)
  assert.equal(isTerminal('CANCELLED'), true)
  assert.equal(isTerminal('IN_REVIEW'), false)
})

test('every role has a writable-code answer and only developer writes code', () => {
  for (const role of BUILTIN_ROLES) {
    assert.equal(typeof canWriteCode(role), 'boolean')
  }
  assert.equal(canWriteCode('developer'), true)
  assert.equal(canWriteCode('reviewer'), false)
  assert.equal(canWriteCode('pm'), false)
  // A custom role writes only when its template says so.
  assert.equal(canWriteCode('frontend', { capabilities: ['write', 'message'] }), true)
  assert.equal(canWriteCode('architect', { capabilities: ['review'] }), false)
  assert.deepEqual([...capabilitiesForRole('qa')].sort(), ['message', 'verify', 'write'])
})

test('the owner may decide approvals; a bot may not', () => {
  assert.equal(authorize(ownerActor(), 'approval.decide').ok, true)
  for (const role of BUILTIN_ROLES) {
    assert.equal(authorize(actor(role), 'approval.decide').ok, false, `${role} must not approve`)
  }
})

test('a bot operation marked own requires ownership', () => {
  const denied = authorize(actor('developer'), 'artifact.submit', { ownsResource: false })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'FORBIDDEN_OWNERSHIP')
  assert.equal(authorize(actor('developer'), 'artifact.submit', { ownsResource: true }).ok, true)
})

test('cross-project operations are rejected', () => {
  const decision = authorize(actor('developer'), 'task.read', { projectScope: 'prj-other' })
  assert.equal(decision.ok, false)
  assert.equal(decision.code, 'CROSS_PROJECT')
})

test('an owner is not restricted to one project', () => {
  assert.equal(authorize(ownerActor(), 'project.create').ok, true)
  assert.equal(authorize(systemActor('p1'), 'task.transition').ok, true)
})

test('unknown operations are rejected rather than allowed', () => {
  const decision = authorize(ownerActor(), 'project.delete-everything')
  assert.equal(decision.ok, false)
  assert.equal(decision.code, 'UNKNOWN_OPERATION')
})
