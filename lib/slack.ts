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

export interface SlackRequest {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

/** A bot token rides in a header to the Web API; a webhook URL is its own credential. */
export const buildRequest = (target: SlackTarget): SlackRequest =>
  target.kind === "webhook"
    ? {
        url: target.url,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }
    : {
        url: POST_MESSAGE_URL,
        headers: {
          Authorization: `Bearer ${target.token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
      }

export interface SlackResponse {
  readonly status: number
  readonly statusText: string
  readonly body: string
}

/**
 * Decides whether Slack accepted a message. The Web API answers 200 even when
 * it refuses one, and says so in the `ok` flag of its JSON body. An incoming
 * webhook signals refusal by status alone and answers with plain text, so its
 * body is not read. See https://api.slack.com/messaging/webhooks#handling_errors
 */
export function readResponse(
  target: SlackTarget,
  response: SlackResponse,
): Result<void> {
  if (response.status < 200 || response.status > 299) {
    return err(`Request failed with status ${response.status} ${response.statusText}`)
  }
  if (target.kind === "webhook") return ok(undefined)

  let result: unknown
  try {
    result = JSON.parse(response.body)
  } catch (cause) {
    return err(
      `Slack returned an unreadable response: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  const { ok: accepted, error } = (result ?? {}) as { ok?: unknown; error?: unknown }
  if (accepted === true) return ok(undefined)
  return err(`Request failed with error ${typeof error === "string" ? error : "unknown"}`)
}

/** Posts an already-serialised body, reporting why Slack refused it. */
export async function post(
  target: SlackTarget,
  body: string,
): Promise<Result<void>> {
  const request = buildRequest(target)
  try {
    const response = await fetch(request.url, {
      method: "POST",
      body,
      headers: request.headers,
    })
    return readResponse(target, {
      status: response.status,
      statusText: response.statusText,
      body: await response.text(),
    })
  } catch (cause) {
    return err(
      `Failed to reach Slack: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}
