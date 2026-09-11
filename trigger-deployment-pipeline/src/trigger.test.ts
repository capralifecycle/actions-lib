import { describe, expect, test } from "bun:test"

import {
  type RawInputs,
  branchFromRef,
  buildTrigger,
  looksLikeDate,
  metadataKey,
  parseArtifactParameter,
  parseInputs,
  repositoryFromRemote,
  splitRepository,
  triggerKey,
  utcSeconds,
} from "./trigger.ts"

const raw = (overrides: Partial<RawInputs> = {}): RawInputs => ({
  bucket: "artifacts",
  pipelines: "apps-dev core-dev",
  triggerType: "artifact",
  cdkSourceMetadataFile: "",
  cloudAssemblyMetadataFile: "",
  artifactParameters: "devTag=abc",
  ...overrides,
})

const exists = (present: string[]) => (path: string) => present.includes(path)

const error = (result: ReturnType<typeof parseInputs>): string => {
  if (result.ok) throw new Error("expected an error, got inputs")
  return result.error
}

describe("an artifact parameter", () => {
  test("splits into a name and a value at the first =", () => {
    expect(parseArtifactParameter("devTag=abc")).toEqual({ name: "devTag", value: "abc" })
  })

  test("drops everything after a second =, as cut -f2 did", () => {
    expect(parseArtifactParameter("key=a=b")).toEqual({ name: "key", value: "a" })
  })

  test("is its own value when it has no =, as cut prints such a line whole", () => {
    expect(parseArtifactParameter("lonely")).toEqual({ name: "lonely", value: "lonely" })
  })

  test("can have an empty value", () => {
    expect(parseArtifactParameter("empty=")).toEqual({ name: "empty", value: "" })
  })
})

describe("inputs are accepted", () => {
  test("for an artifact trigger, splitting both space-separated lists", () => {
    const result = parseInputs(raw({ artifactParameters: "a=1  b=2" }), exists([]))
    expect(result.ok && result.value.pipelines).toEqual(["apps-dev", "core-dev"])
    expect(result.ok && result.value.artifactParameters).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ])
  })

  test("for a cdk-source trigger whose metadata file exists", () => {
    const result = parseInputs(
      raw({ triggerType: "cdk-source", cdkSourceMetadataFile: "/m.json" }),
      exists(["/m.json"]),
    )
    expect(result.ok && result.value.metadataFile).toBe("/m.json")
  })

  test("without setting any parameters when the trigger is not an artifact", () => {
    const result = parseInputs(
      raw({ triggerType: "cloud-assembly", cloudAssemblyMetadataFile: "/c.json" }),
      exists(["/c.json"]),
    )
    expect(result.ok && result.value.artifactParameters).toEqual([])
  })
})

describe("inputs are rejected", () => {
  test("when a required parameter is empty", () => {
    expect(error(parseInputs(raw({ bucket: "" }), exists([])))).toBe(
      "Parameter 'aws-s3-bucket-name' is empty",
    )
    expect(error(parseInputs(raw({ pipelines: "" }), exists([])))).toBe(
      "Parameter 'pipelines' is empty",
    )
    expect(error(parseInputs(raw({ triggerType: "" }), exists([])))).toBe(
      "Parameter 'trigger-type' is empty",
    )
  })

  test("when the trigger type is not one the pipelines understand", () => {
    expect(error(parseInputs(raw({ triggerType: "artefact" }), exists([])))).toContain(
      "must be one of",
    )
  })

  test("when a cdk-source trigger names no metadata file", () => {
    expect(error(parseInputs(raw({ triggerType: "cdk-source" }), exists([])))).toBe(
      "Parameter 'cdk-source-metadata-file' must be set when parameter 'trigger-type' is 'cdk-source'",
    )
  })

  test("when the metadata file does not exist", () => {
    expect(
      error(
        parseInputs(
          raw({ triggerType: "cloud-assembly", cloudAssemblyMetadataFile: "/gone.json" }),
          exists([]),
        ),
      ),
    ).toBe("File '/gone.json' describing the Cloud Assembly does not exist")
  })

  test("when an artifact trigger carries no parameters", () => {
    expect(error(parseInputs(raw({ artifactParameters: "" }), exists([])))).toBe(
      "Parameter 'artifact-parameters' must be set when parameter 'trigger-type' is 'artifact'",
    )
  })
})

