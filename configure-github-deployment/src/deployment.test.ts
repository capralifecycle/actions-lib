import { describe, expect, test } from "bun:test"

import {
  DEPLOYMENT_STATES,
  buildCreatePayload,
  buildLogUrl,
  buildStatusPayload,
  deploymentStatusesUrl,
  deploymentsUrl,
  parseDeploymentState,
  readDeploymentId,
  readDeploymentState,
} from "./deployment.ts"

describe("the deployment state", () => {
  test("is accepted when the API knows it", () => {
    for (const state of DEPLOYMENT_STATES) {
      expect(parseDeploymentState(state)).toEqual({ ok: true, value: state })
    }
  })

  test("is rejected when it is not one the API accepts", () => {
    expect(parseDeploymentState("cancelled")).toEqual({
      ok: false,
      error: "Invalid deployment state 'cancelled'",
    })
  })

  test("is rejected when it is empty, which is what an unset default looks like", () => {
    expect(parseDeploymentState("")).toEqual({
      ok: false,
      error: "Invalid deployment state ''",
    })
  })
})

describe("the create-deployment payload", () => {
  const payload = buildCreatePayload({
    repository: "an-org/my-repo",
    ref: "abcdef1234567890",
    environment: "production",
  })

  test("deploys the exact commit the workflow is running for", () => {
    expect(payload.ref).toBe("abcdef1234567890")
  })

  test("names the task after the repository", () => {
    expect(payload.task).toBe("deploy:an-org/my-repo")
  })

  test("never lets GitHub merge or gate the deployment itself", () => {
    expect(payload.auto_merge).toBe(false)
    expect(payload.required_contexts).toEqual([])
  })
})

describe("the deployment status payload", () => {
  test("carries the state and lets GitHub retire older deployments", () => {
    expect(buildStatusPayload("success", "https://log")).toEqual({
      state: "success",
      log_url: "https://log",
      auto_inactive: true,
    })
  })
})

describe("urls", () => {
  test("point at the commit's checks so the deployment links somewhere useful", () => {
    expect(buildLogUrl("https://github.com", "an-org/my-repo", "abc")).toBe(
      "https://github.com/an-org/my-repo/commit/abc/checks",
    )
  })

  test("address the deployments collection of the repository", () => {
    expect(deploymentsUrl("https://api.github.com", "an-org/my-repo")).toBe(
      "https://api.github.com/repos/an-org/my-repo/deployments",
    )
  })

  test("address the statuses of one deployment", () => {
    expect(
      deploymentStatusesUrl("https://api.github.com", "an-org/my-repo", "42"),
    ).toBe("https://api.github.com/repos/an-org/my-repo/deployments/42/statuses")
  })
})

describe("reading the API response", () => {
  test("takes the deployment id, which arrives as a number", () => {
    expect(readDeploymentId({ id: 42 })).toEqual({ ok: true, value: "42" })
  })

  test("fails rather than carrying on with a missing id", () => {
    expect(readDeploymentId({}).ok).toBe(false)
    expect(readDeploymentId(null).ok).toBe(false)
    expect(readDeploymentId({ id: null }).ok).toBe(false)
  })

  test("takes the state the API settled on", () => {
    expect(readDeploymentState({ state: "inactive" })).toEqual({
      ok: true,
      value: "inactive",
    })
  })

  test("fails rather than reporting an empty state", () => {
    expect(readDeploymentState({ state: "" }).ok).toBe(false)
    expect(readDeploymentState({}).ok).toBe(false)
  })
})
