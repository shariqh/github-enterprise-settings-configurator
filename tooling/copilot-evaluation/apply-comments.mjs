#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import {
  validateCommentRequests,
  validateLiveSelectedIssue,
} from "./lib/core.mjs";
import {verifyAuthoritativeUrls} from "./lib/evidence.mjs";
import {createGitHubClient} from "./lib/github.mjs";

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  const outputPath = process.env.GH_AW_AGENT_OUTPUT;
  const selectionPath = process.env.PRODUCT_WATCH_SELECTION_PATH;
  if (!repository || !token || !outputPath || !selectionPath) {
    throw new Error(
      "GITHUB_REPOSITORY, GH_TOKEN, GH_AW_AGENT_OUTPUT, and PRODUCT_WATCH_SELECTION_PATH are required.",
    );
  }

  const agentOutput = JSON.parse(await readFile(outputPath, "utf8"));
  const selection = JSON.parse(await readFile(selectionPath, "utf8"));
  if (
    selection.schemaVersion !== 1
    || selection.repository !== repository
    || !Array.isArray(selection.issues)
    || selection.issues.length > 5
  ) {
    throw new Error("Selection artifact is invalid for this repository and run.");
  }
  const requests = (agentOutput.items ?? []).filter(
    (item) => item.type === "comment_managed_product_watch",
  );
  if (requests.length === 0) {
    process.stdout.write("No managed product-watch comments requested.\n");
    return;
  }

  const client = createGitHubClient({
    apiRoot: process.env.GITHUB_API_URL ?? "https://api.github.com",
    graphqlUrl: process.env.GITHUB_GRAPHQL_URL ?? "https://api.github.com/graphql",
    repository,
    token,
  });
  const comments = validateCommentRequests(requests, selection.issues);

  for (const comment of comments) {
    const liveIssue = await client.getIssue(comment.number);
    const liveComments = await client.listIssueComments(comment.number);
    validateLiveSelectedIssue(liveIssue, comment, liveComments);
  }
  await verifyAuthoritativeUrls(comments.flatMap((comment) => comment.evidenceUrls));

  if (process.env.GH_AW_SAFE_OUTPUTS_STAGED === "true") {
    process.stdout.write(`Validated ${comments.length} staged comment(s); no comments posted.\n`);
    return;
  }

  let posted = 0;
  try {
    for (const comment of comments) {
      await client.addIssueComment(comment.number, comment.body);
      posted += 1;
    }
  } catch (error) {
    throw new Error(
      `Comment posting failed after ${posted} of ${comments.length} comments; the run may be partially posted.`,
      {cause: error},
    );
  }
  process.stdout.write(`Posted ${comments.length} validated managed comment(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
