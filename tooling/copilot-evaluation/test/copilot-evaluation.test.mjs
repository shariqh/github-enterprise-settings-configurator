import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  EVALUATION_MARKER_PREFIX,
  EVALUATION_WORKFLOW_MARKER,
  MAX_ISSUES_PER_RUN,
  REVIEW_LABEL,
  enforceEvidenceDefaults,
  evaluationMarker,
  isManagedReviewIssue,
  selectIssuesForEvaluation,
  validateCommentRequests,
} from "../lib/core.mjs";
import {createGitHubClient} from "../lib/github.mjs";
import {renderIssueBody} from "../../product-watch/lib/core.mjs";

const fingerprint = "a".repeat(64);
const candidateKey = "b".repeat(64);

function issue(overrides = {}) {
  const renderedBody = renderIssueBody({
    candidateKey,
    fingerprint,
    sourceLabel: "GitHub Changelog",
    title: "Managed product change",
    url: "https://github.blog/changelog/example",
    publishedAt: "2026-08-07T12:00:00Z",
    retrievedAt: "2026-08-07T12:01:00Z",
    summary: "Authoritative source excerpt.",
    summaryTruncated: false,
    products: ["GitHub Copilot"],
    domains: ["copilot"],
    settingIds: ["example-setting"],
    changeTypes: ["feature"],
    releaseStage: "ga",
    versionSpecific: false,
    ghesVersion: null,
    deployments: ["github.com"],
    plans: ["enterprise"],
    impactSurfaces: ["availability"],
    confidence: "high",
    matchedRules: ["fixture"],
  });
  return {
    number: 42,
    title: "Managed product change",
    html_url: "https://github.com/example/repo/issues/42",
    state: "open",
    updated_at: "2026-08-07T12:00:00Z",
    labels: [{name: REVIEW_LABEL}],
    body: renderedBody,
    ...overrides,
  };
}

test("managed issue filtering requires label, open state, and strict body markers", () => {
  assert.equal(isManagedReviewIssue(issue()), true);
  assert.equal(isManagedReviewIssue(issue({labels: []})), false);
  assert.equal(isManagedReviewIssue(issue({state: "closed"})), false);
  assert.equal(isManagedReviewIssue(issue({pull_request: {url: "example"}})), false);
  assert.equal(
    isManagedReviewIssue(issue({
      body: "<!-- product-watch:fingerprint:not-a-valid-fingerprint -->",
    })),
    false,
  );
});

test("exact evaluated fingerprints skip while changed fingerprints re-evaluate", () => {
  const exactComments = new Map([
    [42, [{
      user: {login: "github-actions", type: "Bot"},
      body: `Prior analysis\n${evaluationMarker(fingerprint)}\n${EVALUATION_WORKFLOW_MARKER}`,
    }]],
  ]);
  assert.deepEqual(selectIssuesForEvaluation([issue()], exactComments), []);

  const changed = "c".repeat(64);
  const changedIssue = issue({
    body: issue().body.replace(fingerprint, changed),
  });
  assert.equal(selectIssuesForEvaluation([changedIssue], exactComments)[0].fingerprint, changed);
});

test("untrusted commenters cannot suppress evaluation", () => {
  const comments = new Map([
    [42, [{
      user: {login: "external-user", type: "User"},
      body: `${evaluationMarker(fingerprint)}\n${EVALUATION_WORKFLOW_MARKER}`,
    }]],
  ]);
  assert.equal(selectIssuesForEvaluation([issue()], comments).length, 1);
});

