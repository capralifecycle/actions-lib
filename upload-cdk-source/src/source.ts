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
 */
export function includeMatcher(includeFiles: string): RegExp {
  const alternatives = includeFiles.trim().split(/\s+/).filter(Boolean)
  return new RegExp(`^(${alternatives.join("|")})$`)
}

export const selectEntries = (
  names: readonly string[],
  includeFiles: string,
): string[] => {
  const matches = includeMatcher(includeFiles)
  return names.filter((name) => matches.test(name)).sort()
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
