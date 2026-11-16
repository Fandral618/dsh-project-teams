/**
 * Machine evidence and the verification gate.
 *
 * A check is a real command with a real exit code: the plugin never accepts a
 * Bot's sentence "tests pass" as evidence. Each run stores its command, exit
 * code, duration, a bounded output tail, the log file and the log's SHA-256, so
 * a human can reproduce the same claim later.
 *
 * {@link evaluateGate} then combines machine evidence, the independent review
 * and (for risky work) an explicit owner approval into one of
 * `PASS | FAIL | NEEDS_HUMAN | INCOMPLETE | STALE`. Evidence bound to a
 * different head commit is `STALE`, never reused.
 *
 * @module project-teams/lib/host/verify
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PtError } from './http.js'

/** Check types the gate understands. */
export const CHECK_TYPES = Object.freeze(['build', 'test', 'secret-scan', 'sast'])

/** Maximum characters of output kept inline in the database. */
const TAIL_CHARS = 4_000

/**
 * Default check plan of a project policy.
 * @param {Record<string, any>} policy - project policy object.
 * @returns {Array<{type: string, command: string, required: boolean, timeoutMs: number}>} checks.
 */
export function checksFromPolicy(policy) {
  const raw = Array.isArray(policy?.checks) ? policy.checks : []
  /** @type {Array<{type: string, command: string, required: boolean, timeoutMs: number}>} */
  const checks = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const type = String(entry.type ?? '')
    const command = typeof entry.command === 'string' ? entry.command.trim() : ''
    if (!CHECK_TYPES.includes(type) || command === '') continue
    checks.push({
      type,
      command,
      required: entry.required !== false,
      timeoutMs: Number.isFinite(entry.timeoutMs) ? Math.max(1_000, Math.floor(entry.timeoutMs)) : 300_000,
    })
  }
  return checks
}

/**
 * Execute one command in a worktree and record its evidence.
 *
 * @param {{
 *   type: string,
 *   command: string,
 *   cwd: string,
 *   headCommit: string,
 *   timeoutMs: number,
 *   logDir: string,
 *   label: string,
 * }} input - check input.
 * @returns {Promise<Record<string, unknown>>} verification record fields.
 */
export async function runCheck(input) {
  const startedAt = Date.now()
  /** @type {{exitCode: number, output: string}} */
  const outcome = await new Promise((resolvePromise) => {
    execFile(
      process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      process.platform === 'win32' ? ['/d', '/s', '/c', input.command] : ['-c', input.command],
      {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, CI: '1', PROJECT_TEAMS: '1' },
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : (typeof error.code === 'number' ? error.code : 1)
        resolvePromise({ exitCode: code, output: `${String(stdout ?? '')}${String(stderr ?? '')}` })
      },
    )
  })
  const durationMs = Date.now() - startedAt
  const output = outcome.output
  const tail = output.length > TAIL_CHARS ? `…${output.slice(-TAIL_CHARS)}` : output
  const logPath = join(input.logDir, `${input.label}.log`)
  await mkdir(input.logDir, { recursive: true })
  const body = `# command: ${input.command}\n# cwd: ${input.cwd}\n# head: ${input.headCommit}\n# exit: ${outcome.exitCode}\n# durationMs: ${durationMs}\n\n${output}`
  await writeFile(logPath, body, 'utf8')
  const sha256 = createHash('sha256').update(body).digest('hex')
  return {
    status: outcome.exitCode === 0 ? 'PASS' : 'FAIL',
    exitCode: outcome.exitCode,
    durationMs,
    logPath,
    logSha256: sha256,
    outputTail: tail,
  }
}

/**
 * Status of one check family for one head commit.
 * @param {Array<Record<string, any>>} runs - verification rows.
 * @param {string} type - check type.
 * @param {string} headCommit - commit the evidence must be bound to.
 * @returns {'PASS'|'FAIL'|'MISSING'|'STALE'} status.
 */
function familyStatus(runs, type, headCommit) {
  const family = runs.filter((run) => run.check_type === type)
  if (family.length === 0) return 'MISSING'
  const current = family.filter((run) => run.head_commit === headCommit)
  if (current.length === 0) return 'STALE'
  // The newest evidence for this commit decides; an older PASS of a previous
  // command version must not outrank a newer failure.
  const newest = current.sort((a, b) => b.created_at - a.created_at)[0]
  return newest.status === 'PASS' ? 'PASS' : 'FAIL'
}

/**
 * Evaluate the gate for one task at its current head commit.
 *
 * @param {{
 *   task: Record<string, any>,
 *   artifacts: Array<Record<string, any>>,
 *   verificationRuns: Array<Record<string, any>>,
 *   reviews: Array<Record<string, any>>,
 *   approvals: Array<Record<string, any>>,
 *   policy: Record<string, any>,
 * }} input - evaluation input.
 * @returns {{status: 'PASS'|'FAIL'|'NEEDS_HUMAN'|'INCOMPLETE'|'STALE', reasons: string[], headCommit: string|null, artifactId: string|null, detail: Record<string, any>}} gate result.
 */
