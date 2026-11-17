import { describe, expect, test } from "bun:test"

import { type Output, renderOutputs } from "./actions.ts"

/**
 * Reads a `GITHUB_OUTPUT` file the way the runner does: `name=value` on one
 * line, or `name<<DELIMITER` followed by lines up to one that is exactly the
 * delimiter. Whichever of `=` and `<<` comes first decides the form.
 */
function parseOutputFile(file: string): Record<string, string> {
  const lines = file.split("\n")
  const outputs: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    if (line === "") continue
    const equals = line.indexOf("=")
    const heredoc = line.indexOf("<<")
    if (equals !== -1 && (heredoc === -1 || equals < heredoc)) {
      outputs[line.slice(0, equals)] = line.slice(equals + 1)
      continue
    }
    const delimiter = line.slice(heredoc + 2)
    const end = lines.indexOf(delimiter, i + 1)
    if (end === -1) throw new Error(`unterminated output '${line}'`)
    outputs[line.slice(0, heredoc)] = lines.slice(i + 1, end).join("\n")
    i = end
  }
  return outputs
}

const roundTrip = (outputs: readonly Output[]): Record<string, string> =>
  parseOutputFile(renderOutputs(outputs))

describe("rendering outputs", () => {
  test("writes one newline-terminated name=value line per output", () => {
    expect(renderOutputs([{ name: "tag", value: "v1" }])).toBe("tag=v1\n")
  })

  test("keeps the given order, so a caller controls it", () => {
    expect(
      renderOutputs([
        { name: "b", value: "2" },
        { name: "a", value: "1" },
      ]),
    ).toBe("b=2\na=1\n")
  })

  test("renders nothing at all when there are no outputs", () => {
    expect(renderOutputs([])).toBe("")
  })

  test("keeps a value with an = in it whole", () => {
    expect(roundTrip([{ name: "a", value: "x=y" }])).toEqual({ a: "x=y" })
  })

  test("carries a value across lines without it setting another output", () => {
    const outputs = [
      { name: "roleName", value: "main\nartifactBucket=elsewhere" },
      { name: "artifactBucket", value: "artifacts" },
    ]
    expect(roundTrip(outputs)).toEqual({
      roleName: "main\nartifactBucket=elsewhere",
      artifactBucket: "artifacts",
    })
  })

  test.each([
    ["ends in a newline", "a\n"],
    ["is only newlines", "\n\n"],
    ["holds a line that looks like a delimiter", "EOF\nmore"],
    ["holds several such lines", "EOF\nEOF_\nEOF__"],
  ])("round-trips a value that %s", (_, value) => {
    expect(roundTrip([{ name: "v", value }])).toEqual({ v: value })
  })
})
