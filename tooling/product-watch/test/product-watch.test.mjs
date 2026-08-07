import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  buildCandidates,
  classifyEntry,
  decodeEntities,
  ingestSourceContent,
  parseIssueMarkers,
  planIssueActions,
  renderIssueBody,
  validateConfig,
} from "../lib/core.mjs";
import {parseState, renderStateBody, runProductWatch} from "../lib/runner.mjs";

const config = validateConfig(
  JSON.parse(
    await readFile(
      new URL("../config/v1.json", import.meta.url),
      "utf8",
    ),
  ),
);
const fixtureEntries = JSON.parse(
  await readFile(
    new URL("../fixtures/2026-watch-entries.json", import.meta.url),
    "utf8",
  ),
);
const fixtureSources = JSON.parse(
  await readFile(
    new URL("../fixtures/source-payloads.json", import.meta.url),
    "utf8",
  ),
);

test("2026 fixtures classify into expected review candidates", () => {
  for (const fixture of fixtureEntries) {
    const candidate = classifyEntry(fixture.entry, config);
    assert.equal(candidate.relevant, true, fixture.name);
    assert.equal(candidate.releaseStage, fixture.expected.releaseStage, fixture.name);
    assert.equal(candidate.versionSpecific, fixture.expected.versionSpecific, fixture.name);
    if (fixture.expected.ghesVersion) {
      assert.equal(candidate.ghesVersion, fixture.expected.ghesVersion, fixture.name);
    }
    for (const changeType of fixture.expected.changeTypes) {
      assert.ok(candidate.changeTypes.includes(changeType), `${fixture.name}: ${changeType}`);
    }
    for (const settingId of fixture.expected.settingIds) {
      assert.ok(candidate.settingIds.includes(settingId), `${fixture.name}: ${settingId}`);
    }
  }
});

test("normalization produces a stable fingerprint", () => {
  const source = config.sources[0];
  const first = ingestSourceContent(
    source,
    "<rss><channel><item><title>A &amp; B</title><link>https://example.com/change?utm_source=test</link><pubDate>Tue, 24 Feb 2026 15:49:29 +0000</pubDate><description><![CDATA[<p>Code   Quality</p>]]></description></item></channel></rss>",
  )[0];
  const second = ingestSourceContent(
    source,
    "<rss><channel><item><title><![CDATA[A & B]]></title><link>https://example.com/change</link><pubDate>2026-02-24T15:49:29Z</pubDate><description>Code Quality</description></item></channel></rss>",
  )[0];
  assert.equal(
    classifyEntry(first, config).fingerprint,
    classifyEntry(second, config).fingerprint,
  );
});

test("numeric entity decoding rejects invalid Unicode scalar values safely", () => {
  assert.equal(
    decodeEntities("valid &#65; invalid &#9999999; &#xFFFFFFFF; &#xD800;"),
    "valid A invalid \uFFFD \uFFFD \uFFFD",
  );
});

test("source adapters parse RSS and HTML sections deterministically", () => {
  const entries = config.sources.flatMap((source) =>
    ingestSourceContent(source, fixtureSources[source.id])
  );
  const candidates = buildCandidates(entries, config);
  assert.ok(candidates.some((candidate) => candidate.releaseStage === "public-preview"));
  assert.ok(candidates.some((candidate) => candidate.changeTypes.includes("deprecation")));
  assert.ok(candidates.some((candidate) => candidate.versionSpecific));
});

test("long same-prefix headings keep distinct candidate identities", () => {
  const prefix = "A".repeat(120);
  const source = {
    ...config.sources.find((candidate) => candidate.kind === "html-sections"),
    headingLevels: [2],
  };
  const entries = ingestSourceContent(
    source,
    `<main><h2>${prefix} first</h2><p>GitHub Code Security configuration changed.</p><h2>${prefix} second</h2><p>GitHub Secret Protection configuration changed.</p></main>`,
  );
  const candidates = buildCandidates(entries, config);
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].candidateKey, candidates[1].candidateKey);
  assert.equal(
    new Set(planIssueActions(candidates, [], []).map((action) => action.candidate.candidateKey)).size,
    2,
  );
});

test("issue planning creates, skips, and updates without duplicates", () => {
  const candidate = classifyEntry(fixtureEntries[0].entry, config);
  const body = renderIssueBody(candidate);
  const issue = {number: 12, html_url: "https://example.test/12", body};

  assert.equal(planIssueActions([candidate], [], [])[0].type, "create");
  assert.equal(planIssueActions([candidate], [issue], [])[0].type, "skip");
  assert.equal(
    planIssueActions([{...candidate, fingerprint: "a".repeat(64)}], [issue], [])[0].type,
    "update",
  );
  assert.equal(planIssueActions([candidate], [], [candidate.fingerprint])[0].type, "skip");
  assert.deepEqual(parseIssueMarkers(body), {
    candidateKey: candidate.candidateKey,
    fingerprint: candidate.fingerprint,
  });
});

test("managed issue updates preserve checked disposition and human notes", () => {
  const candidate = classifyEntry(fixtureEntries[1].entry, config);
  const existing = renderIssueBody(candidate)
    .replace("- [ ] Defer until GA", "- [x] Defer until GA")
    .replace(
      "_Add reviewer notes below this line; product-watch updates preserve this section._",
      "Reviewer approved deferring this until Q4.",
    );
  const updated = renderIssueBody({...candidate, fingerprint: "b".repeat(64)}, existing);
  assert.match(updated, /Reviewer approved deferring this until Q4/);
  assert.match(updated, /^- \[x\] Defer until GA$/m);
  assert.match(updated, /^- \[ \] Update required$/m);
  assert.match(updated, /Source evidence/);
});

