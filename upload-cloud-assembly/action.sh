#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_AWS_S3_BUCKET_NAME=""
  INPUT_CLOUD_ASSEMBLY_ARCHIVE=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --aws-s3-bucket-name)     INPUT_AWS_S3_BUCKET_NAME="$2"; shift; shift ;;
      --cloud-assembly-archive) INPUT_CLOUD_ASSEMBLY_ARCHIVE="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  if [ "$INPUT_AWS_S3_BUCKET_NAME" = "" ]; then
    echo "Parameter 'aws-s3-bucket-name' is empty"; exit 1
  fi
  if [ "$INPUT_CLOUD_ASSEMBLY_ARCHIVE" = "" ]; then
    echo "Parameter 'cloud-assembly-archive' is empty"; exit 1
  fi
  readonly INPUT_AWS_S3_BUCKET_NAME CLOUD_ASSEMBLY_ARCHIVE
  export INPUT_AWS_S3_BUCKET_NAME CLOUD_ASSEMBLY_ARCHIVE
}

main() {
  parse_args "$@"
  tmp_folder="$(dirname "$INPUT_CLOUD_ASSEMBLY_ARCHIVE")"
  cloud_assembly_metadata_file="$tmp_folder/cloud-assembly.json"
  s3_key="$(sha256sum "$INPUT_CLOUD_ASSEMBLY_ARCHIVE" | cut -d' ' -f1).zip"
  echo "Uploading local file '$cloud_assembly_metadata_file' to S3 with key '$s3_key'"
  s3_version_id="$(aws s3api put-object \
    --bucket "$INPUT_AWS_S3_BUCKET_NAME" \
    --key "$s3_key" \
    --body "$INPUT_CLOUD_ASSEMBLY_ARCHIVE" \
    --query "VersionId" \
    --output text
  )"
  cat <<EOF > "$cloud_assembly_metadata_file"
{
  "cloudAssemblyBucketName": "$INPUT_AWS_S3_BUCKET_NAME",
  "cloudAssemblyBucketKey": "$s3_key",
  "cloudAssemblyVersionId": "$s3_version_id"
}
EOF
  echo "Storing Cloud Assembly metadata file at '$cloud_assembly_metadata_file' with contents:"
  cat "$cloud_assembly_metadata_file"
  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    echo "cloud-assembly-metadata-file=$cloud_assembly_metadata_file" >> "$GITHUB_OUTPUT"
  fi
}

main "$@"
