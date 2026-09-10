import { execFileSync } from "node:child_process"
import { parseArgs } from "node:util"

import {
  fail,
  requireEnv,
  runningInActions,
  writeOutputs,
} from "../../lib/actions.ts"
import {
  type BuildContext,
  type TagRequest,
  branchFromRef,
  generateTag,
  parseMaxLength,
  parseTagType,
} from "./tag.ts"

const inActions = runningInActions()

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8" }).trim()

// GitHub upper-cases input names but leaves their hyphens intact.
function requestFromEnvironment(): TagRequest {
  const tagType = parseTagType(process.env["INPUT_TAG-TYPE"] ?? "")
  if (!tagType.ok) fail(tagType.error)

  const maxLength = parseMaxLength(process.env["INPUT_MAX-LENGTH"] ?? "256")
  if (!maxLength.ok) fail(maxLength.error)

  return {
    tagType: tagType.value,
    prefix: process.env["INPUT_TAG-PREFIX"] ?? "",
    maxLength: maxLength.value,
    addAutomaticPrefix: process.env["INPUT_ADD-AUTOMATIC-PREFIX"] === "true",
  }
}

function requestFromArgv(): TagRequest {
  let values
  try {
    ;({ values } = parseArgs({
      options: {
        "tag-type": { type: "string", default: "hyphenated-alphanumeric-tag" },
        "tag-prefix": { type: "string", default: "" },
        "max-length": { type: "string", default: "256" },
        "add-automatic-prefix": { type: "boolean", default: false },
      },
    }))
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
  }

  const tagType = parseTagType(values["tag-type"])
  if (!tagType.ok) fail(tagType.error)

  const maxLength = parseMaxLength(values["max-length"])
  if (!maxLength.ok) fail(maxLength.error)

  return {
    tagType: tagType.value,
    prefix: values["tag-prefix"],
    maxLength: maxLength.value,
    addAutomaticPrefix: values["add-automatic-prefix"],
  }
}

const contextFromActions = (): BuildContext => ({
  now: new Date(),
  commitSha: requireEnv("GITHUB_SHA"),
  buildId: requireEnv("GITHUB_RUN_ID"),
  branch: branchFromRef(requireEnv("GITHUB_REF")),
})

const contextFromGit = (): BuildContext => ({
  now: new Date(),
  commitSha: git("show", "-s", "--format=%H"),
  buildId: "local",
  branch: git("rev-parse", "--abbrev-ref", "HEAD"),
})

const request = inActions ? requestFromEnvironment() : requestFromArgv()
const context = inActions ? contextFromActions() : contextFromGit()

const tag = generateTag(request, context)
if (!tag.ok) fail(tag.error)

if (inActions) {
  writeOutputs([{ name: "tag", value: tag.value }])
} else {
  process.stdout.write(`${tag.value}\n`)
}
