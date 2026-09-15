// aikido-scan/src/main.ts
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

// lib/actions.ts
import { appendFileSync } from "node:fs";
var runningInActions = () => process.env["GITHUB_ACTIONS"] === "true";
function fail(message) {
  process.stderr.write(`${message}
`);
  process.exit(1);
}
var requireEnv = (name) => process.env[name] ?? fail(`Environment variable '${name}' is not set`);
var renderOutputs = (outputs) => outputs.map((output) => `${output.name}=${output.value}
`).join("");
function writeOutputs(outputs) {
  appendFileSync(requireEnv("GITHUB_OUTPUT"), renderOutputs(outputs));
}
function mask(value) {
  if (value !== "")
    process.stdout.write(`::add-mask::${value}
`);
}

// lib/result.ts
var ok = (value) => ({ ok: true, value });
var err = (error) => ({ ok: false, error });

// lib/slack.ts
var POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
function parseTarget(botToken, incomingWebhookUrl, channel) {
  if (botToken === "" && incomingWebhookUrl === "") {
    return err("Either a bot token or an incoming webhook URL needs to be supplied");
  }
  if (botToken !== "" && incomingWebhookUrl !== "") {
    return err("Can't use both a bot token and an incoming webhook URL");
  }
  if (botToken !== "" && channel === "") {
    return err("A channel needs to be supplied if using a bot token");
  }
  return botToken !== "" ? ok({ kind: "bot", token: botToken }) : ok({ kind: "webhook", url: incomingWebhookUrl });
}
var buildBody = (payload, channel) => JSON.stringify({ ...payload, ...channel === "" ? {} : { channel } });
var endpoint = (target) => target.kind === "webhook" ? target.url : POST_MESSAGE_URL;
var headers = (target) => ({
  ...target.kind === "bot" ? { Authorization: `Bearer ${target.token}` } : {},
  "Content-Type": "application/json; charset=utf-8"
});
async function post(target, body) {
  let response;
  try {
    response = await fetch(endpoint(target), {
      method: "POST",
      body,
      headers: headers(target)
    });
  } catch (cause) {
    return err(`Failed to reach Slack: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!response.ok) {
    return err(`Request failed with status ${response.status} ${response.statusText}`);
  }
  if (target.kind === "webhook")
    return ok(undefined);
  let result;
  try {
    result = await response.json();
  } catch (cause) {
    return err(`Slack returned an unreadable response: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return result.ok ? ok(undefined) : err(`Request failed with error ${result.error ?? "unknown"}`);
}

// aikido-scan/src/scan.ts
var CONTEXT_NAMES = [
  "server-url",
  "repository-full-name",
  "branch",
  "actor",
  "run-id"
];
function runContextFromEnvironment(environment) {
  return {
    serverUrl: environment["GITHUB_SERVER_URL"] ?? "",
    repositoryFullName: environment["GITHUB_REPOSITORY"] ?? "",
    branch: environment["GITHUB_HEAD_REF"] || (environment["GITHUB_REF_NAME"] ?? ""),
    actor: environment["GITHUB_TRIGGERING_ACTOR"] ?? "",
    runId: environment["GITHUB_RUN_ID"] ?? ""
  };
}
var runContextFromArgs = (values) => ({
  serverUrl: values["server-url"] ?? "",
  repositoryFullName: values["repository-full-name"] ?? "",
  branch: values["branch"] ?? "",
  actor: values["actor"] ?? "",
  runId: values["run-id"] ?? ""
});
var isTrue = (value) => value === "true";
function collectInputs(environment, names) {
  const lookup = (name) => {
    const upper = name.toUpperCase();
    return environment[`INPUT_${upper}`] ?? environment[`INPUT_${upper.replace(/-/g, "_")}`] ?? "";
  };
  return Object.fromEntries(names.map((name) => [name, lookup(name)]));
}
function parseInputs(raw) {
  const value = (name) => raw[name] ?? "";
  const notifySlack = isTrue(value("notify-slack"));
  const missing = ["apikey", "repository", "commit-sha"].concat(notifySlack ? ["bot-token", "channel"] : []).filter((name) => value(name) === "");
  if (missing.length > 0) {
    return err(missing.map((name) => `Parameter '${name}' is empty`).join(`
`));
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
        dependency: value("fail-on-dependency-scan") !== "false",
        malware: isTrue(value("fail-on-malware-scan"))
      }
    },
    notifySlack,
    botToken: value("bot-token"),
    channel: value("channel"),
    failsOnAnyFinding: isTrue(value("fails-on-any-finding"))
  });
}
function buildScanArgs(request) {
  const args = [
    "scan-release",
    request.repository,
    request.commitSha,
    "--apikey",
    request.apikey
  ];
  if (request.minSeverityLevel !== "") {
    args.push("--minimum-severity-level", request.minSeverityLevel);
  }
  if (request.failOn.sast)
    args.push("--fail-on-sast-scan");
  if (request.failOn.iac)
    args.push("--fail-on-iac-scan");
  if (request.failOn.secrets)
    args.push("--fail-on-secrets-scan");
  if (!request.failOn.dependency)
    args.push("--no-fail-on-dependency-scan");
  if (request.failOn.malware)
    args.push("--fail-on-malware-scan");
  return args;
}
function parseScanLog(log) {
  const issues = /Open issues found: (\d+)/.exec(log);
  const diffUrl = /Diff url: (\S+)/.exec(log);
  return {
    issues: issues ? Number(issues[1]) : 0,
    diffUrl: diffUrl ? diffUrl[1] : ""
  };
}
var scanFailed = (exitCode) => exitCode !== 0;
var shouldNotify = (exitCode, inputs) => scanFailed(exitCode) && inputs.notifySlack;
var exitCodeFor = (scanExitCode, failsOnAnyFinding) => failsOnAnyFinding ? scanExitCode : 0;

