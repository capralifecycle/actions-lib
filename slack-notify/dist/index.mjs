// lib/actions.ts
import { appendFileSync } from "node:fs";
var runningInActions = () => process.env["GITHUB_ACTIONS"] === "true";
function fail(message) {
  process.stderr.write(`${message}
`);
  process.exit(1);
}
var requireEnv = (name) => process.env[name] ?? fail(`Environment variable '${name}' is not set`);
function renderOutput({ name, value }) {
  if (!/[\r\n]/.test(value))
    return `${name}=${value}
`;
  let delimiter = "EOF";
  while (value.includes(delimiter))
    delimiter += "_";
  return `${name}<<${delimiter}
${value}
${delimiter}
`;
}
var renderOutputs = (outputs) => outputs.map(renderOutput).join("");
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
var buildRequest = (target) => target.kind === "webhook" ? {
  url: target.url,
  headers: { "Content-Type": "application/json; charset=utf-8" }
} : {
  url: POST_MESSAGE_URL,
  headers: {
    Authorization: `Bearer ${target.token}`,
    "Content-Type": "application/json; charset=utf-8"
  }
};
function readResponse(target, response) {
  if (response.status < 200 || response.status > 299) {
    return err(`Request failed with status ${response.status} ${response.statusText}`);
  }
  if (target.kind === "webhook")
    return ok(undefined);
  let result;
  try {
    result = JSON.parse(response.body);
  } catch (cause) {
    return err(`Slack returned an unreadable response: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const { ok: accepted, error } = result ?? {};
  if (accepted === true)
    return ok(undefined);
  return err(`Request failed with error ${typeof error === "string" ? error : "unknown"}`);
}
async function post(target, body) {
  const request = buildRequest(target);
  try {
    const response = await fetch(request.url, {
      method: "POST",
      body,
      headers: request.headers
    });
    return readResponse(target, {
      status: response.status,
      statusText: response.statusText,
      body: await response.text()
    });
  } catch (cause) {
    return err(`Failed to reach Slack: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

// slack-notify/src/main.ts
var input = (name) => process.env[`INPUT_${name.toUpperCase()}`] ?? process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? "";
var botToken = input("bot-token");
var incomingWebhookUrl = input("incoming-webhook-url");
mask(botToken);
mask(incomingWebhookUrl);
var parsed;
try {
  parsed = JSON.parse(input("payload"));
} catch {
  fail("Failed to parse payload as JSON");
}
if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
  fail("The payload is not a JSON object");
}
var payload = parsed;
var channel = input("channel");
var target = parseTarget(botToken, incomingWebhookUrl, channel);
if (!target.ok)
  fail(target.error);
var body = buildBody(payload, channel);
if (input("dry-run") === "true") {
  process.stdout.write(`Dry run, so the payload was built but not sent
`);
  if (runningInActions())
    writeOutputs([{ name: "payload", value: body }]);
  else
    process.stdout.write(`${body}
`);
} else {
  const sent = await post(target.value, body);
  if (!sent.ok)
    fail(sent.error);
  process.stdout.write(target.value.kind === "bot" ? `Posted to Slack channel ${channel}
` : `Posted to Slack through the incoming webhook
`);
}