describe("the commit being deployed", () => {
  test("is named by branch, with refs/heads/ stripped", () => {
    expect(branchFromRef("refs/heads/main")).toBe("main")
  })

  test("keeps any other kind of ref as it is", () => {
    expect(branchFromRef("refs/tags/v1")).toBe("refs/tags/v1")
    expect(branchFromRef("refs/pull/7/merge")).toBe("refs/pull/7/merge")
  })

  test("belongs to the owner before the first slash of the repository", () => {
    expect(splitRepository("an-org/my-repo")).toEqual({ owner: "an-org", name: "my-repo" })
  })

  test("is found from either form of GitHub remote, without its .git suffix", () => {
    for (const remote of [
      "git@github.com:an-org/my-repo.git",
      "https://github.com/an-org/my-repo.git",
      "https://github.com/an-org/my-repo",
    ]) {
      expect(repositoryFromRemote(remote)).toEqual({ owner: "an-org", name: "my-repo" })
    }
  })
})

describe("times in the trigger", () => {
  test("are whole UTC seconds, as date -u printed them", () => {
    expect(utcSeconds(new Date("2026-09-11T10:20:30.456Z"))).toBe("2026-09-11T10:20:30Z")
  })

  test("are accepted from the API only when they look like a date", () => {
    expect(looksLikeDate("2026-09-11T10:00:00Z")).toBe(true)
    expect(looksLikeDate("null")).toBe(false)
    expect(looksLikeDate("")).toBe(false)
  })
})

describe("the trigger file", () => {
  const context = {
    type: "GITHUB_ACTIONS" as const,
    triggeredBy: "someone",
    startTime: "2026-09-11T10:00:00Z",
    stopTime: "2026-09-11T10:05:00Z",
    commitAuthor: "Some One",
    branchName: "main",
    commitHash: "abc123",
    repositoryName: "my-repo",
    repositoryOwner: "an-org",
  }

  test("has the version the notification handler gates on", () => {
    expect(JSON.parse(buildTrigger(context)).version).toBe("0.1")
  })

  test("carries every field the handler reads, where it reads it", () => {
    expect(JSON.parse(buildTrigger(context))).toEqual({
      version: "0.1",
      ci: {
        type: "GITHUB_ACTIONS",
        triggeredBy: "someone",
        startTime: "2026-09-11T10:00:00Z",
        stopTime: "2026-09-11T10:05:00Z",
      },
      vcs: {
        commitAuthor: "Some One",
        branchName: "main",
        commitHash: "abc123",
        repositoryName: "my-repo",
        repositoryOwner: "an-org",
      },
    })
  })

  test("stays valid JSON when a name contains a quote", () => {
    // The shell built this with a heredoc, so a quote here broke the file.
    expect(() => JSON.parse(buildTrigger({ ...context, commitAuthor: 'Ann "Nan" O' }))).not.toThrow()
  })
})

describe("S3 keys", () => {
  test("put the trigger and its metadata under the pipeline's prefix", () => {
    expect(triggerKey("apps-dev")).toBe("pipelines/apps-dev/trigger")
    expect(metadataKey("apps-dev", "cdk-source")).toBe("pipelines/apps-dev/cdk-source.json")
    expect(metadataKey("apps-dev", "cloud-assembly")).toBe(
      "pipelines/apps-dev/cloud-assembly.json",
    )
  })

  test("upload no metadata for an artifact trigger", () => {
    expect(metadataKey("apps-dev", "artifact")).toBeUndefined()
  })
})
