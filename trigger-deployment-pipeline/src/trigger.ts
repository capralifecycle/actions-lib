import { type Result, err, ok } from "../../lib/result.ts"

export const TRIGGER_TYPES = ["cdk-source", "cloud-assembly", "artifact"] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

/** Where the pipeline reads the variables an artifact trigger sets. */
export const ARTIFACT_PARAMETER_NAMESPACE = "/liflig-cdk/default/pipeline-variables"

export interface RawInputs {
  readonly bucket: string
  readonly pipelines: string
  readonly triggerType: string
  readonly cdkSourceMetadataFile: string
  readonly cloudAssemblyMetadataFile: string
  readonly artifactParameters: string
}

export interface Inputs {
  readonly bucket: string
  readonly pipelines: readonly string[]
  readonly triggerType: TriggerType
  /** The metadata file uploaded beside each trigger, when the type has one. */
  readonly metadataFile: string | undefined
  readonly artifactParameters: readonly ArtifactParameter[]
}

export interface ArtifactParameter {
  readonly name: string
  readonly value: string
}

/** Space-separated, as the inputs are written; runs of whitespace are one gap. */
const words = (value: string): string[] => value.split(/\s+/).filter(Boolean)

/**
 * Splits `name=value` the way `cut -d= -f1` and `cut -d= -f2` did, which is
 * narrower than it looks: a value containing `=` is cut at its first `=`, and a
 * word with no `=` at all yields the whole word as both name and value, since
 * `cut` prints a line without the delimiter unchanged.
 */
export function parseArtifactParameter(word: string): ArtifactParameter {
  const fields = word.split("=")
  return fields.length === 1
    ? { name: word, value: word }
    : { name: fields[0] as string, value: fields[1] as string }
}

export function parseInputs(
  raw: RawInputs,
  fileExists: (path: string) => boolean,
): Result<Inputs> {
  if (raw.bucket === "") return err("Parameter 'aws-s3-bucket-name' is empty")
  if (raw.pipelines === "") return err("Parameter 'pipelines' is empty")
  if (raw.triggerType === "") return err("Parameter 'trigger-type' is empty")

  const triggerType = TRIGGER_TYPES.find((type) => type === raw.triggerType)
  if (triggerType === undefined) {
    return err(
      `Parameter 'trigger-type' must be one of ${TRIGGER_TYPES.map((t) => `'${t}'`).join(", ")}, got '${raw.triggerType}'`,
    )
  }

  let metadataFile: string | undefined
  if (triggerType === "cdk-source") {
    if (raw.cdkSourceMetadataFile === "") {
      return err(
        "Parameter 'cdk-source-metadata-file' must be set when parameter 'trigger-type' is 'cdk-source'",
      )
    }
    if (!fileExists(raw.cdkSourceMetadataFile)) {
      return err(
        `File '${raw.cdkSourceMetadataFile}' describing the CDK source does not exist`,
      )
    }
    metadataFile = raw.cdkSourceMetadataFile
  }
  if (triggerType === "cloud-assembly") {
    if (raw.cloudAssemblyMetadataFile === "") {
      return err(
        "Parameter 'cloud-assembly-metadata-file' must be set when parameter 'trigger-type' is 'cloud-assembly'",
      )
    }
    if (!fileExists(raw.cloudAssemblyMetadataFile)) {
      return err(
        `File '${raw.cloudAssemblyMetadataFile}' describing the Cloud Assembly does not exist`,
      )
    }
    metadataFile = raw.cloudAssemblyMetadataFile
  }
  if (triggerType === "artifact" && raw.artifactParameters === "") {
    return err(
      "Parameter 'artifact-parameters' must be set when parameter 'trigger-type' is 'artifact'",
    )
  }

  return ok({
    bucket: raw.bucket,
    pipelines: words(raw.pipelines),
    triggerType,
    metadataFile,
    artifactParameters:
      triggerType === "artifact"
        ? words(raw.artifactParameters).map(parseArtifactParameter)
        : [],
  })
}

/** `refs/heads/` is stripped; any other ref, a tag or a pull request, is kept. */
export const branchFromRef = (ref: string): string =>
  ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref

/** `owner/name`, where the name may itself contain slashes. */
export function splitRepository(repository: string): {
  owner: string
  name: string
} {
  const slash = repository.indexOf("/")
  return slash === -1
    ? { owner: repository, name: repository }
    : { owner: repository.slice(0, slash), name: repository.slice(slash + 1) }
}

/** Owner and name from a GitHub remote, in either its SSH or its HTTPS form. */
export function repositoryFromRemote(
  remote: string,
): { owner: string; name: string } | undefined {
  const match = /github\.com[/:](.*)\/(.*?)(\.git)?$/.exec(remote.trim())
  return match ? { owner: match[1] as string, name: match[2] as string } : undefined
}

/**
 * `date -u +'%Y-%m-%dT%H:%M:%SZ'`: whole seconds, which is what the consumers
 * of the trigger file have always been given.
 */
export const utcSeconds = (now: Date): string =>
  `${now.toISOString().slice(0, 19)}Z`

/** A deliberately loose check that what the API returned looks like a date. */
export const looksLikeDate = (value: string): boolean => /^[0-9]{4,}-/.test(value)

export interface TriggerContext {
  readonly type: "GITHUB_ACTIONS" | "LOCAL"
  readonly triggeredBy: string
  readonly startTime: string
  readonly stopTime: string
  readonly commitAuthor: string
  readonly branchName: string
  readonly commitHash: string
  readonly repositoryName: string
  readonly repositoryOwner: string
}

/**
 * The file whose upload starts a pipeline. A deployed notification handler
 * parses it and gates on `version`, so its shape is a contract, not a detail.
 */
export function buildTrigger(context: TriggerContext): string {
  return `${JSON.stringify(
    {
      version: "0.1",
      ci: {
        type: context.type,
        triggeredBy: context.triggeredBy,
        startTime: context.startTime,
        stopTime: context.stopTime,
      },
      vcs: {
        commitAuthor: context.commitAuthor,
        branchName: context.branchName,
        commitHash: context.commitHash,
        repositoryName: context.repositoryName,
        repositoryOwner: context.repositoryOwner,
      },
    },
    null,
    2,
  )}\n`
}

const METADATA_FILENAME: Record<TriggerType, string | undefined> = {
  "cdk-source": "cdk-source.json",
  "cloud-assembly": "cloud-assembly.json",
  artifact: undefined,
}

export const pipelinePrefix = (pipeline: string): string => `pipelines/${pipeline}`

export const metadataKey = (
  pipeline: string,
  triggerType: TriggerType,
): string | undefined => {
  const filename = METADATA_FILENAME[triggerType]
  return filename === undefined ? undefined : `${pipelinePrefix(pipeline)}/${filename}`
}

export const triggerKey = (pipeline: string): string =>
  `${pipelinePrefix(pipeline)}/trigger`
