#!/usr/bin/env node

import {appendFile, mkdir, writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {
  MAX_ISSUES_PER_RUN,
  REVIEW_LABEL,
  isManagedReviewIssue,
  selectIssuesForEvaluation,
} from "./lib/core.mjs";
import {createGitHubClient} from "./lib/github.mjs";

function parseArguments(argv) {
  const options = {
    output: ".github/aw/product-watch-evaluation-candidates.json",
    safeOutputs: process.env.GH_AW_SAFE_OUTPUTS ?? "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--output" || key === "--safe-outputs") {
      if (!value) {
        throw new Error(`${key} requires a value.`);
      }
      options[key === "--output" ? "output" : "safeOutputs"] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repository || !token) {
    throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required.");
  }

  const apiRoot = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const client = createGitHubClient({
    apiRoot,
    graphqlUrl: process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql",
    repository,
    token,
  });
  const issues = await client.listReviewIssuesWithComments(REVIEW_LABEL);
  const managedIssues = issues.filter(isManagedReviewIssue);
  const commentsByIssue = new Map(
    managedIssues.map((issue) => [issue.number, issue.comments]),
  );

  const candidates = selectIssuesForEvaluation(
    managedIssues,
    commentsByIssue,
    MAX_ISSUES_PER_RUN,
  );
  await mkdir(dirname(options.output), {recursive: true});
  await writeFile(
    options.output,
    `${JSON.stringify({
      schemaVersion: 1,
      repository,
      maxIssuesPerRun: MAX_ISSUES_PER_RUN,
      issues: candidates,
    }, null, 2)}\n`,
  );

  if (candidates.length === 0 && options.safeOutputs) {
    await mkdir(dirname(options.safeOutputs), {recursive: true});
    await appendFile(
      options.safeOutputs,
      `${JSON.stringify({
        type: "noop",
        message: "No new or changed managed product-watch fingerprints require evaluation.",
      })}\n`,
    );
  }

  process.stdout.write(`Selected ${candidates.length} managed product-watch issue(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
