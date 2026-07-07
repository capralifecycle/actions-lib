#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_APIKEY=""
  INPUT_REPOSITORY=""
  INPUT_COMMIT_SHA=""
  INPUT_MIN_SEVERITY_LEVEL=""
  INPUT_FAIL_ON_SAST_SCAN=""
  INPUT_FAIL_ON_IAC_SCAN=""
  INPUT_FAIL_ON_SECRETS_SCAN=""
  INPUT_FAIL_ON_DEPENDENCY_SCAN=""
  INPUT_FAIL_ON_MALWARE_SCAN=""
  INPUT_NO_FAIL=""
  INPUT_BOT_TOKEN=""
  INPUT_CHANNEL=""
  INPUT_SERVER_URL=""
  INPUT_REPOSITORY_FULL_NAME=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --apikey)                    INPUT_APIKEY="$2"; shift; shift ;;
      --repository)                INPUT_REPOSITORY="$2"; shift; shift ;;
      --commit-sha)                INPUT_COMMIT_SHA="$2"; shift; shift ;;
      --min-severity-level)        INPUT_MIN_SEVERITY_LEVEL="$2"; shift; shift ;;
      --fail-on-sast-scan)         INPUT_FAIL_ON_SAST_SCAN="$2"; shift; shift ;;
      --fail-on-iac-scan)          INPUT_FAIL_ON_IAC_SCAN="$2"; shift; shift ;;
      --fail-on-secrets-scan)      INPUT_FAIL_ON_SECRETS_SCAN="$2"; shift; shift ;;
      --fail-on-dependency-scan)   INPUT_FAIL_ON_DEPENDENCY_SCAN="$2"; shift; shift ;;
      --fail-on-malware-scan)      INPUT_FAIL_ON_MALWARE_SCAN="$2"; shift; shift ;;
      --no-fail)                   INPUT_NO_FAIL="$2"; shift; shift ;;
      --bot-token)                 INPUT_BOT_TOKEN="$2"; shift; shift ;;
      --channel)                   INPUT_CHANNEL="$2"; shift; shift ;;
      --server-url)                INPUT_SERVER_URL="$2"; shift; shift ;;
      --repository-full-name)      INPUT_REPOSITORY_FULL_NAME="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  echo "::add-mask::$INPUT_APIKEY"
  echo "::add-mask::$INPUT_BOT_TOKEN"
  if [ "$INPUT_APIKEY" = "" ]; then
    echo "Parameter 'apikey' is empty"; exit 1
  fi
  if [ "$INPUT_REPOSITORY" = "" ]; then
    echo "Parameter 'repository' is empty"; exit 1
  fi
  if [ "$INPUT_COMMIT_SHA" = "" ]; then
    echo "Parameter 'commit-sha' is empty"; exit 1
  fi
  if [ "$INPUT_BOT_TOKEN" = "" ]; then
    echo "Parameter 'bot-token' is empty"; exit 1
  fi
  if [ "$INPUT_CHANNEL" = "" ]; then
    echo "Parameter 'channel' is empty"; exit 1
  fi
  readonly INPUT_APIKEY INPUT_REPOSITORY INPUT_COMMIT_SHA INPUT_MIN_SEVERITY_LEVEL \
    INPUT_FAIL_ON_SAST_SCAN INPUT_FAIL_ON_IAC_SCAN INPUT_FAIL_ON_SECRETS_SCAN \
    INPUT_FAIL_ON_DEPENDENCY_SCAN INPUT_FAIL_ON_MALWARE_SCAN INPUT_NO_FAIL \
    INPUT_BOT_TOKEN INPUT_CHANNEL INPUT_SERVER_URL INPUT_REPOSITORY_FULL_NAME
  export INPUT_APIKEY INPUT_REPOSITORY INPUT_COMMIT_SHA INPUT_MIN_SEVERITY_LEVEL \
    INPUT_FAIL_ON_SAST_SCAN INPUT_FAIL_ON_IAC_SCAN INPUT_FAIL_ON_SECRETS_SCAN \
    INPUT_FAIL_ON_DEPENDENCY_SCAN INPUT_FAIL_ON_MALWARE_SCAN INPUT_NO_FAIL \
    INPUT_BOT_TOKEN INPUT_CHANNEL INPUT_SERVER_URL INPUT_REPOSITORY_FULL_NAME
}

