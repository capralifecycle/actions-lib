# actions-lib

A library containing operations that can be useful when using GitHub Actions for Continuous Integration (CI).

## Actions

Below is a summary of the actions in the library and a short description of what they do. Some of the actions can also be run locally by running an executable (`action.sh`, or `dist/index.mjs` for TypeScript actions) and passing in inputs as CLI arguments - such actions are marked with _Local usage_ in the table below. _Runtime_ is the action's `runs.using` value: `composite` actions are implemented as shell, `node24` actions as JavaScript or TypeScript.

<!-- ACTION_TABLE_START -->
| Action | Description | Runtime | Local usage |
| :--- | :--- | :---: | :---: |
| [`aikido-scan`](aikido-scan/action.yml) | Run an Aikido release scan and post a summary to Slack if issues are found | `composite` | ✅ |
| [`check-runtime-dependencies`](check-runtime-dependencies/action.yml) | Check if the runtime has the expected dependencies | `composite` | ❌ |
| [`configure-aws-credentials`](configure-aws-credentials/action.yml) | Configure temporary AWS credentials using the GitHub Actions OpenID Connect Provider | `composite` | ❌ |
| [`configure-github-deployment`](configure-github-deployment/action.yml) | Create or update a GitHub deployment | `node24` | ❌ |
| [`generate-tag`](generate-tag/action.yml) | Generate unique tags for artifacts | `node24` | ✅ |
| [`parse-config`](parse-config/action.yml) | Parse and validate a JSON configuration and expose the configuration as separate outputs | `node24` | ✅ |
| [`slack-notify`](slack-notify/action.yml) | Send notifications to Slack | `node24` | ❌ |
| [`trigger-deployment-pipeline`](trigger-deployment-pipeline/action.yml) | Trigger Liflig CDK Pipelines in AWS | `composite` | ✅ |
| [`upload-cdk-source`](upload-cdk-source/action.yml) | Create and upload an archive of the CDK source to use during deployment of a Liflig CDK Pipeline | `node24` | ✅ |
| [`upload-cloud-assembly`](upload-cloud-assembly/action.yml) | Create and upload an archive of the CDK source to use during deployment of a Liflig CDK Pipeline | `node24` | ✅ |
| [`upload-s3-artifact`](upload-s3-artifact/action.yml) | Upload a file or directory to S3 | `node24` | ✅ |
<!-- ACTION_TABLE_END -->
