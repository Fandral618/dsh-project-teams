/**
 * SQLite persistence for Project Teams.
 *
 * The Host runtime (Node 24 inside DSH Desktop) ships `node:sqlite`, so the
 * plugin needs no native module and no build step: one synchronous database
 * handle, WAL journaling, foreign keys on, and a versioned migration table.
 *
 * Every write goes through {@link transaction}, which makes the business rule
 * "one transaction per state change" true by construction: a task transition,
 * its event row, its audit row and its outbox message commit together or not at
 * all.
 *
 * @module project-teams/lib/host/db
 */

import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Current schema version. A bump requires a new migration step. */
export const SCHEMA_VERSION = 1

/**
 * Open (and migrate) the database under a managed data root.
 *
 * @param {string} dataDir - managed data root.
 * @param {{fileName?: string}} [options] - `:memory:` for tests.
 * @returns {{db: any, path: string, close: () => void}} handle.
 */
export function openDatabase(dataDir, options = {}) {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
  const fileName = options.fileName ?? 'project-teams.db'
  const path = fileName === ':memory:' ? ':memory:' : join(dataDir, fileName)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 4000')
  migrate(db)
  return { db, path, close: () => db.close() }
}

/**
 * Read the current schema version.
 * @param {any} db - database handle.
 * @returns {number} version (0 before the first migration).
 */
function version(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version').get()
  return row === undefined ? 0 : Number(row.version)
}

/**
 * Apply every pending migration step.
 * @param {any} db - database handle.
 * @returns {void}
 */
