# actions-lib

A library containing operations that can be useful when using GitHub Actions for Continuous Integration (CI).

## Actions

Below is a summary of the actions in the library and a short description of what they do. Some of the actions can also be run locally by running an executable (e.g., `action.sh`) and passing in inputs as CLI arguments - such actions are marked with _Local usage_ in the table below.

<!-- ACTION_TABLE_START -->
| Action | Description | Local usage |
| --- | --- | --- |
| [check-runtime-dependencies](check-runtime-dependencies/action.yml) | Check if the runtime has the expected dependencies | ❌ |
| [configure-aws-credentials](configure-aws-credentials/action.yml) | Configure temporary AWS credentials using the GitHub Actions OpenID Connect Provider | ❌ |
| [configure-github-deployment](configure-github-deployment/action.yml) | Create or update a GitHub deployment | ❌ |
| [configure-npm](configure-npm/action.yml) | Creates an NPM configuration for authenticating to GitHub Packages and optionally the npmjs.com registry | ❌ |
| [generate-tag](generate-tag/action.yml) | Generate unique tags for artifacts | ✅ |
| [parse-config](parse-config/action.yml) | Parse and validate a JSON configuration and expose the configuration as separate outputs | ✅ |
| [slack-notify](slack-notify/action.yml) | Send notifications to Slack | ❌ |
| [trigger-deployment-pipeline](trigger-deployment-pipeline/action.yml) | Trigger Liflig CDK Pipelines in AWS | ✅ |
| [upload-cdk-source](upload-cdk-source/action.yml) | Create and upload an archive of the CDK source to use during deployment of a Liflig CDK Pipeline | ✅ |
| [upload-cloud-assembly](upload-cloud-assembly/action.yml) | Create and upload an archive of the CDK source to use during deployment of a Liflig CDK Pipeline | ✅ |
| [upload-s3-artifact](upload-s3-artifact/action.yml) | Upload a file or directory to S3 | ✅ |
| [workflow-dispatch](workflow-dispatch/action.yml) | Starts a GitHub Actions workflow through workflow_dispatch | ✅ |
<!-- ACTION_TABLE_END -->
