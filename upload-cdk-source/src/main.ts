import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { fail, runningInActions, writeOutputs } from "../../lib/actions.ts"
import { sha256, zipPaths } from "../../lib/archive.ts"
import { putObject } from "../../lib/aws.ts"
import { buildMetadata, renderMetadata, selectEntries } from "./source.ts"

const DEFAULT_INCLUDE_FILES =
  "assets cdk.json cdk.context.json package.*\\.json src tsconfig\\.json"

const INPUT_NAMES = ["aws-s3-bucket-name", "include-files", "cdk-app-dir"] as const

const inActions = runningInActions()

const fromEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    INPUT_NAMES.map((name) => {
      const upper = name.toUpperCase()
      return [
        name,
        process.env[`INPUT_${upper}`] ??
          process.env[`INPUT_${upper.replace(/-/g, "_")}`] ??
          "",
      ]
    }),
  )

function fromArgv(): Record<string, string> {
  try {
    const { values } = parseArgs({
      options: Object.fromEntries(
        INPUT_NAMES.map((name) => [name, { type: "string", default: "" }]),
      ),
    })
    return values as Record<string, string>
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
  }
}

const inputs = inActions ? fromEnvironment() : fromArgv()

const bucket = inputs["aws-s3-bucket-name"] ?? ""
if (bucket === "") fail("Parameter 'aws-s3-bucket-name' is empty")

// In a workflow the action.yml default fills this in, so an empty value means
// a caller overrode it with one, which the shell version refused too.
const includeFiles = inputs["include-files"] ?? ""
if (inActions && includeFiles === "") fail("Parameter 'include-files' is empty")
const patterns = includeFiles === "" ? DEFAULT_INCLUDE_FILES : includeFiles

const sourceDirectory =
  (inputs["cdk-app-dir"] ?? "") === ""
    ? (process.env["GITHUB_WORKSPACE"] ?? process.cwd())
    : (inputs["cdk-app-dir"] as string)

if (!existsSync(join(sourceDirectory, "cdk.json"))) {
  fail(
    `No cdk.json file found in '${sourceDirectory}'. You may need to set the 'cdk-app-dir' input.`,
  )
}

let present: string[]
try {
  present = readdirSync(sourceDirectory)
} catch (cause) {
  fail(
    `Failed to read '${sourceDirectory}': ${cause instanceof Error ? cause.message : String(cause)}`,
  )
}

const selected = selectEntries(present, patterns)
if (selected.length === 0) {
  fail(`Nothing in '${sourceDirectory}' matched the 'include-files' patterns`)
}
process.stdout.write(`Archiving ${selected.join(", ")}\n`)

const archive = zipPaths(sourceDirectory, selected)
if (!archive.ok) fail(archive.error)

const key = `${sha256(archive.value)}.zip`
process.stdout.write(
  `Uploading ${archive.value.byteLength} bytes of CDK source to s3://${bucket}/${key}\n`,
)

let versionId: string | undefined
try {
  versionId = await putObject({ bucket, key, body: archive.value })
} catch (cause) {
  fail(
    `Failed to upload to s3://${bucket}/${key}: ${cause instanceof Error ? cause.message : String(cause)}`,
  )
}
if (versionId === undefined) {
  process.stdout.write(
    `s3://${bucket} returned no version id; is versioning enabled on the bucket?\n`,
  )
}

const metadataFile = join(
  mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cdk-source-")),
  "cdk-source.json",
)
// `aws s3api --query VersionId --output text` printed "None" for an
// unversioned bucket, and the field is written but never read.
const metadata = renderMetadata(buildMetadata(bucket, key, versionId ?? "None"))
writeFileSync(metadataFile, metadata)
process.stdout.write(`Wrote ${metadataFile}:\n${metadata}`)

if (inActions) {
  writeOutputs([{ name: "cdk-source-metadata-file", value: metadataFile }])
} else {
  process.stdout.write(`${metadataFile}\n`)
}
