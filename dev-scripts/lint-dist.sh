#!/usr/bin/env bash

# Check that the committed bundles match their sources, exit with 1 if not.
#
# GitHub runs dist/ as committed and never builds the action, so a stale bundle
# ships the previous behaviour without any other signal.

set -euo pipefail

script_dir="$(dirname "${BASH_SOURCE[0]}")"
cd "$script_dir/.." || exit 1

build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT

status=0
for entrypoint in ./*/src/main.ts; do
  action="$(basename "$(dirname "$(dirname "$entrypoint")")")"
  bun build "$entrypoint" --target=node --outfile "$build_dir/$action.mjs"
  diff -u "$action/dist/index.mjs" "$build_dir/$action.mjs" || status=1
done

if [ "$status" -ne 0 ]; then
  cat <<'MSG'
The committed bundles are not up-to-date. Run the following command to update:
make dist
MSG
fi
exit "$status"
