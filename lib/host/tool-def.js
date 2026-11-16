/**
 * Local tool-definition compiler.
 *
 * The plugin used to import `defineTool` from `@deepseek-ai/dsh-tools`. That
 * import only resolves inside the Desktop Host, whose module graph anchors the
 * DSH packages; a `dsh` CLI boot of a *linked* plugin directory cannot resolve
 * it (verified: `ERR_MODULE_NOT_FOUND` for `@deepseek-ai/dsh-tools`). Keeping the
 * dependency would make the bundle unusable outside Desktop and impossible to
 * verify across a real process restart in an isolated profile.
 *
 * This module implements the same contract the Host helper provides for the
 * subset the plugin uses: compile the parameter DSL to JSON Schema, compile the
 * declared output schema, and validate arguments before `execute` runs. The
 * real Host helper is still preferred at runtime when it is importable (see
 * `./dsh-tools.js`), so Desktop behaviour is unchanged.
 *
 * @module project-teams/lib/host/tool-def
 */

/**
 * Error thrown when tool arguments do not match the declared parameters.
 */
export class ToolArgsError extends Error {
  /**
   * @param {Array<{path: string, message: string}>} violations - argument violations.
   */
  constructor(violations) {
    super(`invalid tool arguments: ${violations.map((violation) => `${violation.path || '(root)'}: ${violation.message}`).join('; ')}`)
    this.name = 'ToolArgsError'
    this.violations = violations
  }
}

/**
 * Convert one property declaration of the parameter DSL to JSON Schema.
 * @param {Record<string, any>} spec - property declaration.
 * @returns {Record<string, any>} JSON Schema.
 */
function propertySchema(spec) {
  /** @type {Record<string, any>} */
  const schema = {}
  if (typeof spec.type === 'string') schema.type = spec.type
  if (typeof spec.description === 'string') schema.description = spec.description
  if (Array.isArray(spec.enum)) schema.enum = [...spec.enum]
  if (spec.type === 'array') schema.items = propertySchema(spec.items ?? { type: 'string' })
  if (spec.type === 'object') {
    const properties = spec.properties ?? {}
    schema.properties = Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, propertySchema(value)]))
    schema.additionalProperties = spec.additionalProperties === true
    const required = Object.entries(properties).filter(([, value]) => value?.required === true).map(([name]) => name)
    if (required.length > 0) schema.required = required
  }
  if (spec.type === 'object' && spec.additionalProperties === undefined) schema.additionalProperties = true
  return schema
}

/**
 * Compile the parameter map of one tool.
 * @param {Record<string, any> | undefined} parameters - parameter declarations.
 * @returns {Record<string, any>} JSON Schema for the whole argument object.
 */
export function parametersToJsonSchema(parameters) {
  const specs = parameters ?? {}
  const properties = Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, propertySchema(spec)]))
  const required = Object.entries(specs).filter(([, spec]) => spec?.required === true).map(([name]) => name)
  /** @type {Record<string, any>} */
  const schema = { type: 'object', properties, additionalProperties: false }
  if (required.length > 0) schema.required = required
  return schema
}

/**
 * Compile one declared output schema. The plugin writes it directly in JSON
 * Schema form already; `required: true` inside a property is normalised into the
 * owning object's `required` array.
 * @param {Record<string, any>} spec - output schema declaration.
 * @returns {Record<string, any>} JSON Schema.
 */
export function outputToJsonSchema(spec) {
  if (spec === null || typeof spec !== 'object') return { type: 'object', additionalProperties: true }
  /** @type {Record<string, any>} */
  const schema = { ...spec }
  if (schema.properties !== undefined) {
    const required = Object.entries(schema.properties)
      .filter(([, value]) => value?.required === true)
      .map(([name]) => name)
    schema.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => {
        const { required: _required, ...rest } = value ?? {}
        void _required
        return [name, rest]
      }),
    )
    if (required.length > 0) schema.required = required
    else delete schema.required
  }
  return schema
}

/**
 * Validate one argument object against a compiled parameter schema.
 * @param {Record<string, any>} schema - compiled parameter schema.
 * @param {Record<string, any>} args - parsed arguments.
 * @returns {Array<{path: string, message: string}>} violations (empty when valid).
 */
export function validateArguments(schema, args) {
  /** @type {Array<{path: string, message: string}>} */
  const violations = []
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    violations.push({ path: '', message: 'arguments must be an object' })
    return violations
  }
  for (const name of schema.required ?? []) {
    if (args[name] === undefined || args[name] === null) violations.push({ path: name, message: 'is required' })
  }
  for (const [name, value] of Object.entries(args)) {
    const property = schema.properties?.[name]
    if (property === undefined) {
      if (schema.additionalProperties === false) violations.push({ path: name, message: 'is not a declared parameter' })
      continue
    }
    if (value === undefined || value === null) continue
    if (property.type !== undefined) {
      const actual = Array.isArray(value) ? 'array' : typeof value
      const expected = property.type === 'number' ? 'number' : property.type
      if (expected === 'number' ? typeof value !== 'number' : actual !== expected) {
        violations.push({ path: name, message: `must be ${expected}` })
        continue
      }
    }
    if (Array.isArray(property.enum) && !property.enum.includes(value)) {
      violations.push({ path: name, message: `must be one of ${property.enum.join(', ')}` })
    }
  }
  return violations
}

/**
 * Define one tool, mirroring the Host helper's contract.
 * @param {Record<string, any>} options - tool declaration.
 * @returns {Record<string, any>} tool definition registered with `ctx.tools`.
 */
export function defineTool(options) {
  const parameters = parametersToJsonSchema(options.parameters)
  const outputSchema = outputToJsonSchema(options.output?.schema)
  const render = options.output?.render
  const execute = options.execute
  const tool = {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: outputSchema,
      render(args, value) {
        return render === undefined ? [{ type: 'text', text: JSON.stringify(value) }] : render(args, value)
      },
    },
    async execute(args, exec) {
      const violations = validateArguments(parameters, args ?? {})
      if (violations.length > 0) throw new ToolArgsError(violations)
      return execute(args ?? {}, exec)
    },
  }
  if (options.timeoutMs !== undefined) tool.timeoutMs = options.timeoutMs
  if (options.isConcurrencySafe !== undefined) tool.isConcurrencySafe = options.isConcurrencySafe
  return tool
}
