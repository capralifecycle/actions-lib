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

// lib/result.ts
var ok = (value) => ({ ok: true, value });
var err = (error) => ({ ok: false, error });

// configure-github-deployment/src/deployment.ts
var DEPLOYMENT_STATES = [
  "error",
  "failure",
  "inactive",
  "in_progress",
  "queued",
  "pending",
  "success"
];
function parseDeploymentState(value) {
  const match = DEPLOYMENT_STATES.find((candidate) => candidate === value);
  return match ? ok(match) : err(`Invalid deployment state '${value}'`);
}
var buildCreatePayload = (request) => ({
  ref: request.ref,
  auto_merge: false,
  required_contexts: [],
  environment: request.environment,
  task: `deploy:${request.repository}`
});
var buildStatusPayload = (state, logUrl) => ({
  state,
  log_url: logUrl,
  auto_inactive: true
});
var buildLogUrl = (serverUrl, repository, sha) => `${serverUrl}/${repository}/commit/${sha}/checks`;
var deploymentsUrl = (apiUrl, repository) => `${apiUrl}/repos/${repository}/deployments`;
var deploymentStatusesUrl = (apiUrl, repository, deploymentId) => `${apiUrl}/repos/${repository}/deployments/${deploymentId}/statuses`;
function readDeploymentId(body) {
  const id = body?.id;
  return typeof id === "number" || typeof id === "string" && id !== "" ? ok(String(id)) : err("The GitHub API response contained no deployment id");
}
function readDeploymentState(body) {
  const state = body?.state;
  return typeof state === "string" && state !== "" ? ok(state) : err("The GitHub API response contained no deployment state");
}

// configure-github-deployment/src/main.ts
var API_VERSION = "2022-11-28";
var input = (name) => process.env[`INPUT_${name.toUpperCase()}`] ?? process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ?? "";
async function post(url, token, payload) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (cause) {
    fail(`Request to ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    fail(`Request to ${url} failed with ${response.status} ${response.statusText}${detail === "" ? "" : `: ${detail}`}`);
  }
  try {
    return await response.json();
  } catch (cause) {
    fail(`Could not read the response from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
if (!runningInActions()) {
  fail("This action reads the workflow's GitHub context and only runs in Actions");
}
var token = input("github-token");
if (token === "")
  fail("Parameter 'github-token' is empty");
var repository = requireEnv("GITHUB_REPOSITORY");
var sha = requireEnv("GITHUB_SHA");
var apiUrl = process.env["GITHUB_API_URL"] ?? "https://api.github.com";
var serverUrl = process.env["GITHUB_SERVER_URL"] ?? "https://github.com";
var state = parseDeploymentState(input("deployment-state"));
if (!state.ok)
  fail(state.error);
var outputs = [];
var deploymentId = input("deployment-id");
if (deploymentId === "") {
  const environment = input("environment");
  const created = await post(deploymentsUrl(apiUrl, repository), token, buildCreatePayload({ repository, ref: sha, environment }));
  const id = readDeploymentId(created);
  if (!id.ok)
    fail(id.error);
  deploymentId = id.value;
  outputs.push({ name: "deployment-id", value: deploymentId });
  process.stdout.write(`Created deployment ${deploymentId} for environment '${environment}'
`);
} else {
  process.stdout.write(`Updating existing deployment ${deploymentId}
`);
}
var updated = await post(deploymentStatusesUrl(apiUrl, repository, deploymentId), token, buildStatusPayload(state.value, buildLogUrl(serverUrl, repository, sha)));
var updatedState = readDeploymentState(updated);
if (!updatedState.ok)
  fail(updatedState.error);
outputs.push({ name: "deployment-state", value: updatedState.value });
writeOutputs(outputs);
process.stdout.write(`Deployment ${deploymentId} is now '${updatedState.value}'
`);
