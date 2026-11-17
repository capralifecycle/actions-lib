import { existsSync, readFileSync } from "node:fs"

import {
  fail,
  renderOutputs,
  runningInActions,
  writeOutputs,
} from "../../lib/actions.ts"
import { readInputs } from "../../lib/inputs.ts"
import { parseConfig } from "./config.ts"

const inActions = runningInActions()

/** `config` wins over `config-file`; the two inputs are mutually exclusive. */
function read(config: string, configFile: string): string {
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

const inputs = readInputs(["config", "config-file"])

const outputs = parseConfig(read(inputs.config, inputs["config-file"]))
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
