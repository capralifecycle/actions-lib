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

describe("the length budget of a hyphenated tag", () => {
  // Every combination around the point where the head alone fills the budget,
  // for heads of several lengths: short enough to run exhaustively, and wide
  // enough that each boundary is crossed from both sides.
  const cases = ["", "app", "a-much-longer-prefix"].flatMap((prefix) =>
    [false, true].flatMap((addAutomaticPrefix) =>
      Array.from({ length: 31 }, (_, branchLength) =>
        Array.from({ length: 90 }, (_, index) => ({
          prefix,
          addAutomaticPrefix,
          branch: "b".repeat(branchLength),
          maxLength: index + 1,
        })),
      ).flat(),
    ),
  )

  /** The tag's fixed part, which everything but the branch name contributes. */
  const headOf = (prefix: string, addAutomaticPrefix: boolean): string =>
    value(
      generateTag(
        request({ prefix, addAutomaticPrefix, maxLength: 1000 }),
        context({ branch: "" }),
      ),
    )

  test("is filled with as much of the branch name as fits, and never exceeded", () => {
    for (const { prefix, addAutomaticPrefix, branch, maxLength } of cases) {
      const result = generateTag(
        request({ prefix, addAutomaticPrefix, maxLength }),
        context({ branch }),
      )
      if (!result.ok) continue
      const head = headOf(prefix, addAutomaticPrefix)
      const fits = Math.min(branch.length, maxLength - head.length)
      expect(result.value).toBe(`${head}${branch.slice(0, fits)}`)
      expect(result.value.length).toBeLessThanOrEqual(maxLength)
    }
  })

  test("is refused only when not even ten characters of the branch name fit", () => {
    for (const { prefix, addAutomaticPrefix, branch, maxLength } of cases) {
      const result = generateTag(
        request({ prefix, addAutomaticPrefix, maxLength }),
        context({ branch }),
      )
      const shortest = headOf(prefix, addAutomaticPrefix).length + Math.min(branch.length, 10)
      expect(result.ok).toBe(shortest <= maxLength)
    }
  })
})

describe("the length budget of a punctuated tag", () => {
  test("is met exactly or refused, never exceeded", () => {
    for (const prefix of ["", "app"]) {
      const full = value(
        generateTag(request({ tagType: "punctuated-timestamp-tag", prefix }), context()),
      )
      for (let maxLength = 1; maxLength <= full.length + 1; maxLength++) {
        const result = generateTag(
          request({ tagType: "punctuated-timestamp-tag", prefix, maxLength }),
          context(),
        )
        expect(result.ok).toBe(full.length <= maxLength)
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
