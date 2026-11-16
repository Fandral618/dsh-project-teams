/**
 * M0 compatibility probe.
 *
 * M0 has to prove, with executed code rather than descriptions, that:
 *
 * 1. two ordinary Sessions A and B can be created and are independent (distinct
 *    identities, no `parentSessionId`, no subagent origin);
 * 2. each Session carries its own Agent preset, i.e. a role configuration that
 *    is not inherited from the creating Agent;
 * 3. a message admitted into B through the Host leaves a durable user message
 *    in B's own Session log (an A→B delivery that no parent Agent relays);
 * 4. the Session identities survive a Host restart, so a project Bot can be
 *    re-identified rather than re-created.
 *
 * The probe stores its evidence under `<dataDir>/state/m0.json` so point 4 can
 * be re-checked by a later Host process.
 *
 * @module project-teams/lib/host/m0
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PtError } from './http.js'
import { optionalService } from './session-adapter.js'

/**
 * @typedef {Readonly<{
 *   probeId: string,
 *   createdAt: string,
 *   sessions: { a: Record<string, unknown>, b: Record<string, unknown> },
 *   delivery: Record<string, unknown>,
 *   checks: Record<string, boolean>,
 *   verdict: 'PASS' | 'FAIL',
 *   notes: string[],
 * }>} ProbeRecord
 */

/**
 * Read the persisted probe record.
 * @param {string} dataDir - managed data root.
 * @returns {Promise<ProbeRecord | null>} the record, or null when none exists.
 */
