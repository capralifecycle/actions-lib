#!/usr/bin/env node
import { appendFileSync } from "node:fs"
let payload
try {
  payload = JSON.parse(process.env["INPUT_PAYLOAD"])
} catch {
  throw new Error("Failed to parse payload as JSON")
}
const dryRun = process.env["INPUT_DRY-RUN"] === "true"
const channel = process.env["INPUT_CHANNEL"]
const botToken = process.env["INPUT_BOT-TOKEN"]
const incomingWebhookUrl = process.env["INPUT_INCOMING-WEBHOOK-URL"]

if (!(botToken || incomingWebhookUrl)) {
  throw new Error("Either a bot token or an incoming webhook URL needs to be supplied")
}
if (botToken && incomingWebhookUrl) {
  throw new Error("Can't use both a bot token and an incoming webhook URL")
}
if (botToken && !channel) {
  throw new Error("A channel needs to be supplied if using a bot token")
}

const body = JSON.stringify({
  ...payload,
  ...(channel && { channel })
})
if (dryRun) {
  appendFileSync(process.env.GITHUB_OUTPUT, `payload=${body}\n`)
} else {
  const endpointUrl = incomingWebhookUrl || "https://slack.com/api/chat.postMessage"
  const response = await fetch(endpointUrl, {
    method: "POST",
    body,
    headers: {
      ...(botToken && { "Authorization": `Bearer ${botToken}` }),
      "Content-Type": "application/json; charset=utf-8"
    }
  })
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status} ${response.statusText}`)
  }
  const { ok, error } = await response.json()
  if (!ok) {
    throw new Error(`Request failed with error ${error}`)
  }
}
