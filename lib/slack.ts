import { type Result, err, ok } from "./result.ts"

const POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage"

/**
 * Slack is reached either as an app, which needs a channel to post into, or
 * through an incoming webhook, which carries its own destination.
 */
export type SlackTarget =
  | { readonly kind: "bot"; readonly token: string }
  | { readonly kind: "webhook"; readonly url: string }

export function parseTarget(
  botToken: string,
  incomingWebhookUrl: string,
  channel: string,
): Result<SlackTarget> {
  if (botToken === "" && incomingWebhookUrl === "") {
    return err("Either a bot token or an incoming webhook URL needs to be supplied")
  }
  if (botToken !== "" && incomingWebhookUrl !== "") {
    return err("Can't use both a bot token and an incoming webhook URL")
  }
  if (botToken !== "" && channel === "") {
    return err("A channel needs to be supplied if using a bot token")
  }
  return botToken !== ""
    ? ok({ kind: "bot", token: botToken })
    : ok({ kind: "webhook", url: incomingWebhookUrl })
}

/** The channel rides in the payload, and is left out when none was given. */
export const buildBody = (payload: object, channel: string): string =>
  JSON.stringify({ ...payload, ...(channel === "" ? {} : { channel }) })

const endpoint = (target: SlackTarget): string =>
  target.kind === "webhook" ? target.url : POST_MESSAGE_URL

const headers = (target: SlackTarget): Record<string, string> => ({
  ...(target.kind === "bot" ? { Authorization: `Bearer ${target.token}` } : {}),
  "Content-Type": "application/json; charset=utf-8",
})

/**
 * Posts an already-serialised body, reporting why Slack refused it.
 *
 * An incoming webhook answers with a plain-text body, so only the Web API
 * response is read for the `ok` flag that carries its errors.
 * See https://api.slack.com/messaging/webhooks#handling_errors
 */
export async function post(
  target: SlackTarget,
  body: string,
): Promise<Result<void>> {
  let response: Response
  try {
    response = await fetch(endpoint(target), {
      method: "POST",
      body,
      headers: headers(target),
    })
  } catch (cause) {
    return err(
      `Failed to reach Slack: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }

  if (!response.ok) {
    return err(`Request failed with status ${response.status} ${response.statusText}`)
  }
  if (target.kind === "webhook") return ok(undefined)

  let result: { ok?: boolean; error?: string }
  try {
    result = (await response.json()) as { ok?: boolean; error?: string }
  } catch (cause) {
    return err(
      `Slack returned an unreadable response: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  return result.ok
    ? ok(undefined)
    : err(`Request failed with error ${result.error ?? "unknown"}`)
}
