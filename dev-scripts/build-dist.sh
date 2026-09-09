#!/usr/bin/env bash

# Bundle each TypeScript action into the single file GitHub executes at runtime.

set -euo pipefail

script_dir="$(dirname "${BASH_SOURCE[0]}")"
cd "$script_dir/.." || exit 1

for entrypoint in ./*/src/main.ts; do
  action="$(basename "$(dirname "$(dirname "$entrypoint")")")"
  bun build "$entrypoint" --target=node --outfile "$action/dist/index.mjs"
done
