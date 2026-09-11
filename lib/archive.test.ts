import { describe, expect, test } from "bun:test"
import { unzipSync } from "fflate"
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sha256, zipDirectory } from "./archive.ts"

const built = (directory: string): Uint8Array => {
  const result = zipDirectory(directory)
  if (!result.ok) throw new Error(`expected an archive, got: ${result.error}`)
  return result.value
}

/** The mode bits an extracted entry would be created with. */
const modeOf = (zip: Uint8Array, name: string): number => {
  // fflate exposes content but not attributes on unzip, so read the mode out of
  // the central directory the same way an unzip implementation does.
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const target = new TextEncoder().encode(name)
  for (let i = 0; i < zip.length - 46; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue
    const nameLength = view.getUint16(i + 28, true)
    const candidate = zip.subarray(i + 46, i + 46 + nameLength)
    if (
      candidate.length === target.length &&
      candidate.every((byte, index) => byte === target[index])
    ) {
      return (view.getUint32(i + 38, true) >>> 16) & 0xfff
    }
  }
  throw new Error(`no central directory entry for '${name}'`)
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "archive-"))
  writeFileSync(join(root, "run.sh"), "#!/bin/sh\necho hi\n")
  chmodSync(join(root, "run.sh"), 0o755)
  writeFileSync(join(root, "data.txt"), "plain\n")
  chmodSync(join(root, "data.txt"), 0o644)
  mkdirSync(join(root, "nested"))
  chmodSync(join(root, "nested"), 0o755)
  writeFileSync(join(root, "nested", "inner.txt"), "nested\n")
  chmodSync(join(root, "nested", "inner.txt"), 0o600)
  mkdirSync(join(root, "empty"))
  symlinkSync("data.txt", join(root, "link.txt"))
  return root
}

describe("a zipped directory", () => {
  const zip = built(fixture())
  const files = unzipSync(zip)

  test("keeps the executable bit, which a deployed script depends on", () => {
    expect(modeOf(zip, "run.sh")).toBe(0o755)
  })

  test("keeps a restrictive mode rather than widening it", () => {
    expect(modeOf(zip, "nested/inner.txt")).toBe(0o600)
  })

  test("stores nested paths with forward slashes", () => {
    expect(Object.keys(files)).toContain("nested/inner.txt")
  })

  test("follows a symlink and stores what it points at, as zip -r does", () => {
    expect(new TextDecoder().decode(files["link.txt"])).toBe("plain\n")
  })

  test("keeps an empty directory, which a file-only walk would lose", () => {
    expect(Object.keys(files)).toContain("empty/")
  })

  test("records every directory, as zip -r does, not only empty ones", () => {
    expect(Object.keys(files)).toContain("nested/")
  })

  test("keeps a directory's own mode on its entry", () => {
    expect(modeOf(zip, "nested/")).toBe(0o755)
  })
})

describe("the checksum", () => {
  test("is the sha256 of the content, which names the artifact in S3", () => {
    expect(sha256(new TextEncoder().encode("hello"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })
})

describe("a directory that cannot be archived", () => {
  test("is refused when it is empty, as `zip -r` refuses it", () => {
    const root = mkdtempSync(join(tmpdir(), "archive-empty-"))
    const result = zipDirectory(root)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("Nothing to archive")
  })

  test("does not recurse forever through a symlink to an ancestor", () => {
    const root = mkdtempSync(join(tmpdir(), "archive-cycle-"))
    writeFileSync(join(root, "a.txt"), "a\n")
    mkdirSync(join(root, "sub"))
    symlinkSync(root, join(root, "sub", "loop"))
    expect(Object.keys(unzipSync(built(root)))).toContain("a.txt")
  })
})

describe("a deep tree", () => {
  test("is walked to the bottom without recursing once per level", () => {
    const root = mkdtempSync(join(tmpdir(), "archive-deep-"))
    let directory = root
    for (let level = 0; level < 200; level++) {
      directory = join(directory, "d")
      mkdirSync(directory)
    }
    writeFileSync(join(directory, "bottom.txt"), "bottom\n")
    const names = Object.keys(unzipSync(built(root)))
    expect(names).toContain(`${"d/".repeat(200)}bottom.txt`)
    expect(names.filter((name) => name.endsWith("/"))).toHaveLength(200)
  })
})

describe("the same tree", () => {
  test("always produces the same archive, so its key is stable", () => {
    const root = fixture()
    expect(sha256(built(root))).toBe(sha256(built(root)))
  })
})