export async function readProbeRecord(dataDir) {
  try {
    const text = await readFile(join(dataDir, 'state', 'm0.json'), 'utf8')
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Persist the probe record atomically.
 * @param {string} dataDir - managed data root.
 * @param {ProbeRecord} record - record to persist.
 * @returns {Promise<void>} resolves after the rename.
 */
async function writeProbeRecord(dataDir, record) {
  const target = join(dataDir, 'state', 'm0.json')
  await mkdir(dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  await rename(tmp, target)
}

/**
 * Enumerate the Agent presets this deployment composes.
 * @param {any} ctx - plugin context.
 * @returns {Promise<string[]>} preset ids, default first.
 */
export async function listPresets(ctx) {
  const registry = optionalService(ctx, 'agentPresets')
  if (registry === undefined) return []
  try {
    const presets = await registry.list()
    if (!Array.isArray(presets)) return []
    return presets.map((preset) => String(preset.id)).filter((id) => id !== '')
  } catch {
    return []
  }
}

/**
 * Pick two distinct presets for the two probe Sessions, so the experiment shows
 * a per-Session role configuration rather than a shared default.
 * @param {string[]} presets - available preset ids.
 * @param {string} preferred - configured default preset (may be empty).
 * @returns {{a: string, b: string, note: string}} chosen presets.
 */
function pickPresets(presets, preferred) {
  const unique = [...new Set(presets)]
  if (unique.length >= 2) {
    const a = preferred !== '' && unique.includes(preferred) ? preferred : unique[0]
    const b = unique.find((id) => id !== a) ?? unique[1]
    return { a, b, note: `two presets available: ${a} / ${b}` }
  }
  if (unique.length === 1) return { a: unique[0], b: unique[0], note: `only one preset available: ${unique[0]}` }
  return { a: '', b: '', note: 'no preset registry in this profile; Session creation ran without a preset' }
}

/**
 * Shorten one message body for the evidence record.
 * @param {string} text - message text.
 * @param {number} [limit] - maximum retained characters.
 * @returns {string} bounded excerpt.
 */
function excerpt(text, limit = 240) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit)}… (${flat.length} chars)`
}

/**
 * Run the M0 probe.
 *
 * @param {any} ctx - plugin context.
 * @param {import('./config.js').ResolvedConfig} config - resolved configuration.
 * @param {import('./session-adapter.js').SessionAdapter} adapter - Session adapter.
 * @param {{reuse?: boolean}} [options] - reuse keeps the recorded Sessions when they are still resolvable.
 * @returns {Promise<ProbeRecord>} the executed probe record.
 */
export async function runProbe(ctx, config, adapter, options = {}) {
  /** @type {string[]} */
  const notes = []
  const probeId = `m0-${randomUUID()}`
  const cwd = join(config.dataDir, 'm0')
  await mkdir(cwd, { recursive: true })

  const previous = options.reuse === true ? await readProbeRecord(config.dataDir) : null
  /** @type {{a: string, b: string}} */
  let sessionsToUse
  if (previous !== null) {
    const aId = typeof previous.sessions?.a?.sessionId === 'string' ? previous.sessions.a.sessionId : ''
    const bId = typeof previous.sessions?.b?.sessionId === 'string' ? previous.sessions.b.sessionId : ''
    const aFacts = aId === '' ? undefined : await adapter.inspectSession(aId)
    const bFacts = bId === '' ? undefined : await adapter.inspectSession(bId)
    if (aFacts?.found === true && bFacts?.found === true) {
      sessionsToUse = { a: aId, b: bId }
      notes.push('reused the Sessions recorded by the previous probe run')
    } else {
      sessionsToUse = { a: '', b: '' }
      notes.push('previous probe Sessions are no longer resolvable; created new ones')
    }
  } else {
    sessionsToUse = { a: '', b: '' }
  }

  const presets = await listPresets(ctx)
  const chosen = pickPresets(presets, config.defaultAgentPreset)
  notes.push(chosen.note)

  if (sessionsToUse.a === '') {
    const created = await adapter.createSession({
      cwd,
      agentPreset: chosen.a === '' ? undefined : chosen.a,
      title: 'PT M0 · Session A (PM role)',
    })
    sessionsToUse.a = created.sessionId
    if (created.presetRejected !== undefined) {
      notes.push(`preset "${created.presetRejected}" was rejected by this deployment: ${created.presetFailure ?? ''}`)
    }
  }
  if (sessionsToUse.b === '') {
    const created = await adapter.createSession({
      cwd,
      agentPreset: chosen.b === '' ? undefined : chosen.b,
      title: 'PT M0 · Session B (Reviewer role)',
    })
    sessionsToUse.b = created.sessionId
    if (created.presetRejected !== undefined) {
      notes.push(`preset "${created.presetRejected}" was rejected by this deployment: ${created.presetFailure ?? ''}`)
    }
  }

  const a = await adapter.inspectSession(sessionsToUse.a)
  const b = await adapter.inspectSession(sessionsToUse.b)

  const marker = `[project-teams:m0 ${probeId}] A→B delivery check. No reply is required.`
  const receipt = await adapter.deliver({
    targetSessionId: sessionsToUse.b,
    text: marker,
    mode: 'queue',
  })
  // The prompt receipt is Host acceptance of the INPUT. Durable evidence is the
  // message appearing in B's own log; retry the read briefly to absorb the
  // admission hand-off.
  /** @type {string[]} */
  let bUserTexts = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    bUserTexts = await adapter.recentUserTexts(sessionsToUse.b, 20)
    if (bUserTexts.some((text) => text.includes(marker))) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const durable = bUserTexts.some((text) => text.includes(marker))
  if (!durable) {
    notes.push('B has no live Session object in this Host, so its durable log could not be read; acceptance receipt is the only delivery evidence')
  }

  const aUserTexts = await adapter.recentUserTexts(sessionsToUse.a, 20)

  /** @type {Record<string, boolean>} */
  const checks = {
    'sessions-distinct': sessionsToUse.a !== '' && sessionsToUse.b !== '' && sessionsToUse.a !== sessionsToUse.b,
    'sessions-found': a.found === true && b.found === true,
    'not-a-subagent': a.parentSessionId === null && b.parentSessionId === null && a.origin === null && b.origin === null,
    'preset-bound': presets.length === 0 || (a.agentPreset !== null && b.agentPreset !== null),
    'preset-distinct': presets.length < 2 || (a.agentPreset !== b.agentPreset),
    'prompt-accepted': receipt.accepted === true,
    'delivered-to-b-log': durable,
    'not-delivered-to-a-log': !aUserTexts.some((text) => text.includes(marker)),
    'independent-cwd': a.cwd === b.cwd,
  }

  const verdict = checks['sessions-distinct'] && checks['sessions-found'] && checks['not-a-subagent'] && checks['prompt-accepted'] && checks['delivered-to-b-log'] && checks['not-delivered-to-a-log']
    ? 'PASS'
    : 'FAIL'

  /** @type {ProbeRecord} */
  const record = {
    probeId,
    createdAt: new Date().toISOString(),
    sessions: { a, b },
    delivery: {
      ...receipt,
      marker,
      targetUserTextsTail: bUserTexts.slice(-3).map((text) => excerpt(text)),
      sourceUserTextsTail: aUserTexts.slice(-3).map((text) => excerpt(text)),
    },
    checks,
    verdict,
    notes,
  }
  await writeProbeRecord(config.dataDir, record)
  if (verdict === 'FAIL') {
    throw new PtError('m0/probe-failed', `M0 probe failed: ${Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name).join(', ')}`, 500, { record })
  }
  return record
}

/**
 * Re-check a previously recorded probe against the current Host process, which
 * is what proves Session identification after a restart.
 * @param {import('./config.js').ResolvedConfig} config - resolved configuration.
 * @param {import('./session-adapter.js').SessionAdapter} adapter - Session adapter.
 * @returns {Promise<Record<string, unknown>>} re-check result.
 */
export async function verifyProbe(config, adapter) {
  const record = await readProbeRecord(config.dataDir)
  if (record === null) {
    throw new PtError('m0/no-probe', 'no M0 probe record exists yet; run the probe first', 404)
  }
  const aId = String(record.sessions?.a?.sessionId ?? '')
  const bId = String(record.sessions?.b?.sessionId ?? '')
  const a = await adapter.inspectSession(aId)
  const b = await adapter.inspectSession(bId)
  const marker = String(record.delivery?.marker ?? '')
  const bUserTexts = await adapter.recentUserTexts(bId, 20)
  const hasDurableMarker = marker !== '' && bUserTexts.some((text) => text.includes(marker))
  return {
    recordedProbeId: record.probeId,
    recordedVerdict: record.verdict,
    recordedAt: record.createdAt,
    a,
    b,
    durableMarkerPresent: hasDurableMarker,
    liveAgents: { a: adapter.isLive(aId), b: adapter.isLive(bId) },
    verdict: a.found && b.found && hasDurableMarker ? 'PASS' : 'BLOCKED',
  }
}
