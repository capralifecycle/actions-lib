#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_AWS_S3_BUCKET_NAME=""
  INPUT_PIPELINES=""
  INPUT_CDK_SOURCE_METADATA_FILE=""
  INPUT_ARTIFACT_PARAMETERS=""
  INPUT_CLOUD_ASSEMBLY_METADATA_FILE=""
  INPUT_TRIGGER_TYPE=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --aws-s3-bucket-name)           INPUT_AWS_S3_BUCKET_NAME="$2"; shift; shift ;;
      --pipelines)                    INPUT_PIPELINES="$2"; shift; shift ;;
      --cdk-source-metadata-file)     INPUT_CDK_SOURCE_METADATA_FILE="$2"; shift; shift ;;
      --cloud-assembly-metadata-file) INPUT_CLOUD_ASSEMBLY_METADATA_FILE="$2"; shift; shift ;;
      --artifact-parameters)          INPUT_ARTIFACT_PARAMETERS="$2"; shift; shift ;;
      --trigger-type)                 INPUT_TRIGGER_TYPE="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  if [ "$INPUT_AWS_S3_BUCKET_NAME" = "" ]; then
    echo "Parameter 'aws-s3-bucket-name' is empty"; exit 1
  fi
  if [ "$INPUT_PIPELINES" = "" ]; then
    echo "Parameter 'pipelines' is empty"; exit 1
  fi
  if [ "$INPUT_TRIGGER_TYPE" = "" ]; then
    echo "Parameter 'trigger-type' is empty"; exit 1
  fi
  if [ "$INPUT_TRIGGER_TYPE" = "cdk-source" ]; then
    if [ "$INPUT_CDK_SOURCE_METADATA_FILE" = "" ]; then
      echo "Parameter 'cdk-source-metadata-file' must be set when parameter 'trigger-type' is 'cdk-source'"; exit 1
    elif [ ! -f "$INPUT_CDK_SOURCE_METADATA_FILE" ]; then
      echo "File '$INPUT_CDK_SOURCE_METADATA_FILE' describing the CDK source does not exist"; exit 1
    fi
  fi
  if [ "$INPUT_TRIGGER_TYPE" = "cloud-assembly" ]; then
    if [ "$INPUT_CLOUD_ASSEMBLY_METADATA_FILE" = "" ]; then
      echo "Parameter 'cloud-assembly-metadata-file' must be set when parameter 'trigger-type' is 'cloud-assembly'"; exit 1
    elif [ ! -f "$INPUT_CLOUD_ASSEMBLY_METADATA_FILE" ]; then
      echo "File '$INPUT_CLOUD_ASSEMBLY_METADATA_FILE' describing the Cloud Assembly does not exist"; exit 1
    fi
  fi
  if [ "$INPUT_TRIGGER_TYPE" = "artifact" ] && [ "$INPUT_ARTIFACT_PARAMETERS" = "" ]; then
    echo "Parameter 'artifact-parameters' must be set when parameter 'trigger-type' is 'artifact'"; exit 1
  fi
  readonly INPUT_AWS_S3_BUCKET_NAME INPUT_PIPELINES INPUT_CDK_SOURCE_METADATA_FILE INPUT_ARTIFACT_PARAMETERS INPUT_CLOUD_ASSEMBLY_METADATA_FILE
  export INPUT_AWS_S3_BUCKET_NAME INPUT_PIPELINES INPUT_CDK_SOURCE_METADATA_FILE INPUT_ARTIFACT_PARAMETERS INPUT_CLOUD_ASSEMBLY_METADATA_FILE
}

