import { describe, expect, test } from "bun:test"

import { buildMetadata, renderMetadata, selectEntries } from "./source.ts"

const DEFAULT_INCLUDE =
  "assets cdk.json cdk.context.json package.*\\.json src tsconfig\\.json"

const selected = (names: readonly string[], includeFiles: string): string[] => {
  const result = selectEntries(names, includeFiles)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe("selecting what goes into the archive", () => {
  const present = [
    "assets",
    "cdk.json",
    "cdk.context.json",
    "package.json",
    "package-lock.json",
    "src",
    "tsconfig.json",
    "node_modules",
    "README.md",
    "cdk.out",
    ".git",
  ]

  test("takes the CDK application's own sources and manifests", () => {
    expect(selected(present, DEFAULT_INCLUDE)).toEqual([
      "assets",
      "cdk.context.json",
      "cdk.json",
      "package-lock.json",
      "package.json",
      "src",
      "tsconfig.json",
    ])
  })

  test("leaves out what the pipeline rebuilds or does not need", () => {
    const names = selected(present, DEFAULT_INCLUDE)
    expect(names).not.toContain("node_modules")
    expect(names).not.toContain("cdk.out")
    expect(names).not.toContain(".git")
  })

  test("anchors each pattern, so a longer name is not swept in", () => {
    expect(selected(["src", "src-extra", "mysrc"], DEFAULT_INCLUDE)).toEqual([
      "src",
    ])
  })

  test("matches only names at the top level, never a nested path", () => {
    expect(selected(["nested/cdk.json"], DEFAULT_INCLUDE)).toEqual([])
  })

  test("honours a caller's own patterns", () => {
    expect(selected(["a.txt", "b.txt", "c.txt"], "a\\.txt c\\.txt")).toEqual([
      "a.txt",
      "c.txt",
    ])
  })

  test("anchors a pattern that has an alternation of its own", () => {
    expect(selected(["a", "b", "ab", "xa"], "a|b")).toEqual(["a", "b"])
  })

  test("refuses a pattern that is not a regular expression, naming it", () => {
    expect(selectEntries(["src"], "src (unclosed")).toEqual({
      ok: false,
      error: "'include-files' pattern '(unclosed' is not a valid regular expression",
    })
  })

  test("refuses a pattern that would reach outside its own anchors", () => {
    expect(selectEntries(["src", "node_modules"], "src x)|(.*").ok).toBe(false)
  })
})

describe("the metadata a pipeline reads", () => {
  test("names the bucket, the key and the version", () => {
    expect(
      JSON.parse(renderMetadata(buildMetadata("a-bucket", "abc.zip", "v1"))),
    ).toEqual({ bucketName: "a-bucket", bucketKey: "abc.zip", versionId: "v1" })
  })

  test("ends with a newline, as the shell heredoc did", () => {
    expect(renderMetadata(buildMetadata("b", "k", "v")).endsWith("}\n")).toBe(true)
  })
})
