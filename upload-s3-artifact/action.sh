#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_AWS_S3_BUCKET_NAME=""
  INPUT_AWS_S3_KEY=""
  INPUT_AWS_S3_KEY_PREFIX=""
  INPUT_TARGET_PATH=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --aws-s3-bucket-name)     INPUT_AWS_S3_BUCKET_NAME="$2"; shift; shift ;;
      --aws-s3-key) INPUT_AWS_S3_KEY="$2"; shift; shift ;;
      --aws-s3-key-prefix) INPUT_AWS_S3_KEY_PREFIX="$2"; shift; shift ;;
      --target-path) INPUT_TARGET_PATH="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  if [ "$INPUT_AWS_S3_BUCKET_NAME" = "" ]; then
    echo "Parameter 'aws-s3-bucket-name' is empty"; exit 1
  fi
  if [ "$INPUT_TARGET_PATH" = "" ]; then
    echo "Parameter 'target-path' is empty"; exit 1
  fi
  readonly INPUT_AWS_S3_BUCKET_NAME INPUT_AWS_S3_KEY INPUT_AWS_S3_KEY_PREFIX INPUT_TARGET_PATH
  export INPUT_AWS_S3_BUCKET_NAME INPUT_AWS_S3_KEY INPUT_AWS_S3_KEY_PREFIX INPUT_TARGET_PATH
}

main() {
  parse_args "$@"
  if [ -f "$INPUT_TARGET_PATH" ]; then
    echo "Found file at path '$INPUT_TARGET_PATH'"
    file_path="$INPUT_TARGET_PATH"
  elif [ -d "$INPUT_TARGET_PATH" ]; then
    echo "Found directory at path '$INPUT_TARGET_PATH'"
    echo "Zipping directory before uploading to S3"
    tmp_dir="/tmp/${GITHUB_ACTION:-$(date -u +%s)}"
    mkdir -p "$tmp_dir"
    file_path="$tmp_dir/target.zip"
    (cd "$INPUT_TARGET_PATH" && zip -r "$file_path" .;)
  else
    echo "No file or directory at path '$INPUT_TARGET_PATH'"
    exit 1
  fi
  checksum="$(sha256sum "$file_path" | cut -d' ' -f1)"
  filename="$(basename "$file_path")"
  # NOTE: Get the last extension, if any
  extension="$(echo "$filename" | sed -n 's/^.*\.\(.*\)$/\1/p')"
  default_aws_s3_key="$checksum${extension:+.}${extension:-}"
  aws_s3_key="${INPUT_AWS_S3_KEY_PREFIX}${INPUT_AWS_S3_KEY:-$default_aws_s3_key}"
  aws s3 cp "$file_path" "s3://$INPUT_AWS_S3_BUCKET_NAME/${aws_s3_key}"
  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "aws-s3-key=$aws_s3_key" >> "$GITHUB_OUTPUT"
  fi
}

main "$@"
