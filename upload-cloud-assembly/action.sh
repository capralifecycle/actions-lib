#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_AWS_S3_BUCKET_NAME=""
  INPUT_CDK_APP_DIR=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
    --aws-s3-bucket-name)
      INPUT_AWS_S3_BUCKET_NAME="$2"
      shift
      shift
      ;;
    --cdk-app-dir)
      INPUT_CDK_APP_DIR="$2"
      shift
      shift
      ;;
    *)
      echo "Unknown option '$1'"
      exit 1
      ;;
    esac
  done
  if [ "$INPUT_AWS_S3_BUCKET_NAME" = "" ]; then
    echo "Parameter 'aws-s3-bucket-name' is empty"
    exit 1
  fi
  if [ "$INPUT_CDK_APP_DIR" = "" ]; then
    echo "Parameter 'cdk-app-dir' is empty"
    exit 1
  fi
  readonly INPUT_AWS_S3_BUCKET_NAME INPUT_CDK_APP_DIR
  export INPUT_AWS_S3_BUCKET_NAME INPUT_CDK_APP_DIR
}

main() {

  parse_args "$@"

  if [ ! -f "${INPUT_CDK_APP_DIR}/cdk.json" ]; then
    echo "No cdk.json file found in '$INPUT_CDK_APP_DIR'. Please set the 'cdk-app-dir' input" \
      " to a directory containing a CDK App." >&2
    exit 1
  fi

  tmp_dir="/tmp/${GITHUB_ACTION:-$(date -u +%s)}"
  mkdir -p "$tmp_dir"

  target_archive_file="$tmp_dir/cloud-assembly.zip"
  target_metadata_file="$tmp_dir/cloud-assembly.json"

  echo "Creating Cloud Assembly archive at '$target_archive_file' from CDK application in '$INPUT_CDK_APP_DIR'"
  cd "$INPUT_CDK_APP_DIR"
  rm -rf cdk.out
  npx cdk synth
  cd cdk.out
  zip -r "$target_archive_file" .
  s3_key="$(sha256sum "$target_archive_file" | cut -d' ' -f1).zip"

  echo "Uploading Cloud Assembly archive file at '$target_archive_file' to S3 with key '$s3_key'"
  s3_version_id="$(
    aws s3api put-object \
      --bucket "$INPUT_AWS_S3_BUCKET_NAME" \
      --key "$s3_key" \
      --body "$target_archive_file" \
      --query "VersionId" \
      --output text
  )"

  cat <<EOF >"$target_metadata_file"
{
  "cloudAssemblyBucketName": "$INPUT_AWS_S3_BUCKET_NAME",
  "cloudAssemblyBucketKey": "$s3_key",
  "cloudAssemblyVersionId": "$s3_version_id"
}
EOF

  echo "Storing Cloud Assembly metadata file at '$target_metadata_file' with contents:"
  cat "$target_metadata_file"
  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "cloud-assembly-metadata-file=$target_metadata_file" >>"$GITHUB_OUTPUT"
  fi
}

main "$@"
