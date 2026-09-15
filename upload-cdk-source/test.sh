#!/usr/bin/env bash

# Fixture and assertions for this action, driven from
# .github/workflows/tests.yml.
#
#   arrange  Builds a CDK application directory, and reports its path as the
#            step output `dir`. Needs RUNNER_TEMP and GITHUB_OUTPUT.
#   assert   Checks the archive named by the metadata file is in the bucket and
#            holds the application's sources and nothing else. Needs
#            ARTIFACT_BUCKET and METADATA_FILE.

set -euo pipefail
IFS=$'\n\t'

# A RETURN trap fires after the function's locals are gone, so the directory to
# remove is kept here and cleaned up when the script exits.
work=""
cleanup() {
  if [ -n "$work" ]; then
    rm -rf "$work"
  fi
}
trap cleanup EXIT

require() {
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      echo "$name is not set" >&2
      exit 1
    fi
  done
}

arrange() {
  require RUNNER_TEMP GITHUB_OUTPUT

  local app
  app="$(mktemp -d "$RUNNER_TEMP/cdk-app-XXXXXX")"
  mkdir -p "$app/src" "$app/node_modules" "$app/cdk.out"
  echo '{}' >"$app/cdk.json"
  echo '{}' >"$app/package.json"
  echo 'export const app = 1' >"$app/src/app.ts"
  # Neither of these belongs in the archive: one is restored by the pipeline,
  # the other is produced by it.
  echo 'a dependency' >"$app/node_modules/ignored.js"
  echo 'a previous build' >"$app/cdk.out/stack.json"

  echo "dir=$app" >>"$GITHUB_OUTPUT"
}

assert() {
  require ARTIFACT_BUCKET METADATA_FILE

  test -f "$METADATA_FILE"
  local bucket key
  bucket="$(jq --exit-status --raw-output ".bucketName" "$METADATA_FILE")"
  key="$(jq --exit-status --raw-output ".bucketKey" "$METADATA_FILE")"
  test "$bucket" = "$ARTIFACT_BUCKET"

  aws s3api head-object --bucket "$ARTIFACT_BUCKET" --key "$key" >/dev/null

  work="$(mktemp -d)"
  aws s3 cp "s3://$ARTIFACT_BUCKET/$key" "$work/cdk-source.zip" >/dev/null
  unzip -Z1 "$work/cdk-source.zip" | sort >"$work/entries"
  cat "$work/entries"

  local wanted unwanted
  for wanted in "cdk.json" "package.json" "src/app.ts"; do
    if ! grep -qx "$wanted" "$work/entries"; then
      echo "'$wanted' is missing from the archive" >&2
      exit 1
    fi
  done
  for unwanted in "node_modules" "cdk.out"; do
    if grep -q "$unwanted" "$work/entries"; then
      echo "'$unwanted' should not be in the archive" >&2
      exit 1
    fi
  done
}

main() {
  case "${1:-}" in
  arrange) arrange ;;
  assert) assert ;;
  *)
    echo "Usage: $0 arrange|assert" >&2
    exit 1
    ;;
  esac
}

main "$@"
