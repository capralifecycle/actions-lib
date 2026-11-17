import { describe, expect, test } from "bun:test"

import {
  type SlackTarget,
  buildBody,
  buildRequest,
  parseTarget,
  readResponse,
} from "./slack.ts"

const error = (result: ReturnType<typeof parseTarget>): string => {
  if (result.ok) throw new Error("expected an error, got a target")
  return result.error
}

describe("choosing how to reach Slack", () => {
  test("uses the app when a bot token and a channel are given", () => {
    expect(parseTarget("xoxb-1", "", "#ops")).toEqual({
      ok: true,
      value: { kind: "bot", token: "xoxb-1" },
    })
  })

  test("uses the webhook, which carries its own destination", () => {
    expect(parseTarget("", "https://hooks.slack.test/1", "")).toEqual({
      ok: true,
      value: { kind: "webhook", url: "https://hooks.slack.test/1" },
    })
  })

  test("refuses when neither is supplied", () => {
    expect(error(parseTarget("", "", ""))).toBe(
      "Either a bot token or an incoming webhook URL needs to be supplied",
    )
  })

  test("refuses when both are supplied, rather than picking one", () => {
    expect(error(parseTarget("xoxb-1", "https://hooks.slack.test/1", "#ops"))).toBe(
      "Can't use both a bot token and an incoming webhook URL",
    )
  })

  test("refuses a bot token with nowhere to post", () => {
    expect(error(parseTarget("xoxb-1", "", ""))).toBe(
      "A channel needs to be supplied if using a bot token",
    )
  })
})

describe("the request body", () => {
  test("carries the caller's payload unchanged", () => {
    expect(buildBody({ text: "hello" }, "")).toBe('{"text":"hello"}')
  })

  test("adds the channel when one is given", () => {
    expect(JSON.parse(buildBody({ text: "hello" }, "#ops"))).toEqual({
      text: "hello",
      channel: "#ops",
    })
  })

  test("adds the channel even for a webhook, as the shell version did", () => {
    expect(JSON.parse(buildBody({ text: "x" }, "#ops")).channel).toBe("#ops")
  })

  test("lets the payload's own channel be overridden by the input", () => {
    expect(JSON.parse(buildBody({ channel: "#from-payload" }, "#from-input")).channel).toBe(
      "#from-input",
    )
  })
})

describe("the request", () => {
  test("goes to the Web API with the bot token as a bearer token", () => {
    expect(buildRequest({ kind: "bot", token: "xoxb-1" })).toEqual({
      url: "https://slack.com/api/chat.postMessage",
      headers: {
        Authorization: "Bearer xoxb-1",
        "Content-Type": "application/json; charset=utf-8",
      },
    })
  })

  test("goes to the webhook URL with no credential of its own", () => {
    expect(buildRequest({ kind: "webhook", url: "https://hooks.slack.test/1" })).toEqual({
      url: "https://hooks.slack.test/1",
      headers: { "Content-Type": "application/json; charset=utf-8" },
    })
  })
})

describe("Slack's answer", () => {
  const bot: SlackTarget = { kind: "bot", token: "t" }
  const webhook: SlackTarget = { kind: "webhook", url: "https://hooks.slack.test/1" }
  const answer = (status: number, body: string, statusText = "") => ({
    status,
    statusText,
    body,
  })

  test.each([
    ["the Web API", bot, answer(200, '{"ok":true}')],
    ["a webhook, whose plain-text body is not read", webhook, answer(200, "ok")],
  ])("is an acceptance from %s", (_, target, response) => {
    expect(readResponse(target, response)).toEqual({ ok: true, value: undefined })
  })

  test.each([
    [
      "names the error the Web API gave, though it answered 200",
      bot,
      answer(200, '{"ok":false,"error":"channel_not_found"}'),
      "Request failed with error channel_not_found",
    ],
    [
      "says so when the Web API gave no error",
      bot,
      answer(200, '{"ok":false}'),
      "Request failed with error unknown",
    ],
    [
      "does not take a body without the flag as an acceptance",
      bot,
      answer(200, "null"),
      "Request failed with error unknown",
    ],
    [
      "names the status a webhook refused with",
      webhook,
      answer(404, "no_service", "Not Found"),
      "Request failed with status 404 Not Found",
    ],
    [
      "names the status before reading the body",
      bot,
      answer(500, "<html>", "Internal Server Error"),
      "Request failed with status 500 Internal Server Error",
    ],
  ])("%s", (_, target, response, expected) => {
    expect(readResponse(target, response)).toEqual({ ok: false, error: expected })
  })

  test("is reported as unreadable when the Web API body is not JSON", () => {
    const result = readResponse(bot, answer(200, "<html>"))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toStartWith("Slack returned an unreadable response")
  })
})
