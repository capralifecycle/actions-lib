import { describe, expect, test } from "bun:test"

import {
  type BuildContext,
  type TagRequest,
  branchFromRef,
  generateTag,
  parseMaxLength,
  parseTagType,
  sanitiseBranchName,
} from "./tag.ts"

const context = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  now: new Date("2026-09-09T12:51:17Z"),
  commitSha: "abcd1234567890",
  buildId: "1658821493",
  branch: "main",
  ...overrides,
})

const request = (overrides: Partial<TagRequest> = {}): TagRequest => ({
  tagType: "hyphenated-alphanumeric-tag",
  prefix: "",
  maxLength: 256,
  addAutomaticPrefix: false,
  ...overrides,
})

const value = (result: ReturnType<typeof generateTag>): string => {
  if (!result.ok) throw new Error(`expected a tag, got error: ${result.error}`)
  return result.value
}

const error = (result: ReturnType<typeof generateTag>): string => {
  if (result.ok) throw new Error(`expected an error, got tag: ${result.value}`)
  return result.error
}

describe("a punctuated timestamp tag", () => {
  test("renders the UTC timestamp, dot-separated from any prefix", () => {
    for (const [prefix, expected] of [
      ["", "20260909.125117"],
      ["my-app", "my-app.20260909.125117"],
    ] as const) {
      const request_ = request({ tagType: "punctuated-timestamp-tag", prefix })
      expect(value(generateTag(request_, context()))).toBe(expected)
    }
  })

  test("is rejected when it exceeds max-length", () => {
    expect(
      error(
        generateTag(request({ tagType: "punctuated-timestamp-tag", maxLength: 14 }), context()),
      ),
    ).toBe("Maximum tag length 14 has been exceeded")
  })
})

describe("a hyphenated alphanumeric tag", () => {
  test("carries timestamp, build id, short SHA and branch", () => {
    expect(value(generateTag(request(), context()))).toBe(
      "20260909-125117z-1658821493-abcd1234-main",
    )
  })

  test("marks a non-default branch with an nd- prefix", () => {
    expect(
      value(generateTag(request({ prefix: "my-app", addAutomaticPrefix: true }), context())),
    ).toBe("nd-my-app-20260909-125117z-1658821493-abcd1234-main")
  })

  test("yields a doubled separator when the automatic prefix meets an empty caller prefix", () => {
    expect(value(generateTag(request({ addAutomaticPrefix: true }), context()))).toBe(
      "nd--20260909-125117z-1658821493-abcd1234-main",
    )
  })

  test("rejects a caller prefix that would be indistinguishable from the automatic one", () => {
    for (const prefix of ["nd", "nd-"]) {
      expect(error(generateTag(request({ prefix, addAutomaticPrefix: true }), context()))).toBe(
        `The prefix '${prefix}' contains a reserved word 'nd'`,
      )
    }
  })

  test("truncates the branch name to fill the length budget exactly", () => {
    expect(
      value(
        generateTag(
          request({ maxLength: 60 }),
          context({ branch: "feature/some-really-long-branch-name" }),
        ),
      ),
    ).toBe("20260909-125117z-1658821493-abcd1234-featuresome-really-long")
  })

  test("is accepted when it fits max-length exactly", () => {
    expect(value(generateTag(request({ maxLength: 41 }), context()))).toHaveLength(41)
  })

  test("is rejected when too little of the branch name would survive", () => {
    expect(error(generateTag(request({ maxLength: 40 }), context()))).toBe(
      "The tag exceeds the maximum length of 40 characters by 1 character(s)",
    )
  })
})

describe("the length budget", () => {
  const randomBranch = (length: number): string =>
    Array.from(
      { length },
      () => "abcdefghijklmnopqrstuvwxyz0123456789-_"[Math.floor(Math.random() * 38)],
    ).join("")

  test("is never exceeded by a generated tag", () => {
    for (let i = 0; i < 500; i++) {
      const maxLength = 42 + Math.floor(Math.random() * 200)
      const result = generateTag(
        request({
          maxLength,
          prefix: randomBranch(Math.floor(Math.random() * 12)),
          addAutomaticPrefix: Math.random() < 0.5,
        }),
        context({ branch: randomBranch(Math.floor(Math.random() * 120)) }),
      )
      if (result.ok) expect(result.value.length).toBeLessThanOrEqual(maxLength)
    }
  })

  test("rejects rather than emitting a tag with a uselessly short branch fragment", () => {
    const head = "20260909-125117z-1658821493-abcd1234-"

    for (let i = 0; i < 500; i++) {
      const maxLength = 20 + Math.floor(Math.random() * 40)
      const branch = randomBranch(Math.floor(Math.random() * 40))
      const result = generateTag(request({ maxLength }), context({ branch }))
      if (result.ok) {
        const emitted = result.value.slice(head.length)
        expect(emitted.length === branch.length || emitted.length >= 10).toBe(true)
      }
    }
  })
})

describe("input parsing", () => {
  test("rejects an unknown tag type by name", () => {
    const result = parseTagType("semver")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe("Unknown tag type 'semver'")
  })

  test("rejects a max-length that is not a positive integer", () => {
    for (const input of ["", "0", "-1", "abc", "1.5"]) {
      expect(parseMaxLength(input).ok).toBe(false)
    }
    expect(parseMaxLength("256")).toEqual({ ok: true, value: 256 })
  })

  test("takes the branch name from a push ref, leaving other ref shapes intact", () => {
    expect(branchFromRef("refs/heads/feature/x")).toBe("feature/x")
    expect(branchFromRef("refs/pull/42/merge")).toBe("refs/pull/42/merge")
  })

  test("keeps only characters legal in an image tag", () => {
    expect(sanitiseBranchName("feat/æøå-1_2.3")).toBe("feat-1_23")
  })
})
