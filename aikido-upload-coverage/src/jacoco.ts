import { type Result, err, ok } from "../../lib/result.ts"

/** The counters JaCoCo records for one line of a source file. */
export interface Line {
  readonly nr: number
  readonly missedInstructions: number
  readonly coveredInstructions: number
  readonly missedBranches: number
  readonly coveredBranches: number
}

export interface SourceFile {
  /** Path relative to the source root, such as `com/example/Foo.kt`. */
  readonly path: string
  readonly lines: readonly Line[]
}

export interface Lcov {
  readonly text: string
  readonly lines: number
  readonly coveredLines: number
}

export interface Conversion extends Lcov {
  /** Source files with line counters, each one record in the LCOV. */
  readonly sourceFiles: number
  /** How many of those were found in the repository and named by their path there. */
  readonly locatedFiles: number
}

const TAG = /<(\/?)(package|sourcefile|line)\b([^>]*)>/g
const ATTRIBUTE = /([\w-]+)="([^"]*)"/g

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

/** JaCoCo escapes only these five characters in attribute values. */
const unescapeXml = (value: string): string =>
  value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] as string)

const attributes = (source: string): Map<string, string> =>
  new Map(
    [...source.matchAll(ATTRIBUTE)].map(([, name, value]) => [
      name as string,
      unescapeXml(value as string),
    ]),
  )

function parseLine(attrs: Map<string, string>): Result<Line> {
  const counts = ["nr", "mi", "ci", "mb", "cb"].map((name) =>
    Number(attrs.get(name)),
  )
  if (!counts.every((count) => Number.isInteger(count) && count >= 0)) {
    return err(`Malformed <line> element: ${JSON.stringify(Object.fromEntries(attrs))}`)
  }
  const [nr, mi, ci, mb, cb] = counts as [number, number, number, number, number]
  return ok({
    nr,
    missedInstructions: mi,
    coveredInstructions: ci,
    missedBranches: mb,
    coveredBranches: cb,
  })
}

/**
 * Reads the per-line counters out of a JaCoCo XML report. Only `<package>`,
 * `<sourcefile>` and `<line>` carry what LCOV needs; the class and method
 * counters are aggregates of the same data. Packages may sit inside `<group>`
 * elements, as in an aggregate report, which this reads the same way.
 */
export function parseJacoco(xml: string): Result<SourceFile[]> {
  const files: { path: string; lines: Line[] }[] = []
  let pkg: string | null = null
  let file: { path: string; lines: Line[] } | null = null

  for (const [, closing, tag, rest] of xml.matchAll(TAG)) {
    const attrs = attributes(rest as string)
    if (tag === "package") {
      pkg = closing ? null : (attrs.get("name") ?? "")
    } else if (tag === "sourcefile") {
      if (closing) {
        file = null
        continue
      }
      const name = attrs.get("name") ?? ""
      file = { path: pkg ? `${pkg}/${name}` : name, lines: [] }
      files.push(file)
    } else if (file !== null) {
      const line = parseLine(attrs)
      if (!line.ok) return line
      file.lines.push(line.value)
    }
  }

  return ok(files)
}

/**
 * JaCoCo counts instructions, not executions, so a line is reported as hit
 * once rather than with a count that would read as a number of runs. A line is
 * covered when any of its instructions ran, which is how JaCoCo's own line
 * counter decides.
 */
export function toLcov(files: readonly SourceFile[]): Lcov {
  let lines = 0
  let coveredLines = 0
  const records: string[] = []

  for (const file of files) {
    if (file.lines.length === 0) continue

    const sorted = [...file.lines].sort((a, b) => a.nr - b.nr)
    const record = ["TN:", `SF:${file.path}`]
    let hit = 0
    let branches = 0
    let branchesHit = 0

    for (const line of sorted) {
      const covered = line.coveredInstructions > 0
      if (covered) hit++
      const total = line.coveredBranches + line.missedBranches
      for (let branch = 0; branch < total; branch++) {
        const taken = branch < line.coveredBranches ? 1 : 0
        record.push(`BRDA:${line.nr},0,${branch},${taken}`)
      }
      branches += total
      branchesHit += line.coveredBranches
      record.push(`DA:${line.nr},${covered ? 1 : 0}`)
    }

    record.push(
      `LF:${sorted.length}`,
      `LH:${hit}`,
      `BRF:${branches}`,
      `BRH:${branchesHit}`,
      "end_of_record",
    )
    records.push(record.join("\n"))
    lines += sorted.length
    coveredLines += hit
  }

  return {
    text: records.length === 0 ? "" : `${records.join("\n")}\n`,
    lines,
    coveredLines,
  }
}

/**
 * JaCoCo names a source file by its package path, such as `com/example/Foo.kt`,
 * which the upload step cannot open from the repository root to check line
 * numbers against. Each is renamed to the one repository file whose path ends
 * with it; a path that matches no file, or several, is left as it is.
 */
export function locateSources(
  files: readonly SourceFile[],
  repositoryFiles: readonly string[],
): SourceFile[] {
  const byName = new Map<string, string[]>()
  for (const file of repositoryFiles) {
    const name = file.slice(file.lastIndexOf("/") + 1)
    byName.set(name, [...(byName.get(name) ?? []), file])
  }

  return files.map((file) => {
    const name = file.path.slice(file.path.lastIndexOf("/") + 1)
    const matches = (byName.get(name) ?? []).filter(
      (candidate) => candidate === file.path || candidate.endsWith(`/${file.path}`),
    )
    return matches.length === 1 ? { ...file, path: matches[0] as string } : file
  })
}

export function jacocoToLcov(
  xml: string,
  repositoryFiles: readonly string[],
): Result<Conversion> {
  const parsed = parseJacoco(xml)
  if (!parsed.ok) return parsed
  const files = locateSources(parsed.value, repositoryFiles).filter(
    (file) => file.lines.length > 0,
  )
  const lcov = toLcov(files)
  if (lcov.lines === 0) {
    return err("The JaCoCo report has no line counters to convert")
  }
  const known = new Set(repositoryFiles)
  return ok({
    ...lcov,
    sourceFiles: files.length,
    locatedFiles: files.filter((file) => known.has(file.path)).length,
  })
}
