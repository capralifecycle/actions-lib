import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { fail, runningInActions, writeOutputs } from "../../lib/actions.ts"
import { sha256, zipDirectory } from "../../lib/archive.ts"
import { putObject } from "../../lib/aws.ts"
import { buildMetadata, renderMetadata } from "./assembly.ts"

const INPUT_NAMES = ["aws-s3-bucket-name", "cdk-app-dir"] as const

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

/** Runs the CDK CLI, letting its output through as it arrives. */
function synth(directory: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["cdk", "synth"], {
      cwd: directory,
      stdio: ["ignore", "inherit", "inherit"],
    })
    child.on("error", (cause) => fail(`Failed to run 'npx cdk synth': ${cause.message}`))
    child.on("close", (code) => resolve(code ?? 1))
  })
}

const inputs = inActions ? fromEnvironment() : fromArgv()

const bucket = inputs["aws-s3-bucket-name"] ?? ""
if (bucket === "") fail("Parameter 'aws-s3-bucket-name' is empty")

const appDirectory =
  (inputs["cdk-app-dir"] ?? "") === ""
    ? (process.env["GITHUB_WORKSPACE"] ?? process.cwd())
    : (inputs["cdk-app-dir"] as string)

if (!existsSync(join(appDirectory, "cdk.json"))) {
  fail(
    `No cdk.json file found in '${appDirectory}'. Please set the 'cdk-app-dir' input to a directory containing a CDK App.`,
  )
}

// Synthesising into a directory that already holds output from another build
// would archive both, so the previous one goes first.
const outputDirectory = join(appDirectory, "cdk.out")
rmSync(outputDirectory, { recursive: true, force: true })

process.stdout.write(`Synthesising the CDK application in '${appDirectory}'\n`)
const synthExitCode = await synth(appDirectory)
if (synthExitCode !== 0) {
  fail(`'npx cdk synth' failed with exit code ${synthExitCode}`)
}

const archive = zipDirectory(outputDirectory)
if (!archive.ok) fail(archive.error)

const key = `${sha256(archive.value)}.zip`
process.stdout.write(
  `Uploading ${archive.value.byteLength} bytes of Cloud Assembly to s3://${bucket}/${key}\n`,
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
  mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cloud-assembly-")),
  "cloud-assembly.json",
)
// `aws s3api --query VersionId --output text` printed "None" for an
// unversioned bucket, and the field is written but never read.
const metadata = renderMetadata(buildMetadata(bucket, key, versionId ?? "None"))
writeFileSync(metadataFile, metadata)
process.stdout.write(`Wrote ${metadataFile}:\n${metadata}`)

if (inActions) {
  writeOutputs([{ name: "cloud-assembly-metadata-file", value: metadataFile }])
} else {
  process.stdout.write(`${metadataFile}\n`)
}
