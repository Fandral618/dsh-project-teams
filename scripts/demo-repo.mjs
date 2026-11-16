#!/usr/bin/env node
/**
 * Create a disposable demo repository for the Project Teams end-to-end run.
 *
 * The script writes a tiny Web API + test file, initialises Git with one commit,
 * and prints the absolute path. Bind a Project Teams project to that path, add
 * the printed policy checks, and let the team take a task through the gate.
 *
 * Usage: node scripts/demo-repo.mjs [targetDir]
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const target = resolve(process.argv[2] ?? join(tmpdir(), `project-teams-demo-${Date.now()}`))
mkdirSync(join(target, 'src'), { recursive: true })
mkdirSync(join(target, 'test'), { recursive: true })

writeFileSync(join(target, 'package.json'), JSON.stringify({
  name: 'project-teams-demo',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: {
    build: 'node --check src/app.js',
    test: 'node --test test/signup.test.js',
  },
}, null, 2) + '\n', 'utf8')

writeFileSync(join(target, 'src', 'app.js'), `/**
 * Minimal account API used by the Project Teams demo.
 * NO production secrets: this repository is disposable.
 */

/** In-memory account store. */
const accounts = new Map()

/**
 * Validate one sign-up payload.
 * @param {{email?: string, password?: string}} input - payload.
 * @returns {{ok: true} | {ok: false, error: string}} validation result.
 */
export function validateSignup(input) {
  const email = typeof input?.email === 'string' ? input.email.trim() : ''
  const password = typeof input?.password === 'string' ? input.password : ''
  if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) return { ok: false, error: 'invalid email' }
  if (password.length < 8) return { ok: false, error: 'password too short' }
  return { ok: true }
}

/**
 * Register one account.
 * @param {{email: string, password: string}} input - payload.
 * @returns {{ok: boolean, error?: string}} outcome.
 */
export function signup(input) {
  const validation = validateSignup(input)
  if (!validation.ok) return validation
  const email = input.email.trim().toLowerCase()
  if (accounts.has(email)) return { ok: false, error: 'account exists' }
  accounts.set(email, { email, passwordHash: 'demo:' + input.password.length })
  return { ok: true }
}

/**
 * Authenticate one account.
 * @param {{email: string, password: string}} input - payload.
 * @returns {{ok: boolean, error?: string}} outcome.
 */
export function login(input) {
  const account = accounts.get(String(input?.email ?? '').trim().toLowerCase())
  if (account === undefined) return { ok: false, error: 'unknown account' }
  const valid = account.passwordHash === 'demo:' + String(input?.password ?? '').length
  return valid ? { ok: true } : { ok: false, error: 'wrong password' }
}

/** @returns {number} number of registered accounts. */
export function accountCount() {
  return accounts.size
}
`, 'utf8')

writeFileSync(join(target, 'test', 'signup.test.js'), `import test from 'node:test'
import assert from 'node:assert/strict'
import { login, signup, validateSignup } from '../src/app.js'

test('rejects an invalid email', () => {
  assert.equal(validateSignup({ email: 'nope', password: 'longenough' }).ok, false)
})

test('rejects a short password', () => {
  assert.equal(validateSignup({ email: 'a@b.co', password: 'short' }).ok, false)
})

test('registers and logs in', () => {
  assert.equal(signup({ email: 'user@example.com', password: 'longenough' }).ok, true)
  assert.equal(login({ email: 'user@example.com', password: 'longenough' }).ok, true)
})
`, 'utf8')

writeFileSync(join(target, 'README.md'), `# Project Teams demo

A disposable Web API with one test file. Safe to delete.

The Project Teams end-to-end run asks the team to "implement sign-up and sign-in
with input validation and tests". Suggested project policy checks:

\`\`\`json
[
  { "type": "build", "command": "node --check src/app.js", "required": true },
  { "type": "test", "command": "node --test test/signup.test.js", "required": true }
]
\`\`\`
`, 'utf8')

const git = (args) => execFileSync('git', args, { cwd: target, stdio: 'pipe' })
git(['init', '-q', '-b', 'main'])
git(['config', 'user.name', 'Project Teams Demo'])
git(['config', 'user.email', 'demo@localhost'])
git(['add', '--all'])
git(['commit', '-q', '-m', 'chore: initial demo repository'])

process.stdout.write([
  `demo repository: ${target}`,
  `head commit:     ${git(['rev-parse', 'HEAD']).toString().trim()}`,
  'policy checks:   [{"type":"build","command":"node --check src/app.js","required":true},{"type":"test","command":"node --test test/signup.test.js","required":true}]',
  '',
].join('\n'))
