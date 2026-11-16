/**
 * Activation self-check.
 *
 * The plugin proves its own wiring in the running Host process and writes the
 * result under `<dataDir>/state/`, which is the evidence the compatibility
 * matrix cites. It is deliberately independent of the HTTP API: the Desktop
 * shell serves ordinary browsers only when browser access is enabled, so an
 * external curl is not a reliable verification channel, while a file written by
 * the Host process itself is.
 *
 * Three artifacts are produced:
 *
 * - `activation.jsonl` — one appended line per activation, with the runtime and
 *   the composed services;
 * - `client-registration.json` — the module-loader boot row the browser half
 *   was published as (or the reason it was not);
 * - `m0.json` / `m0-verify-*.json` — the M0 Session probe and its later re-check.
 *
 * @module project-teams/lib/host/activation
 */

import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readProbeRecord, runProbe, verifyProbe } from './m0.js'
import { optionalService } from './session-adapter.js'

/**
 * Describe the browser half as the Host module loader published it.
 *
 * `ctx.clientModules.graph()` is the same boot graph the page receives, so a
 * row here means the Client bundle is composed and served; it is not a claim
 * about what a browser renders.
 *
 * @param {any} ctx - plugin context.
 * @param {string} packageName - browser module identity (the package name).
 * @returns {Record<string, unknown>} registration facts.
 */
export function describeClientRegistration(ctx, packageName) {
  const registry = optionalService(ctx, 'clientModules')
  if (typeof registry?.graph !== 'function') {
    return { available: false, reason: 'ctx.clientModules is not composed in this Host' }
  }
  try {
    const graph = registry.graph()
    const rows = (graph?.entries ?? []).filter((entry) => String(entry?.id ?? '').includes(packageName))
    return {
      available: true,
      graphRev: graph?.rev ?? null,
      release: graph?.release ?? null,
      entries: rows.map((entry) => ({
        id: entry.id,
        url: entry.url,
        rev: entry.rev,
        inject: entry.inject ?? [],
        immediately: entry.immediately === true,
      })),
      clientPath: typeof registry.clientPath === 'function' ? (registry.clientPath(packageName) ?? null) : null,
    }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Append one activation line and refresh the latest snapshot.
 * @param {string} dataDir - managed data root.
 * @param {Record<string, unknown>} record - activation record.
 * @returns {Promise<void>} resolves after both writes.
 */
async function writeActivation(dataDir, record) {
  const stateDir = join(dataDir, 'state')
  await mkdir(stateDir, { recursive: true })
  await appendFile(join(stateDir, 'activation.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
  await writeFile(join(stateDir, 'activation.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/**
 * Write one verification snapshot.
 * @param {string} dataDir - managed data root.
 * @param {Record<string, unknown>} snapshot - verification result.
 * @returns {Promise<string>} absolute path written.
 */
async function writeVerifySnapshot(dataDir, snapshot) {
  const target = join(dataDir, 'state', `m0-verify-${Date.now()}.json`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return target
}

/**
 * Run the activation self-check.
 *
 * @param {any} ctx - plugin context.
 * @param {import('./config.js').ResolvedConfig} config - resolved configuration.
 * @param {import('./session-adapter.js').SessionAdapter} adapter - Session adapter.
 * @param {{packageName: string}} metadata - bundle identity.
 * @returns {Promise<void>} resolves when the self-check has been scheduled.
 */
export async function runActivationSelfCheck(ctx, config, adapter, metadata) {
  const record = {
    at: new Date().toISOString(),
    pid: process.pid,
    plugin: metadata.packageName,
    dataDir: config.dataDir,
    environment: adapter.environment(),
    clientRegistration: describeClientRegistration(ctx, metadata.packageName),
    autoProbe: config.m0AutoProbe,
  }
  try {
    await writeActivation(config.dataDir, record)
  } catch (error) {
    ctx.logger?.warn?.(`project-teams: activation record could not be written: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!config.m0AutoProbe) return
  try {
    const previous = await readProbeRecord(config.dataDir)
    if (previous === null) {
      const probe = await runProbe(ctx, config, adapter, {})
      ctx.logger?.info?.(`project-teams: M0 probe verdict ${probe.verdict} (${probe.probeId})`)
      return
    }
    const verification = await verifyProbe(config, adapter)
    const snapshot = { at: new Date().toISOString(), pid: process.pid, ...verification }
    const path = await writeVerifySnapshot(config.dataDir, snapshot)
    ctx.logger?.info?.(`project-teams: M0 re-check ${String(verification.verdict)} written to ${path}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger?.warn?.(`project-teams: M0 self-check failed: ${message}`)
    try {
      await writeVerifySnapshot(config.dataDir, {
        at: new Date().toISOString(),
        pid: process.pid,
        verdict: 'BLOCKED',
        error: message,
      })
    } catch {
      // Nothing further to report through.
    }
  }
}
