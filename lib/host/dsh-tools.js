/**
 * `defineTool` resolution.
 *
 * Prefer the Host's own helper (identical behaviour to every shipped tool), and
 * fall back to the local compiler when the DSH packages are not resolvable from
 * this bundle — which happens for a linked plugin directory booted by the `dsh`
 * CLI outside Desktop (see `./tool-def.js`).
 *
 * @module project-teams/lib/host/dsh-tools
 */

let implementation
try {
  implementation = await import('@deepseek-ai/dsh-tools')
} catch {
  implementation = await import('./tool-def.js')
}

/** The tool-definition helper this Host offers. */
export const defineTool = implementation.defineTool

/** Which implementation is in use: `host` or `local`. */
export const toolDefinitionSource = implementation === undefined
  ? 'local'
  : typeof implementation.parametersToJsonSchema === 'function' ? 'local' : 'host'
