// generate-tag/src/main.ts
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

// lib/actions.ts
import { appendFileSync } from "node:fs";
var runningInActions = () => process.env["GITHUB_ACTIONS"] === "true";
function fail(message) {
  process.stderr.write(`${message}
`);
  process.exit(1);
}
var requireEnv = (name) => process.env[name] ?? fail(`Environment variable '${name}' is not set`);
var renderOutputs = (outputs) => outputs.map((output) => `${output.name}=${output.value}
`).join("");
function writeOutputs(outputs) {
  appendFileSync(requireEnv("GITHUB_OUTPUT"), renderOutputs(outputs));
}

// lib/result.ts
var ok = (value) => ({ ok: true, value });
var err = (error) => ({ ok: false, error });

// generate-tag/src/tag.ts
var TAG_TYPES = [
  "punctuated-timestamp-tag",
  "hyphenated-alphanumeric-tag"
];
var NON_DEFAULT_BRANCH_PREFIX = "nd";
var MIN_BRANCH_NAME_CHARACTERS = 10;
var SHORT_SHA_LENGTH = 8;
function parseTagType(value) {
  const match = TAG_TYPES.find((candidate) => candidate === value);
  return match ? ok(match) : err(`Unknown tag type '${value}'`);
}
function parseMaxLength(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? ok(parsed) : err(`Parameter 'max-length' must be a positive integer, got '${value}'`);
}
function branchFromRef(ref) {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}
function sanitiseBranchName(branch) {
  return branch.replace(/[^a-zA-Z0-9_-]/g, "");
}
var pad = (value, width) => String(value).padStart(width, "0");
function punctuatedTimestamp(now) {
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`;
  const time = `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`;
  return `${date}.${time}`;
}
function hyphenatedTimestamp(now) {
  const date = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1, 2)}${pad(now.getUTCDate(), 2)}`;
  const time = `${pad(now.getUTCHours(), 2)}${pad(now.getUTCMinutes(), 2)}${pad(now.getUTCSeconds(), 2)}`;
  return `${date}-${time}z`;
}
function resolvePrefix(request) {
  const applies = request.tagType === "hyphenated-alphanumeric-tag" && request.addAutomaticPrefix;
  if (!applies)
    return ok(request.prefix);
  if (request.prefix === NON_DEFAULT_BRANCH_PREFIX || request.prefix === `${NON_DEFAULT_BRANCH_PREFIX}-`) {
    return err(`The prefix '${request.prefix}' contains a reserved word '${NON_DEFAULT_BRANCH_PREFIX}'`);
  }
  return ok(`${NON_DEFAULT_BRANCH_PREFIX}-${request.prefix}`);
}
var joinPrefix = (prefix, separator) => prefix === "" ? "" : `${prefix}${separator}`;
function punctuatedTag(request, context) {
  const tag = `${joinPrefix(request.prefix, ".")}${punctuatedTimestamp(context.now)}`;
  return tag.length > request.maxLength ? err(`Maximum tag length ${request.maxLength} has been exceeded`) : ok(tag);
}
function hyphenatedTag(request, context) {
  const prefix = resolvePrefix(request);
  if (!prefix.ok)
    return prefix;
  const shortSha = context.commitSha.slice(0, SHORT_SHA_LENGTH);
  const branch = sanitiseBranchName(context.branch);
  const head = `${joinPrefix(prefix.value, "-")}${hyphenatedTimestamp(context.now)}-${context.buildId}-${shortSha}-`;
  const availableForBranch = request.maxLength - head.length;
  const requiredForBranch = Math.min(branch.length, MIN_BRANCH_NAME_CHARACTERS);
  if (availableForBranch < requiredForBranch) {
    return err(`The tag exceeds the maximum length of ${request.maxLength} characters by ${requiredForBranch - availableForBranch} character(s)`);
  }
  return ok(`${head}${branch.slice(0, availableForBranch)}`);
}
function generateTag(request, context) {
  return request.tagType === "punctuated-timestamp-tag" ? punctuatedTag(request, context) : hyphenatedTag(request, context);
}

// generate-tag/src/main.ts
var inActions = runningInActions();
var git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
function requestFromEnvironment() {
  const tagType = parseTagType(process.env["INPUT_TAG-TYPE"] ?? "");
  if (!tagType.ok)
    fail(tagType.error);
  const maxLength = parseMaxLength(process.env["INPUT_MAX-LENGTH"] ?? "256");
  if (!maxLength.ok)
    fail(maxLength.error);
  return {
    tagType: tagType.value,
    prefix: process.env["INPUT_TAG-PREFIX"] ?? "",
    maxLength: maxLength.value,
    addAutomaticPrefix: process.env["INPUT_ADD-AUTOMATIC-PREFIX"] === "true"
  };
}
function requestFromArgv() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        "tag-type": { type: "string", default: "hyphenated-alphanumeric-tag" },
        "tag-prefix": { type: "string", default: "" },
        "max-length": { type: "string", default: "256" },
        "add-automatic-prefix": { type: "boolean", default: false }
      }
    }));
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
  const tagType = parseTagType(values["tag-type"]);
  if (!tagType.ok)
    fail(tagType.error);
  const maxLength = parseMaxLength(values["max-length"]);
  if (!maxLength.ok)
    fail(maxLength.error);
  return {
    tagType: tagType.value,
    prefix: values["tag-prefix"],
    maxLength: maxLength.value,
    addAutomaticPrefix: values["add-automatic-prefix"]
  };
}
var contextFromActions = () => ({
  now: new Date,
  commitSha: requireEnv("GITHUB_SHA"),
  buildId: requireEnv("GITHUB_RUN_ID"),
  branch: branchFromRef(requireEnv("GITHUB_REF"))
});
var contextFromGit = () => ({
  now: new Date,
  commitSha: git("show", "-s", "--format=%H"),
  buildId: "local",
  branch: git("rev-parse", "--abbrev-ref", "HEAD")
});
var request = inActions ? requestFromEnvironment() : requestFromArgv();
var context = inActions ? contextFromActions() : contextFromGit();
var tag = generateTag(request, context);
if (!tag.ok)
  fail(tag.error);
if (inActions) {
  writeOutputs([{ name: "tag", value: tag.value }]);
} else {
  process.stdout.write(`${tag.value}
`);
}
