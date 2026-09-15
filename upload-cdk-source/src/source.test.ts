import { describe, expect, test } from "bun:test"

import { buildMetadata, renderMetadata, selectEntries } from "./source.ts"

const DEFAULT_INCLUDE =
  "assets cdk.json cdk.context.json package.*\\.json src tsconfig\\.json"

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
    expect(selectEntries(present, DEFAULT_INCLUDE)).toEqual([
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
    const selected = selectEntries(present, DEFAULT_INCLUDE)
    expect(selected).not.toContain("node_modules")
    expect(selected).not.toContain("cdk.out")
    expect(selected).not.toContain(".git")
  })

  test("anchors each pattern, so a longer name is not swept in", () => {
    expect(selectEntries(["src", "src-extra", "mysrc"], DEFAULT_INCLUDE)).toEqual([
      "src",
    ])
  })

  test("matches only names at the top level, never a nested path", () => {
    expect(selectEntries(["nested/cdk.json"], DEFAULT_INCLUDE)).toEqual([])
  })

  test("honours a caller's own patterns", () => {
    expect(selectEntries(["a.txt", "b.txt", "c.txt"], "a\\.txt c\\.txt")).toEqual([
      "a.txt",
      "c.txt",
    ])
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
