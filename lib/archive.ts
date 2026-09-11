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
 * Walks a directory the way `zip -r` does: symlinks are followed and the file
 * they point at is stored, and empty directories are kept as entries of their
 * own so the archive still describes the tree.
 */
function collect(root: string, directory: string, seen: Set<string>): Entry[] {
  // Directories are reached through symlinks as well, so a link pointing at an
  // ancestor would otherwise recurse until the stack runs out.
  const real = realpathSync(directory)
  if (seen.has(real)) return []
  seen.add(real)

  const children = readdirSync(directory, { withFileTypes: true })
  if (children.length === 0 && directory !== root) {
    return [
      {
        name: `${toEntryName(relative(root, directory))}/`,
        mode: statSync(directory).mode,
        content: new Uint8Array(),
      },
    ]
  }
  return children.flatMap((child) => {
    const path = join(directory, child.name)
    // statSync follows symlinks, so a link contributes its target's content.
    return statSync(path).isDirectory()
      ? collect(root, path, seen)
      : [
          {
            name: toEntryName(relative(root, path)),
            mode: statSync(path).mode,
            content: new Uint8Array(readFileSync(path)),
          },
        ]
  })
}

/**
 * Builds a zip of a directory's contents, preserving the unix mode of every
 * entry. Without the mode, an extracted file loses its executable bit, which
 * matters for anything that is run rather than read after deployment.
 */
export function zipDirectory(directory: string): Result<Uint8Array> {
  let entries: Entry[]
  try {
    entries = collect(directory, directory, new Set())
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
