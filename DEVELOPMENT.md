# Development

## Conventions

### TypeScript

New actions are written in TypeScript and run on the `node24` runtime.

```
lib/                # shared by every action, bundled into each one
<action>/
  action.yml        # runs: {using: node24, main: dist/index.mjs}
  dist/index.mjs    # bundle, committed
  src/main.ts       # reads the environment, calls the core, writes outputs
  src/<core>.ts     # pure functions
  src/<core>.test.ts
```

Keep decisions in pure functions that take their inputs as arguments, including
the clock. Confine the environment, git and the network to `main.ts`.

`lib/` holds what more than one action needs: `Result` for a failure a pure
function reports as a value, and the Actions helpers for reading the
environment, writing outputs and exiting with a message instead of a stack
trace. The bundler inlines it, so
each `dist/index.mjs` stays self-contained and there is no package to publish.
Move code there when a second action needs it, not in anticipation.

Actions are discovered by globbing `*/src/main.ts`, so `lib/` must never
contain one; a `lib/src/main.ts` would be built as an action of its own.

An action's inputs are validated in `main.ts` or the core, never assumed:
`required: true` in `action.yml` is documentation, and GitHub does not enforce
it — a missing input arrives as an empty string.

GitHub upper-cases input names but leaves their hyphens intact, so `tag-type`
arrives as `INPUT_TAG-TYPE`.

GitHub never builds the action, so run `make dist` after changing a source file
and commit the result. `make lint-dist` fails when a bundle and its source have
drifted.

```sh
make ci         # everything CI runs
make build      # bun install
make test       # bun test
make typecheck  # tsc --noEmit
make dist       # rebuild the bundles
```

`make ci` is what the workflow calls, so a green run locally is a green run in
CI. It refuses a tree where a generated file has drifted from its source, since
the bundles, the README table and the lockfile are all committed.

Bun is the package manager, bundler and test runner; there is no npm lockfile.
`bunfig.toml` pins exact versions and enforces the same minimum release age the
org Renovate preset applies to automated bumps.

### Shell scripts

Most actions are implemented as composite actions using shell scripts.

To make some of these actions usable locally the shell scripts are in isolated files that are structured in the following manner:

```sh
#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
parse_args() {
  # Set default argument values if relevant
  INPUT_MY_INPUT=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --my-input) INPUT_MY_INPUT="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  # Validate any arguments if relevant
  if [ "$INPUT_MY_INPUT" = "" ]; then
    echo "Parameter 'my-input' is empty"; exit 1
  fi
  readonly INPUT_MY_INPUT
  export INPUT_MY_INPUT
}

main() {
  parse_args "$@"
  # Do stuff
}

main "$@"
```

## Continuous Integration (CI)

All shell scripts in the repository are automatically checked using shellcheck.

Releases are made using semantic-release which checks the commit history and evaluates them according to conventional commits.

The README action table is generated from the `action.yml` metadata by [dev-scripts/generate-docs.ts](dev-scripts/generate-docs.ts). Run `make docs` after changing an action's name or description, and commit the result. `make lint-docs` runs the same generator with `--check` and fails the build when the table has drifted.

### Tests

A set of sequential tests are set up in the reusable workflow [tests.yml](.github/workflows/tests.yml) which is used by [ci.yml](.github/workflows/ci.yml). These tests loosely follow the arrange-act-assert testing pattern. Localstack is used to simulate various AWS resources. The tests use the actual actions in the library, so both the interface (i.e., inputs and outputs) as well as the underlying implementation is tested. Note that the tests run in the same environment and are thus not very well-isolated. This means that tests can affect each other, which is not entirely ideal. The actions should, however, be used together, so the tests do reflect actual usage.

For a given test you should always have a step for `act` and `assert`. You can have an initial `arrange` step if you need to do some preparations for the test (e.g., creating a local file). We should try to keep each arrange-act-assert chain as isolated as possible from other steps (e.g., avoid using outputs from another test's arrange step).

Example format for a specific test of a specific action:

```yml
- name: arrange-<action>-<test-name>
  id: arrange-<action>-<test-name>
- uses: ./<action>
  name: act-<action>-<test-name>
  id: act-<action>-<test-name>
- name: assert-<action>-<test-name>
  id: assert-<action>-<test-name>
  env:
    EXPECTED: "example"
    GOT: ${{ steps.act-<action>-<test-name>.outputs.example }}
  run: test "$GOT" = "$EXPECTED"
```
