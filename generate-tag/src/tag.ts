import { type Result, err, ok } from "../../lib/result.ts"

export const TAG_TYPES = [
  "punctuated-timestamp-tag",
  "hyphenated-alphanumeric-tag",
] as const

export type TagType = (typeof TAG_TYPES)[number]

/** Marks a tag built from a non-default branch, for artifact cleanup policies. */
const NON_DEFAULT_BRANCH_PREFIX = "nd"

/** Below this much of the branch name, the tag is rejected rather than truncated. */
const MIN_BRANCH_NAME_CHARACTERS = 10

const SHORT_SHA_LENGTH = 8

export interface TagRequest {
  readonly tagType: TagType
  readonly prefix: string
  readonly maxLength: number
  readonly addAutomaticPrefix: boolean
}

/** Everything that varies between runs, including the clock. */
export interface BuildContext {
  readonly now: Date
  readonly commitSha: string
  readonly buildId: string
  readonly branch: string
}

export function parseTagType(value: string): Result<TagType> {
  const match = TAG_TYPES.find((candidate) => candidate === value)
  return match ? ok(match) : err(`Unknown tag type '${value}'`)
}

export function parseMaxLength(value: string): Result<number> {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0
    ? ok(parsed)
    : err(`Parameter 'max-length' must be a positive integer, got '${value}'`)
}

/** Strips `refs/heads/`; other ref shapes pass through unchanged. */
export function branchFromRef(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref
}

/** Keeps only characters legal in a container image tag. */
export function sanitiseBranchName(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9_-]/g, "")
}

const pad = (value: number, width: number): string =>
  String(value).padStart(width, "0")

/** `20231130.145802` */
export function punctuatedTimestamp(now: Date): string {
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`
  const time = `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`
  return `${date}.${time}`
}

/** `20231130-145834z` */
export function hyphenatedTimestamp(now: Date): string {
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`
  const time = `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`
  return `${date}-${time}z`
}

/** Rejects a caller prefix that would be indistinguishable from the automatic one. */
function resolvePrefix(request: TagRequest): Result<string> {
  const applies =
    request.tagType === "hyphenated-alphanumeric-tag" &&
    request.addAutomaticPrefix
  if (!applies) return ok(request.prefix)

  if (
    request.prefix === NON_DEFAULT_BRANCH_PREFIX ||
    request.prefix === `${NON_DEFAULT_BRANCH_PREFIX}-`
  ) {
    return err(
      `The prefix '${request.prefix}' contains a reserved word '${NON_DEFAULT_BRANCH_PREFIX}'`,
    )
  }
  return ok(`${NON_DEFAULT_BRANCH_PREFIX}-${request.prefix}`)
}

const joinPrefix = (prefix: string, separator: string): string =>
  prefix === "" ? "" : `${prefix}${separator}`

function punctuatedTag(
  request: TagRequest,
  context: BuildContext,
): Result<string> {
  const tag = `${joinPrefix(request.prefix, ".")}${punctuatedTimestamp(context.now)}`
  return tag.length > request.maxLength
    ? err(`Maximum tag length ${request.maxLength} has been exceeded`)
    : ok(tag)
}

function hyphenatedTag(
  request: TagRequest,
  context: BuildContext,
): Result<string> {
  const prefix = resolvePrefix(request)
  if (!prefix.ok) return prefix

  const shortSha = context.commitSha.slice(0, SHORT_SHA_LENGTH)
  const branch = sanitiseBranchName(context.branch)
  const head = `${joinPrefix(prefix.value, "-")}${hyphenatedTimestamp(context.now)}-${context.buildId}-${shortSha}-`

  const availableForBranch = request.maxLength - head.length
  const requiredForBranch = Math.min(branch.length, MIN_BRANCH_NAME_CHARACTERS)

  if (availableForBranch < requiredForBranch) {
    return err(
      `The tag exceeds the maximum length of ${request.maxLength} characters by ${requiredForBranch - availableForBranch} character(s)`,
    )
  }
  return ok(`${head}${branch.slice(0, availableForBranch)}`)
}

export function generateTag(
  request: TagRequest,
  context: BuildContext,
): Result<string> {
  return request.tagType === "punctuated-timestamp-tag"
    ? punctuatedTag(request, context)
    : hyphenatedTag(request, context)
}