export function migrate(db) {
  let current = version(db)
  if (current > SCHEMA_VERSION) {
    throw new Error(`project-teams: database schema ${current} is newer than this plugin (${SCHEMA_VERSION})`)
  }
  if (current === SCHEMA_VERSION) return
  if (current === 0) {
    db.exec('BEGIN')
    try {
      applyV1(db)
      db.exec('DELETE FROM schema_version')
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION)
      db.exec('COMMIT')
      current = SCHEMA_VERSION
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

/**
 * Schema version 1.
 *
 * Constraints that carry the product rules:
 * - `project_bots (project_id, session_id)` unique: one Session belongs to one
 *   project (P0), so a cross-project injection cannot be modelled at all;
 * - `messages (project_id, idempotency_key)` unique: a repeated key produces one
 *   business effect;
 * - the partial unique index `one_active_run`: at most one active TaskRun per
 *   task, which is the lease invariant in the schema itself;
 * - `task_events` and `audit_events` are append-only by convention and by the
 *   absence of any update path in the repositories.
 *
 * @param {any} db - database handle.
 * @returns {void}
 */
function applyV1(db) {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      goal TEXT NOT NULL DEFAULT '',
      repo_root TEXT NOT NULL,
      default_branch TEXT NOT NULL DEFAULT 'main',
      status TEXT NOT NULL DEFAULT 'active',
      policy TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE project_bots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      session_id TEXT NOT NULL,
      template_version INTEGER NOT NULL DEFAULT 1,
      agent_preset TEXT,
      cwd TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'active',
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (project_id, session_id),
      UNIQUE (project_id, role)
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      acceptance TEXT NOT NULL DEFAULT '[]',
      owner_bot_id TEXT REFERENCES project_bots(id),
      priority INTEGER NOT NULL DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      version INTEGER NOT NULL DEFAULT 1,
      risk_level TEXT NOT NULL DEFAULT 'low',
      write_scope TEXT NOT NULL DEFAULT '',
      base_commit TEXT,
      head_commit TEXT,
      blocked_reason TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX tasks_project_status ON tasks (project_id, status);

    CREATE TABLE task_dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_task_id)
    );

    CREATE TABLE task_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      from_state TEXT,
      to_state TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX task_events_task ON task_events (task_id, seq);

    CREATE TABLE task_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES project_bots(id),
      session_id TEXT NOT NULL,
      lease_until INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      worktree_path TEXT NOT NULL,
      branch TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      head_commit TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      budget_used INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      ended_reason TEXT
    );
    CREATE UNIQUE INDEX one_active_run ON task_runs (task_id) WHERE status = 'active';

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      from_bot_id TEXT NOT NULL REFERENCES project_bots(id),
      to_bot_id TEXT NOT NULL REFERENCES project_bots(id),
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      task_id TEXT REFERENCES tasks(id),
      thread_id TEXT,
      idempotency_key TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'QUEUED',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      delivered_at INTEGER,
      processed_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (project_id, idempotency_key)
    );
    CREATE INDEX messages_due ON messages (state, next_attempt_at);

    CREATE TABLE message_deliveries (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL,
      delivered_at INTEGER NOT NULL,
      result TEXT NOT NULL,
      error_code TEXT,
      detail TEXT
    );

    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES task_runs(id),
      kind TEXT NOT NULL,
      repo_commit TEXT NOT NULL,
      uri TEXT NOT NULL,
      sha256 TEXT,
      summary TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      reviewer_bot_id TEXT NOT NULL REFERENCES project_bots(id),
      artifact_id TEXT NOT NULL REFERENCES artifacts(id),
      base_commit TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      verdict TEXT NOT NULL,
      findings TEXT NOT NULL DEFAULT '[]',
      context TEXT NOT NULL DEFAULT '{}',
      requested_at INTEGER NOT NULL,
      decided_at INTEGER
    );

    CREATE TABLE verification_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      artifact_id TEXT REFERENCES artifacts(id),
      check_type TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      command TEXT NOT NULL,
      exit_code INTEGER,
      log_path TEXT,
      log_sha256 TEXT,
      output_tail TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE change_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      proposed_by TEXT NOT NULL,
      kind TEXT NOT NULL,
      impact TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );

    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      subject_revision TEXT NOT NULL,
      approver_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      justification TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX approvals_subject ON approvals (subject_type, subject_id);

    CREATE TABLE audit_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      result TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      trace_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX audit_project ON audit_events (project_id, seq);

    CREATE TABLE budgets (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      max_parallel_runs INTEGER NOT NULL DEFAULT 3,
      per_run_message_limit INTEGER NOT NULL DEFAULT 40,
      hourly_message_limit INTEGER NOT NULL DEFAULT 120,
      max_retries INTEGER NOT NULL DEFAULT 5,
      max_review_rounds INTEGER NOT NULL DEFAULT 3
    );

    CREATE TABLE counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `)
}

/**
 * Run one function inside a database transaction.
 *
 * Nested calls join the outer transaction so a service method can be composed
 * from smaller transactional steps without opening a second write window.
 *
 * @template T
 * @param {any} db - database handle.
 * @param {() => T} fn - body.
 * @returns {T} body result.
 */
export function transaction(db, fn) {
  if (transactionDepth > 0) return fn()
  db.exec('BEGIN IMMEDIATE')
  transactionDepth += 1
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // A rollback failure must not hide the original error.
    }
    throw error
  } finally {
    transactionDepth -= 1
  }
}

/** Current nesting depth of {@link transaction} on this module instance. */
let transactionDepth = 0

/**
 * Milliseconds since the epoch.
 * @returns {number} current time.
 */
export function now() {
  return Date.now()
}

/**
 * Increment and read one named counter inside a transaction (task numbering).
 * @param {any} db - database handle.
 * @param {string} name - counter name.
 * @param {number} [by] - increment.
 * @returns {number} new value.
 */
export function nextCounter(db, name, by = 1) {
  const row = db.prepare('SELECT value FROM counters WHERE name = ?').get(name)
  const next = (row === undefined ? 0 : Number(row.value)) + by
  if (row === undefined) db.prepare('INSERT INTO counters (name, value) VALUES (?, ?)').run(name, next)
  else db.prepare('UPDATE counters SET value = ? WHERE name = ?').run(next, name)
  return next
}
