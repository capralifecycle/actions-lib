/**
 * The last extension of a filename, without the dot, or an empty string when
 * there is none. `a.tar.gz` is a `gz`.
 */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".")
  return dot === -1 ? "" : filename.slice(dot + 1)
}

export interface KeyRequest {
  /** Overrides the content-addressed default when set. */
  readonly explicitKey: string
  readonly prefix: string
  readonly checksum: string
  readonly extension: string
}

/**
 * Artifacts are content-addressed by default, so uploading the same bytes twice
 * lands on the same key and a deployment can name exactly what it deployed.
 */
export function s3Key(request: KeyRequest): string {
  const suffix = request.extension === "" ? "" : `.${request.extension}`
  const key =
    request.explicitKey === "" ? `${request.checksum}${suffix}` : request.explicitKey
  return `${request.prefix}${key}`
}
