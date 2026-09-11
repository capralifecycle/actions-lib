import { fail, mask, runningInActions, writeOutputs } from "../../lib/actions.ts"
import { buildBody, parseTarget, post } from "../../lib/slack.ts"

const input = (name: string): string =>
  process.env[`INPUT_${name.toUpperCase()}`] ??
  process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ??
  ""

const botToken = input("bot-token")
const incomingWebhookUrl = input("incoming-webhook-url")
mask(botToken)
mask(incomingWebhookUrl)

let parsed: unknown
try {
  parsed = JSON.parse(input("payload"))
} catch {
  fail("Failed to parse payload as JSON")
}
// Spreading anything else yields an empty or index-keyed body, which Slack
// accepts and silently posts as nothing useful.
if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
  fail("The payload is not a JSON object")
}
const payload: object = parsed

const channel = input("channel")
const target = parseTarget(botToken, incomingWebhookUrl, channel)
if (!target.ok) fail(target.error)

const body = buildBody(payload, channel)

if (input("dry-run") === "true") {
  process.stdout.write("Dry run, so the payload was built but not sent\n")
  if (runningInActions()) writeOutputs([{ name: "payload", value: body }])
  else process.stdout.write(`${body}\n`)
} else {
  const sent = await post(target.value, body)
  if (!sent.ok) fail(sent.error)
  process.stdout.write(
    target.value.kind === "bot"
      ? `Posted to Slack channel ${channel}\n`
      : "Posted to Slack through the incoming webhook\n",
  )
}
