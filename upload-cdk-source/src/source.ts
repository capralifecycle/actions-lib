import { type Result, err, ok } from "../../lib/result.ts"

/**
 * The include-files input is a space-separated list of patterns matched against
 * the names directly inside the CDK application directory. Anything selected is
 * archived whole if it is a directory.
 *
 * The patterns were written for `grep`'s basic regular expressions, of which
 * only the subset the defaults use — `.`, `*` and `\.` — carries over
 * unchanged. `\+`, `\?` and `\{n,m\}` quantify there and are literal here,
 * and a class such as `[[:alpha:]]` has no equivalent and compiles to something
 * else entirely rather than failing.
 *
 * Each pattern must compile on its own, so that one with an unbalanced
 * parenthesis cannot close the group around it and match past the anchors.
 */
function includeMatcher(includeFiles: string): Result<RegExp> {
  const patterns = includeFiles.trim().split(/\s+/).filter(Boolean)
  for (const pattern of patterns) {
    try {
      new RegExp(pattern)
    } catch {
      return err(`'include-files' pattern '${pattern}' is not a valid regular expression`)
    }
  }
  return ok(new RegExp(`^(?:${patterns.map((pattern) => `(?:${pattern})`).join("|")})$`))
}

export function selectEntries(
  names: readonly string[],
  includeFiles: string,
): Result<string[]> {
  const matcher = includeMatcher(includeFiles)
  if (!matcher.ok) return matcher
  return ok(names.filter((name) => matcher.value.test(name)).sort())
}

export interface SourceMetadata {
  readonly bucketName: string
  readonly bucketKey: string
  readonly versionId: string
}

/**
 * The pointer a pipeline reads to find the source it should deploy. The field
 * names are part of the contract with the pipeline, not an internal detail.
 */
export const buildMetadata = (
  bucketName: string,
  bucketKey: string,
  versionId: string,
): SourceMetadata => ({ bucketName, bucketKey, versionId })

export const renderMetadata = (metadata: SourceMetadata): string =>
  `${JSON.stringify(metadata, null, 2)}\n`