create_trigger_file() {
  local trigger_file="$1"
  if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
    ci_trigger_type="GITHUB_ACTIONS"
    ci_triggered_by="$GITHUB_ACTOR"
    vcs_commit_author="$(git show -s --format="%an")"
    vcs_branch_name="${GITHUB_REF#refs/heads/}"
    vcs_commit_hash="$GITHUB_SHA"
    vcs_repository_owner="$(echo "$GITHUB_REPOSITORY" | cut -d"/" -f1)"
    vcs_repository_name="$(echo "$GITHUB_REPOSITORY" | cut -d"/" -f2-)"

    if ! github_actions_run="$(curl -L \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer $GITHUB_TOKEN" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      --fail \
      --silent \
      --show-error \
      "https://api.github.com/repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
    )"; then
      echo "Failed to fetch timing information for the current GitHub Actions workflow run" >&2
      exit 1
    fi
    ci_start_time="$(echo "$github_actions_run" | jq --exit-status --raw-output ".created_at")"
    # A quick check to see that what we parsed from the the GitHub API response looks likes a date
    echo "$ci_start_time" | grep -q "^[0-9]\{4,\}-.*$"
    # NOTE: Since we use the same trigger file for all pipelines, the stop time 
    # will not be entirely accurate, but will likely only be off by a second or two.
    ci_stop_time="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  else
    ci_trigger_type="LOCAL"
    ci_triggered_by="$(whoami)@$(hostname)"
    vcs_commit_author="$(git show -s --format="%an")"
    vcs_branch_name="$(git rev-parse --abbrev-ref HEAD)"
    vcs_commit_hash="$(git show -s --format="%H")"
    # NOTE: Extract details from GitHub remote
    vcs_repository_owner="$(git config --get "remote.origin.url" | sed -n "s/^.*github.com[\/:]\(.*\)\/\(.*\)\(\.git\)\{0,1\}$/\1/p")"
    vcs_repository_name="$(git config --get "remote.origin.url" | sed -n "s/^.*github.com[\/:]\(.*\)\/\(.*\)\(\.git\)\{0,1\}$/\2/p")"
  fi

  cat <<EOF > "$trigger_file"
{
  "version": "0.1",
  "ci": {
    "type": "$ci_trigger_type",
    "triggeredBy": "$ci_triggered_by",
    "startTime": "${ci_start_time:-}",
    "stopTime": "${ci_stop_time:-}"
  },
  "vcs": {
    "commitAuthor": "$vcs_commit_author",
    "branchName": "$vcs_branch_name",
    "commitHash": "$vcs_commit_hash",
    "repositoryName": "$vcs_repository_name",
    "repositoryOwner": "$vcs_repository_owner"
  }
}
EOF
  printf "Contents of trigger file '%s':\n%s\n" "$trigger_file" "$(cat "$trigger_file")"
}

main() {
  parse_args "$@"
  tmp_path="/tmp/trigger-deployment-pipeline-$(date +%s)"
  mkdir -p "$tmp_path"
  pipeline_trigger_filename="trigger"
  pipeline_trigger_path="$tmp_path/$pipeline_trigger_filename"
  cdk_source_metadata_filename="cdk-source.json"
  cloud_assembly_filename="cloud-assembly.json"
  artifact_parameter_namespace="/liflig-cdk/default/pipeline-variables"

  create_trigger_file "$pipeline_trigger_path"

  # Store references to artifacts in SSM
  if [ "$INPUT_TRIGGER_TYPE" = "artifact" ]; then
    echo "$INPUT_ARTIFACT_PARAMETERS" | tr ' ' '\n' | while read -r parameter; do
      parameter_name="$(echo "$parameter" | cut -d '=' -f1)"
      parameter_value="$(echo "$parameter" | cut -d '=' -f2)"
      aws ssm put-parameter \
        --name "$artifact_parameter_namespace/$parameter_name" \
        --value "$parameter_value" \
        --type String \
        --overwrite
    done
  fi

  # Upload 1) CDK source or Cloud Assembly metadata file and 2) pipeline trigger file
  echo "$INPUT_PIPELINES" | tr ' ' '\n' | while read -r pipeline_name; do
    if [ "$INPUT_TRIGGER_TYPE" = "cdk-source" ]; then
      aws s3 cp "$INPUT_CDK_SOURCE_METADATA_FILE" "s3://$INPUT_AWS_S3_BUCKET_NAME/pipelines/$pipeline_name/$cdk_source_metadata_filename"
    elif [ "$INPUT_TRIGGER_TYPE" = "cloud-assembly" ]; then
      aws s3 cp "$INPUT_CLOUD_ASSEMBLY_METADATA_FILE" "s3://$INPUT_AWS_S3_BUCKET_NAME/pipelines/$pipeline_name/$cloud_assembly_filename"
    fi
    aws s3 cp "$pipeline_trigger_path" "s3://$INPUT_AWS_S3_BUCKET_NAME/pipelines/$pipeline_name/$pipeline_trigger_filename"
  done
}

main "$@"
