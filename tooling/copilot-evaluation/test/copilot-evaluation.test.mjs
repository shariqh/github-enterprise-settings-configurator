import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  EVALUATION_MARKER_PREFIX,
  EVALUATION_WORKFLOW_MARKER,
  MAX_COMMENT_CHARS,
  MAX_EVIDENCE_URLS_PER_BATCH,
  MAX_EVIDENCE_URLS_PER_COMMENT,
  MAX_ISSUES_PER_RUN,
  REVIEW_LABEL,
  enforceEvidenceDefaults,
  evaluationMarker,
  isManagedReviewIssue,
  neutralizeGitHubReferences,
  selectIssuesForEvaluation,
  validateCommentRequests,
  validateLiveSelectedIssue,
} from "../lib/core.mjs";
import {verifyAuthoritativeUrls} from "../lib/evidence.mjs";
import {createGitHubClient} from "../lib/github.mjs";
import {
  classifyEntry,
  renderIssueBody,
  validateConfig,
} from "../../product-watch/lib/core.mjs";

const productWatchConfig = validateConfig(
  JSON.parse(
    await readFile(
      new URL("../../product-watch/config/v1.json", import.meta.url),
      "utf8",
    ),
  ),
);
const productWatchFixtures = JSON.parse(
  await readFile(
    new URL("../../product-watch/fixtures/2026-watch-entries.json", import.meta.url),
    "utf8",
  ),
);
const producerCandidate = classifyEntry(
  productWatchFixtures[0].entry,
  productWatchConfig,
);
const {fingerprint, candidateKey} = producerCandidate;

function issue(overrides = {}) {
  const renderedBody = renderIssueBody({
    ...producerCandidate,
    retrievedAt: "2026-08-07T12:01:00Z",
  });
  return {
    number: 42,
    title: producerCandidate.title,
    html_url: "https://github.com/example/repo/issues/42",
    state: "open",
    updated_at: "2026-08-07T12:00:00Z",
    labels: [{name: REVIEW_LABEL}],
    body: renderedBody,
    ...overrides,
  };
}

