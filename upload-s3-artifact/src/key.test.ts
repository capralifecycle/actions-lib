import { describe, expect, test } from "bun:test"

import { extensionOf, s3Key } from "./key.ts"

describe("the extension of a filename", () => {
  test("is the part after the last dot", () => {
    expect(extensionOf("target.zip")).toBe("zip")
    expect(extensionOf("app.tar.gz")).toBe("gz")
  })

  test("is empty when there is no dot", () => {
    expect(extensionOf("Makefile")).toBe("")
  })

  test("is empty for a name that ends in a dot", () => {
    expect(extensionOf("odd.")).toBe("")
  })
})

const request = (overrides: Partial<Parameters<typeof s3Key>[0]> = {}) => ({
  explicitKey: "",
  prefix: "",
  checksum: "abc123",
  extension: "zip",
  ...overrides,
})

describe("the S3 key", () => {
  test("is the checksum and the extension when nothing is given", () => {
    expect(s3Key(request())).toBe("abc123.zip")
  })

  test("drops the dot when the artifact has no extension", () => {
    expect(s3Key(request({ extension: "" }))).toBe("abc123")
  })

  test("is the caller's key when one is given, checksum ignored", () => {
    expect(s3Key(request({ explicitKey: "my-app.jar" }))).toBe("my-app.jar")
  })

  test("carries the prefix in front of either form", () => {
    expect(s3Key(request({ prefix: "builds/" }))).toBe("builds/abc123.zip")
    expect(s3Key(request({ prefix: "builds/", explicitKey: "x.zip" }))).toBe(
      "builds/x.zip",
    )
  })
})
