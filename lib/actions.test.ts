import { describe, expect, test } from "bun:test"

import { renderOutputs } from "./actions.ts"

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
})
