import { appendFileSync } from "node:fs"

/** One of the outputs an action declares in its `action.yml`. */
export interface Output {
  readonly name: string
  readonly value: string
}

/**
 * Actions in this library double as local executables, and the two modes differ
 * in where they read inputs from and where they report results.
 */
export const runningInActions = (): boolean =>
  process.env["GITHUB_ACTIONS"] === "true"

/** Reports the reason on stderr and exits non-zero, without a stack trace. */
export function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

export const requireEnv = (name: string): string =>
  process.env[name] ?? fail(`Environment variable '${name}' is not set`)

/**
 * A value that spans lines is written between delimiters, as the runner
 * requires; written as `name=value`, its later lines would be read as further
 * outputs.
 */
function renderOutput({ name, value }: Output): string {
  if (!/[\r\n]/.test(value)) return `${name}=${value}\n`
  let delimiter = "EOF"
  while (value.includes(delimiter)) delimiter += "_"
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`
}

export const renderOutputs = (outputs: readonly Output[]): string =>
  outputs.map(renderOutput).join("")

export function writeOutputs(outputs: readonly Output[]): void {
  appendFileSync(requireEnv("GITHUB_OUTPUT"), renderOutputs(outputs))
}

/** Keeps a value out of the workflow log, wherever it is later echoed. */
export function mask(value: string): void {
  if (value !== "") process.stdout.write(`::add-mask::${value}\n`)
}