test("state payload round-trips", () => {
  const state = {
    schemaVersion: 1,
    lastSuccessfulScan: "2026-08-07T12:00:00.000Z",
    sources: {},
    fingerprints: ["a".repeat(64)],
  };
  assert.deepEqual(parseState(renderStateBody(state)), state);
});

test("partial source failures do not call GitHub or advance state", async () => {
  let githubCalls = 0;
  const githubClient = new Proxy({}, {
    get() {
      return async () => {
        githubCalls += 1;
        throw new Error("GitHub should not be called");
      };
    },
  });
  const incompleteFixtures = {...fixtureSources};
  delete incompleteFixtures["github-docs-rest-api-versions"];

  const report = await runProductWatch({
    config,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: incompleteFixtures,
    githubClient,
    now: () => new Date("2026-08-07T12:00:00Z"),
  });

  assert.equal(report.status, "partial-source-failure");
  assert.equal(report.stateAdvanced, false);
  assert.equal(githubCalls, 0);
  assert.equal(report.errors[0].sourceId, "github-docs-rest-api-versions");
});

test("malformed numeric entities do not fail end-to-end ingestion", async () => {
  const malformedSources = {
    ...fixtureSources,
    "github-changelog": fixtureSources["github-changelog"].replace(
      "GitHub Code Quality",
      "GitHub Code Quality &#9999999; &#xFFFFFFFF; &#xD800;",
    ),
  };
  const report = await runProductWatch({
    config,
    repository: "owner/repo",
    token: "",
    dryRun: true,
    fixtureSources: malformedSources,
    now: () => new Date("2026-08-07T12:00:00Z"),
  });
  assert.equal(report.status, "dry-run");
  assert.equal(report.errors.length, 0);
  assert.ok(report.sources.every((source) => source.status === "ok"));
  assert.ok(report.candidates.some((candidate) => candidate.title.includes("\uFFFD")));
});

test("fixture dry run produces issue actions without mutations", async () => {
  const report = await runProductWatch({
    config,
    repository: "owner/repo",
    token: "",
    dryRun: true,
    fixtureSources,
    now: () => new Date("2026-08-07T12:00:00Z"),
  });
  assert.equal(report.status, "dry-run");
  assert.equal(report.stateAdvanced, false);
  assert.ok(report.actions.some((action) => action.type === "create"));
  assert.ok(report.candidateCount >= 4);
});

test("successful runs create, dedupe, and preserve reviewer state on update", async () => {
  let issueNumber = 100;
  const issues = [];
  const githubClient = {
    async listIssues(label) {
      return issues.filter((issue) => issue.labels.includes(label));
    },
    async ensureLabel() {},
    async createIssue(fields) {
      const issue = {
        ...fields,
        number: issueNumber,
        html_url: `https://example.test/issues/${issueNumber}`,
        state: "open",
      };
      issueNumber += 1;
      issues.push(issue);
      return issue;
    },
    async updateIssue(number, fields) {
      const issue = issues.find((candidate) => candidate.number === number);
      Object.assign(issue, fields);
      return issue;
    },
  };

  const first = await runProductWatch({
    config,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources,
    githubClient,
    now: () => new Date("2026-08-07T12:00:00Z"),
  });
  assert.equal(first.status, "success");
  assert.equal(first.stateAdvanced, true);
  assert.equal(
    issues.filter((issue) => issue.labels.includes(config.state.reviewLabel)).length,
    first.candidateCount,
  );
  assert.equal(
    issues.filter((issue) => issue.labels.includes(config.state.issueLabel)).length,
    1,
  );

  const second = await runProductWatch({
    config,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources,
    githubClient,
    now: () => new Date("2026-08-08T12:00:00Z"),
  });
  assert.equal(second.status, "success");
  assert.ok(second.actions.every((action) => action.type === "skip"));
  assert.equal(
    issues.filter((issue) => issue.labels.includes(config.state.reviewLabel)).length,
    first.candidateCount,
  );

  const reviewIssue = issues.find((issue) =>
    issue.labels.includes(config.state.reviewLabel)
    && issue.title.includes("Code Quality")
  );
  reviewIssue.body = reviewIssue.body
    .replace("- [ ] Defer until GA", "- [x] Defer until GA")
    .replace(
      "_Add reviewer notes below this line; product-watch updates preserve this section._",
      "Wait for the preview to reach GA.",
    );
  const changedSources = {
    ...fixtureSources,
    "github-changelog": fixtureSources["github-changelog"].replace(
      "Code Quality can be enabled through security configurations.",
      "Code Quality can be enabled through security configurations. Additional guidance applies.",
    ),
  };
  const third = await runProductWatch({
    config,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: changedSources,
    githubClient,
    now: () => new Date("2026-08-09T12:00:00Z"),
  });
  assert.equal(third.status, "success");
  assert.ok(third.actions.some((action) => action.type === "update"));
  assert.match(reviewIssue.body, /^- \[x\] Defer until GA$/m);
  assert.match(reviewIssue.body, /Wait for the preview to reach GA/);
});
