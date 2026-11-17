import { createHash } from "node:crypto"
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { zipSync } from "fflate"

import { type Result, err, ok } from "./result.ts"

/** Identifies the external attributes below as unix mode bits. */
const ZIP_OS_UNIX = 3

/**
 * The zip format holds sizes in four bytes and the entry count in two, and
 * anything larger needs the Zip64 extensions. The writer used here does not
 * emit them and does not complain either: it overruns the field and corrupts
 * the neighbouring header. Refusing the archive is the only safe answer, since
 * a corrupt one is only discovered by whoever later tries to open it.
 */
const MAX_ENTRIES = 0xffff
const MAX_BYTES = 0xffffffff

/** A zip entry's mode lives in the top half of its external attributes. */
const modeAttributes = (mode: number): number => (mode & 0xffff) << 16

/**
 * Zip entries always use forward slashes, whatever the platform produced them.
 */
const toEntryName = (path: string): string => path.split(sep).join("/")

interface Entry {
  readonly name: string
  readonly mode: number
  readonly content: Uint8Array
}

/**
 * Walks the tree under each starting path the way `zip -r` does: symlinks are
 * followed and what they point at is stored under the link's own name, and
 * every directory is kept as an entry of its own. A directory reached through
 * two paths is stored under both.
 *
 * The one departure is a symlink back to a directory the walk is already
 * inside, which `zip -r` follows until the path grows too long to open. Here
 * it is skipped, since every level it would add repeats the one above.
 *
 * Iterative rather than recursive, so the depth of the tree cannot exhaust the
 * call stack. Children are visited in sorted order, so the same tree always
 * produces the same archive and therefore the same content-addressed key.
 */
function collect(root: string, starts: readonly string[]): Entry[] {
  const entries: Entry[] = []
  const noAncestors: ReadonlySet<string> = new Set()
  const pending: { path: string; ancestors: ReadonlySet<string> }[] = starts
    .map((path) => ({ path, ancestors: noAncestors }))
    .reverse()

  while (pending.length > 0) {
    const { path, ancestors } = pending.pop() as (typeof pending)[number]
    const stats = statSync(path)

    if (!stats.isDirectory()) {
      entries.push({
        name: toEntryName(relative(root, path)),
        mode: stats.mode,
        content: new Uint8Array(readFileSync(path)),
      })
      continue
    }

    const real = realpathSync(path)
    if (ancestors.has(real)) continue
    const within = new Set(ancestors).add(real)

    // `zip -r` records every directory it visits, not only empty ones. The
    // entry carries the directory's own mode, which an extractor otherwise
    // replaces with its default.
    if (path !== root) {
      entries.push({
        name: `${toEntryName(relative(root, path))}/`,
        mode: stats.mode,
        content: new Uint8Array(),
      })
    }
    const children = readdirSync(path).sort()
    for (const child of children.reverse()) {
      pending.push({ path: join(path, child), ancestors: within })
    }
  }
  return entries
}

/**
 * Builds a zip of a directory's contents, preserving the unix mode of every
 * entry. Without the mode, an extracted file loses its executable bit, which
 * matters for anything that is run rather than read after deployment.
 */
export function zipDirectory(directory: string): Result<Uint8Array> {
  return archive(directory, [directory])
}

/**
 * Archives `names`, which are relative to `root`, recursing into any that are
 * directories. Entry names stay relative to `root`.
 */
export const zipPaths = (
  root: string,
  names: readonly string[],
): Result<Uint8Array> => archive(root, names.map((name) => join(root, name)))

function archive(root: string, starts: readonly string[]): Result<Uint8Array> {
  const directory = root
  let entries: Entry[]
  try {
    entries = collect(root, starts)
  } catch (cause) {
    return err(
      `Failed to read '${directory}': ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  // `zip -r` refuses an empty directory, and so does this: an artifact with
  // nothing in it almost always means the step that should have produced it
  // did not.
  if (entries.length === 0) return err(`Nothing to archive in '${directory}'`)

  if (entries.length > MAX_ENTRIES) {
    return err(
      `'${directory}' holds ${entries.length} entries, more than the ${MAX_ENTRIES} a zip can address without Zip64`,
    )
  }
  const total = entries.reduce((sum, entry) => sum + entry.content.byteLength, 0)
  const tooLarge = entries.find((entry) => entry.content.byteLength > MAX_BYTES)
  if (tooLarge !== undefined || total > MAX_BYTES) {
    return err(
      `'${directory}' is too large to archive without Zip64 (limit ${MAX_BYTES} bytes per entry and in total)`,
    )
  }

  return ok(
    zipSync(
      Object.fromEntries(
        entries.map((entry) => [
          entry.name,
          [entry.content, { os: ZIP_OS_UNIX, attrs: modeAttributes(entry.mode) }],
        ]),
      ),
    ),
  )
}

export const sha256 = (content: Uint8Array): string =>
  createHash("sha256").update(content).digest("hex")
