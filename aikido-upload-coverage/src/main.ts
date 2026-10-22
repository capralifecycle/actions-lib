import { globSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseArgs } from "node:util"

import { fail, runningInActions, writeOutputs } from "../../lib/actions.ts"
import { type Result, err, ok } from "../../lib/result.ts"
import {
  type PreparedReport,
  parseFilePaths,
  prepareReport,
  summarize,
  workspacePath,
} from "./prepare.ts"

interface Inputs {
  readonly patterns: readonly string[]
  readonly failOnError: boolean
}

const inActions = runningInActions()

function readInputs(): Inputs {
  if (inActions) {
    return {
      patterns: parseFilePaths(process.env["INPUT_FILE_PATHS"] ?? ""),
      failOnError: process.env["INPUT_FAIL_ON_ERROR"] === "true",
    }
  }
  try {
    const { values } = parseArgs({
      options: {
        "file-paths": { type: "string", multiple: true, default: [] },
      },
    })
    return {
      patterns: values["file-paths"].flatMap(parseFilePaths),
      failOnError: true,
    }
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
  }
}

/** Installed packages can ship their own coverage reports, which a `**` pattern would pick up. */
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"])

/** Build output holds copies and generated code, never the sources a report should point at. */
const EXCLUDED_FROM_SOURCES = new Set([...EXCLUDED_DIRECTORIES, "build", "target"])

const JVM_SOURCES = "**/*.{java,kt,groovy,scala}"

const glob = (workspace: string, pattern: string, excluded: ReadonlySet<string>): string[] =>
  globSync(pattern, {
    cwd: workspace,
    withFileTypes: true,
    exclude: (entry) => entry.isDirectory() && excluded.has(entry.name),
  })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))

function findReports(workspace: string, pattern: string): Result<string[]> {
  const matches = glob(workspace, pattern, EXCLUDED_DIRECTORIES)
  if (matches.length === 0) return err(`No file matched '${pattern}'`)

  const files: string[] = []
  for (const match of matches.sort()) {
    const file = workspacePath(workspace, match)
    if (!file.ok) return file
    files.push(file.value)
  }
  return ok(files)
}

function prepareAll(workspace: string, patterns: readonly string[]): Result<PreparedReport[]> {
  if (patterns.length === 0) return err("Parameter 'file-paths' is empty")

  const files = new Set<string>()
  for (const pattern of patterns) {
    const found = findReports(workspace, pattern)
    if (!found.ok) return found
    for (const file of found.value) files.add(file)
  }

  const repositoryFiles = glob(workspace, JVM_SOURCES, EXCLUDED_FROM_SOURCES).flatMap((file) => {
    const relative = workspacePath(workspace, file)
    return relative.ok ? [relative.value] : []
  })

  const reports: PreparedReport[] = []
  for (const file of files) {
    let content: string
    try {
      content = readFileSync(path.join(workspace, file), "utf8")
    } catch (cause) {
      return err(`${file}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
    const report = prepareReport(file, content, repositoryFiles)
    if (!report.ok) return report
    reports.push(report.value)
  }
  return ok(reports)
}

/** Workflow commands end at a newline, so one inside the message is escaped. */
const escapeCommand = (message: string): string =>
  message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")

const inputs = readInputs()
const workspace = process.cwd()
const reports = prepareAll(workspace, inputs.patterns)

if (!reports.ok) {
  if (inputs.failOnError) fail(reports.error)
  process.stdout.write(
    `::warning title=Coverage not uploaded::${escapeCommand(reports.error)}\n`,
  )
  writeOutputs([{ name: "file-paths", value: "" }])
  process.exit(0)
}

for (const report of reports.value) {
  if (report.kind === "converted") {
    writeFileSync(path.join(workspace, report.path), report.lcov)
  }
  process.stdout.write(`${summarize(report)}\n`)
}

const filePaths = reports.value.map((report) => report.path).join(",")
if (inActions) {
  writeOutputs([{ name: "file-paths", value: filePaths }])
}
