// aikido-upload-coverage/src/main.ts
import { globSync, readFileSync, writeFileSync } from "node:fs";
import path2 from "node:path";
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

// aikido-upload-coverage/src/prepare.ts
import path from "node:path";

// aikido-upload-coverage/src/jacoco.ts
var TAG = /<(\/?)(package|sourcefile|line)\b([^>]*)>/g;
var ATTRIBUTE = /([\w-]+)="([^"]*)"/g;
var ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};
var unescapeXml = (value) => value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name]);
var attributes = (source) => new Map([...source.matchAll(ATTRIBUTE)].map(([, name, value]) => [
  name,
  unescapeXml(value)
]));
function parseLine(attrs) {
  const counts = ["nr", "mi", "ci", "mb", "cb"].map((name) => Number(attrs.get(name)));
  if (!counts.every((count) => Number.isInteger(count) && count >= 0)) {
    return err(`Malformed <line> element: ${JSON.stringify(Object.fromEntries(attrs))}`);
  }
  const [nr, mi, ci, mb, cb] = counts;
  return ok({
    nr,
    missedInstructions: mi,
    coveredInstructions: ci,
    missedBranches: mb,
    coveredBranches: cb
  });
}
function parseJacoco(xml) {
  const files = [];
  let pkg = null;
  let file = null;
  for (const [, closing, tag, rest] of xml.matchAll(TAG)) {
    const attrs = attributes(rest);
    if (tag === "package") {
      pkg = closing ? null : attrs.get("name") ?? "";
    } else if (tag === "sourcefile") {
      if (closing) {
        file = null;
        continue;
      }
      const name = attrs.get("name") ?? "";
      file = { path: pkg ? `${pkg}/${name}` : name, lines: [] };
      files.push(file);
    } else if (file !== null) {
      const line = parseLine(attrs);
      if (!line.ok)
        return line;
      file.lines.push(line.value);
    }
  }
  return ok(files);
}
function toLcov(files) {
  let lines = 0;
  let coveredLines = 0;
  const records = [];
  for (const file of files) {
    if (file.lines.length === 0)
      continue;
    const sorted = [...file.lines].sort((a, b) => a.nr - b.nr);
    const record = ["TN:", `SF:${file.path}`];
    let hit = 0;
    let branches = 0;
    let branchesHit = 0;
    for (const line of sorted) {
      const covered = line.coveredInstructions > 0;
      if (covered)
        hit++;
      const total = line.coveredBranches + line.missedBranches;
      for (let branch = 0;branch < total; branch++) {
        const taken = branch < line.coveredBranches ? 1 : 0;
        record.push(`BRDA:${line.nr},0,${branch},${taken}`);
      }
      branches += total;
      branchesHit += line.coveredBranches;
      record.push(`DA:${line.nr},${covered ? 1 : 0}`);
    }
    record.push(`LF:${sorted.length}`, `LH:${hit}`, `BRF:${branches}`, `BRH:${branchesHit}`, "end_of_record");
    records.push(record.join(`
`));
    lines += sorted.length;
    coveredLines += hit;
  }
  return {
    text: records.length === 0 ? "" : `${records.join(`
`)}
`,
    lines,
    coveredLines
  };
}
function jacocoToLcov(xml) {
  const files = parseJacoco(xml);
  if (!files.ok)
    return files;
  const lcov = toLcov(files.value);
  if (lcov.lines === 0) {
    return err("The JaCoCo report has no line counters to convert");
  }
  return ok(lcov);
}

