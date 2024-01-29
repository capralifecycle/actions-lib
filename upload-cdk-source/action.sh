#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_AWS_S3_BUCKET_NAME=""
  INPUT_CDK_SOURCE_ARCHIVE=""
  INPUT_INCLUDE_FILES='assets cdk.json cdk.context.json package.*\.json src tsconfig\.json'
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --aws-s3-bucket-name) INPUT_AWS_S3_BUCKET_NAME="$2"; shift; shift ;;
      --cdk-source-archive) INPUT_CDK_SOURCE_ARCHIVE="$2"; shift; shift ;;
      --include-files)      INPUT_INCLUDE_FILES="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  if [ "$INPUT_AWS_S3_BUCKET_NAME" = "" ]; then
    echo "Parameter 'aws-s3-bucket-name' is empty"; exit 1
  fi
  if [ "$INPUT_CDK_SOURCE_ARCHIVE" = "" ]; then
    echo "Parameter 'cdk-source-archive' is empty"; exit 1
  fi
  if [ "$INPUT_INCLUDE_FILES" = "" ]; then
    echo "Parameter 'include-files' is empty"; exit 1
  fi
  readonly INPUT_AWS_S3_BUCKET_NAME CDK_SOURCE_ARCHIVE INPUT_INCLUDE_FILES
  export INPUT_AWS_S3_BUCKET_NAME CDK_SOURCE_ARCHIVE INPUT_INCLUDE_FILES
}

main() {
  parse_args "$@"
  grep_pattern="$(echo "$INPUT_INCLUDE_FILES" | sed 's/ /\\|/g')"
  find . \
    | grep "^\./\($grep_pattern\)$" \
    | zip -r -@ "$INPUT_CDK_SOURCE_ARCHIVE"
  tmp_folder="$(dirname "$INPUT_CDK_SOURCE_ARCHIVE")"
  cdk_source_metadata_file="$tmp_folder/cdk-source.json"
  s3_key="$(sha256sum "$INPUT_CDK_SOURCE_ARCHIVE" | cut -d' ' -f1).zip"
  echo "Uploading local file '$cdk_source_metadata_file' to S3 with key '$s3_key'"
  s3_version_id="$(aws s3api put-object \
    --bucket "$INPUT_AWS_S3_BUCKET_NAME" \
    --key "$s3_key" \
    --body "$INPUT_CDK_SOURCE_ARCHIVE" \
    --query "VersionId" \
    --output text
  )"
  cat <<EOF > "$cdk_source_metadata_file"
{
  "bucketName": "$INPUT_AWS_S3_BUCKET_NAME",
  "bucketKey": "$s3_key",
  "versionId": "$s3_version_id"
}
EOF
  echo "Storing CDK source metadata file at '$cdk_source_metadata_file' with contents:"
  cat "$cdk_source_metadata_file"
  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "cdk-source-metadata-file=$cdk_source_metadata_file" >> "$GITHUB_OUTPUT"
  fi
}

main "$@"
