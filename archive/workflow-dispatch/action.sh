#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_OWNER=""
  INPUT_REPO=""
  INPUT_REF=""
  INPUT_WORKFLOW_ID=""
  INPUT_SOURCE_TYPE=""
  INPUT_SOURCE_REPO=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --owner)     INPUT_OWNER="$2"; shift; shift ;;
      --repo)   INPUT_REPO="$2"; shift; shift ;;
      --ref)   INPUT_REF="$2"; shift; shift ;;
      --workflow-id)   INPUT_WORKFLOW_ID="$2"; shift; shift ;;
      --source-type)   INPUT_SOURCE_TYPE="$2"; shift; shift ;;
      --source-repo)   INPUT_SOURCE_REPO="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  if [ "$INPUT_OWNER" = "" ]; then
    echo "Parameter 'owner' is empty"; exit 1
  fi
  if [ "$INPUT_REPO" = "" ]; then
    echo "Parameter 'repo' is empty"; exit 1
  fi
  if [ "$INPUT_REF" = "" ]; then
    echo "Parameter 'ref' is empty"; exit 1
  fi
  if [ "$INPUT_WORKFLOW_ID" = "" ]; then
    echo "Parameter 'workflow-id' is empty"; exit 1
  fi
  if [ "$INPUT_SOURCE_TYPE" = "" ]; then
    echo "Parameter 'source-type' is empty"; exit 1
  fi
  if [ "$INPUT_SOURCE_REPO" = "" ]; then
    echo "Parameter 'source-repo' is empty"; exit 1
  fi

  readonly INPUT_OWNER INPUT_REPO INPUT_REF INPUT_WORKFLOW_ID INPUT_SOURCE_TYPE INPUT_SOURCE_REPO
  export INPUT_OWNER INPUT_REPO INPUT_REF INPUT_WORKFLOW_ID INPUT_SOURCE_TYPE INPUT_SOURCE_REPO
}

main() {
  parse_args "$@"

  if [ "$GITHUB_TOKEN" = "" ]; then
    echo "Env var 'GITHUB_TOKEN' is empty, cannot authenticate to target repo"; exit 1
  fi

  PAYLOAD=$(
  cat << EOF
{
  "ref": "${INPUT_REF}",
  "inputs": {
    "source_type": "${INPUT_SOURCE_TYPE}",
    "source_repo": "${INPUT_SOURCE_REPO}"
  }
}
EOF
)

  if curl -X POST \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    --fail-with-body \
    "https://api.github.com/repos/${INPUT_OWNER}/${INPUT_REPO}/actions/workflows/${INPUT_WORKFLOW_ID}/dispatches" \
    -d "$PAYLOAD"; then
    echo "Successfully triggered workflow dispatch for workflow '${INPUT_WORKFLOW_ID}' at ${INPUT_OWNER}/${INPUT_REPO}#${INPUT_REF}"
  else
    echo "Failed to trigger workflow dispatch for workflow '${INPUT_WORKFLOW_ID}' at ${INPUT_OWNER}/${INPUT_REPO}#${INPUT_REF}."
    exit 1
  fi
  }

main "$@"
