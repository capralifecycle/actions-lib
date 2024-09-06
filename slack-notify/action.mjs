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
  const useIncomingWebhook = Boolean(incomingWebhookUrl) // null, undefined or empty string means false.
  const endpointUrl = useIncomingWebhook ?  incomingWebhookUrl : "https://slack.com/api/chat.postMessage"
  const response = await fetch(endpointUrl, {
    method: "POST",
    body,
    headers: {
      /* 
      * Only set the Authorization header if we're not using webhook and bot token is defined
      * Since there's a check above, there will under no circumstances be a situation where 
      * useIncomingWebhook is true and the botToken-variable is defined
      */
      ...(botToken && { "Authorization": `Bearer ${botToken}` }),
      "Content-Type": "application/json; charset=utf-8"
    }
  })
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status} ${response.statusText}`)
  }
  /*
  * Slack is using a different response scheme for incoming webhooks. Thereby,
  * we only do fetch.then(response => resonse.json()) if messages was posted to the
  * chat.postMessage-api. 
  * 
  * Error handling for incoming webhooks: https://api.slack.com/messaging/webhooks#handling_errors
  */
  if (!useIncomingWebhook) {
    const { ok, error } = await response.json()
    if (!ok) {
      throw new Error(`Request failed with error ${error}`)
    }
  }
}
