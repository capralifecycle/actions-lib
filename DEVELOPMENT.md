# Development

## Conventions

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

A small Python script is used to automatically update the README with names, descriptions and metadata associated with each action. CI checks if the README is up-to-date, and if not prompts you to manually update the README using `generate-docs.py`.

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