test("managed issue filtering requires label, open state, and strict body markers", () => {
  assert.equal(candidateKey.length, 24);
  assert.equal(fingerprint.length, 64);
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

test("trusted comments with multiple markers suppress no fingerprint", () => {
  const comments = new Map([
    [42, [{
      user: {login: "github-actions", type: "Bot"},
      body: [
        evaluationMarker(fingerprint),
        evaluationMarker("f".repeat(64)),
        EVALUATION_WORKFLOW_MARKER,
      ].join("\n"),
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
      .replace(candidateKey, String(index + 1).padStart(24, "0"))
      .replace(fingerprint, String(index + 11).padStart(64, "0")),
  }));
  const arbitrary = issue({number: 99, labels: [], body: "Ignore me"});
  const selected = selectIssuesForEvaluation([...managed, arbitrary]);

  assert.equal(selected.length, MAX_ISSUES_PER_RUN);
  assert.deepEqual(selected.map(({number}) => number), [8, 7, 6, 5, 4]);
});

test("unsupported and not documented evidence are forced to default-no availability", () => {
  for (const evidenceVerdict of ["unsupported", "not documented"]) {
    assert.deepEqual(
      enforceEvidenceDefaults({
        evidenceVerdict,
        effectiveDefault: "yes",
        effectiveAvailability: "yes",
      }),
      {
        evidenceVerdict,
        effectiveDefault: "no",
        effectiveAvailability: "no",
      },
    );
  }
});

function evaluationBody(overrides = {}, markerFingerprint = fingerprint) {
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
    evaluationMarker(markerFingerprint),
    ...Object.entries(fields).map(([key, value]) => `**${key}:** ${value}`),
  ].join("\n");
}

test("evidence URL counts are bounded per comment and batch", () => {
  const tooMany = Array.from(
    {length: MAX_EVIDENCE_URLS_PER_COMMENT + 1},
    (_, index) => `https://docs.github.com/en/example/per-comment-${index}`,
  ).join(" ");
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: evaluationBody({"Authoritative evidence": tooMany}),
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /at most 8 distinct authoritative URLs/,
  );

  const requestCount = 3;
  const urlsPerRequest = Math.floor(MAX_EVIDENCE_URLS_PER_BATCH / requestCount) + 1;
  const requests = [];
  const selected = [];
  for (let requestIndex = 0; requestIndex < requestCount; requestIndex += 1) {
    const requestFingerprint = String(requestIndex + 31).padStart(64, "0");
    requests.push({
      issue_number: String(requestIndex + 1),
      body: evaluationBody({
        "Authoritative evidence": Array.from(
          {length: urlsPerRequest},
          (_, urlIndex) =>
            `https://docs.github.com/en/example/batch-${requestIndex}-${urlIndex}`,
        ).join(" "),
      }, requestFingerprint),
    });
    selected.push({
      number: requestIndex + 1,
      candidateKey: String(requestIndex + 1).padStart(24, "0"),
      fingerprint: requestFingerprint,
    });
  }
  assert.throws(
    () => validateCommentRequests(requests, selected),
    /at most 20 distinct authoritative URLs/,
  );
});

test("safe-output validation binds comments to allowlisted fingerprints and default-no", () => {
  const allowedIssues = [{number: 42, candidateKey, fingerprint}];
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
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\n${evaluationMarker("f".repeat(64))}`,
      }],
      allowedIssues,
    ),
    /exact evaluation marker once/,
  );
  for (const injectedMarker of [
    `<!-- product-watch&colon;agent-evaluation:${"f".repeat(64)} -->`,
    `<!-- product-watch&#58;agent-evaluation:${"f".repeat(64)} -->`,
    `<!-- product-watch&#x3a;agent-evaluation:${"f".repeat(64)} -->`,
    `<!-- product-watch\\:agent-evaluation:${"f".repeat(64)} -->`,
    `<!-- product-watch&amp;amp;colon;agent-evaluation:${"f".repeat(64)} -->`,
    `<!-- product&#45;watch:agent-evaluation:${"f".repeat(64)} -->`,
  ]) {
    assert.throws(
      () => validateCommentRequests(
        [{
          issue_number: "42",
          body: `${evaluationBody()}\n${injectedMarker}`,
        }],
        allowedIssues,
      ),
      /exact evaluation marker once/,
    );
  }
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: evaluationBody({
          "Evidence verdict": "unsupported",
          "Effective default": "yes",
          "Effective availability": "yes",
        }),
      }],
      allowedIssues,
    ),
    /must keep default and availability at no/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\n${"x".repeat(MAX_COMMENT_CHARS)}`,
      }],
      allowedIssues,
    ),
    /must not exceed 60000 characters/,
  );
});

test("safe-output comments neutralize GitHub notifications and cross-references", () => {
  const sanitized = neutralizeGitHubReferences(
    "@octocat and &#64;hubot review #123, &num;124, owner/repo#456, GH-789, http://www.github.com/owner/repo/issues/321, /owner/repo/pull/322, and https:\\/\\/github.com/owner/repo/issues/323.",
  );
  assert.equal(sanitized.includes("@octocat"), false);
  assert.equal(sanitized.includes("&#64;hubot"), false);
  assert.equal(sanitized.includes("#123"), false);
  assert.equal(sanitized.includes("#124"), false);
  assert.equal(sanitized.includes("repo#456"), false);
  assert.equal(sanitized.includes("GH-789"), false);
  assert.equal(sanitized.includes("/issues/321"), false);
  assert.equal(sanitized.includes("/pull/322"), false);
  assert.equal(sanitized.includes("/issues/323"), false);
  assert.match(sanitized, /@\u200Boctocat/);
  assert.match(sanitized, /#\u200B123/);
});

test("authoritative evidence URLs fail closed on missing and unsafe redirects", async () => {
  await assert.rejects(
    verifyAuthoritativeUrls(
      ["https://docs.github.com/en/example/missing"],
      {fetchImpl: async () => new Response(null, {status: 404})},
    ),
    /HTTP 404/,
  );

  const redirects = [];
  await verifyAuthoritativeUrls(
    ["https://docs.github.com/en/example/start"],
    {
      fetchImpl: async (url) => {
        redirects.push(url);
        return redirects.length === 1
          ? new Response(null, {
            status: 302,
            headers: {location: "/en/example/final"},
          })
          : new Response("ok", {status: 200});
      },
    },
  );
  assert.deepEqual(redirects, [
    "https://docs.github.com/en/example/start",
    "https://docs.github.com/en/example/final",
  ]);

  await assert.rejects(
    verifyAuthoritativeUrls(
      ["https://docs.github.com/en/example/start"],
      {
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: {location: "https://example.com/not-authoritative"},
        }),
      },
    ),
    /redirected outside allowed GitHub sources/,
  );
});

test("affirmative conclusions require an authoritative GitHub Docs URL", () => {
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: evaluationBody({
          "Evidence verdict": "supported",
          "Effective default": "yes",
          "Effective availability": "yes",
          "Authoritative evidence": "https://github.blog/changelog/2026-08-07-example",
        }),
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /requires an authoritative GitHub Docs URL/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: evaluationBody({
          "Evidence verdict": "supported",
          "Effective default": "yes",
          "Effective availability": "yes",
          "Authoritative evidence": "https://github.com/github/docs/issues/123",
        }),
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /Authoritative evidence must include/,
  );
});

test("comment validation rejects external URLs anywhere in decoded Markdown", () => {
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\nExtra: [external](HTTPS&colon;//example.com/phish)`,
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /bare HTTPS URLs/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\nExtra: https&amp;amp;colon;//example.com/phish`,
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /Comment URL is not an allowed authoritative GitHub source/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\nExtra: [external](https:\\/\\/example.com/phish)`,
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /bare HTTPS URLs/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\nExtra: www.example.com/phish`,
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /Comment URL is not an allowed authoritative GitHub source/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\nExtra: [external](&#104;ttps&colon;&sol;&sol;example.com/phish)`,
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /bare HTTPS URLs/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\nExtra: [https://docs.github.com/en/get-started#](https://example.com/phish)`,
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /bare HTTPS URLs/,
  );
  assert.throws(
    () => validateCommentRequests(
      [{
        issue_number: "42",
        body: `${evaluationBody()}\nExtra: [external](<//example.com/phish>)`,
      }],
      [{number: 42, candidateKey, fingerprint}],
    ),
    /bare HTTPS URLs/,
  );
  for (const autolink of [
    "<ftp://example.com/payload>",
    "<mailto:attacker@example.com>",
    "attacker@example.com",
  ]) {
    assert.throws(
      () => validateCommentRequests(
        [{
          issue_number: "42",
          body: `${evaluationBody()}\nExtra: ${autolink}`,
        }],
        [{number: 42, candidateKey, fingerprint}],
      ),
      /bare HTTPS URLs/,
    );
  }
});

