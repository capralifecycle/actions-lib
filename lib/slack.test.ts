import { describe, expect, test } from "bun:test"

import { buildBody, parseTarget } from "./slack.ts"

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

describe("a refusal from Slack", () => {
  test("names the error Slack gave, or says so when it gave none", async () => {
    const { post } = await import("./slack.ts")
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 200,
      })) as unknown as typeof fetch
    try {
      const result = await post({ kind: "bot", token: "t" }, "{}")
      expect(result).toEqual({ ok: false, error: "Request failed with error unknown" })
    } finally {
      globalThis.fetch = original
    }
  })
})
