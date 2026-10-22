import { describe, expect, test } from "bun:test"

import { type SourceFile, jacocoToLcov, locateSources, parseJacoco, toLcov } from "./jacoco.ts"

const report = (body: string): string =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">' +
  `<report name="app"><sessioninfo id="s" start="1" dump="2"/>${body}</report>`

const line = (nr: number, mi: number, ci: number, mb = 0, cb = 0): string =>
  `<line nr="${nr}" mi="${mi}" ci="${ci}" mb="${mb}" cb="${cb}"/>`

const counter = '<counter type="LINE" missed="1" covered="1"/>'

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe("reading a JaCoCo report", () => {
  test("names each source file by its package path", () => {
    const xml = report(
      '<package name="com/example">' +
        '<class name="com/example/Foo" sourcefilename="Foo.kt">' +
        '<method name="&lt;init&gt;" desc="()V" line="3">' +
        `${counter}</method>${counter}</class>` +
        `<sourcefile name="Foo.kt">${line(3, 0, 4)}${line(4, 2, 0)}${counter}</sourcefile>` +
        `${counter}</package>`,
    )

    expect(unwrap(parseJacoco(xml))).toEqual([
      {
        path: "com/example/Foo.kt",
        lines: [
          {
            nr: 3,
            missedInstructions: 0,
            coveredInstructions: 4,
            missedBranches: 0,
            coveredBranches: 0,
          },
          {
            nr: 4,
            missedInstructions: 2,
            coveredInstructions: 0,
            missedBranches: 0,
            coveredBranches: 0,
          },
        ],
      },
    ])
  })

  test("reads packages nested in the groups of an aggregate report", () => {
    const xml = report(
      `<group name="api"><package name="a"><sourcefile name="A.kt">${line(1, 0, 1)}</sourcefile></package></group>` +
        `<group name="core"><package name="b"><sourcefile name="B.kt">${line(1, 1, 0)}</sourcefile></package></group>`,
    )

    expect(unwrap(parseJacoco(xml)).map((file) => file.path)).toEqual(["a/A.kt", "b/B.kt"])
  })

  test("leaves a file in the default package without a directory", () => {
    const xml = report(`<package name=""><sourcefile name="Main.kt">${line(1, 0, 1)}</sourcefile></package>`)

    expect(unwrap(parseJacoco(xml))[0]?.path).toBe("Main.kt")
  })

  test("decodes escaped characters in names", () => {
    const xml = report(`<package name="a&amp;b"><sourcefile name="&quot;A&quot;.kt">${line(1, 0, 1)}</sourcefile></package>`)

    expect(unwrap(parseJacoco(xml))[0]?.path).toBe('a&b/"A".kt')
  })

  test("rejects a line whose counters are not counts", () => {
    const xml = report(`<package name="a"><sourcefile name="A.kt"><line nr="1" mi="x" ci="0" mb="0" cb="0"/></sourcefile></package>`)

    expect(parseJacoco(xml).ok).toBe(false)
  })
})

describe("writing LCOV", () => {
  const file = (path: string, lines: [number, number, number, number?, number?][]): SourceFile => ({
    path,
    lines: lines.map(([nr, mi, ci, mb = 0, cb = 0]) => ({
      nr,
      missedInstructions: mi,
      coveredInstructions: ci,
      missedBranches: mb,
      coveredBranches: cb,
    })),
  })

  test("counts a partly covered line as covered, as JaCoCo does", () => {
    const lcov = toLcov([file("a/A.kt", [[1, 3, 2], [2, 4, 0], [3, 0, 5]])])

    expect(lcov.text).toBe(
      ["TN:", "SF:a/A.kt", "DA:1,1", "DA:2,0", "DA:3,1", "LF:3", "LH:2", "BRF:0", "BRH:0", "end_of_record", ""].join("\n"),
    )
    expect({ lines: lcov.lines, coveredLines: lcov.coveredLines }).toEqual({ lines: 3, coveredLines: 2 })
  })

  test("lists covered branches as taken before missed ones", () => {
    const lcov = toLcov([file("a/A.kt", [[7, 1, 3, 1, 2]])])

    expect(lcov.text).toBe(
      [
        "TN:",
        "SF:a/A.kt",
        "BRDA:7,0,0,1",
        "BRDA:7,0,1,1",
        "BRDA:7,0,2,0",
        "DA:7,1",
        "LF:1",
        "LH:1",
        "BRF:3",
        "BRH:2",
        "end_of_record",
        "",
      ].join("\n"),
    )
  })

  test("orders lines by number", () => {
    const lcov = toLcov([file("a/A.kt", [[9, 0, 1], [2, 0, 1]])])

    expect(lcov.text).toContain("DA:2,1\nDA:9,1")
  })

  test("omits a source file without lines and totals the rest", () => {
    const lcov = toLcov([file("a/Empty.kt", []), file("a/A.kt", [[1, 0, 1]]), file("b/B.kt", [[1, 1, 0], [2, 1, 0]])])

    expect(lcov.text).not.toContain("Empty.kt")
    expect(lcov.text.match(/end_of_record/g)).toHaveLength(2)
    expect({ lines: lcov.lines, coveredLines: lcov.coveredLines }).toEqual({ lines: 3, coveredLines: 1 })
  })
})

describe("locating source files in the repository", () => {
  const locate = (sourcePath: string, repositoryFiles: string[]): string =>
    locateSources([{ path: sourcePath, lines: [] }], repositoryFiles)[0]?.path as string

  test.each([
    ["the one file ending with the package path", "com/x/Foo.kt", ["src/main/kotlin/com/x/Foo.kt", "src/main/kotlin/com/x/Bar.kt"], "src/main/kotlin/com/x/Foo.kt"],
    ["a file already at the package path", "com/x/Foo.kt", ["com/x/Foo.kt"], "com/x/Foo.kt"],
    ["a module's file in a multi-module build", "com/x/Foo.kt", ["api/src/main/kotlin/com/x/Foo.kt", "core/src/main/kotlin/com/y/Foo.kt"], "api/src/main/kotlin/com/x/Foo.kt"],
    ["no file, keeping the package path", "com/x/Foo.kt", ["src/main/kotlin/com/x/Bar.kt"], "com/x/Foo.kt"],
    ["several files, keeping the package path", "com/x/Foo.kt", ["a/src/main/kotlin/com/x/Foo.kt", "b/src/main/kotlin/com/x/Foo.kt"], "com/x/Foo.kt"],
    ["only a match on a whole directory name", "com/x/Foo.kt", ["src/main/kotlin/acom/x/Foo.kt"], "com/x/Foo.kt"],
  ])("resolves to %s", (_, sourcePath, repositoryFiles, expected) => {
    expect(locate(sourcePath, repositoryFiles)).toBe(expected)
  })
})

describe("converting a JaCoCo report to LCOV", () => {
  test("refuses a report with no line counters", () => {
    expect(jacocoToLcov(report('<package name="a"><sourcefile name="A.kt"></sourcefile></package>'), [])).toEqual({
      ok: false,
      error: "The JaCoCo report has no line counters to convert",
    })
  })
})
