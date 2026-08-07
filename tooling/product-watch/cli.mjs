#!/usr/bin/env node
import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {parseArgs} from "node:util";
import {renderReportMarkdown, validateConfig} from "./lib/core.mjs";
import {runProductWatch} from "./lib/runner.mjs";

const {values} = parseArgs({
  options: {
    config: {type: "string", default: "tooling/product-watch/config/v1.json"},
    output: {type: "string", default: "product-watch-report.json"},
    summary: {type: "string", default: "product-watch-summary.md"},
    fixture: {type: "string"},
    "dry-run": {type: "string", default: process.env.DRY_RUN ?? "true"},
  },
});

function parseBoolean(value, name) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be "true" or "false"`);
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function main() {
  const config = validateConfig(await readJson(values.config));
  const fixtureSources = values.fixture ? await readJson(values.fixture) : null;
  const report = await runProductWatch({
    config,
    repository: process.env.GITHUB_REPOSITORY ?? "local/dry-run",
    token: process.env.GITHUB_TOKEN ?? "",
    dryRun: parseBoolean(values["dry-run"], "--dry-run"),
    fixtureSources,
  });
  await Promise.all([
    writeFile(resolve(values.output), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(resolve(values.summary), renderReportMarkdown(report)),
  ]);
  process.stdout.write(renderReportMarkdown(report));
  if (report.status === "partial-source-failure" || report.status === "mutation-failure") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