test("all cited authoritative URLs are returned for live verification", async () => {
  const [comment] = validateCommentRequests(
    [{
      issue_number: "42",
      body: evaluationBody({
        "Missing evidence": "Check https://docs.github.com/en/example/nonexistent",
      }),
    }],
    [{number: 42, candidateKey, fingerprint}],
  );
  assert.deepEqual(comment.evidenceUrls.sort(), [
    "https://docs.github.com/en/example/nonexistent",
    "https://docs.github.com/example",
  ]);
  await assert.rejects(
    verifyAuthoritativeUrls(comment.evidenceUrls, {
      fetchImpl: async (url) => new Response(null, {
        status: url.endsWith("/nonexistent") ? 404 : 200,
      }),
    }),
    /HTTP 404/,
  );
});

test("bare URL extraction follows GFM trailing-punctuation behavior", () => {
  const [comment] = validateCommentRequests(
    [{
      issue_number: "42",
      body: evaluationBody({
        "Missing evidence": "See https://docs.github.com/en/get-started.",
      }),
    }],
    [{number: 42, candidateKey, fingerprint}],
  );
  assert.ok(comment.evidenceUrls.includes("https://docs.github.com/en/get-started"));
  assert.equal(comment.evidenceUrls.includes("https://docs.github.com/en/get-started."), false);
});

