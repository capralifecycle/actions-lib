export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

const ok = <T>(value: T): Result<T> => ({ ok: true, value })
const err = <T>(error: string): Result<T> => ({ ok: false, error })

interface FieldSchema {
  /** The type of the field, or of each item when `collection` is set. */
  readonly type: "string"
  readonly required: boolean
  /** The field holds an array of `type` rather than a single value. */
  readonly collection?: boolean
}

const SCHEMA_VERSIONS: Record<string, Record<string, FieldSchema>> = {
  "0.1": {
    version: { type: "string", required: true },
    accountId: { type: "string", required: true },
    roleName: { type: "string", required: true },
    limitedRoleName: { type: "string", required: false },
    artifactBucket: { type: "string", required: true },
    ecrRepository: { type: "string", required: false },
    pipelines: { type: "string", collection: true, required: false },
    devPipelines: { type: "string", collection: true, required: false },
    prodPipelines: { type: "string", collection: true, required: false },
  },
}

export type Config = Record<string, unknown>

/** One `name=value` line, in the order the configuration declared it. */
export interface Output {
  readonly name: string
  readonly value: string
}

export function parseJson(serialized: string): Result<Config> {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return err("Failed to parse configuration as JSON")
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? ok(parsed as Config)
    : err("The configuration is not a JSON object")
}

function describe(value: unknown): string {
  if (Array.isArray(value)) return "an array"
  if (value === null) return "null"
  return `a ${typeof value}`
}

function checkField(
  name: string,
  schema: FieldSchema,
  value: unknown,
): string | undefined {
  if (value === undefined) {
    return schema.required ? `'${name}' is required but missing` : undefined
  }
  if (schema.collection) {
    if (!Array.isArray(value)) {
      return `'${name}' must be an array of ${schema.type}s, got ${describe(value)}`
    }
    const badIndex = value.findIndex((item) => typeof item !== schema.type)
    return badIndex === -1
      ? undefined
      : `'${name}[${badIndex}]' must be a ${schema.type}, got ${describe(value[badIndex])}`
  }
  return typeof value === schema.type
    ? undefined
    : `'${name}' must be a ${schema.type}, got ${describe(value)}`
}

/**
 * Checks the configuration against the schema its `version` selects, reporting
 * every violation rather than only the first.
 */
export function validate(config: Config): Result<Config> {
  const version = config["version"]
  if (typeof version !== "string") {
    return err("The configuration has no 'version' string")
  }

  const schema = SCHEMA_VERSIONS[version]
  if (!schema) {
    return err(`No matching schema found for schema version '${version}'`)
  }

  const problems = Object.entries(schema)
    .map(([name, field]) => checkField(name, field, config[name]))
    .filter((problem): problem is string => problem !== undefined)

  const unknown = Object.keys(config).filter((key) => !(key in schema))
  if (unknown.length > 0) {
    problems.push(`unknown field(s): ${unknown.map((k) => `'${k}'`).join(", ")}`)
  }

  return problems.length === 0
    ? ok(config)
    : err(
        `The supplied configuration does not match schema version '${version}':\n` +
          problems.map((problem) => `  - ${problem}`).join("\n"),
      )
}

/**
 * Renders the configuration as action outputs: empty fields are dropped, and
 * arrays become space-separated lists, which is the form the other actions in
 * this library accept for their list inputs.
 */
export function toOutputs(config: Config): Output[] {
  return Object.entries(config)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => {
      const joined = Array.isArray(value) ? value.join(" ") : value
      return {
        name,
        value: typeof joined === "string" ? joined : JSON.stringify(joined),
      }
    })
}

export function parseConfig(serialized: string): Result<Output[]> {
  const parsed = parseJson(serialized)
  if (!parsed.ok) return parsed

  const validated = validate(parsed.value)
  if (!validated.ok) return validated

  return ok(toOutputs(validated.value))
}