// aikido-scan/src/slack.ts
var SHORT_SHA_LENGTH = 7;
var mrkdwn = (text) => ({ type: "mrkdwn", text });
function buildSlackPayload(repository, commitSha, findings, context) {
  const shortSha = commitSha.slice(0, SHORT_SHA_LENGTH);
  const commitUrl = `${context.serverUrl}/${context.repositoryFullName}/commit/${commitSha}`;
  const runUrl = `${context.serverUrl}/${context.repositoryFullName}/actions/runs/${context.runId}`;
  return {
    text: `Aikido scan on ${repository} (${shortSha}) found ${findings.issues} issues: ${findings.diffUrl}`,
    blocks: [
      {
        type: "section",
        text: mrkdwn(`:shield: Aikido scan found *${findings.issues}* issues on *${repository}* — <${findings.diffUrl}|View in Aikido>`)
      },
      {
        type: "context",
        elements: [
          mrkdwn(`branch \`${context.branch}\` · <${commitUrl}|${shortSha}> · by ${context.actor} · <${runUrl}|Workflow run>`)
        ]
      }
    ]
  };
}

// aikido-scan/src/main.ts
var CLIENT_COMMAND = "aikido-api-client";
var INPUT_NAMES = [
  "apikey",
  "repository",
  "commit-sha",
  "min-severity-level",
  "fail-on-sast-scan",
  "fail-on-iac-scan",
  "fail-on-secrets-scan",
  "fail-on-dependency-scan",
  "fail-on-malware-scan",
  "fails-on-any-finding",
  "notify-slack",
  "bot-token",
  "channel"
];
var inActions = runningInActions();
var rawFromEnvironment = () => collectInputs(process.env, INPUT_NAMES);
function valuesFromArgv() {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries([...INPUT_NAMES, ...CONTEXT_NAMES].map((name) => [
        name,
        { type: "string", default: "" }
      ]))
    });
    return values;
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
}
function runScan(args) {
  return new Promise((resolve) => {
    const child = spawn(CLIENT_COMMAND, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let log = "";
    const tee = (chunk) => {
      const text = chunk.toString();
      log += text;
      process.stdout.write(text);
    };
    child.stdout.on("data", tee);
    child.stderr.on("data", tee);
    child.on("error", (cause) => fail(`Failed to run '${CLIENT_COMMAND}': ${cause.message}`));
    child.on("close", (code) => resolve({ exitCode: code ?? 1, log }));
  });
}
async function postToSlack(payload, inputs) {
  const target = parseTarget(inputs.botToken, "", inputs.channel);
  if (!target.ok)
    fail(target.error);
  const sent = await post(target.value, buildBody(payload, inputs.channel));
  if (!sent.ok)
    fail(sent.error);
}
var argv = inActions ? undefined : valuesFromArgv();
var raw = argv ?? rawFromEnvironment();
var context = argv ? runContextFromArgs(argv) : runContextFromEnvironment(process.env);
mask(raw["apikey"] ?? "");
mask(raw["bot-token"] ?? "");
var inputs = parseInputs(raw);
if (!inputs.ok)
  fail(inputs.error);
var args = buildScanArgs(inputs.value.scan);
process.stdout.write(`Scanning ${inputs.value.scan.repository} at ${inputs.value.scan.commitSha}
`);
var { exitCode, log } = await runScan(args);
var findings = parseScanLog(log);
var slackNotified = false;
var payload;
if (shouldNotify(exitCode, inputs.value)) {
  payload = buildSlackPayload(inputs.value.scan.repository, inputs.value.scan.commitSha, findings, context);
  await postToSlack(payload, inputs.value);
  slackNotified = true;
  process.stdout.write(`Notified Slack channel ${inputs.value.channel}
`);
}
var outputs = [
  { name: "issues-found", value: String(findings.issues) },
  { name: "diff-url", value: findings.diffUrl },
  { name: "scan-exit-code", value: String(exitCode) },
  { name: "slack-notified", value: String(slackNotified) }
];
if (payload !== undefined) {
  outputs.push({ name: "slack-payload", value: JSON.stringify(payload) });
}
if (inActions) {
  writeOutputs(outputs);
}
if (!scanFailed(exitCode)) {
  process.stdout.write(`Aikido scan found no new issues
`);
  process.exit(0);
}
process.stdout.write(`Aikido scan found ${findings.issues} issue(s) (exit code ${exitCode})` + `${findings.diffUrl === "" ? "" : `: ${findings.diffUrl}`}
`);
if (!inputs.value.failsOnAnyFinding) {
  process.stdout.write(`'fails-on-any-finding' is disabled, so the action will not fail
`);
}
process.exit(exitCodeFor(exitCode, inputs.value.failsOnAnyFinding));
