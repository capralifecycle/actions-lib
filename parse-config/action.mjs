#!/usr/bin/env node
import { readFileSync, appendFileSync, existsSync } from "node:fs"
import { parseArgs } from "node:util"
let serializedConfig
let configFile
if (process.env["GITHUB_ACTIONS"] === "true") {
  serializedConfig = process.env["INPUT_CONFIG"]
  configFile = process.env["INPUT_CONFIG-FILE"]
} else {
  const { values } = parseArgs({
    options: {
      "config-file": {
        type: "string",
      },
      config: {
        type: "string",
      }
    }
  })
  serializedConfig = values.config
  configFile = values["config-file"]
  console.log(serializedConfig)
}
if (!serializedConfig && !configFile) {
  throw new Error("No configuration or configuration file supplied")
} else if (!serializedConfig && !existsSync(configFile)) {
  throw new Error(`The configuration file '${configFile}' does not exist`)
}
let config = {}
try {
  config = JSON.parse(serializedConfig || readFileSync(configFile, "utf8"))
} catch (e) {
  throw new Error(`Failed to parse configuration as JSON`)
}
const schemaVersions = {
  "0.1": {
    version: {
      type: "string",
      required: true,
    },
    accountId: {
      type: "string",
      required: true,
    },
    roleName: {
      type: "string",
      required: true,
    },
    limitedRoleName: {
      type: "string",
      required: false,
    },
    artifactBucket: {
      type: "string",
      required: true,
    },
    ecrRepository: {
      type: "string",
      collection: true,
      required: false,
    },
    pipelines: {
      type: "string",
      collection: true,
      required: false,
    },
    devPipelines: {
      type: "string",
      collection: true,
      required: false,
    },
    prodPipelines: {
      type: "string",
      collection: true,
      required: false,
    },
  },
}
const schema = schemaVersions[config.version]
if (!schema) {
  throw new Error(
    `No matching schema found for schema version '${config.version}'`,
  )
}
const matchesSchema = Object.entries(schema)
  .filter(([_, schemaValue]) => !!schemaValue.required)
  .every(([schemaKey, schemaValue]) =>
    Object.keys(config).includes(schemaKey) && !!schemaValue.collection
      ? Array.isArray(config[schemaKey]) &&
      config[schemaKey].every(
        (collectionItem) => typeof collectionItem === schemaValue.type,
      )
      : typeof config[schemaKey] === schemaValue.type,
  ) && Object.keys(config).every(configKey => Object.keys(schema).includes(configKey))
if (!matchesSchema) {
  throw new Error("The supplied configuration does not match the schema")
}

Object.entries(config)
  .filter(([_, val]) => !!val)
  .forEach(([key, val]) => {
    const value = Array.isArray(val) ? val.join(" ") : val
    const sanitized = typeof value !== "string" ? JSON.stringify(value) : value
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${sanitized}\n`)
  })
