import { describe, expect, test } from "bun:test"

import {
  type Inputs,
  buildScanArgs,
  exitCodeFor,
  parseInputs,
  parseScanLog,
  runContextFromArgs,
  runContextFromEnvironment,
  scanOutcome,
  shouldNotify,
} from "./scan.ts"
import { buildSlackPayload } from "./slack.ts"

/**
 * Every option the pinned client declares. Its argument parser rejects anything
 * else outright, so an option that is merely plausible fails the whole scan.
 */
const CLIENT_OPTIONS = [
  "--apikey",
  "--plain-output",
  "--minimum-severity-level",
  "--fail-on-sast-scan",
  "--fail-on-iac-scan",
  "--fail-on-secrets-scan",
  "--no-fail-on-dependency-scan",
]

const raw = (overrides: Record<string, string> = {}): Record<string, string> => ({
  apikey: "secret",
  repository: "my-repo",
  "commit-sha": "abcdef1234567890",
  "min-severity-level": "CRITICAL",
  "fail-on-sast-scan": "true",
  "fail-on-iac-scan": "true",
  "fail-on-secrets-scan": "true",
  "fail-on-dependency-scan": "true",
  "fails-on-any-finding": "false",
  "notify-slack": "false",
  "bot-token": "",
  channel: "",
  ...overrides,
})

const inputs = (overrides: Record<string, string> = {}): Inputs => {
  const result = parseInputs(raw(overrides))
  if (!result.ok) throw new Error(`expected inputs, got error: ${result.error}`)
  return result.value
}

const error = (result: ReturnType<typeof parseInputs>): string => {
  if (result.ok) throw new Error("expected an error, got inputs")
  return result.error
}

describe("inputs are rejected", () => {
  test("when the API key is missing", () => {
    expect(error(parseInputs(raw({ apikey: "" })))).toContain(
      "Parameter 'apikey' is empty",
    )
  })

  test("when Slack is requested without a token or a channel", () => {
    const message = error(parseInputs(raw({ "notify-slack": "true" })))
    expect(message).toContain("Parameter 'bot-token' is empty")
    expect(message).toContain("Parameter 'channel' is empty")
  })

  test("listing every missing parameter at once", () => {
    const message = error(
      parseInputs(raw({ apikey: "", repository: "", "commit-sha": "" })),
    )
    expect(message.split("\n")).toHaveLength(3)
  })
})

describe("inputs are accepted", () => {
  test("without a Slack token when notifications are off", () => {
    expect(parseInputs(raw({ "notify-slack": "false" })).ok).toBe(true)
  })
})

describe("scan arguments", () => {
  test("always name the sub-command, repository, commit and key", () => {
    expect(buildScanArgs(inputs().scan).slice(0, 5)).toEqual([
      "scan-release",
      "my-repo",
      "abcdef1234567890",
      "--apikey",
      "secret",
    ])
  })

  test("turn off colour, which would split the log lines the counts are read from", () => {
    expect(buildScanArgs(inputs().scan)).toContain("--plain-output")
  })

  test("pass the minimum severity level when one is given", () => {
    expect(buildScanArgs(inputs().scan)).toContain("--minimum-severity-level")
    expect(buildScanArgs(inputs({ "min-severity-level": "" }).scan)).not.toContain(
      "--minimum-severity-level",
    )
  })

  test("opt in to the categories that are switched on", () => {
    const args = buildScanArgs(inputs().scan)
    expect(args).toContain("--fail-on-sast-scan")
    expect(args).toContain("--fail-on-iac-scan")
    expect(args).toContain("--fail-on-secrets-scan")
  })

  test("name only options the client accepts", () => {
    const combinations = [
      inputs(),
      inputs({ "min-severity-level": "" }),
      inputs({ "fail-on-dependency-scan": "false" }),
      inputs({ "fail-on-sast-scan": "false", "fail-on-iac-scan": "false" }),
    ]
    for (const combination of combinations) {
      for (const arg of buildScanArgs(combination.scan).filter((a) =>
        a.startsWith("--"),
      )) {
        expect(CLIENT_OPTIONS).toContain(arg)
      }
    }
  })

  test("opt out of dependency findings, which the client fails on by default", () => {
    // The only negative flag: its absence means the client still fails.
    expect(buildScanArgs(inputs().scan)).not.toContain(
      "--no-fail-on-dependency-scan",
    )
    expect(
      buildScanArgs(inputs({ "fail-on-dependency-scan": "false" }).scan),
    ).toContain("--no-fail-on-dependency-scan")
  })

  test("treat anything but an explicit 'false' as leaving dependency failures on", () => {
    expect(
      buildScanArgs(inputs({ "fail-on-dependency-scan": "" }).scan),
    ).not.toContain("--no-fail-on-dependency-scan")
  })
})

describe("reading the client's output", () => {
  test("picks out the issue count and the diff URL", () => {
    expect(
      parseScanLog(
        "Scanning...\nOpen issues found: 12\nDiff url: https://app.aikido.dev/x/1\nDone\n",
      ),
    ).toEqual({ issues: 12, diffUrl: "https://app.aikido.dev/x/1" })
  })

  test("reports no issues when the client printed no count", () => {
    expect(parseScanLog("Scan completed, nothing to report\n")).toEqual({
      issues: 0,
      diffUrl: "",
    })
  })

  test("stops the URL at whitespace", () => {
    expect(parseScanLog("Diff url: https://a.example/1 trailing").diffUrl).toBe(
      "https://a.example/1",
    )
  })
})

