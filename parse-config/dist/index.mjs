// parse-config/src/main.ts
import { existsSync, readFileSync } from "node:fs";
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

// parse-config/src/config.ts
var SCHEMA_VERSIONS = {
  "0.1": {
    version: { type: "string", required: true },
    accountId: { type: "string", required: true },
    roleName: { type: "string", required: true },
    limitedRoleName: { type: "string", required: false },
    artifactBucket: { type: "string", required: true },
    ecrRepository: { type: "string", required: false },
    pipelines: { type: "string", collection: true, required: false },
    devPipelines: { type: "string", collection: true, required: false },
    prodPipelines: { type: "string", collection: true, required: false }
  }
};
function parseJson(serialized) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return err("Failed to parse configuration as JSON");
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? ok(parsed) : err("The configuration is not a JSON object");
}
function describe(value) {
  if (Array.isArray(value))
    return "an array";
  if (value === null)
    return "null";
  return `a ${typeof value}`;
}
function checkField(name, schema, value) {
  if (value === undefined) {
    return schema.required ? `'${name}' is required but missing` : undefined;
  }
  if (schema.collection) {
    if (!Array.isArray(value)) {
      return `'${name}' must be an array of ${schema.type}s, got ${describe(value)}`;
    }
    const badIndex = value.findIndex((item) => typeof item !== schema.type);
    return badIndex === -1 ? undefined : `'${name}[${badIndex}]' must be a ${schema.type}, got ${describe(value[badIndex])}`;
  }
  return typeof value === schema.type ? undefined : `'${name}' must be a ${schema.type}, got ${describe(value)}`;
}
function validate(config) {
  const version = config["version"];
  if (typeof version !== "string") {
    return err("The configuration has no 'version' string");
  }
  const schema = SCHEMA_VERSIONS[version];
  if (!schema) {
    return err(`No matching schema found for schema version '${version}'`);
  }
  const problems = Object.entries(schema).map(([name, field]) => checkField(name, field, config[name])).filter((problem) => problem !== undefined);
  const unknown = Object.keys(config).filter((key) => !(key in schema));
  if (unknown.length > 0) {
    problems.push(`unknown field(s): ${unknown.map((k) => `'${k}'`).join(", ")}`);
  }
  return problems.length === 0 ? ok(config) : err(`The supplied configuration does not match schema version '${version}':
` + problems.map((problem) => `  - ${problem}`).join(`
`));
}
function toOutputs(config) {
  return Object.entries(config).filter(([, value]) => Boolean(value)).map(([name, value]) => {
    const joined = Array.isArray(value) ? value.join(" ") : value;
    return {
      name,
      value: typeof joined === "string" ? joined : JSON.stringify(joined)
    };
  });
}
function parseConfig(serialized) {
  const parsed = parseJson(serialized);
  if (!parsed.ok)
    return parsed;
  const validated = validate(parsed.value);
  if (!validated.ok)
    return validated;
  return ok(toOutputs(validated.value));
}

// parse-config/src/main.ts
var inActions = runningInActions();
var sourceFromEnvironment = () => ({
  config: process.env["INPUT_CONFIG"] ?? "",
  configFile: process.env["INPUT_CONFIG-FILE"] ?? ""
});
function sourceFromArgv() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        config: { type: "string", default: "" },
        "config-file": { type: "string", default: "" }
      }
    }));
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
  return { config: values.config, configFile: values["config-file"] };
}
function read({ config, configFile }) {
  if (config !== "")
    return config;
  if (configFile === "") {
    fail("No configuration or configuration file supplied");
  }
  if (!existsSync(configFile)) {
    fail(`The configuration file '${configFile}' does not exist`);
  }
  process.stdout.write(`Reading configuration from '${configFile}'
`);
  return readFileSync(configFile, "utf8");
}
var source = inActions ? sourceFromEnvironment() : sourceFromArgv();
var outputs = parseConfig(read(source));
if (!outputs.ok)
  fail(outputs.error);
if (inActions) {
  writeOutputs(outputs.value);
  process.stdout.write(`Parsed configuration into ${outputs.value.length} output(s): ` + `${outputs.value.map((output) => output.name).join(", ")}
`);
} else {
  process.stdout.write(renderOutputs(outputs.value));
}
