import { parseArgs } from "node:util"

import { fail, runningInActions } from "./actions.ts"
import { type Result, err, ok } from "./result.ts"

/**
 * GitHub sets `INPUT_COMMIT-SHA` for an action on the node runtime, while a
 * composite step has to name the variable itself and underscores are the safer
 * spelling there. Both are accepted, and an unset input reads as empty.
 */
export function collectInputs<Name extends string>(
  environment: Readonly<Record<string, string | undefined>>,
  names: readonly Name[],
): Record<Name, string> {
  const lookup = (name: string): string => {
    const upper = name.toUpperCase()
    return (
      environment[`INPUT_${upper}`] ??
      environment[`INPUT_${upper.replace(/-/g, "_")}`] ??
      ""
    )
  }
  return Object.fromEntries(names.map((name) => [name, lookup(name)])) as Record<Name, string>
}

/**
 * Reads `--name value` flags for a run outside a workflow. A flag the action
 * does not take is refused rather than ignored, and an absent one reads as empty.
 */
export function parseFlags<Name extends string>(
  args: readonly string[],
  names: readonly Name[],
): Result<Record<Name, string>> {
  try {
    const { values } = parseArgs({
      args: [...args],
      options: Object.fromEntries(
        names.map((name) => [name, { type: "string", default: "" } as const]),
      ),
    })
    return ok(values as Record<Name, string>)
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : String(cause))
  }
}

/**
 * The action's inputs: from the workflow when running in Actions, otherwise
 * from the command line. `localOnly` names further flags that stand in for what
 * a workflow provides by other means, and are left unset in Actions.
 */
export function readInputs<Name extends string, Local extends string = never>(
  names: readonly Name[],
  localOnly: readonly Local[] = [],
): Record<Name, string> & Partial<Record<Local, string>> {
  if (runningInActions()) {
    return collectInputs(process.env, names) as Record<Name, string> & Partial<Record<Local, string>>
  }
  const flags = parseFlags<Name | Local>(process.argv.slice(2), [...names, ...localOnly])
  if (!flags.ok) fail(flags.error)
  return flags.value
}
