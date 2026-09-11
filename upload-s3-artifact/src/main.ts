import { readFileSync, statSync } from "node:fs"
import { basename } from "node:path"
import { parseArgs } from "node:util"

import { fail, runningInActions, writeOutputs } from "../../lib/actions.ts"
import { sha256, zipDirectory } from "../../lib/archive.ts"
import { putObject } from "../../lib/aws.ts"
import { extensionOf, s3Key } from "./key.ts"

const INPUT_NAMES = [
  "aws-s3-bucket-name",
  "aws-s3-key",
  "aws-s3-key-prefix",
  "target-path",
] as const

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
const targetPath = inputs["target-path"] ?? ""
if (bucket === "") fail("Parameter 'aws-s3-bucket-name' is empty")
if (targetPath === "") fail("Parameter 'target-path' is empty")

function read(path: string): { content: Uint8Array; filename: string } {
  let stats
  try {
    stats = statSync(path)
  } catch {
    fail(`No file or directory at path '${path}'`)
  }
  if (stats.isDirectory()) {
    process.stdout.write(`Found directory at path '${path}', zipping it\n`)
    const archive = zipDirectory(path)
    if (!archive.ok) fail(archive.error)
    return { content: archive.value, filename: "target.zip" }
  }
  process.stdout.write(`Found file at path '${path}'\n`)
  return { content: new Uint8Array(readFileSync(path)), filename: basename(path) }
}

const { content, filename } = read(targetPath)

const key = s3Key({
  explicitKey: inputs["aws-s3-key"] ?? "",
  prefix: inputs["aws-s3-key-prefix"] ?? "",
  checksum: sha256(content),
  extension: extensionOf(filename),
})

process.stdout.write(
  `Uploading ${content.byteLength} bytes to s3://${bucket}/${key}\n`,
)
try {
  await putObject({ bucket, key, body: content })
} catch (cause) {
  fail(
    `Failed to upload to s3://${bucket}/${key}: ${cause instanceof Error ? cause.message : String(cause)}`,
  )
}

if (inActions) {
  writeOutputs([{ name: "aws-s3-key", value: key }])
} else {
  process.stdout.write(`${key}\n`)
}