build_scan_args() {
  scan_args=("scan-release" "$INPUT_REPOSITORY" "$INPUT_COMMIT_SHA" "--apikey" "$INPUT_APIKEY")
  if [ "$INPUT_MIN_SEVERITY_LEVEL" != "" ]; then
    scan_args+=("--minimum-severity-level" "$INPUT_MIN_SEVERITY_LEVEL")
  fi
  [ "$INPUT_FAIL_ON_SAST_SCAN" = "true" ] && scan_args+=("--fail-on-sast-scan")
  [ "$INPUT_FAIL_ON_IAC_SCAN" = "true" ] && scan_args+=("--fail-on-iac-scan")
  [ "$INPUT_FAIL_ON_SECRETS_SCAN" = "true" ] && scan_args+=("--fail-on-secrets-scan")
  [ "$INPUT_FAIL_ON_DEPENDENCY_SCAN" = "false" ] && scan_args+=("--no-fail-on-dependency-scan")
  [ "$INPUT_FAIL_ON_MALWARE_SCAN" = "true" ] && scan_args+=("--fail-on-malware-scan")
  true
}

build_slack_payload() {
  local issues="$1"
  local diff_url="$2"
  local short_sha="${INPUT_COMMIT_SHA:0:7}"
  local commit_url="$INPUT_SERVER_URL/$INPUT_REPOSITORY_FULL_NAME/commit/$INPUT_COMMIT_SHA"
  slack_payload="$(jq -n \
    --arg text "Aikido scan on <$commit_url|$INPUT_REPOSITORY ($short_sha)> found *$issues* issues: $diff_url" \
    '{text: $text}')"
}

post_to_slack() {
  if ! curl \
    --fail \
    --silent \
    --show-error \
    --request POST \
    --header "Authorization: Bearer $INPUT_BOT_TOKEN" \
    --header "Content-Type: application/json; charset=utf-8" \
    --data "$(jq -c --arg channel "$INPUT_CHANNEL" '. + {channel: $channel}' <<< "$slack_payload")" \
    "https://slack.com/api/chat.postMessage" \
    -o /tmp/aikido-scan-slack-response.json; then
    echo "Failed to post message to Slack" >&2
    exit 1
  fi
  if [ "$(jq --raw-output ".ok" /tmp/aikido-scan-slack-response.json)" != "true" ]; then
    echo "Slack responded with an error: $(jq --raw-output ".error" /tmp/aikido-scan-slack-response.json)" >&2
    exit 1
  fi
}

main() {
  parse_args "$@"
  build_scan_args

  log_file="$(mktemp)"
  set +e
  aikido-api-client "${scan_args[@]}" 2>&1 | tee "$log_file"
  scan_exit_code="${PIPESTATUS[0]}"
  set -e

  issues="$(grep -oP 'Open issues found: \K\d+' "$log_file" || true)"
  diff_url="$(grep -oP 'Diff url: \K\S+' "$log_file" || true)"
  issues="${issues:-0}"

  {
    echo "issues-found=$issues"
    echo "diff-url=$diff_url"
    echo "scan-exit-code=$scan_exit_code"
  } >> "$GITHUB_OUTPUT"

  if [ "$scan_exit_code" != "0" ]; then
    build_slack_payload "$issues" "$diff_url"
    post_to_slack
    {
      echo "slack-payload<<AIKIDO_SCAN_EOF"
      echo "$slack_payload"
      echo "AIKIDO_SCAN_EOF"
    } >> "$GITHUB_OUTPUT"

    if [ "$INPUT_NO_FAIL" = "true" ]; then
      echo "Aikido scan found issues (exit code $scan_exit_code), but 'no-fail' is enabled so the action will not fail"
      exit 0
    fi
    exit "$scan_exit_code"
  fi
}

main "$@"