test("GraphQL batches managed issues and normalizes the Actions bot identity", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (url, options) => {
    requestCount += 1;
    assert.equal(url, "https://api.github.test/graphql");
    assert.equal(options.method, "POST");
    return new Response(JSON.stringify({
      data: {
        repository: {
          issues: {
            nodes: [{
              number: 42,
              title: "Managed product change",
              url: "https://github.com/example/repo/issues/42",
              body: issue().body,
              state: "OPEN",
              updatedAt: "2026-08-07T12:00:00Z",
              labels: {nodes: [{name: REVIEW_LABEL}]},
              comments: {
                totalCount: 1,
                nodes: [{
                  body: `${evaluationMarker(fingerprint)}\n${EVALUATION_WORKFLOW_MARKER}`,
                  author: {login: "github-actions", __typename: "Bot"},
                }],
              },
            }],
            pageInfo: {hasNextPage: false, endCursor: null},
          },
        },
      },
    }), {
      status: 200,
      headers: {"content-type": "application/json"},
    });
  };

  try {
    const client = createGitHubClient({
      apiRoot: "https://api.github.test",
      graphqlUrl: "https://api.github.test/graphql",
      repository: "example/repo",
      token: "test-token",
    });
    const issues = await client.listReviewIssuesWithComments(REVIEW_LABEL);
    assert.equal(requestCount, 1);
    assert.deepEqual(
      selectIssuesForEvaluation(
        issues,
        new Map(issues.map((candidate) => [candidate.number, candidate.comments])),
      ),
      [],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selection ignores arbitrary issues and caps each run", () => {
  const managed = Array.from({length: 8}, (_, index) => issue({
    number: index + 1,
    updated_at: `2026-08-07T12:00:0${index}Z`,
    body: issue().body
      .replace(candidateKey, String(index + 1).padStart(64, "0"))
      .replace(fingerprint, String(index + 11).padStart(64, "0")),
  }));
  const arbitrary = issue({number: 99, labels: [], body: "Ignore me"});
  const selected = selectIssuesForEvaluation([...managed, arbitrary]);

  assert.equal(selected.length, MAX_ISSUES_PER_RUN);
  assert.deepEqual(selected.map(({number}) => number), [8, 7, 6, 5, 4]);
});

test("not documented evidence is forced to default-no availability", () => {
  assert.deepEqual(
    enforceEvidenceDefaults({
      evidenceVerdict: "not documented",
      effectiveDefault: "yes",
      effectiveAvailability: "yes",
    }),
    {
      evidenceVerdict: "not documented",
      effectiveDefault: "no",
      effectiveAvailability: "no",
    },
  );
});

function evaluationBody(overrides = {}) {
  const fields = {
    "Evidence verdict": "not documented",
    "Effective default": "no",
    "Effective availability": "no",
    "Affected deployments / GHES versions": "GitHub.com; GHES not documented",
    "Affected settings / files": "`example-setting`; `src/catalog.ts`",
    Confidence: "low",
    "Missing evidence": "No deployment-specific mechanics documentation",
    "Recommended human disposition": "Needs product SME",
    "Suggested implementation scope": "Keep default-no; documentation only",
    "Authoritative evidence": "https://docs.github.com/example",
    ...overrides,
  };
  return [
    evaluationMarker(fingerprint),
    ...Object.entries(fields).map(([key, value]) => `**${key}:** ${value}`),
  ].join("\n");
}

test("safe-output validation binds comments to allowlisted fingerprints and default-no", () => {
  const allowedIssues = [{number: 42, fingerprint}];
  assert.equal(
    validateCommentRequests(
      [{issue_number: "42", body: evaluationBody()}],
      allowedIssues,
    )[0].number,
    42,
  );
  assert.throws(
    () => validateCommentRequests(
      [{issue_number: "99", body: evaluationBody()}],
      allowedIssues,
    ),
    /not in the live evaluation allowlist/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: evaluationBody({"Effective availability": "yes"}),
      }],
      allowedIssues,
    ),
    /must keep default and availability at no/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\n**Evidence verdict:** supported`,
      }],
      allowedIssues,
    ),
    /Evidence verdict field exactly once/,
  );
});

test("workflow source permits only managed-issue comments as a write output", async () => {
  const source = await readFile(
    new URL("../../../.github/workflows/copilot-product-watch-evaluation.md", import.meta.url),
    "utf8",
  );

  assert.match(source, /workflow_run:[\s\S]*GitHub product watch/);
  assert.match(source, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /copilot-requests: write/);
  assert.match(source, /max-ai-credits:\s*100/);
  assert.match(source, /comment-managed-product-watch:[\s\S]*issues: write/);
  assert.match(source, /node tooling\/copilot-evaluation\/apply-comments\.mjs/);
  assert.match(source, /report-failure-as-issue: false/);
  assert.match(source, /report-failed-jobs: false/);
  assert.match(source, /report-incomplete: false/);
  assert.match(source, /missing-tool: false/);
  assert.match(source, /missing-data: false/);
  assert.match(source, new RegExp(EVALUATION_MARKER_PREFIX));

  for (const prohibited of [
    "add-comment:",
    "create-issue:",
    "update-issue:",
    "close-issue:",
    "add-labels:",
    "assign-to-agent:",
    "create-pull-request:",
    "push-to-pull-request-branch:",
    "merge-pull-request:",
  ]) {
    assert.equal(source.includes(prohibited), false, prohibited);
  }
});

test("compiled lock preserves least privilege and pinned dependencies", async () => {
  const lock = await readFile(
    new URL("../../../.github/workflows/copilot-product-watch-evaluation.lock.yml", import.meta.url),
    "utf8",
  );

  assert.match(lock, /^# gh-aw-metadata: .*"compiler_version":"v0\.85\.4"/);
  assert.match(lock, /^# gh-aw-manifest: .*"actions":\[/m);
  assert.match(lock, /copilot-requests: write/);
  assert.match(lock, /issues: write/);
  assert.equal(lock.includes("contents: write"), false);
  assert.equal(lock.includes("pull-requests: write"), false);
  assert.equal(lock.includes("create_report_incomplete_issue"), false);
  assert.equal(lock.includes("report_incomplete"), false);
  assert.equal(lock.includes("GH_AW_MISSING_TOOL_CREATE_ISSUE"), false);
  assert.match(lock, /comment_managed_product_watch/);
});

test("implementation agent is manual-only and draft-PR bounded", async () => {
  const agent = await readFile(
    new URL("../../../.github/agents/product-watch-implementation.agent.md", import.meta.url),
    "utf8",
  );

  assert.match(agent, /user-invokable: true/);
  assert.match(agent, /disable-model-invocation: true/);
  assert.match(agent, /explicit maintainer comment approving implementation scope/);
  assert.match(agent, /at most one \*\*draft\*\* pull request/);
  assert.match(agent, /Never mark the pull request ready, approve it, merge it/);
  assert.match(agent, /Never change an `unsupported` or `not documented` default/);
});