export function evaluateGate(input) {
  const reasons = []
  const requiredChecks = checksFromPolicy(input.policy).filter((check) => check.required)
  const head = input.task.head_commit ?? null
  if (head === null) {
    return { status: 'INCOMPLETE', reasons: ['no head commit recorded for this task'], headCommit: null, artifactId: null, detail: {} }
  }
  const artifact = input.artifacts
    .filter((row) => row.task_id === input.task.id && row.repo_commit === head)
    .sort((a, b) => b.created_at - a.created_at)[0]
  if (artifact === undefined) {
    const other = input.artifacts.filter((row) => row.task_id === input.task.id)
    return {
      status: other.length === 0 ? 'INCOMPLETE' : 'STALE',
      reasons: other.length === 0
        ? ['no artifact submitted for the current head commit']
        : ['every artifact belongs to an older commit; the current head is unreviewed'],
      headCommit: head,
      artifactId: null,
      detail: {},
    }
  }

  /** @type {Record<string, string>} */
  const checkDetail = {}
  let failed = false
  let missing = false
  let stale = false
  for (const check of requiredChecks) {
    const status = familyStatus(input.verificationRuns, check.type, head)
    checkDetail[check.type] = status
    if (status === 'FAIL') { failed = true; reasons.push(`required ${check.type} check failed`) }
    if (status === 'MISSING') { missing = true; reasons.push(`required ${check.type} check has not run for ${head.slice(0, 12)}`) }
    if (status === 'STALE') { stale = true; reasons.push(`required ${check.type} evidence belongs to another commit`) }
  }

  // Reviews are chosen by COMMIT, not by row order: several requests can exist
  // (a retried request, a re-opened task) and a decided verdict for the current
  // head must not be hidden behind a newer pending row. This ordering bug was
  // found by the first real multi-agent run.
  const allReviews = input.reviews.filter((row) => row.task_id === input.task.id)
  const forHead = allReviews.filter((row) => row.head_commit === head)
  const decided = forHead
    .filter((row) => row.decided_at !== null && row.decided_at !== undefined)
    .sort((a, b) => b.requested_at - a.requested_at)
  const review = decided[0]
  let reviewStatus = 'MISSING'
  if (review !== undefined) {
    reviewStatus = review.verdict === 'APPROVE' ? 'APPROVE' : 'CHANGES_REQUESTED'
    if (review.verdict === 'APPROVE') {
      // A review is necessary but never sufficient: it cannot replace machine
      // evidence, and an APPROVE with blockers is still a rejection.
      const findings = safeJson(review.findings, [])
      const blocking = findings.filter((finding) => finding?.severity === 'blocker' || finding?.severity === 'critical')
      if (blocking.length > 0) {
        reviewStatus = 'CHANGES_REQUESTED'
        failed = true
        reasons.push(`the review approved with ${blocking.length} blocking finding(s)`)
      }
    } else {
      failed = true
      reasons.push('the review requested changes')
    }
  } else if (forHead.length > 0) {
    reviewStatus = 'PENDING'
    missing = true
    reasons.push('the independent review has not returned a verdict')
  } else if (allReviews.length > 0) {
    reviewStatus = 'STALE'
    stale = true
    reasons.push('the latest review is bound to a different head commit')
  } else {
    missing = true
    reasons.push('no independent review was requested for this task')
  }

  const risk = String(input.task.risk_level ?? 'low')
  const approval = input.approvals
    .filter((row) => row.subject_type === 'task' && row.subject_id === input.task.id && row.subject_revision === head)
    .sort((a, b) => b.created_at - a.created_at)[0]
  const needsApproval = risk === 'high' || input.policy?.requireApprovalForDone === true
  let approvalStatus = 'NOT_REQUIRED'
  if (needsApproval) {
    if (approval === undefined) {
      approvalStatus = 'MISSING'
      reasons.push(`risk level "${risk}" requires an explicit owner approval for ${head.slice(0, 12)}`)
    } else if (approval.decision !== 'APPROVE') {
      approvalStatus = 'REJECTED'
      reasons.push('the owner rejected this revision')
    } else {
      approvalStatus = 'APPROVED'
    }
  }

  let status
  if (stale) status = 'STALE'
  else if (failed) status = 'FAIL'
  else if (needsApproval && approvalStatus !== 'APPROVED') status = 'NEEDS_HUMAN'
  else if (missing) status = 'INCOMPLETE'
  else status = 'PASS'

  return {
    status,
    reasons: reasons.length === 0 ? ['every required check, the review and the approval hold for this commit'] : reasons,
    headCommit: head,
    artifactId: artifact.id,
    detail: { checks: checkDetail, review: reviewStatus, approval: approvalStatus, risk },
  }
}

/**
 * Parse a JSON column defensively.
 * @param {unknown} value - stored text.
 * @param {any} fallback - value when parsing fails.
 * @returns {any} parsed value.
 */
export function safeJson(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

/**
 * Guard that a check command is allowed by policy: commands come from the
 * project policy written by the owner, never from a Bot message.
 * @param {Record<string, any>} policy - project policy.
 * @param {string} type - check type.
 * @returns {{command: string, timeoutMs: number}} the configured command.
 */
export function commandFor(policy, type) {
  const check = checksFromPolicy(policy).find((entry) => entry.type === type)
  if (check === undefined) {
    throw new PtError('verification/not-configured', `check "${type}" is not configured in this project policy`, 400)
  }
  return { command: check.command, timeoutMs: check.timeoutMs }
}
