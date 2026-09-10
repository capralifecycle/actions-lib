#!/usr/bin/env bun

// Regenerates the action table in README.md from the action.yml files.
//
// Without arguments the README is rewritten in place; with --check it is left
// alone and a stale table exits non-zero instead.

import { dirname, join } from "node:path"

const START = "<!-- ACTION_TABLE_START -->"
const END = "<!-- ACTION_TABLE_END -->"

const root = join(dirname(Bun.fileURLToPath(import.meta.url)), "..")
const readmePath = join(root, "README.md")

interface Action {
  readonly name: string
  readonly path: string
  readonly description: string
  readonly runtime: string
  readonly local: boolean
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

/** Sorted, which is the order the table is rendered in. */
function actionPaths(): string[] {
  // Actions live one directory below the root, which is what `uses: ./<action>`
  // resolves against, so there is nothing to find deeper in the tree.
  const paths = [...new Bun.Glob("*/action.yml").scanSync(root)].sort()
  return paths.length > 0 ? paths : fail("Found no action.yml files")
}

/**
 * The description GitHub shows for an action doubles as this table's metadata,
 * by carrying a second YAML document inside itself:
 *
 * ```yaml
 * description: |
 *   description: "Send notifications to Slack"
 *   local: false
 * ```
 *
 * `local` marks an action that can also be run outside a workflow, by invoking
 * its executable with CLI arguments.
 */
function parseDescription(
  path: string,
  field: unknown,
): { description: string; local: boolean } {
  if (typeof field !== "string") {
    fail(`${path}: 'description' is missing or is not a string`)
  }

  const { description, local } = (Bun.YAML.parse(field) ?? {}) as Record<string, unknown>
  if (typeof description !== "string") {
    fail(`${path}: the YAML inside 'description' has no 'description' string`)
  }
  if (typeof local !== "boolean") {
    fail(`${path}: the YAML inside 'description' has no 'local' boolean`)
  }

  return { description, local }
}

/**
 * GitHub's own `runs.using`, reported verbatim: `composite` for an action built
 * from a list of steps, `node24` for one with a JavaScript entrypoint. Which
 * shell or language a composite action's steps happen to use is not recorded
 * anywhere in the action.yml, so it is not something this table can report.
 */
function parseRuntime(path: string, runs: unknown): string {
  const using = (runs as { using?: unknown })?.using
  return typeof using === "string" ? using : fail(`${path}: 'runs.using' is missing`)
}

async function readAction(path: string): Promise<Action> {
  const { description, runs } = Bun.YAML.parse(
    await Bun.file(join(root, path)).text(),
  ) as { description?: unknown; runs?: unknown }

  return {
    name: path.split("/")[0]!,
    path,
    runtime: parseRuntime(path, runs),
    ...parseDescription(path, description),
  }
}

function renderTable(actions: readonly Action[]): string {
  const row = ({ name, path, description, runtime, local }: Action): string =>
    `| [\`${name}\`](${path}) | ${description} | \`${runtime}\` | ${local ? "✅" : "❌"} |`

  return [
    "| Action | Description | Runtime | Local usage |",
    "| :--- | :--- | :---: | :---: |",
    ...actions.map(row),
  ].join("\n")
}

function replaceTable(readme: string, table: string): string {
  const start = readme.indexOf(START)
  const end = readme.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    fail(`README.md is missing the '${START}' / '${END}' markers`)
  }

  return `${readme.slice(0, start)}${START}\n${table}\n${readme.slice(end)}`
}

const actions = await Promise.all(actionPaths().map(readAction))
const readme = await Bun.file(readmePath).text()
const updated = replaceTable(readme, renderTable(actions))

if (updated === readme) process.exit(0)

if (Bun.argv.includes("--check")) {
  fail("README.md is out of date. Run 'make docs' to update it.")
}

await Bun.write(readmePath, updated)
process.stdout.write("Updated README.md\n")
