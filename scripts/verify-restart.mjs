#!/usr/bin/env node
/**
 * Process-restart verification in an ISOLATED profile.
 *
 * The plugin's own activation self-check already does the two things a restart
 * test needs: boot 1 creates two ordinary Sessions and records the M0 evidence;
 * boot 2 must re-identify those Sessions from durable storage and re-read the
 * delivered marker. This script drives that across two real Host processes,
 * using a throwaway DSH_HOME and a throwaway profile, so the user's everyday
 * profile is never touched.
 *
 * Usage:
 *   node scripts/verify-restart.mjs [--keep]
 *
 * Requirements: the DSH CLI (default: DSH_INSTALL_DIR env, else discover), and
 * git. Exits non-zero when either boot fails.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const keep = process.argv.includes('--keep')

/** Locate the DSH CLI entry (`@deepseek-ai/dsh/lib/bin.js`) in the running install. */
function resolveCli() {
  // A Desktop install keeps the packages inside `app.asar`, which plain Node
  // cannot stat; the Electron runtime this script launches can. Prefer an
  // explicit override, otherwise use the documented anchor unconditionally.
  const override = process.env.DSH_CLI_ENTRY
  if (override !== undefined && override !== '') return override
  const install = process.env.DSH_INSTALL_DIR
  if (install === undefined || install === '') throw new Error('DSH_INSTALL_DIR is not set; run this inside a DSH shell')
  return join(install, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

const cli = resolveCli()
const nodeExecutable = process.env.DSH_NODE_EXECUTABLE
if (nodeExecutable === undefined || nodeExecutable === '') throw new Error('DSH_NODE_EXECUTABLE is not set')

const home = mkdtempSync(join(tmpdir(), 'dsh-restart-'))
const profileName = 'pt-restart'
const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_PROFILE: profileName,
  ELECTRON_RUN_AS_NODE: '1',
}

/** Run the CLI once and return stdout. */
function run(args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(nodeExecutable, [cli, ...args], { env, timeout: options.timeoutMs ?? 180_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) {
        rejectPromise(new Error(`dsh ${args.join(' ')} failed: ${String(stderr || error.message).slice(0, 2000)}`))
        return
      }
      resolvePromise(String(stdout))
    })
  })
}

/** Boot the profile on a free port, wait until the plugin logs "host ready", then stop it. */
async function boot(label) {
  const port = 0
  const child = spawn(nodeExecutable, [cli, '--profile', profileName, '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const collect = (chunk) => { log += String(chunk) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const started = Date.now()
  const deadline = started + 120_000
  let ready = false
  const activationPath = join(home, 'project-teams', 'state', 'activation.json')
  while (Date.now() < deadline) {
    // The CLI writes Host logs to a file, so readiness is observed from the
    // plugin's own activation record instead of stdout.
    if (log.includes('project-teams: host ready') || existsSync(activationPath)) { ready = true; break }
    if (child.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 400))
  }
  // Wait for what this boot is supposed to produce, not a fixed nap: boot 1
  // writes m0.json, boot 2 writes a fresh m0-verify-*.json. Each is the plugin's
  // own activation self-check, so observing it also proves activation finished.
  if (ready) {
    const stateDir = join(home, 'project-teams', 'state')
    const wantVerify = existsSync(join(stateDir, 'm0.json'))
    const waitUntil = Date.now() + 45_000
    while (Date.now() < waitUntil) {
      const names = existsSync(stateDir) ? readdirSync(stateDir) : []
      const produced = wantVerify
        ? names.some((name) => name.startsWith('m0-verify-'))
        : names.includes('m0.json')
      if (produced) break
      if (child.exitCode !== null) break
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  child.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 1_500))
  if (child.exitCode === null) child.kill('SIGKILL')
  const stateDir = join(home, 'project-teams', 'state')
  let activation = null
  try {
    activation = JSON.parse(readFileSync(join(stateDir, 'activation.json'), 'utf8'))
  } catch {
    activation = null
  }
  return {
    label,
    ready,
    pid: activation?.pid ?? null,
    activatedAt: activation?.at ?? null,
    logTail: log.split('\n').filter((line) => line.includes('project-teams')).slice(-6),
    stateFiles: existsSync(stateDir) ? readdirSync(stateDir) : [],
  }
}

const summary = { home, profile: profileName, cli, boots: [], verdict: 'BLOCKED', notes: [] }
try {
  // 1) Create the isolated profile from the shipped web template.
  await run(['--profile', profileName, '--from-default-profile', 'web', '--dump-config']).catch(async (error) => {
    // Older CLIs may not support --from-default-profile together with --dump-config.
    summary.notes.push(`from-default-profile: ${error.message.slice(0, 200)}`)
  })
  // 2) Install this bundle into that profile only.
  summary.notes.push('install: ' + (await run(['plugin', '--profile', profileName, 'add', packageRoot])).trim().split('\n').slice(-3).join(' | '))

  // 3) First boot: the self-check creates the two Sessions and writes m0.json.
  const first = await boot('boot-1')
  summary.boots.push(first)

  // 4) Second boot: the self-check must re-identify them from disk.
  const second = await boot('boot-2')
  summary.boots.push(second)

  // AT-16: removing the bundle leaves no row in the profile and keeps the data.
  const profileFile = join(home, 'profiles', profileName, 'package.json')
  const listBundles = () => {
    try {
      return JSON.parse(readFileSync(profileFile, 'utf8')).dsh?.profile?.bundles ?? []
    } catch {
      return []
    }
  }
  const installedBefore = listBundles().includes('dsh-project-teams')
  await run(['plugin', '--profile', profileName, 'remove', 'dsh-project-teams'])
  const installedAfter = listBundles().includes('dsh-project-teams')
  const dataKept = existsSync(join(home, 'project-teams', 'project-teams.db'))
  summary.uninstall = { installedBefore, installedAfter, dataKept }

  const verifyFiles = (second.stateFiles ?? []).filter((name) => name.startsWith('m0-verify-'))
  const latestVerify = verifyFiles.length === 0
    ? null
    : JSON.parse(readFileSync(join(home, 'project-teams', 'state', verifyFiles.sort().at(-1)), 'utf8'))
  const schema = existsSync(join(home, 'project-teams', 'project-teams.db'))
    ? 'database created'
    : 'database missing'
  summary.schema = schema
  summary.verify = latestVerify === null ? null : {
    verdict: latestVerify.verdict,
    aFound: latestVerify.a?.found,
    bFound: latestVerify.b?.found,
    durableMarkerPresent: latestVerify.durableMarkerPresent,
  }
  const ok = first.ready && second.ready && latestVerify !== null && latestVerify.verdict === 'PASS'
    && installedBefore && !installedAfter && dataKept
  summary.verdict = ok ? 'PASS' : 'BLOCKED'
} catch (error) {
  summary.notes.push(`error: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (!keep) rmSync(home, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
process.exitCode = summary.verdict === 'PASS' ? 0 : 1