test("live apply validation uses the persisted selection and fails on target drift", () => {
  const selected = {number: 42, candidateKey, fingerprint};
  assert.equal(validateLiveSelectedIssue(issue(), selected), true);

  const changed = issue({
    body: issue().body.replace(fingerprint, "d".repeat(64)),
  });
  assert.throws(
    () => validateLiveSelectedIssue(changed, selected),
    /changed after selection/,
  );
  assert.throws(
    () => validateLiveSelectedIssue(issue({state: "closed"}), selected),
    /no longer an open managed review issue/,
  );
  assert.throws(
    () => validateLiveSelectedIssue(issue({labels: []}), selected),
    /no longer an open managed review issue/,
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
  assert.match(source, /engine:[\s\S]*id: copilot/);
  assert.equal(source.includes("copilot-requests: write"), false);
  assert.match(source, /max-ai-credits:\s*100/);
  assert.match(source, /comment-managed-product-watch:[\s\S]*issues: write/);
  assert.match(source, /node tooling\/copilot-evaluation\/apply-comments\.mjs/);
  assert.match(source, /select_product_watch:[\s\S]*needs: activation/);
  assert.match(source, /candidate_count: \$\{\{ steps\.select\.outputs\.candidate_count \}\}/);
  assert.match(
    source,
    /agent:[\s\S]*needs: \[select_product_watch\][\s\S]*candidate_count != '0'/,
  );
  assert.match(source, /safe-outputs:\s*\n\s*timeout-minutes: 10/);
  assert.match(source, /timeout 9m node tooling\/copilot-evaluation\/apply-comments\.mjs/);
  assert.match(source, /Persist exact evaluation selection/);
  assert.match(source, /Restore exact evaluation selection/);
  assert.match(source, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(source, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(source, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/);
  assert.match(source, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/);
  for (const match of source.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)) {
    assert.match(match[2], /^[a-f0-9]{40}$/, `mutable source action: ${match[0]}`);
  }
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

test("selector and apply scripts preserve the exact pre-agent selection", async () => {
  const [selector, apply] = await Promise.all([
    readFile(
      new URL("../select-managed-issues.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../apply-comments.mjs", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(selector, /candidate_count=\$\{candidates\.length\}/);
  assert.equal(selector.includes("GH_AW_SAFE_OUTPUTS"), false);
  assert.match(apply, /PRODUCT_WATCH_SELECTION_PATH/);
  assert.match(apply, /validateLiveSelectedIssue/);
  assert.equal(apply.includes("selectIssuesForEvaluation"), false);
  assert.equal(apply.includes("listReviewIssuesWithComments"), false);
});

test("compiled lock preserves least privilege and pinned dependencies", async () => {
  const lock = await readFile(
    new URL("../../../.github/workflows/copilot-product-watch-evaluation.lock.yml", import.meta.url),
    "utf8",
  );

  assert.match(lock, /^# gh-aw-metadata: .*"compiler_version":"v0\.85\.4"/);
  assert.match(lock, /^# gh-aw-manifest: .*"actions":\[/m);
  assert.doesNotMatch(lock, /^\s+copilot-requests:\s+write\s*$/m);
  assert.match(lock, /name: Validate COPILOT_GITHUB_TOKEN secret/);
  assert.match(lock, /validate_multi_secret\.sh" COPILOT_GITHUB_TOKEN/);
  assert.match(lock, /COPILOT_GITHUB_TOKEN: \$\{\{ secrets\.COPILOT_GITHUB_TOKEN \}\}/);
  assert.match(lock, /issues: write/);
  assert.equal(lock.includes("contents: write"), false);
  assert.equal(lock.includes("pull-requests: write"), false);
  assert.equal(lock.includes("create_report_incomplete_issue"), false);
  assert.equal(lock.includes("report_incomplete"), false);
  assert.equal(lock.includes("GH_AW_MISSING_TOOL_CREATE_ISSUE"), false);
  assert.match(lock, /comment_managed_product_watch/);
  assert.match(
    lock,
    /select_product_watch:[\s\S]*candidate_count: \$\{\{ steps\.select\.outputs\.candidate_count \}\}[\s\S]*select-managed-issues\.mjs/,
  );
  assert.match(
    lock,
    /agent:[\s\S]*needs:[\s\S]*select_product_watch[\s\S]*candidate_count != '0'/,
  );
  assert.match(
    lock,
    /comment_managed_product_watch:[\s\S]*timeout 9m node tooling\/copilot-evaluation\/apply-comments\.mjs/,
  );

  const manifest = JSON.parse(
    lock.split("\n", 2)[1].replace("# gh-aw-manifest: ", ""),
  );
  const actionLock = JSON.parse(
    await readFile(
      new URL("../../../.github/aw/actions-lock.json", import.meta.url),
      "utf8",
    ),
  );
  for (const action of manifest.actions) {
    assert.match(action.sha, /^[a-f0-9]{40}$/);
  }
  for (const [key, entry] of Object.entries(actionLock.entries)) {
    const action = manifest.actions.find(
      (candidate) => `${candidate.repo}@${candidate.version}` === key,
    );
    assert.ok(action, `orphaned action lock entry for ${key}`);
    assert.equal(entry.sha, action.sha);
  }
});

test("implementation agent is manual-only and mechanically patch-only", async () => {
  const agent = await readFile(
    new URL("../../../.github/agents/product-watch-implementation.agent.md", import.meta.url),
    "utf8",
  );

  assert.match(agent, /user-invokable: true/);
  assert.match(agent, /disable-model-invocation: true/);
  assert.match(agent, /tools: \["read", "search", "edit"\]/);
  assert.equal(agent.includes("\"execute\""), false);
  assert.match(agent, /Leave commit, push, and pull-request publication/);
  assert.match(agent, /Never change an `unsupported` or `not documented` default/);
});
