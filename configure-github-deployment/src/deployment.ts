import { type Result, err, ok } from "../../lib/result.ts"

/** The states the GitHub Deployments API accepts for a deployment status. */
export const DEPLOYMENT_STATES = [
  "error",
  "failure",
  "inactive",
  "in_progress",
  "queued",
  "pending",
  "success",
] as const

export type DeploymentState = (typeof DEPLOYMENT_STATES)[number]

export function parseDeploymentState(value: string): Result<DeploymentState> {
  const match = DEPLOYMENT_STATES.find((candidate) => candidate === value)
  return match ? ok(match) : err(`Invalid deployment state '${value}'`)
}

export interface CreateDeploymentRequest {
  readonly repository: string
  readonly ref: string
  readonly environment: string
}

export interface CreateDeploymentPayload {
  readonly ref: string
  readonly auto_merge: boolean
  readonly required_contexts: readonly string[]
  readonly environment: string
  readonly task: string
}

/**
 * `auto_merge` off and no required contexts, because the commit being deployed
 * has already been built: letting GitHub merge the base branch in or gate on
 * other checks would deploy something other than what was tested.
 */
export const buildCreatePayload = (
  request: CreateDeploymentRequest,
): CreateDeploymentPayload => ({
  ref: request.ref,
  auto_merge: false,
  required_contexts: [],
  environment: request.environment,
  task: `deploy:${request.repository}`,
})

export interface DeploymentStatusPayload {
  readonly state: DeploymentState
  readonly log_url: string
  readonly auto_inactive: boolean
}

export const buildStatusPayload = (
  state: DeploymentState,
  logUrl: string,
): DeploymentStatusPayload => ({
  state,
  log_url: logUrl,
  auto_inactive: true,
})

/** Where GitHub sends someone who clicks through from the deployment. */
export const buildLogUrl = (
  serverUrl: string,
  repository: string,
  sha: string,
): string => `${serverUrl}/${repository}/commit/${sha}/checks`

export const deploymentsUrl = (apiUrl: string, repository: string): string =>
  `${apiUrl}/repos/${repository}/deployments`

export const deploymentStatusesUrl = (
  apiUrl: string,
  repository: string,
  deploymentId: string,
): string => `${apiUrl}/repos/${repository}/deployments/${deploymentId}/statuses`

/** The API returns the id as a number; every later use of it is as a string. */
export function readDeploymentId(body: unknown): Result<string> {
  const id = (body as { id?: unknown } | null)?.id
  return typeof id === "number" || (typeof id === "string" && id !== "")
    ? ok(String(id))
    : err("The GitHub API response contained no deployment id")
}

export function readDeploymentState(body: unknown): Result<string> {
  const state = (body as { state?: unknown } | null)?.state
  return typeof state === "string" && state !== ""
    ? ok(state)
    : err("The GitHub API response contained no deployment state")
}
