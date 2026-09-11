import { fail, requireEnv, runningInActions, writeOutputs } from "../../lib/actions.ts"
import {
  buildCreatePayload,
  buildLogUrl,
  buildStatusPayload,
  deploymentStatusesUrl,
  deploymentsUrl,
  parseDeploymentState,
  readDeploymentId,
  readDeploymentState,
} from "./deployment.ts"

const API_VERSION = "2022-11-28"

const input = (name: string): string =>
  process.env[`INPUT_${name.toUpperCase()}`] ??
  process.env[`INPUT_${name.toUpperCase().replace(/-/g, "_")}`] ??
  ""

async function post(url: string, token: string, payload: unknown): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
  } catch (cause) {
    fail(
      `Request to ${url} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    fail(
      `Request to ${url} failed with ${response.status} ${response.statusText}${detail === "" ? "" : `: ${detail}`}`,
    )
  }
  try {
    return await response.json()
  } catch (cause) {
    fail(
      `Could not read the response from ${url}: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

if (!runningInActions()) {
  fail("This action reads the workflow's GitHub context and only runs in Actions")
}

const token = input("github-token")
if (token === "") fail("Parameter 'github-token' is empty")

const repository = requireEnv("GITHUB_REPOSITORY")
const sha = requireEnv("GITHUB_SHA")
const apiUrl = process.env["GITHUB_API_URL"] ?? "https://api.github.com"
const serverUrl = process.env["GITHUB_SERVER_URL"] ?? "https://github.com"

const state = parseDeploymentState(input("deployment-state"))
if (!state.ok) fail(state.error)

const outputs: { name: string; value: string }[] = []
let deploymentId = input("deployment-id")

if (deploymentId === "") {
  const environment = input("environment")
  const created = await post(
    deploymentsUrl(apiUrl, repository),
    token,
    buildCreatePayload({ repository, ref: sha, environment }),
  )
  const id = readDeploymentId(created)
  if (!id.ok) fail(id.error)

  deploymentId = id.value
  outputs.push({ name: "deployment-id", value: deploymentId })
  process.stdout.write(
    `Created deployment ${deploymentId} for environment '${environment}'\n`,
  )
} else {
  process.stdout.write(`Updating existing deployment ${deploymentId}\n`)
}

const updated = await post(
  deploymentStatusesUrl(apiUrl, repository, deploymentId),
  token,
  buildStatusPayload(state.value, buildLogUrl(serverUrl, repository, sha)),
)
const updatedState = readDeploymentState(updated)
if (!updatedState.ok) fail(updatedState.error)

outputs.push({ name: "deployment-state", value: updatedState.value })
writeOutputs(outputs)

process.stdout.write(
  `Deployment ${deploymentId} is now '${updatedState.value}'\n`,
)
