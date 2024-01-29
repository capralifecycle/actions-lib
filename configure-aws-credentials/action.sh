#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

parse_args() {
  INPUT_AWS_ACCOUNT_ID=""
  INPUT_AWS_IAM_ROLE_NAME=""
  INPUT_AWS_IAM_ROLE_SESSION_NAME=""
  INPUT_AWS_REGION="eu-west-1"
  INPUT_ADD_CREDENTIALS_TO_ENVIRONMENT="false"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --aws-account-id)                        INPUT_AWS_ACCOUNT_ID="$2"; shift; shift ;;
      --aws-iam-role-name)                     INPUT_AWS_IAM_ROLE_NAME="$2"; shift; shift ;;
      --aws-iam-role-session-name)             INPUT_AWS_IAM_ROLE_SESSION_NAME="$2"; shift; shift ;;
      --aws-region)                            INPUT_AWS_REGION="$2"; shift; shift ;;
      --add-credentials-to-environment)        INPUT_ADD_CREDENTIALS_TO_ENVIRONMENT="$2"; shift; shift ;;
      *) echo "Unknown option '$1'"; exit 1 ;;
    esac
  done
  if [ "$INPUT_AWS_ACCOUNT_ID" = "" ]; then
    echo "Parameter 'aws-account-id' is empty"; exit 1
  fi
  if [ "$INPUT_AWS_IAM_ROLE_NAME" = "" ]; then
    echo "Parameter 'aws-iam-role-name' is empty"; exit 1
  fi
  if [ "$INPUT_AWS_IAM_ROLE_SESSION_NAME" = "" ]; then
    echo "Parameter 'aws-iam-role-session-name' is empty"; exit 1
  fi
  if [ "$INPUT_AWS_REGION" = "" ]; then
    echo "Parameter 'aws-region' is empty"; exit 1
  fi
  readonly INPUT_AWS_ACCOUNT_ID INPUT_AWS_IAM_ROLE_NAME INPUT_AWS_IAM_ROLE_SESSION_NAME INPUT_AWS_REGION INPUT_ADD_CREDENTIALS_TO_ENVIRONMENT
  export INPUT_AWS_ACCOUNT_ID INPUT_AWS_IAM_ROLE_NAME INPUT_AWS_IAM_ROLE_SESSION_NAME INPUT_AWS_REGION INPUT_ADD_CREDENTIALS_TO_ENVIRONMENT
}

main() {
  parse_args "$@"
  aws_iam_role_arn="arn:aws:iam::$INPUT_AWS_ACCOUNT_ID:role/$INPUT_AWS_IAM_ROLE_NAME"
  github_actions_oidc_token="$(curl \
    --header "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
    --fail \
    --silent \
    --show-error \
    "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" \
    | jq -r ".value"
  )"
  echo "::add-mask::$github_actions_oidc_token"

  max_retries=3
  sleep_duration=5
  retries=0
  while true; do
    read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<<"$(aws sts assume-role-with-web-identity \
      --region "$INPUT_AWS_REGION" \
      --role-arn "$aws_iam_role_arn" \
      --role-session-name "$INPUT_AWS_IAM_ROLE_SESSION_NAME" \
      --web-identity-token "$github_actions_oidc_token" \
      --query "[Credentials.AccessKeyId, Credentials.SecretAccessKey, Credentials.SessionToken]" \
      --output text)"
    if [ "$AWS_ACCESS_KEY_ID" != "" ] && [ "$AWS_SECRET_ACCESS_KEY" != "" ] && [ "$AWS_SESSION_TOKEN" != "" ]; then
      echo "Successfully assumed role"
      # Mask the values in GitHub Actions
      echo "::add-mask::$AWS_ACCESS_KEY_ID"
      echo "::add-mask::$AWS_SECRET_ACCESS_KEY"
      echo "::add-mask::$AWS_SESSION_TOKEN"
      # Set environment variables to more easily test the credentials later on
      export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_REGION="$INPUT_AWS_REGION"
      break
    fi
    if [ "$retries" -lt "$max_retries" ]; then
      echo "Failed to assume IAM role. Retrying ..."
      retries="$((retries + 1))"
      sleep "$sleep_duration"
    else
      echo "Failed to assume role after multiple retries. Exiting ..."
      exit 1
    fi
  done
  echo "Verifying temporary AWS credentials"
  aws sts get-caller-identity > /dev/null 2>&1
  cat <<EOF >> "$GITHUB_OUTPUT"
aws-access-key-id=$AWS_ACCESS_KEY_ID
aws-secret-access-key=$AWS_SECRET_ACCESS_KEY
aws-session-token=$AWS_SESSION_TOKEN
EOF
  cat <<EOF >> "$GITHUB_ENV"
AWS_REGION=$AWS_REGION
EOF
  if [ "$INPUT_ADD_CREDENTIALS_TO_ENVIRONMENT" = "true" ]; then
    echo "Storing temporary AWS credentials in environment"
    cat <<EOF >> "$GITHUB_ENV"
AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN
EOF
  fi
}

main "$@"
