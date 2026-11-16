/**
 * Git workspace isolation.
 *
 * Every write task gets its own `git worktree` and branch, cut from a recorded
 * base commit, under the managed project directory. Two developers can work on
 * the same repository without touching each other's checkout, and every commit
 * the plugin records is reproducible from `base_commit..head_commit`.
 *
 * Commands are executed with `execFile('git', args)` — never through a shell —
 * so a task title, branch name or path can never be reinterpreted as shell
 * syntax. The worktree path is validated against the managed root before any
 * recursive filesystem operation.
 *
 * @module project-teams/lib/host/worktree
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { PtError } from './http.js'

/** Characters allowed in a managed task id / run id inside a branch or path. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Windows device names that cannot be used as a directory name. */
const RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Run one git command and return its trimmed stdout.
 * @param {string[]} args - arguments (no shell interpolation).
 * @param {{cwd: string, timeoutMs?: number, allowFailure?: boolean}} options - execution options.
 * @returns {Promise<{stdout: string, stderr: string, code: number}>} outcome.
 */
export function git(args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile('git', args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      const code = error === null ? 0 : (typeof error.code === 'number' ? error.code : 1)
      if (error !== null && options.allowFailure !== true) {
        rejectPromise(new PtError(
          'git/command-failed',
          `git ${args.join(' ')} failed (exit ${code}): ${(stderr || error.message || '').trim().slice(0, 800)}`,
          500,
        ))
        return
      }
      resolvePromise({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code })
    })
  })
}

/**
 * Validate one path segment (task id, run id, project id).
 * @param {string} value - candidate.
 * @param {string} label - field name for the error.
 * @returns {string} the validated segment.
 */
export function safeSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value) || RESERVED_SEGMENT.test(value)) {
    throw new PtError('path/invalid-segment', `${label} "${String(value)}" is not a safe path segment`, 400)
  }
  return value
}

/**
 * Resolve `child` under `root` and refuse anything outside it.
 * @param {string} root - managed root.
 * @param {string} child - candidate path.
 * @returns {string} normalized absolute path.
 */
export function containPath(root, child) {
  const base = resolve(normalize(root))
  const target = resolve(normalize(child))
  const rel = relative(base, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new PtError('path/escape', `path ${target} is outside the managed root ${base}`, 400)
  }
  return target
}

/**
 * Git workspace manager for one data root.
 *
 * Worktrees are created **inside the project repository** (default
 * `<repo>/.project-teams/runs/<run>/worktree`) because a Bot Session's file
 * sandbox allows writes under its own workspace, and a Bot's workspace is the
 * repository. A worktree under `$DSH_HOME` would be outside that workspace and
 * every edit would be denied — which is exactly what the first real run showed.
 * The directory is added to `.git/info/exclude`, so it never appears as an
 * untracked change in the user's repository.
 */
