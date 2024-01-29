const { execSync } = require('node:child_process');

module.exports = {
  branches: ["master"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github",
    // Custom plugin for pushing an additional major tag on release (e.g., v1, v2)
    {
      success(pluginConfig, context) {
        const { options: { repositoryUrl }, nextRelease: { version }, logger } = context;
        const [majorVersion] = version.split(".");
        const majorVersionTag = `v${majorVersion}`
        logger.info(`Pushing new major version tag "${majorVersionTag}" to git`);
        execSync(`git tag --force "${majorVersionTag}"`);
        execSync(`git push "${context.options.repositoryUrl}" --force --tags`);
      },
    },
  ],
};