describe("the client's exit code", () => {
  test.each([
    [0, "clean"],
    [10, "findings"],
    [1, "error"],
    [2, "error"],
    [127, "error"],
  ] as const)("%i reads as %s", (code, expected) => {
    expect(scanOutcome(code)).toBe(expected)
  })
})

describe("what the action does with the outcome", () => {
  const notifying = inputs({ "notify-slack": "true", "bot-token": "t", channel: "#c" })

  test("notifies Slack of findings when notification is on", () => {
    expect(shouldNotify("findings", notifying)).toBe(true)
    expect(shouldNotify("findings", inputs())).toBe(false)
  })

  test("does not notify Slack of a clean scan", () => {
    expect(shouldNotify("clean", notifying)).toBe(false)
  })

  test("does not report a scan that never completed as findings", () => {
    expect(shouldNotify("error", notifying)).toBe(false)
  })

  test.each([
    ["clean", 0, false, 0],
    ["clean", 0, true, 0],
    ["findings", 10, false, 0],
    ["findings", 10, true, 10],
    ["error", 1, false, 1],
    ["error", 1, true, 1],
  ] as const)(
    "exits a %s scan (client exit %i, fails-on-any-finding %p) with %i",
    (outcome, clientExitCode, failsOnAnyFinding, expected) => {
      expect(exitCodeFor(outcome, clientExitCode, failsOnAnyFinding)).toBe(expected)
    },
  )
})

describe("the Slack payload", () => {
  const context = {
    serverUrl: "https://github.com",
    repositoryFullName: "an-org/my-repo",
    branch: "main",
    actor: "someone",
    runId: "42",
  }

  const payload = buildSlackPayload(
    "my-repo",
    "abcdef1234567890",
    { issues: 3, diffUrl: "https://app.aikido.dev/x/1" },
    context,
  )

  test("carries a plain-text fallback for clients that cannot render blocks", () => {
    expect(payload.text).toBe(
      "Aikido scan on my-repo (abcdef1) found 3 issues: https://app.aikido.dev/x/1",
    )
  })

  test("summarises the findings and links to the report", () => {
    expect(payload.blocks[0]?.text?.text).toBe(
      ":shield: Aikido scan found *3* issues on *my-repo* — <https://app.aikido.dev/x/1|View in Aikido>",
    )
  })

  test("leaves out the report link when the client printed no diff URL", () => {
    const withoutUrl = buildSlackPayload("my-repo", "abcdef1234567890", { issues: 3, diffUrl: "" }, context)
    expect(withoutUrl.text).toBe("Aikido scan on my-repo (abcdef1) found 3 issues")
    expect(withoutUrl.blocks[0]?.text?.text).toBe(":shield: Aikido scan found *3* issues on *my-repo*")
  })

  test("links the commit and the workflow run from the context line", () => {
    expect(payload.blocks[1]?.elements?.[0]?.text).toBe(
      "branch `main` · <https://github.com/an-org/my-repo/commit/abcdef1234567890|abcdef1> · by someone · <https://github.com/an-org/my-repo/actions/runs/42|Workflow run>",
    )
  })
})

describe("the run context", () => {
  const environment = {
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "an-org/my-repo",
    GITHUB_REF_NAME: "main",
    GITHUB_TRIGGERING_ACTOR: "someone",
    GITHUB_RUN_ID: "42",
  }

  test("comes from the runner's own default variables", () => {
    expect(runContextFromEnvironment(environment)).toEqual({
      serverUrl: "https://github.com",
      repositoryFullName: "an-org/my-repo",
      branch: "main",
      actor: "someone",
      runId: "42",
    })
  })

  test("names the source branch of a pull request, not its merge ref", () => {
    expect(
      runContextFromEnvironment({
        ...environment,
        GITHUB_HEAD_REF: "my-feature",
        GITHUB_REF_NAME: "7/merge",
      }).branch,
    ).toBe("my-feature")
  })

  test("falls back to the ref name when there is no pull request", () => {
    expect(
      runContextFromEnvironment({ ...environment, GITHUB_HEAD_REF: "" }).branch,
    ).toBe("main")
  })

  test("reports the user who started this run, which a re-run can change", () => {
    // GITHUB_ACTOR is the original author on a re-run; the notification should
    // credit whoever pressed the button.
    expect(
      runContextFromEnvironment({
        ...environment,
        GITHUB_ACTOR: "original-author",
        GITHUB_TRIGGERING_ACTOR: "whoever-reran-it",
      }).actor,
    ).toBe("whoever-reran-it")
  })

  test("is empty rather than undefined when nothing is set", () => {
    expect(runContextFromEnvironment({})).toEqual({
      serverUrl: "",
      repositoryFullName: "",
      branch: "",
      actor: "",
      runId: "",
    })
  })

  test("can be supplied by flag when running outside a workflow", () => {
    expect(
      runContextFromArgs({
        "server-url": "https://github.example",
        "repository-full-name": "an-org/my-repo",
        branch: "a-branch",
        actor: "me",
        "run-id": "7",
      }),
    ).toEqual({
      serverUrl: "https://github.example",
      repositoryFullName: "an-org/my-repo",
      branch: "a-branch",
      actor: "me",
      runId: "7",
    })
  })
})
