#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_TAG_TYPE=""
  INPUT_TAG_PREFIX=""
  INPUT_MAX_LENGTH="256"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --tag-type)     INPUT_TAG_TYPE="$2"; shift; shift ;;
      --tag-prefix)   INPUT_TAG_PREFIX="$2"; shift; shift ;;
      --max-length)   INPUT_MAX_LENGTH="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  if [ "$INPUT_TAG_TYPE" = "" ]; then
    echo "Parameter 'tag-type' is empty"; exit 1
  fi
  readonly INPUT_TAG_TYPE INPUT_TAG_PREFIX INPUT_MAX_LENGTH
  export INPUT_TAG_TYPE INPUT_TAG_PREFIX INPUT_MAX_LENGTH
}

main() {
  parse_args "$@"
  if [ "$INPUT_TAG_TYPE" = "punctuated-timestamp-tag" ]; then
    date="$(date -u "+%Y%m%d.%H%M%S")"
    tag="${INPUT_TAG_PREFIX:-}${INPUT_TAG_PREFIX:+.}$date"
    tag_length="${#tag}"
    if [ "$tag_length" -gt "$INPUT_MAX_LENGTH" ]; then
      echo "Maximum tag length $INPUT_MAX_LENGTH has been exceeded"
      exit 1
    fi
  elif [ "$INPUT_TAG_TYPE" = "hyphenated-alphanumeric-tag" ]; then
    echo
    timestamp="$(date -u "+%Y%m%d-%H%M%Sz")"
    if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
      short_sha="$(echo "$GITHUB_SHA" | cut -c -8)"
      build_id="$GITHUB_RUN_ID"
      sanitized_branch_name="${GITHUB_REF#refs/heads/}"
      sanitized_branch_name="${sanitized_branch_name//[^a-zA-Z0-9_-]/}"
    else
      short_sha="$(git show -s --format="%H" | cut -c -8)"
      build_id="local"
      sanitized_branch_name="$(git rev-parse --abbrev-ref HEAD | sed "s/[^a-zA-Z0-9_-]//g")"
    fi
    tag_length_without_branch_name="$(echo "${INPUT_TAG_PREFIX:-}${INPUT_TAG_PREFIX:+-}$timestamp-$build_id-$short_sha-" | wc -c)"
    min_branch_name_characters="$(test "${#sanitized_branch_name}" -lt "10" && echo "${#sanitized_branch_name}" || echo "10")"
    available_branch_name_characters="$((INPUT_MAX_LENGTH - tag_length_without_branch_name))"
    if [ "$available_branch_name_characters" -lt "$min_branch_name_characters" ]; then
      echo "The tag exceeds the maximum length of $INPUT_MAX_LENGTH characters by $(( min_branch_name_characters - available_branch_name_characters )) character(s)"
      exit 1
    fi
    tag="${INPUT_TAG_PREFIX:-}${INPUT_TAG_PREFIX:+-}$timestamp-$build_id-$short_sha-${sanitized_branch_name:0:$available_branch_name_characters}"
  else
    echo "Unknown tag type '$INPUT_TAG_TYPE'"; exit 1
  fi

  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "tag=$tag" >> "$GITHUB_OUTPUT"
  else
    echo "$tag"
  fi
}

main "$@"
