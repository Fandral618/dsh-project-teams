/**
 * Resolved plugin configuration.
 *
 * The Host row's `config` object is validated by Cordis only when the plugin
 * exports a `Config` schema; Project Teams keeps its configuration plain and
 * applies defaults and bounds here so that a hand-edited patch row can never
 * produce an unbounded value.
 *
 * @module project-teams/lib/host/config
 */

import { homedir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'

/** @typedef {Readonly<{
 *   dataDir: string,
 *   defaultAgentPreset: string,
 *   maxParallelRuns: number,
 *   maxMessagesPerTask: number,
 *   maxMessagesPerHour: number,
 *   maxRetries: number,
 *   commandTimeoutMs: number,
 *   enableAutoWake: boolean,
 *   m0AutoProbe: boolean,
 *   worktreeDir: string,
 * }>} ResolvedConfig */

/**
 * Absolute DSH home directory.
 *
 * DSH sets `DSH_HOME` for every process it launches; a profile-less launch has
 * no variable, so the documented default location is used instead. The plugin
 * never hard-codes a profile or session path below it.
 * @returns {string} absolute DSH home directory.
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '' && isAbsolute(fromEnv.trim())) {
    return normalize(fromEnv.trim())
  }
  return join(homedir(), '.dsh')
}

/**
 * Resolve the plugin's managed data root.
 * @param {unknown} raw - the row's `dataDir` field.
 * @returns {string} absolute data root.
 */
export function resolveDataDir(raw) {
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = raw.trim()
    if (!isAbsolute(value)) {
      throw new Error(`project-teams: dataDir must be an absolute path, got "${value}"`)
    }
    return normalize(value)
  }
  return join(dshHome(), 'project-teams')
}

/**
 * Read one integer field with a floor and a default.
 * @param {unknown} raw - the configuration value.
 * @param {number} fallback - value used when the field is absent or unusable.
 * @param {number} minimum - smallest accepted value.
 * @returns {number} resolved integer.
 */
function intField(raw, fallback, minimum) {
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.floor(value))
}

/**
 * Resolve the plugin row's configuration.
 * @param {Record<string, unknown> | undefined} config - raw row configuration.
 * @returns {ResolvedConfig} resolved configuration.
 */
export function resolveConfig(config) {
  const raw = config ?? {}
  const preset = typeof raw.defaultAgentPreset === 'string' ? raw.defaultAgentPreset.trim() : ''
  return Object.freeze({
    dataDir: resolveDataDir(raw.dataDir),
    defaultAgentPreset: preset,
    maxParallelRuns: intField(raw.maxParallelRuns, 3, 1),
    maxMessagesPerTask: intField(raw.maxMessagesPerTask, 40, 1),
    maxMessagesPerHour: intField(raw.maxMessagesPerHour, 120, 1),
    maxRetries: intField(raw.maxRetries, 5, 1),
    commandTimeoutMs: intField(raw.commandTimeoutMs, 600_000, 1_000),
    enableAutoWake: raw.enableAutoWake !== false,
    // M0 evidence: run the Session probe once per data directory on activation,
    // then re-check the recorded Sessions on every later activation. Set false
    // once the probe has served its purpose.
    m0AutoProbe: raw.m0AutoProbe !== false,
    // Directory INSIDE the project repository that holds run worktrees. It stays
    // inside the repository because a Bot's file sandbox only allows writes
    // under its own workspace.
    worktreeDir: typeof raw.worktreeDir === 'string' && raw.worktreeDir.trim() !== '' ? raw.worktreeDir.trim() : '.project-teams',
  })
}
