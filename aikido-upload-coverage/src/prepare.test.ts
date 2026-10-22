import { describe, expect, test } from "bun:test"

import { err, ok } from "../../lib/result.ts"
import { type Format, detectFormat, lcovPathFor, parseFilePaths, prepareReport, summarize, workspacePath } from "./prepare.ts"

const JACOCO =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><report name="app">' +
  '<package name="a"><sourcefile name="A.kt">' +
  '<line nr="1" mi="0" ci="2" mb="0" cb="0"/><line nr="2" mi="2" ci="0" mb="0" cb="0"/>' +
  "</sourcefile></package></report>"

describe("detecting a report's format from its content", () => {
  const cases: [string, string, Format | null][] = [
    [
      "a JaCoCo report with its prolog and doctype",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd"><report name="app">',
      "jacoco",
    ],
    [
      "a Cobertura report with its doctype",
      '<?xml version="1.0" ?>\n<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">\n<coverage line-rate="0.5">',
      "cobertura",
    ],
    ["a Cobertura report without a prolog", '<coverage line-rate="1">', "cobertura"],
    ["an XML report behind a comment", "<!-- generated --><report>", "jacoco"],
    ["an XML report behind a byte order mark", "\uFEFF<coverage>", "cobertura"],
    ["an LCOV report", "TN:\nSF:src/a.ts\nDA:1,1\nend_of_record\n", "lcov"],
    ["an LCOV report without a test name", "SF:src/a.ts\nDA:1,1\n", "lcov"],
    ["XML with another root element", "<testsuite>", null],
    ["plain text", "hello", null],
    ["an empty file", "", null],
  ]

  test.each(cases)("recognises %s", (_, content, expected) => {
    expect(detectFormat(content)).toBe(expected)
  })
})

describe("splitting the file-paths input", () => {
  test.each([
    ["one path per line", "a.xml\nb/lcov.info\n", ["a.xml", "b/lcov.info"]],
    ["commas and spaces", "a.xml, b.xml c.xml", ["a.xml", "b.xml", "c.xml"]],
    ["blank lines", "\n  a.xml\n\n", ["a.xml"]],
    ["nothing", "  \n", []],
  ])("handles %s", (_, raw, expected) => {
    expect(parseFilePaths(raw)).toEqual(expected)
  })
})

describe("naming a report relative to the workspace", () => {
  test.each([
    ["a relative path", "target/site/jacoco/jacoco.xml", ok("target/site/jacoco/jacoco.xml")],
    ["an absolute path inside", "/work/repo/coverage/lcov.info", ok("coverage/lcov.info")],
    ["a path through a parent", "../other/lcov.info", err<string>("'../other/lcov.info' is outside the workspace '/work/repo'")],
    ["an absolute path outside", "/tmp/lcov.info", err<string>("'/tmp/lcov.info' is outside the workspace '/work/repo'")],
    ["a name that starts with dots", "..lcov.info", ok("..lcov.info")],
  ])("accepts or refuses %s", (_, file, expected) => {
    expect(workspacePath("/work/repo", file)).toEqual(expected)
  })
})

describe("naming the converted report", () => {
  test.each([
    ["target/site/jacoco/jacoco.xml", "target/site/jacoco/jacoco.lcov"],
    ["build/reports/JACOCO.XML", "build/reports/JACOCO.lcov"],
    ["coverage/report", "coverage/report.lcov"],
  ])("writes %s as %s", (source, expected) => {
    expect(lcovPathFor(source)).toBe(expected)
  })
})

describe("preparing a report for upload", () => {
  test("hands an LCOV report over as it is", () => {
    expect(prepareReport("coverage/lcov.info", "TN:\nSF:a.ts\nend_of_record\n")).toEqual({
      ok: true,
      value: { kind: "as-is", path: "coverage/lcov.info" },
    })
  })

  test("hands a Cobertura report over as it is", () => {
    expect(prepareReport("coverage/cobertura.xml", "<coverage/>")).toEqual({
      ok: true,
      value: { kind: "as-is", path: "coverage/cobertura.xml" },
    })
  })

  test("converts a JaCoCo report to LCOV beside the original", () => {
    const prepared = prepareReport("target/site/jacoco/jacoco.xml", JACOCO)

    expect(prepared).toEqual({
      ok: true,
      value: {
        kind: "converted",
        source: "target/site/jacoco/jacoco.xml",
        path: "target/site/jacoco/jacoco.lcov",
        lcov: "TN:\nSF:a/A.kt\nDA:1,1\nDA:2,0\nLF:2\nLH:1\nBRF:0\nBRH:0\nend_of_record\n",
        lines: 2,
        coveredLines: 1,
      },
    })
  })

  test("refuses a file it cannot identify, naming it", () => {
    expect(prepareReport("target/surefire-reports/TEST-a.xml", "<testsuite/>")).toEqual({
      ok: false,
      error: "target/surefire-reports/TEST-a.xml: not an LCOV, Cobertura or JaCoCo XML report",
    })
  })

  test("refuses a JaCoCo report it cannot convert, naming it", () => {
    expect(prepareReport("jacoco.xml", '<report name="app"></report>')).toEqual({
      ok: false,
      error: "jacoco.xml: The JaCoCo report has no line counters to convert",
    })
  })
})

describe("summarising a prepared report", () => {
  test("reports the line coverage of a converted report", () => {
    const prepared = prepareReport("jacoco.xml", JACOCO)
    if (!prepared.ok) throw new Error(prepared.error)

    expect(summarize(prepared.value)).toBe("jacoco.xml: converted to jacoco.lcov, 1/2 lines covered (50.0%)")
  })
})
