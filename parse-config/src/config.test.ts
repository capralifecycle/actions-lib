import { describe, expect, test } from "bun:test"

import { type Config, parseConfig, toOutputs, validate } from "./config.ts"

const minimal = {
  version: "0.1",
  accountId: "000000000000",
  roleName: "actions-lib-main",
  artifactBucket: "actions-lib-artifacts",
}

const config = (overrides: Config = {}): Config => ({ ...minimal, ...overrides })

const error = (result: ReturnType<typeof validate>): string => {
  if (result.ok) throw new Error("expected a validation error, got a config")
  return result.error
}

describe("a configuration is accepted", () => {
  test("when it carries only the required fields", () => {
    expect(validate(config()).ok).toBe(true)
  })

  test("when its optional list fields are arrays of strings", () => {
    const result = validate(
      config({
        devPipelines: ["apps-dev", "core-dev"],
        prodPipelines: ["apps-prod"],
        pipelines: [],
      }),
    )
    expect(result.ok).toBe(true)
  })

  test("when ecrRepository is a plain string", () => {
    // The schema declared this a collection while every real configuration and
    // the action's own test fixture set a string, and the check that would have
    // caught the mismatch was unreachable.
    expect(validate(config({ ecrRepository: "actions-lib-artifacts" })).ok).toBe(
      true,
    )
  })
})

describe("a configuration is rejected", () => {
  test("when a required field is missing", () => {
    const { accountId, ...withoutAccountId } = minimal
    expect(error(validate(withoutAccountId))).toContain(
      "'accountId' is required but missing",
    )
  })

  test("when the schema version is unknown", () => {
    expect(error(validate(config({ version: "9.9" })))).toBe(
      "No matching schema found for schema version '9.9'",
    )
  })

  test("when a list field holds a bare string", () => {
    expect(error(validate(config({ devPipelines: "apps-dev" })))).toContain(
      "'devPipelines' must be an array of strings, got a string",
    )
  })

  test("when a list field holds a non-string item", () => {
    expect(error(validate(config({ pipelines: ["ok", 7] })))).toContain(
      "'pipelines[1]' must be a string, got a number",
    )
  })

  test("when a scalar field holds the wrong type", () => {
    expect(error(validate(config({ accountId: 12 })))).toContain(
      "'accountId' must be a string, got a number",
    )
  })

  test("when it carries a field the schema does not know", () => {
    expect(error(validate(config({ typo: "value" })))).toContain(
      "unknown field(s): 'typo'",
    )
  })

  test("reporting every violation at once, not just the first", () => {
    const message = error(
      validate({ version: "0.1", devPipelines: 3, typo: true }),
    )
    expect(message).toContain("'accountId' is required but missing")
    expect(message).toContain("'roleName' is required but missing")
    expect(message).toContain("'artifactBucket' is required but missing")
    expect(message).toContain("'devPipelines' must be an array of strings")
    expect(message).toContain("unknown field(s): 'typo'")
  })
})

describe("outputs", () => {
  test("render arrays as space-separated lists", () => {
    expect(toOutputs({ devPipelines: ["apps-dev", "core-dev"] })).toEqual([
      { name: "devPipelines", value: "apps-dev core-dev" },
    ])
  })

  test("omit empty fields, so an unset value produces no output", () => {
    expect(toOutputs({ ecrRepository: "", roleName: "main" })).toEqual([
      { name: "roleName", value: "main" },
    ])
  })

  test("preserve the order the configuration declared", () => {
    const names = toOutputs(config({ ecrRepository: "repo" })).map((o) => o.name)
    expect(names).toEqual([
      "version",
      "accountId",
      "roleName",
      "artifactBucket",
      "ecrRepository",
    ])
  })
})

describe("parsing", () => {
  test("reports malformed JSON without leaking the input", () => {
    const result = parseConfig("{not json")
    expect(result).toEqual({
      ok: false,
      error: "Failed to parse configuration as JSON",
    })
  })

  test("rejects JSON that is not an object", () => {
    expect(parseConfig("[1, 2]").ok).toBe(false)
  })

  test("turns a well-formed configuration into outputs", () => {
    const result = parseConfig(
      JSON.stringify(config({ devPipelines: ["apps-dev"] })),
    )
    expect(result).toEqual({
      ok: true,
      value: [
        { name: "version", value: "0.1" },
        { name: "accountId", value: "000000000000" },
        { name: "roleName", value: "actions-lib-main" },
        { name: "artifactBucket", value: "actions-lib-artifacts" },
        { name: "devPipelines", value: "apps-dev" },
      ],
    })
  })
})
