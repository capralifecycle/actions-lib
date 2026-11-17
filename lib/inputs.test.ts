import { describe, expect, test } from "bun:test"

import { collectInputs, parseFlags } from "./inputs.ts"

describe("reading inputs from the environment", () => {
  test("accepts the hyphenated names the node runtime sets", () => {
    expect(collectInputs({ "INPUT_COMMIT-SHA": "abc" }, ["commit-sha"])).toEqual({
      "commit-sha": "abc",
    })
  })

  test("accepts the underscored names a composite step can set", () => {
    expect(collectInputs({ INPUT_COMMIT_SHA: "abc" }, ["commit-sha"])).toEqual({
      "commit-sha": "abc",
    })
  })

  test("prefers the hyphenated name when both are present", () => {
    expect(
      collectInputs(
        { "INPUT_COMMIT-SHA": "hyphen", INPUT_COMMIT_SHA: "underscore" },
        ["commit-sha"],
      ),
    ).toEqual({ "commit-sha": "hyphen" })
  })

  test("reports an unset input as empty rather than undefined", () => {
    expect(collectInputs({}, ["channel"])).toEqual({ channel: "" })
  })
})

describe("reading inputs from the command line", () => {
  test("takes each named flag, in either spelling, and leaves the rest empty", () => {
    expect(
      parseFlags(["--bucket", "b", "--key=k"], ["bucket", "key", "prefix"]),
    ).toEqual({ ok: true, value: { bucket: "b", key: "k", prefix: "" } })
  })

  test.each([
    ["an unknown flag", ["--buckt", "b"]],
    ["a stray argument", ["b"]],
    ["a flag with no value", ["--bucket"]],
  ])("refuses %s rather than running without it", (_, args) => {
    expect(parseFlags(args, ["bucket"]).ok).toBe(false)
  })
})
