import { spawn } from "node:child_process"
import { parseArgs } from "node:util"

import {
  fail,
  mask,
  runningInActions,
  writeOutputs,
} from "../../lib/actions.ts"
import {
  type Inputs,
  type RunContext,
  buildScanArgs,
  collectInputs,
  exitCodeFor,
  parseInputs,
  parseScanLog,
  scanFailed,
  shouldNotify,
} from "./scan.ts"
import { type SlackPayload, buildSlackPayload } from "./slack.ts"

const CLIENT_COMMAND = "aikido-api-client"
const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage"

const INPUT_NAMES = [
  "apikey",
  "repository",
  "commit-sha",
  "min-severity-level",
  "fail-on-sast-scan",
  "fail-on-iac-scan",
  "fail-on-secrets-scan",
  "fail-on-dependency-scan",
  "fail-on-malware-scan",
  "fails-on-any-finding",
  "notify-slack",
  "bot-token",
  "channel",
] as const

const inActions = runningInActions()

const rawFromEnvironment = (): Record<string, string> =>
  collectInputs(process.env, INPUT_NAMES)

function rawFromArgv(): Record<string, string> {
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

/**
 * The repository, commit and branch a scan reports on are the ones the workflow
 * is running for, so they come from the runner rather than from inputs.
 */
function contextFromEnvironment(): RunContext {
  const branch = process.env["GITHUB_HEAD_REF"] || process.env["GITHUB_REF_NAME"]
  return {
    serverUrl: process.env["GITHUB_SERVER_URL"] ?? "",
    repositoryFullName: process.env["GITHUB_REPOSITORY"] ?? "",
    branch: branch ?? "",
    actor: process.env["GITHUB_TRIGGERING_ACTOR"] ?? "",
    runId: process.env["GITHUB_RUN_ID"] ?? "",
  }
}

interface ScanResult {
  readonly exitCode: number
  readonly log: string
}

/** Streams the client's output as it arrives while keeping a copy to read back. */
function runScan(args: readonly string[]): Promise<ScanResult> {
  return new Promise((resolve) => {
    const child = spawn(CLIENT_COMMAND, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let log = ""
    const tee = (chunk: Buffer): void => {
      const text = chunk.toString()
      log += text
      process.stdout.write(text)
    }
    child.stdout.on("data", tee)
    child.stderr.on("data", tee)
    child.on("error", (cause) =>
      fail(`Failed to run '${CLIENT_COMMAND}': ${cause.message}`),
    )
    child.on("close", (code) => resolve({ exitCode: code ?? 1, log }))
  })
}

async function postToSlack(
  payload: SlackPayload,
  inputs: Inputs,
): Promise<void> {
  let response: Response
  try {
    response = await fetch(SLACK_POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inputs.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ ...payload, channel: inputs.channel }),
    })
  } catch (cause) {
    fail(
      `Failed to post message to Slack: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!response.ok) {
    fail(
      `Failed to post message to Slack: ${response.status} ${response.statusText}`,
    )
  }
  const body = (await response.json()) as { ok?: boolean; error?: string }
  if (!body.ok) {
    fail(`Slack responded with an error: ${body.error ?? "unknown"}`)
  }
}

const raw = inActions ? rawFromEnvironment() : rawFromArgv()

mask(raw["apikey"] ?? "")
mask(raw["bot-token"] ?? "")

const inputs = parseInputs(raw)
if (!inputs.ok) fail(inputs.error)

const args = buildScanArgs(inputs.value.scan)
process.stdout.write(
  `Scanning ${inputs.value.scan.repository} at ${inputs.value.scan.commitSha}\n`,
)

const { exitCode, log } = await runScan(args)
const findings = parseScanLog(log)

let slackNotified = false
let payload: SlackPayload | undefined

if (shouldNotify(exitCode, inputs.value)) {
  payload = buildSlackPayload(
    inputs.value.scan.repository,
    inputs.value.scan.commitSha,
    findings,
    contextFromEnvironment(),
  )
  await postToSlack(payload, inputs.value)
  slackNotified = true
  process.stdout.write(`Notified Slack channel ${inputs.value.channel}\n`)
}

const outputs = [
  { name: "issues-found", value: String(findings.issues) },
  { name: "diff-url", value: findings.diffUrl },
  { name: "scan-exit-code", value: String(exitCode) },
  { name: "slack-notified", value: String(slackNotified) },
]
if (payload !== undefined) {
  outputs.push({ name: "slack-payload", value: JSON.stringify(payload) })
}

if (inActions) {
  writeOutputs(outputs)
}

if (!scanFailed(exitCode)) {
  process.stdout.write("Aikido scan found no new issues\n")
  process.exit(0)
}

process.stdout.write(
  `Aikido scan found ${findings.issues} issue(s) (exit code ${exitCode})` +
    `${findings.diffUrl === "" ? "" : `: ${findings.diffUrl}`}\n`,
)
if (!inputs.value.failsOnAnyFinding) {
  process.stdout.write(
    "'fails-on-any-finding' is disabled, so the action will not fail\n",
  )
}
process.exit(exitCodeFor(exitCode, inputs.value.failsOnAnyFinding))