export class WorktreeManager {
  /**
   * @param {{dataDir: string, worktreeDir?: string, timeoutMs?: number}} options - manager options.
   */
  constructor(options) {
    this.dataDir = options.dataDir
    this.worktreeDir = options.worktreeDir ?? '.project-teams'
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  /**
   * Managed run directory of one repository.
   * @param {string} repoRoot - project repository root.
   * @returns {string} absolute directory.
   */
  runsRoot(repoRoot) {
    const relative = String(this.worktreeDir).trim().replace(/^[./\\]+/, '.').replace(/[/\\]+$/, '')
    if (!/^\.?[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(relative)) {
      throw new PtError('path/invalid-segment', `worktreeDir "${String(this.worktreeDir)}" is not a safe directory name`, 400)
    }
    return join(repoRoot, relative, 'runs')
  }

  /**
   * Absolute worktree path of one run.
   * @param {string} repoRoot - project repository root.
   * @param {string} runId - run identity.
   * @returns {string} absolute path.
   */
  worktreePathOf(repoRoot, runId) {
    return containPath(this.runsRoot(repoRoot), join(this.runsRoot(repoRoot), safeSegment(runId, 'runId'), 'worktree'))
  }

  /**
   * Ensure the managed directory is ignored by the repository without touching
   * the working tree or the user's `.gitignore`.
   * @param {string} repoRoot - project repository root.
   * @returns {Promise<void>} resolves after the exclude entry exists.
   */
  async ensureExcluded(repoRoot) {
    const infoDir = join(repoRoot, '.git', 'info')
    const excludeFile = join(infoDir, 'exclude')
    const entry = `${this.worktreeDir.replace(/\/+$/, '')}/`
    let current = ''
    try {
      current = await readFile(excludeFile, 'utf8')
    } catch {
      current = ''
    }
    if (current.split(/\r?\n/).some((line) => line.trim() === entry)) return
    await mkdir(infoDir, { recursive: true })
    const next = current === '' || current.endsWith('\n') ? `${current}${entry}\n` : `${current}\n${entry}\n`
    await writeFile(excludeFile, next, 'utf8')
  }

  /**
   * Inspect a repository before a project is bound to it.
   * @param {string} repoRoot - candidate repository root.
   * @returns {Promise<Record<string, unknown>>} repository facts.
   */
  async inspectRepository(repoRoot) {
    if (typeof repoRoot !== 'string' || repoRoot.trim() === '' || !isAbsolute(repoRoot)) {
      throw new PtError('project/repo-path', 'repo_root must be an absolute path', 400)
    }
    const root = resolve(normalize(repoRoot.trim()))
    let info
    try {
      info = await stat(root)
    } catch {
      throw new PtError('project/repo-missing', `repository path ${root} does not exist`, 400)
    }
    if (!info.isDirectory()) {
      throw new PtError('project/repo-not-directory', `repository path ${root} is not a directory`, 400)
    }
    const inside = await git(['rev-parse', '--is-inside-work-tree'], { cwd: root, allowFailure: true, timeoutMs: this.timeoutMs })
    if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
      throw new PtError('project/not-a-repository', `${root} is not inside a Git work tree`, 400)
    }
    const top = (await git(['rev-parse', '--show-toplevel'], { cwd: root, timeoutMs: this.timeoutMs })).stdout.trim()
    const head = await git(['rev-parse', 'HEAD'], { cwd: root, allowFailure: true, timeoutMs: this.timeoutMs })
    if (head.code !== 0) {
      throw new PtError('project/empty-repository', `${root} has no commit yet; create an initial commit first`, 400)
    }
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, allowFailure: true, timeoutMs: this.timeoutMs })
    return {
      repoRoot: resolve(normalize(top)),
      requestedRoot: root,
      headCommit: head.stdout.trim(),
      branch: branch.stdout.trim() || 'HEAD',
      version: (await git(['--version'], { cwd: root, allowFailure: true })).stdout.trim(),
    }
  }

  /**
   * Create the isolated worktree of one run.
   *
   * @param {{projectId: string, taskId: string, runId: string, repoRoot: string, baseCommit: string}} input - run identity.
   * @returns {Promise<{worktreePath: string, branch: string, baseCommit: string}>} created workspace.
   */
  async createWorktree(input) {
    const taskId = safeSegment(input.taskId, 'taskId')
    const runId = safeSegment(input.runId, 'runId')
    await this.ensureExcluded(input.repoRoot)
    const runsRoot = this.runsRoot(input.repoRoot)
    const worktreePath = this.worktreePathOf(input.repoRoot, runId)
    const branch = `pt/${taskId}/${runId}`
    await mkdir(join(runsRoot, runId), { recursive: true })
    const existing = await stat(worktreePath).catch(() => undefined)
    if (existing !== undefined) {
      throw new PtError('workspace/exists', `worktree ${worktreePath} already exists; refusing to reuse an unknown directory`, 409)
    }
    // A stale branch from a failed attempt would make `worktree add -b` fail with
    // an unrelated message, so it is reported explicitly instead.
    const branchCheck = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: input.repoRoot,
      allowFailure: true,
      timeoutMs: this.timeoutMs,
    })
    if (branchCheck.code === 0) {
      throw new PtError('workspace/branch-exists', `branch ${branch} already exists`, 409)
    }
    await git(['worktree', 'add', '-b', branch, worktreePath, input.baseCommit], {
      cwd: input.repoRoot,
      timeoutMs: this.timeoutMs,
    })
    return { worktreePath, branch, baseCommit: input.baseCommit }
  }

  /**
   * Stage everything and create one commit in the run worktree.
   * @param {{worktreePath: string, message: string}} input - commit input.
   * @returns {Promise<{commit: string, files: string[]}>} commit facts.
   */
  async commitAll(input) {
    await git(['add', '--all'], { cwd: input.worktreePath, timeoutMs: this.timeoutMs })
    const staged = await git(['diff', '--cached', '--name-only'], { cwd: input.worktreePath, timeoutMs: this.timeoutMs })
    const files = staged.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    if (files.length === 0) {
      throw new PtError('artifact/no-changes', 'the run worktree has no staged changes to commit', 400)
    }
    const message = input.message.trim() === '' ? 'project-teams: run commit' : input.message.trim()
    await git(['-c', 'user.name=Project Teams', '-c', 'user.email=project-teams@localhost', 'commit', '-m', message], {
      cwd: input.worktreePath,
      timeoutMs: this.timeoutMs,
    })
    const commit = (await git(['rev-parse', 'HEAD'], { cwd: input.worktreePath, timeoutMs: this.timeoutMs })).stdout.trim()
    return { commit, files }
  }

  /**
   * Read the diff of a run against its base commit.
   * @param {{worktreePath: string, baseCommit: string, headCommit?: string|null, stat?: boolean}} input - diff input.
   * @returns {Promise<string>} unified diff (bounded by the caller).
   */
  async diff(input) {
    const target = input.headCommit === undefined || input.headCommit === null ? 'HEAD' : input.headCommit
    const args = ['diff', ...(input.stat === true ? ['--stat'] : []), `${input.baseCommit}..${target}`]
    const result = await git(args, { cwd: input.worktreePath, timeoutMs: this.timeoutMs })
    return result.stdout
  }

  /**
   * Current head commit of a worktree.
   * @param {string} worktreePath - run worktree.
   * @returns {Promise<string>} commit hash.
   */
  async headCommit(worktreePath) {
    const result = await git(['rev-parse', 'HEAD'], { cwd: worktreePath, timeoutMs: this.timeoutMs })
    return result.stdout.trim()
  }

  /**
   * Whether the worktree has uncommitted changes.
   * @param {string} worktreePath - run worktree.
   * @returns {Promise<boolean>} dirty flag.
   */
  async isDirty(worktreePath) {
    const result = await git(['status', '--porcelain'], { cwd: worktreePath, timeoutMs: this.timeoutMs })
    return result.stdout.trim() !== ''
  }

  /**
   * Remove one run worktree. The branch is kept unless `deleteBranch` is set:
   * cancelled work stays inspectable, which is the "do not destroy work on
   * cancel" rule.
   * @param {{repoRoot: string, worktreePath: string, branch: string, deleteBranch?: boolean, force?: boolean}} input - removal input.
   * @returns {Promise<void>} resolves after removal.
   */
  async removeWorktree(input) {
    const runsRoot = this.runsRoot(input.repoRoot)
    containPath(runsRoot, input.worktreePath)
    await git(['worktree', 'remove', ...(input.force === false ? [] : ['--force']), input.worktreePath], {
      cwd: input.repoRoot,
      timeoutMs: this.timeoutMs,
      allowFailure: true,
    })
    const exists = await stat(input.worktreePath).catch(() => undefined)
    if (exists !== undefined) await rm(input.worktreePath, { recursive: true, force: true })
    if (input.deleteBranch === true) {
      await git(['branch', '-D', input.branch], { cwd: input.repoRoot, allowFailure: true, timeoutMs: this.timeoutMs })
    }
  }
}
