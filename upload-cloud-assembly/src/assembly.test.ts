import { describe, expect, test } from "bun:test"

import { buildMetadata, renderMetadata } from "./assembly.ts"

describe("the metadata a pipeline reads", () => {
  test("uses the cloud-assembly field names, not the cdk-source ones", () => {
    expect(
      JSON.parse(renderMetadata(buildMetadata("a-bucket", "abc.zip", "v1"))),
    ).toEqual({
      cloudAssemblyBucketName: "a-bucket",
      cloudAssemblyBucketKey: "abc.zip",
      cloudAssemblyVersionId: "v1",
    })
  })

  test("ends with a newline, as the shell heredoc did", () => {
    expect(renderMetadata(buildMetadata("b", "k", "v")).endsWith("}\n")).toBe(true)
  })
})
