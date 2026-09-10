import { existsSync, readFileSync } from "node:fs"
import { parseArgs } from "node:util"

import {
  fail,
  renderOutputs,
  runningInActions,
  writeOutputs,
} from "../../lib/actions.ts"
import { parseConfig } from "./config.ts"

const inActions = runningInActions()

interface Source {
  readonly config: string
  readonly configFile: string
}

// GitHub upper-cases input names but leaves their hyphens intact.
const sourceFromEnvironment = (): Source => ({
  config: process.env["INPUT_CONFIG"] ?? "",
  configFile: process.env["INPUT_CONFIG-FILE"] ?? "",
})

function sourceFromArgv(): Source {
  let values
  try {
    ;({ values } = parseArgs({
      options: {
        config: { type: "string", default: "" },
        "config-file": { type: "string", default: "" },
      },
    }))
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
  }
  return { config: values.config, configFile: values["config-file"] }
}

/** `config` wins over `config-file`; the two inputs are mutually exclusive. */
function read({ config, configFile }: Source): string {
  if (config !== "") return config
  if (configFile === "") {
    fail("No configuration or configuration file supplied")
  }
  if (!existsSync(configFile)) {
    fail(`The configuration file '${configFile}' does not exist`)
  }
  process.stdout.write(`Reading configuration from '${configFile}'\n`)
  return readFileSync(configFile, "utf8")
}

const source = inActions ? sourceFromEnvironment() : sourceFromArgv()

const outputs = parseConfig(read(source))
if (!outputs.ok) fail(outputs.error)

if (inActions) {
  writeOutputs(outputs.value)
  process.stdout.write(
    `Parsed configuration into ${outputs.value.length} output(s): ` +
      `${outputs.value.map((output) => output.name).join(", ")}\n`,
  )
} else {
  process.stdout.write(renderOutputs(outputs.value))
}
