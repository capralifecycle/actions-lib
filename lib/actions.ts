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

export const renderOutputs = (outputs: readonly Output[]): string =>
  outputs.map((output) => `${output.name}=${output.value}\n`).join("")

export function writeOutputs(outputs: readonly Output[]): void {
  appendFileSync(requireEnv("GITHUB_OUTPUT"), renderOutputs(outputs))
}
