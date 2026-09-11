import { type Result, err, ok } from "../../lib/result.ts"

/** Every scan category the CI API client can be told to fail the job on. */
export interface FailOn {
  readonly sast: boolean
  readonly iac: boolean
  readonly secrets: boolean
  readonly dependency: boolean
  readonly malware: boolean
}

export interface ScanRequest {
  readonly apikey: string
  readonly repository: string
  readonly commitSha: string
  readonly minSeverityLevel: string
  readonly failOn: FailOn
}

export interface Inputs {
  readonly scan: ScanRequest
  readonly notifySlack: boolean
  readonly botToken: string
  readonly channel: string
  readonly failsOnAnyFinding: boolean
}

/** The parts of the run a notification refers back to. */
export interface RunContext {
  readonly serverUrl: string
  readonly repositoryFullName: string
  readonly branch: string
  readonly actor: string
  readonly runId: string
}

/** The context flags that stand in for the runner's environment locally. */
export const CONTEXT_NAMES = [
  "server-url",
  "repository-full-name",
  "branch",
  "actor",
  "run-id",
] as const

/**
 * Every value here has a default environment variable on a runner, so the
 * action reads them rather than having them threaded through as inputs.
 * `GITHUB_HEAD_REF` is set only for a pull request, where it names the source
 * branch; otherwise the run's own ref name is the branch.
 */
export function runContextFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): RunContext {
  return {
    serverUrl: environment["GITHUB_SERVER_URL"] ?? "",
    repositoryFullName: environment["GITHUB_REPOSITORY"] ?? "",
    branch: environment["GITHUB_HEAD_REF"] || (environment["GITHUB_REF_NAME"] ?? ""),
    actor: environment["GITHUB_TRIGGERING_ACTOR"] ?? "",
    runId: environment["GITHUB_RUN_ID"] ?? "",
  }
}

export const runContextFromArgs = (
  values: Readonly<Record<string, string>>,
): RunContext => ({
  serverUrl: values["server-url"] ?? "",
  repositoryFullName: values["repository-full-name"] ?? "",
  branch: values["branch"] ?? "",
  actor: values["actor"] ?? "",
  runId: values["run-id"] ?? "",
})

export interface Findings {
  readonly issues: number
  readonly diffUrl: string
}

const isTrue = (value: string): boolean => value === "true"

/**
 * GitHub sets `INPUT_COMMIT-SHA` for an action on the node runtime, while a
 * composite step has to name the variable itself and underscores are the safer
 * spelling there. Accept both so the runtime can change without touching this.
 */
export function collectInputs(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): Record<string, string> {
  const lookup = (name: string): string => {
    const upper = name.toUpperCase()
    return (
      environment[`INPUT_${upper}`] ??
      environment[`INPUT_${upper.replace(/-/g, "_")}`] ??
      ""
    )
  }
  return Object.fromEntries(names.map((name) => [name, lookup(name)]))
}

export function parseInputs(raw: Readonly<Record<string, string>>): Result<Inputs> {
  const value = (name: string): string => raw[name] ?? ""

  const notifySlack = isTrue(value("notify-slack"))

  const missing = ["apikey", "repository", "commit-sha"]
    .concat(notifySlack ? ["bot-token", "channel"] : [])
    .filter((name) => value(name) === "")

  if (missing.length > 0) {
    return err(
      missing.map((name) => `Parameter '${name}' is empty`).join("\n"),
    )
  }

  return ok({
    scan: {
      apikey: value("apikey"),
      repository: value("repository"),
      commitSha: value("commit-sha"),
      minSeverityLevel: value("min-severity-level"),
      failOn: {
        sast: isTrue(value("fail-on-sast-scan")),
        iac: isTrue(value("fail-on-iac-scan")),
        secrets: isTrue(value("fail-on-secrets-scan")),
        // The client fails on dependency findings by default and only offers a
        // flag to turn that off, so anything but an explicit "false" leaves it on.
        dependency: value("fail-on-dependency-scan") !== "false",
        malware: isTrue(value("fail-on-malware-scan")),
      },
    },
    notifySlack,
    botToken: value("bot-token"),
    channel: value("channel"),
    failsOnAnyFinding: isTrue(value("fails-on-any-finding")),
  })
}

export function buildScanArgs(request: ScanRequest): string[] {
  const args = [
    "scan-release",
    request.repository,
    request.commitSha,
    "--apikey",
    request.apikey,
  ]
  if (request.minSeverityLevel !== "") {
    args.push("--minimum-severity-level", request.minSeverityLevel)
  }
  if (request.failOn.sast) args.push("--fail-on-sast-scan")
  if (request.failOn.iac) args.push("--fail-on-iac-scan")
  if (request.failOn.secrets) args.push("--fail-on-secrets-scan")
  if (!request.failOn.dependency) args.push("--no-fail-on-dependency-scan")
  if (request.failOn.malware) args.push("--fail-on-malware-scan")
  return args
}

/** Reads the issue count and diff URL back out of the client's own output. */
export function parseScanLog(log: string): Findings {
  const issues = /Open issues found: (\d+)/.exec(log)
  const diffUrl = /Diff url: (\S+)/.exec(log)
  return {
    issues: issues ? Number(issues[1]) : 0,
    diffUrl: diffUrl ? (diffUrl[1] as string) : "",
  }
}

export const scanFailed = (exitCode: number): boolean => exitCode !== 0

export const shouldNotify = (exitCode: number, inputs: Inputs): boolean =>
  scanFailed(exitCode) && inputs.notifySlack

/**
 * A scan that found something still reports its findings and notifies; whether
 * that also fails the job is the caller's choice.
 */
export const exitCodeFor = (
  scanExitCode: number,
  failsOnAnyFinding: boolean,
): number => (failsOnAnyFinding ? scanExitCode : 0)
