import path from "node:path"

import { type Result, err, ok } from "../../lib/result.ts"
import { jacocoToLcov } from "./jacoco.ts"

/** The coverage report formats this action accepts. */
export type Format = "lcov" | "cobertura" | "jacoco"

const XML_PREAMBLE = /^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/

/**
 * Identifies a report by its content rather than its name: JaCoCo and
 * Cobertura reports are both conventionally `*.xml`, and only the root element
 * tells them apart.
 */
export function detectFormat(content: string): Format | null {
  const text = content.replace(/^\uFEFF/, "")
  const preamble = XML_PREAMBLE.exec(text)?.[0] ?? ""
  const root = /^<([\w:.-]+)/.exec(text.slice(preamble.length))?.[1]

  if (root === "report") return "jacoco"
  if (root === "coverage") return "cobertura"
  if (root === undefined && /^(?:TN|SF):/m.test(text)) return "lcov"
  return null
}

/**
 * A report ready for the upload step. Aikido reads LCOV and Cobertura, so
 * those are handed over as they are and JaCoCo is converted to LCOV first.
 */
export type PreparedReport =
  | {
      readonly kind: "as-is"
      readonly path: string
    }
  | {
      readonly kind: "converted"
      readonly source: string
      /** Where the LCOV is written and what the upload step reads. */
      readonly path: string
      readonly lcov: string
      readonly lines: number
      readonly coveredLines: number
      readonly sourceFiles: number
      readonly locatedFiles: number
    }

/**
 * Splits the `file-paths` input the same way the upload step does, so a list
 * that works there works here.
 */
export const parseFilePaths = (raw: string): string[] =>
  raw.split(/[\s,]+/).filter((entry) => entry !== "")

/**
 * The upload step refuses absolute paths and `..` segments, so every report
 * has to be named relative to the workspace and lie inside it.
 */
export function workspacePath(workspace: string, file: string): Result<string> {
  const relative = path.relative(workspace, path.resolve(workspace, file))
  if (relative === "" || relative.split(path.sep)[0] === ".." || path.isAbsolute(relative)) {
    return err(`'${file}' is outside the workspace '${workspace}'`)
  }
  return ok(relative.split(path.sep).join("/"))
}

/**
 * The upload step picks the parser from the file name, and treats every
 * `*.xml` as Cobertura, so a converted report must not keep its extension.
 */
export const lcovPathFor = (source: string): string =>
  /\.xml$/i.test(source) ? source.replace(/\.xml$/i, ".lcov") : `${source}.lcov`

/**
 * `repositoryFiles` lists the workspace's source files, which a JaCoCo report's
 * package-relative paths are resolved against.
 */
export function prepareReport(
  file: string,
  content: string,
  repositoryFiles: readonly string[],
): Result<PreparedReport> {
  const format = detectFormat(content)
  switch (format) {
    case "lcov":
    case "cobertura":
      return ok({ kind: "as-is", path: file })
    case "jacoco": {
      const lcov = jacocoToLcov(content, repositoryFiles)
      if (!lcov.ok) return err(`${file}: ${lcov.error}`)
      return ok({
        kind: "converted",
        source: file,
        path: lcovPathFor(file),
        lcov: lcov.value.text,
        lines: lcov.value.lines,
        coveredLines: lcov.value.coveredLines,
        sourceFiles: lcov.value.sourceFiles,
        locatedFiles: lcov.value.locatedFiles,
      })
    }
    case null:
      return err(`${file}: not an LCOV, Cobertura or JaCoCo XML report`)
  }
}

export function summarize(report: PreparedReport): string {
  if (report.kind === "as-is") return `${report.path}: no conversion needed`
  const percentage = ((100 * report.coveredLines) / report.lines).toFixed(1)
  return (
    `${report.source}: converted to ${report.path}, ` +
    `${report.coveredLines}/${report.lines} lines covered (${percentage}%), ` +
    `${report.locatedFiles}/${report.sourceFiles} source files found in the repository`
  )
}
