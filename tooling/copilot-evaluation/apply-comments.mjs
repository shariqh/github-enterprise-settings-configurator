#!/usr/bin/env node

import {readFile} from "node:fs/promises";
import {
  MAX_ISSUES_PER_RUN,
  REVIEW_LABEL,
  isManagedReviewIssue,
  selectIssuesForEvaluation,
  validateCommentRequests,
} from "./lib/core.mjs";
import {createGitHubClient} from "./lib/github.mjs";

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  const outputPath = process.env.GH_AW_AGENT_OUTPUT;
  if (!repository || !token || !outputPath) {
    throw new Error("GITHUB_REPOSITORY, GH_TOKEN, and GH_AW_AGENT_OUTPUT are required.");
  }

  const agentOutput = JSON.parse(await readFile(outputPath, "utf8"));
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
  const issues = await client.listReviewIssuesWithComments(REVIEW_LABEL);
  const managedIssues = issues.filter(isManagedReviewIssue);
  const commentsByIssue = new Map(
    managedIssues.map((issue) => [issue.number, issue.comments]),
  );

  const allowedIssues = selectIssuesForEvaluation(
    managedIssues,
    commentsByIssue,
    MAX_ISSUES_PER_RUN,
  );
  const comments = validateCommentRequests(requests, allowedIssues);

  if (process.env.GH_AW_SAFE_OUTPUTS_STAGED === "true") {
    process.stdout.write(`Validated ${comments.length} staged comment(s); no comments posted.\n`);
    return;
  }

  for (const comment of comments) {
    await client.addIssueComment(comment.number, comment.body);
  }
  process.stdout.write(`Posted ${comments.length} validated managed comment(s).\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
