/**
 * Host entry of the Project Teams bundle.
 *
 * `inject` names the composed services this plugin needs. Cordis activates the
 * plugin once every named service exists, and disposes it when one disappears;
 * every listener, route and tool registered inside `apply` is owned by that
 * fiber and therefore released on reload.
 *
 * @module project-teams
 */

import { applyHost } from './lib/host/index.js'

export const name = 'project-teams'

export const inject = [
  'webServer',
  'connection',
  'sessionController',
  'sessions',
  'agents',
  'tools',
  'systemPrompt',
]

/**
 * Activate the plugin.
 * @param {any} ctx - Cordis plugin context.
 * @param {Record<string, unknown> | undefined} config - loader row configuration.
 * @returns {void}
 */
export function apply(ctx, config) {
  applyHost(ctx, config)
}
