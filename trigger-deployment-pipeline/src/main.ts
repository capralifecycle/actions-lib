import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { hostname, userInfo } from "node:os"
import { parseArgs } from "node:util"

import { fail, requireEnv, runningInActions } from "../../lib/actions.ts"
import { putObject, putParameter } from "../../lib/aws.ts"
import {
  ARTIFACT_PARAMETER_NAMESPACE,
  type TriggerContext,
  branchFromRef,
  buildTrigger,
  looksLikeDate,
  metadataKey,
  parseInputs,
  repositoryFromRemote,
  splitRepository,
  triggerKey,
  utcSeconds,
} from "./trigger.ts"

const INPUT_NAMES = [
  "github-token",
  "pipelines",
  "aws-s3-bucket-name",
  "trigger-type",
  "cdk-source-metadata-file",
  "cloud-assembly-metadata-file",
  "artifact-parameters",
] as const

const inActions = runningInActions()

const fromEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    INPUT_NAMES.map((name) => {
      const upper = name.toUpperCase()
      return [
        name,
        process.env[`INPUT_${upper}`] ??
          process.env[`INPUT_${upper.replace(/-/g, "_")}`] ??
          "",
      ]
    }),
  )

function fromArgv(): Record<string, string> {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(
        INPUT_NAMES.map((name) => [name, { type: "string", default: "" }]),
      ),
    })
    return values as Record<string, string>
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
  }
}

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8" }).trim()

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/** When the workflow run started, which the trigger reports as its start. */
async function runStartedAt(repository: string, runId: string, token: string): Promise<string> {
  const apiUrl = process.env["GITHUB_API_URL"] ?? "https://api.github.com"
  let response: Response
  try {
    response = await fetch(`${apiUrl}/repos/${repository}/actions/runs/${runId}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
  } catch (cause) {
    fail(
      `Failed to fetch timing information for the current GitHub Actions workflow run: ${describe(cause)}`,
    )
  }
  if (!response.ok) {
    fail(
      `Failed to fetch timing information for the current GitHub Actions workflow run: ${response.status} ${response.statusText}`,
    )
  }
  let createdAt: unknown
  try {
    createdAt = ((await response.json()) as { created_at?: unknown }).created_at
  } catch (cause) {
    fail(`The workflow run could not be read: ${describe(cause)}`)
  }
  if (typeof createdAt !== "string" || !looksLikeDate(createdAt)) {
    fail(`The workflow run reported no usable start time: ${JSON.stringify(createdAt)}`)
  }
  return createdAt
}

async function contextFromActions(token: string): Promise<TriggerContext> {
  const repository = requireEnv("GITHUB_REPOSITORY")
  const { owner, name } = splitRepository(repository)
  const startTime = await runStartedAt(repository, requireEnv("GITHUB_RUN_ID"), token)
  return {
    type: "GITHUB_ACTIONS",
    triggeredBy: requireEnv("GITHUB_ACTOR"),
    startTime,
    // One trigger file serves every pipeline, so this is stamped once, before
    // any of them is started.
    stopTime: utcSeconds(new Date()),
    commitAuthor: git("show", "-s", "--format=%an"),
    branchName: branchFromRef(requireEnv("GITHUB_REF")),
    commitHash: requireEnv("GITHUB_SHA"),
    repositoryName: name,
    repositoryOwner: owner,
  }
}

function contextFromGit(): TriggerContext {
  const remote = repositoryFromRemote(git("config", "--get", "remote.origin.url"))
  return {
    type: "LOCAL",
    triggeredBy: `${userInfo().username}@${hostname()}`,
    startTime: "",
    stopTime: "",
    commitAuthor: git("show", "-s", "--format=%an"),
    branchName: git("rev-parse", "--abbrev-ref", "HEAD"),
    commitHash: git("show", "-s", "--format=%H"),
    repositoryName: remote?.name ?? "",
    repositoryOwner: remote?.owner ?? "",
  }
}

const raw = inActions ? fromEnvironment() : fromArgv()

const parsed = parseInputs(
  {
    bucket: raw["aws-s3-bucket-name"] ?? "",
    pipelines: raw["pipelines"] ?? "",
    triggerType: raw["trigger-type"] ?? "",
    cdkSourceMetadataFile: raw["cdk-source-metadata-file"] ?? "",
    cloudAssemblyMetadataFile: raw["cloud-assembly-metadata-file"] ?? "",
    artifactParameters: raw["artifact-parameters"] ?? "",
  },
  existsSync,
)
if (!parsed.ok) fail(parsed.error)
const inputs = parsed.value

let context: TriggerContext
try {
  context = inActions ? await contextFromActions(raw["github-token"] ?? "") : contextFromGit()
} catch (cause) {
  fail(`Failed to read the commit being deployed: ${describe(cause)}`)
}
const trigger = new TextEncoder().encode(buildTrigger(context))
// The file also names the commit author and whoever started the run, which the
// log has no need to repeat.
process.stdout.write(
  `Triggering ${inputs.pipelines.length} pipeline(s) for ${context.commitHash} on ${context.branchName} (${inputs.triggerType})\n`,
)

// Parameters go first: a pipeline started by its trigger reads them at once.
for (const parameter of inputs.artifactParameters) {
  const name = `${ARTIFACT_PARAMETER_NAMESPACE}/${parameter.name}`
  try {
    await putParameter(name, parameter.value)
  } catch (cause) {
    fail(`Failed to write parameter '${name}': ${describe(cause)}`)
  }
  process.stdout.write(`Set ${name}\n`)
}

const metadata =
  inputs.metadataFile === undefined
    ? undefined
    : new Uint8Array(readFileSync(inputs.metadataFile))

// Sequential on purpose: each pipeline's metadata has to be in place before the
// trigger that starts it, and the upload of a trigger is what starts it.
for (const pipeline of inputs.pipelines) {
  const key = metadataKey(pipeline, inputs.triggerType)
  try {
    if (key !== undefined && metadata !== undefined) {
      await putObject({ bucket: inputs.bucket, key, body: metadata })
    }
    await putObject({ bucket: inputs.bucket, key: triggerKey(pipeline), body: trigger })
  } catch (cause) {
    fail(`Failed to trigger pipeline '${pipeline}': ${describe(cause)}`)
  }
  process.stdout.write(`Triggered pipeline '${pipeline}'\n`)
}