// aikido-upload-coverage/src/prepare.ts
var XML_PREAMBLE = /^(?:\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/;
function detectFormat(content) {
  const text = content.replace(/^\uFEFF/, "");
  const preamble = XML_PREAMBLE.exec(text)?.[0] ?? "";
  const root = /^<([\w:.-]+)/.exec(text.slice(preamble.length))?.[1];
  if (root === "report")
    return "jacoco";
  if (root === "coverage")
    return "cobertura";
  if (root === undefined && /^(?:TN|SF):/m.test(text))
    return "lcov";
  return null;
}
var parseFilePaths = (raw) => raw.split(/[\s,]+/).filter((entry) => entry !== "");
function workspacePath(workspace, file) {
  const relative = path.relative(workspace, path.resolve(workspace, file));
  if (relative === "" || relative.split(path.sep)[0] === ".." || path.isAbsolute(relative)) {
    return err(`'${file}' is outside the workspace '${workspace}'`);
  }
  return ok(relative.split(path.sep).join("/"));
}
var lcovPathFor = (source) => /\.xml$/i.test(source) ? source.replace(/\.xml$/i, ".lcov") : `${source}.lcov`;
function prepareReport(file, content) {
  const format = detectFormat(content);
  switch (format) {
    case "lcov":
    case "cobertura":
      return ok({ kind: "as-is", path: file });
    case "jacoco": {
      const lcov = jacocoToLcov(content);
      if (!lcov.ok)
        return err(`${file}: ${lcov.error}`);
      return ok({
        kind: "converted",
        source: file,
        path: lcovPathFor(file),
        lcov: lcov.value.text,
        lines: lcov.value.lines,
        coveredLines: lcov.value.coveredLines
      });
    }
    case null:
      return err(`${file}: not an LCOV, Cobertura or JaCoCo XML report`);
  }
}
function summarize(report) {
  if (report.kind === "as-is")
    return `${report.path}: no conversion needed`;
  const percentage = (100 * report.coveredLines / report.lines).toFixed(1);
  return `${report.source}: converted to ${report.path}, ` + `${report.coveredLines}/${report.lines} lines covered (${percentage}%)`;
}

// aikido-upload-coverage/src/main.ts
var inActions = runningInActions();
function readInputs() {
  if (inActions) {
    return {
      patterns: parseFilePaths(process.env["INPUT_FILE_PATHS"] ?? ""),
      failOnError: process.env["INPUT_FAIL_ON_ERROR"] === "true"
    };
  }
  try {
    const { values } = parseArgs({
      options: {
        "file-paths": { type: "string", multiple: true, default: [] }
      }
    });
    return {
      patterns: values["file-paths"].flatMap(parseFilePaths),
      failOnError: true
    };
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
}
var EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);
function findReports(workspace, pattern) {
  const matches = globSync(pattern, {
    cwd: workspace,
    withFileTypes: true,
    exclude: (entry) => entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)
  }).filter((entry) => entry.isFile()).map((entry) => path2.join(entry.parentPath, entry.name));
  if (matches.length === 0)
    return err(`No file matched '${pattern}'`);
  const files = [];
  for (const match of matches.sort()) {
    const file = workspacePath(workspace, match);
    if (!file.ok)
      return file;
    files.push(file.value);
  }
  return ok(files);
}
function prepareAll(workspace, patterns) {
  if (patterns.length === 0)
    return err("Parameter 'file-paths' is empty");
  const files = new Set;
  for (const pattern of patterns) {
    const found = findReports(workspace, pattern);
    if (!found.ok)
      return found;
    for (const file of found.value)
      files.add(file);
  }
  const reports = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(path2.join(workspace, file), "utf8");
    } catch (cause) {
      return err(`${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const report = prepareReport(file, content);
    if (!report.ok)
      return report;
    reports.push(report.value);
  }
  return ok(reports);
}
var escapeCommand = (message) => message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
var inputs = readInputs();
var workspace = process.cwd();
var reports = prepareAll(workspace, inputs.patterns);
if (!reports.ok) {
  if (inputs.failOnError)
    fail(reports.error);
  process.stdout.write(`::warning title=Coverage not uploaded::${escapeCommand(reports.error)}
`);
  writeOutputs([{ name: "file-paths", value: "" }]);
  process.exit(0);
}
for (const report of reports.value) {
  if (report.kind === "converted") {
    writeFileSync(path2.join(workspace, report.path), report.lcov);
  }
  process.stdout.write(`${summarize(report)}
`);
}
var filePaths = reports.value.map((report) => report.path).join(",");
if (inActions) {
  writeOutputs([{ name: "file-paths", value: filePaths }]);
}
