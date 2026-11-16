/**
 * HTTP seam of the Project Teams Host API.
 *
 * The browser half talks to `/<prefix>/api/...`. Every handler therefore shares
 * one request fence, one JSON body reader with a hard byte bound, and one
 * response envelope. Failures are `{ ok: false, error: { code, message } }`
 * with the HTTP status derived from the error code, so the Client renders the
 * Host's reason instead of inventing one.
 *
 * @module project-teams/lib/host/http
 */

/** Largest accepted JSON request body (bytes). */
export const MAX_BODY_BYTES = 1 << 20

/**
 * One business failure with a stable machine code and an HTTP status.
 */
export class PtError extends Error {
  /**
   * @param {string} code - stable machine code returned to the caller.
   * @param {string} message - human-readable reason.
   * @param {number} [status] - HTTP status when served over the Host API.
   * @param {Record<string, unknown>} [details] - structured context for the caller.
   */
  constructor(code, message, status = 400, details) {
    super(message)
    this.name = 'PtError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/**
 * Map an error code family to its HTTP status when the error carries none.
 * @param {string} code - machine code.
 * @returns {number} HTTP status.
 */
function statusOf(code) {
  if (code.endsWith('/not-found')) return 404
  if (code.endsWith('/forbidden')) return 403
  if (code.endsWith('/conflict') || code === 'VERSION_CONFLICT') return 409
  if (code.endsWith('/unavailable')) return 503
  return 400
}

/**
 * Normalize any thrown value into `{ code, message, status, details }`.
 * @param {unknown} error - thrown value.
 * @returns {{code: string, message: string, status: number, details?: Record<string, unknown>}} envelope fields.
 */
export function toErrorEnvelope(error) {
  if (error instanceof PtError) {
    return { code: error.code, message: error.message, status: error.status, details: error.details }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'internal', message, status: 500 }
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON-serializable body.
 * @returns {void}
 */
export function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(text)
}

/**
 * Write one success envelope.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {unknown} value - result value.
 * @returns {void}
 */
export function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value })
}

/**
 * Write one failure envelope.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {unknown} error - thrown value.
 * @returns {void}
 */
export function writeError(res, error) {
  const { code, message, status, details } = toErrorEnvelope(error)
  writeJson(res, status, { ok: false, error: details === undefined ? { code, message } : { code, message, details } })
}

/**
 * Read and parse one bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {number} [limit] - byte bound.
 * @returns {Promise<Record<string, unknown>>} parsed object (empty object for an empty body).
 */
export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) {
    throw new PtError('request-too-large', `request body exceeds ${limit} bytes`, 413)
  }
  /** @type {Buffer[]} */
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.byteLength
    if (total > limit) throw new PtError('request-too-large', `request body exceeds ${limit} bytes`, 413)
    chunks.push(buf)
  }
  if (total === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new PtError('bad-request', 'request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PtError('bad-request', 'request body must be a JSON object')
  }
  return /** @type {Record<string, unknown>} */ (parsed)
}

/**
 * Require a non-empty string field.
 * @param {Record<string, unknown>} body - request body.
 * @param {string} field - field name.
 * @returns {string} trimmed value.
 */
export function requireString(body, field) {
  const value = body[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PtError('bad-request', `"${field}" must be a non-empty string`)
  }
  return value.trim()
}

/**
 * Read an optional string field.
 * @param {Record<string, unknown>} body - request body.
 * @param {string} field - field name.
 * @returns {string | undefined} trimmed value, or undefined.
 */
export function optionalString(body, field) {
  const value = body[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new PtError('bad-request', `"${field}" must be a string`)
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Require an integer field.
 * @param {Record<string, unknown>} body - request body.
 * @param {string} field - field name.
 * @returns {number} integer value.
 */
export function requireInt(body, field) {
  const value = body[field]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new PtError('bad-request', `"${field}" must be an integer`)
  }
  return value
}

/**
 * Build the route prefix used by both halves.
 * @param {string} base - route base such as `/project-teams`.
 * @returns {string} normalized prefix without a trailing slash.
 */
export function apiPrefix(base) {
  const trimmed = base.replace(/\/+$/, '')
  return trimmed === '' ? '/project-teams' : trimmed
}

export { statusOf }
