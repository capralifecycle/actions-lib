import { spawn } from "node:child_process"

import {
  fail,
  mask,
  runningInActions,
  writeOutputs,
} from "../../lib/actions.ts"
import { readInputs } from "../../lib/inputs.ts"
import { buildBody, parseTarget, post } from "../../lib/slack.ts"
import {
  CONTEXT_NAMES,
  type Inputs,
  type RunContext,
  buildScanArgs,
  exitCodeFor,
  parseInputs,
  parseScanLog,
  runContextFromArgs,
  runContextFromEnvironment,
  scanOutcome,
  shouldNotify,
} from "./scan.ts"
import { type SlackPayload, buildSlackPayload } from "./slack.ts"

const CLIENT_COMMAND = "aikido-api-client"

const INPUT_NAMES = [
  "apikey",
  "repository",
  "commit-sha",
  "min-severity-level",
  "fail-on-sast-scan",
  "fail-on-iac-scan",
  "fail-on-secrets-scan",
  "fail-on-dependency-scan",
  "fails-on-any-finding",
  "notify-slack",
  "bot-token",
  "channel",
] as const

const inActions = runningInActions()

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
    // A client that never ran has found nothing, which must not be reported as
    // a clean scan; the shell version let exit code 127 pass as a green result.
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
  const target = parseTarget(inputs.botToken, "", inputs.channel)
  if (!target.ok) fail(target.error)

  const sent = await post(target.value, buildBody(payload, inputs.channel))
  if (!sent.ok) fail(sent.error)
}

const raw = readInputs(INPUT_NAMES, CONTEXT_NAMES)
const context: RunContext = inActions
  ? runContextFromEnvironment(process.env)
  : runContextFromArgs(raw)

mask(raw["apikey"])
mask(raw["bot-token"])

const inputs = parseInputs(raw)
if (!inputs.ok) fail(inputs.error)

const args = buildScanArgs(inputs.value.scan)
process.stdout.write(
  `Scanning ${inputs.value.scan.repository} at ${inputs.value.scan.commitSha}\n`,
)

const { exitCode, log } = await runScan(args)
const outcome = scanOutcome(exitCode)
const findings = parseScanLog(log)

let slackNotified = false
let payload: SlackPayload | undefined

if (shouldNotify(outcome, inputs.value)) {
  payload = buildSlackPayload(
    inputs.value.scan.repository,
    inputs.value.scan.commitSha,
    findings,
    context,
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

switch (outcome) {
  case "clean":
    process.stdout.write("Aikido scan found no new issues\n")
    break
  case "findings":
    process.stdout.write(
      `Aikido scan found ${findings.issues} issue(s)` +
        `${findings.diffUrl === "" ? "" : `: ${findings.diffUrl}`}\n`,
    )
    if (!inputs.value.failsOnAnyFinding) {
      process.stdout.write(
        "'fails-on-any-finding' is disabled, so the action will not fail\n",
      )
    }
    break
  case "error":
    process.stderr.write(
      `'${CLIENT_COMMAND}' failed with exit code ${exitCode} before the scan completed\n`,
    )
    break
}
process.exit(exitCodeFor(outcome, exitCode, inputs.value.failsOnAnyFinding))
