import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {
  GHES_RELEASE_KINDS,
  assertAllowedDocsUrl,
  buildVersionDiscoveredEntry,
  classifyEntry,
  compareGhesVersions,
  parseGhesReleaseIndex,
  validateConfig,
} from "../lib/core.mjs";
import {runProductWatch} from "../lib/runner.mjs";

const configV2 = validateConfig(
  JSON.parse(
    await readFile(new URL("../config/v2.json", import.meta.url), "utf8"),
  ),
);
const configV1 = validateConfig(
  JSON.parse(
    await readFile(new URL("../config/v1.json", import.meta.url), "utf8"),
  ),
);
const baseFixtureSources = JSON.parse(
  await readFile(new URL("../fixtures/source-payloads.json", import.meta.url), "utf8"),
);
const ghesFixtures = JSON.parse(
  await readFile(
    new URL("../fixtures/ghes-discovery-payloads.json", import.meta.url),
    "utf8",
  ),
);

function v2FixtureSources(overrides = {}) {
  return {
    "github-changelog": baseFixtureSources["github-changelog"],
    "github-docs-code-security-configurations":
      baseFixtureSources["github-docs-code-security-configurations"],
    "github-docs-rest-api-versions": baseFixtureSources["github-docs-rest-api-versions"],
    "ghes-3.21-release-notes": ghesFixtures["ghes-3.21-release-notes"],
    "ghes-release-index": ghesFixtures["ghes-release-index"],
    "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes":
      ghesFixtures["https://docs.github.com/en/enterprise-server@3.22/admin/release-notes"],
    ...overrides,
  };
}

test("v1 config remains valid and untouched for reproducibility", () => {
  assert.equal(configV1.schemaVersion, 1);
  assert.equal(configV1.ghesRelease, undefined);
});

test("v2 config models GHES 3.21 as the baseline and enables discovery", () => {
  assert.equal(configV2.schemaVersion, 2);
  assert.deepEqual(configV2.ghesRelease.modeledVersions, ["3.21"]);
  assert.ok(configV2.sources.some((source) => source.kind === "ghes-release-index"));
});

test("compareGhesVersions orders major.minor version strings numerically", () => {
  assert.ok(compareGhesVersions("3.22", "3.21") > 0);
  assert.ok(compareGhesVersions("3.9", "3.10") < 0);
  assert.equal(compareGhesVersions("3.21", "3.21"), 0);
});

test("assertAllowedDocsUrl rejects hosts and paths outside the authoritative allow-list", () => {
  const {ghesRelease} = configV2;
  assert.doesNotThrow(() =>
    assertAllowedDocsUrl(
      "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes",
      ghesRelease,
    )
  );
  assert.throws(
    () => assertAllowedDocsUrl("https://evil.example.com/en/enterprise-server@3.22/admin/release-notes", ghesRelease),
    /disallowed host/,
  );
  assert.throws(
    () => assertAllowedDocsUrl("https://docs.github.com/en/some-other-product", ghesRelease),
    /disallowed path/,
  );
  assert.throws(
    () => assertAllowedDocsUrl("http://docs.github.com/en/enterprise-server@3.22/admin/release-notes", ghesRelease),
    /non-https/,
  );
  assert.throws(
    () => assertAllowedDocsUrl("not a url", ghesRelease),
    /malformed/,
  );
});

test("parseGhesReleaseIndex extracts full version metadata and tracked-only lifecycle entries", () => {
  const source = {
    id: "ghes-release-index",
    label: "GitHub Enterprise Server all releases",
    url: "https://docs.github.com/en/enterprise-server@3.21/admin/all-releases",
    kind: "ghes-release-index",
    deployments: ["ghes"],
    ghesRelease: configV2.ghesRelease,
  };
  const {entries, versions} = parseGhesReleaseIndex(ghesFixtures["ghes-release-index"], source);

  assert.equal(versions.length, 3, "all rows are captured in versions metadata");
  const v322 = versions.find((row) => row.version === "3.22");
  assert.equal(v322.supported, true);
  assert.equal(v322.releaseDate, "2026-09-01");
  const v316 = versions.find((row) => row.version === "3.16");
  assert.equal(v316.supported, false);

  // 3.16 is older than the modeled baseline (3.21) and must not generate a
  // lifecycle candidate entry, to avoid daily noise from superseded versions.
  assert.equal(entries.some((entry) => entry.sourceVersion === "3.16"), false);
  assert.equal(entries.filter((entry) => entry.ghesReleaseKind === GHES_RELEASE_KINDS.LIFECYCLE).length, 2);
  assert.ok(entries.some((entry) => entry.sourceVersion === "3.21"));
  assert.ok(entries.some((entry) => entry.sourceVersion === "3.22"));
});

test("buildVersionDiscoveredEntry always defaults to unavailable/unmodeled, even without release notes", () => {
  const row = {
    version: "3.22",
    candidateDate: "2026-08-04",
    releaseDate: "2026-09-01",
    closingDownDate: "2027-09-01",
    supported: true,
    releaseNotesUrl: null,
  };
  const entry = buildVersionDiscoveredEntry(row, configV2.ghesRelease, "ghes-release-index");
  assert.equal(entry.ghesReleaseKind, GHES_RELEASE_KINDS.VERSION_DISCOVERED);
  assert.equal(entry.discoveredVersion, true);
  assert.match(entry.summary, /effective unavailable\/unmodeled/);

  const failedEntry = buildVersionDiscoveredEntry(
    row,
    configV2.ghesRelease,
    "ghes-release-index",
    new Error("503 Service Unavailable"),
  );
  assert.match(failedEntry.summary, /could not be retrieved/);
  assert.match(failedEntry.summary, /503 Service Unavailable/);
});

test("classifyEntry distinguishes GHES feature release candidate, stable, and patch entries", () => {
  const candidateEntry = classifyEntry(
    {
      id: "https://docs.github.com/x#candidate",
      sourceId: "ghes-discovered-3.22",
      sourceLabel: "GitHub Enterprise Server 3.22 release notes (discovered)",
      sourceUrl: "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes",
      title: "3.22.0 Release Candidate 1",
      url: "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes#3-22-0-rc-1",
      publishedAt: "2026-08-04T00:00:00.000Z",
      summary: "This release candidate for GitHub Enterprise Server 3.22 introduces GitHub Code Security configuration improvements.",
      deployments: ["ghes"],
      sourceVersion: "3.22",
      discoveredVersion: true,
    },
    configV2,
  );
  assert.equal(candidateEntry.ghesCandidateType, GHES_RELEASE_KINDS.FEATURE_CANDIDATE);
  assert.equal(candidateEntry.unmodeledVersion, true);
  assert.ok(candidateEntry.changeTypes.includes(GHES_RELEASE_KINDS.FEATURE_CANDIDATE));

  const stableEntry = classifyEntry(
    {
      id: "https://docs.github.com/x#stable",
      sourceId: "ghes-discovered-3.22",
      sourceLabel: "GitHub Enterprise Server 3.22 release notes (discovered)",
      sourceUrl: "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes",
      title: "3.22.0",
      url: "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes#3-22-0",
      publishedAt: "2026-09-01T00:00:00.000Z",
      summary: "GitHub Enterprise Server 3.22 is now generally available. This feature release includes GitHub Secret Protection secret scanning improvements.",
      deployments: ["ghes"],
      sourceVersion: "3.22",
      discoveredVersion: true,
    },
    configV2,
  );
  assert.equal(stableEntry.ghesCandidateType, GHES_RELEASE_KINDS.FEATURE_STABLE);

  const patchEntry = classifyEntry(
    {
      id: "https://docs.github.com/en/enterprise-server@3.21/admin/release-notes#3-21-4",
      sourceId: "ghes-3.21-release-notes",
      sourceLabel: "GitHub Enterprise Server 3.21 release notes",
      sourceUrl: "https://docs.github.com/en/enterprise-server@3.21/admin/release-notes",
      title: "3.21.4",
      url: "https://docs.github.com/en/enterprise-server@3.21/admin/release-notes#3-21-4",
      publishedAt: "2026-08-05T00:00:00.000Z",
      summary: "GitHub Enterprise Server fixed an issue affecting GitHub Code Security secret scanning push protection.",
      deployments: ["ghes"],
      sourceVersion: "3.21",
    },
    configV2,
  );
  assert.equal(patchEntry.ghesCandidateType, GHES_RELEASE_KINDS.PATCH);
  assert.equal(patchEntry.unmodeledVersion, false);
});

test("dry run discovers 3.22 as an unmodeled version, RC, and GA candidate alongside the modeled 3.21 patch", async () => {
  const report = await runProductWatch({
    config: configV2,
    repository: "owner/repo",
    token: "",
    dryRun: true,
    fixtureSources: v2FixtureSources(),
    now: () => new Date("2026-09-02T12:00:00Z"),
  });

  assert.equal(report.status, "dry-run");
  assert.equal(report.errors.length, 0);

  const byGhesType = (type) =>
    report.candidates.filter((candidate) => candidate.ghesCandidateType === type);

  assert.equal(byGhesType(GHES_RELEASE_KINDS.VERSION_DISCOVERED).length, 1);
  assert.ok(byGhesType(GHES_RELEASE_KINDS.VERSION_DISCOVERED)[0].unmodeledVersion);
  assert.equal(byGhesType(GHES_RELEASE_KINDS.FEATURE_CANDIDATE).length, 1);
  assert.equal(byGhesType(GHES_RELEASE_KINDS.FEATURE_STABLE).length, 1);
  assert.equal(byGhesType(GHES_RELEASE_KINDS.PATCH).length, 1);
  assert.ok(byGhesType(GHES_RELEASE_KINDS.PATCH)[0].unmodeledVersion === false);

  // Tracked lifecycle entries exist for the modeled baseline (3.21) and the
  // discovered version (3.22), but not for the superseded 3.16 row.
  const lifecycle = byGhesType(GHES_RELEASE_KINDS.LIFECYCLE);
  assert.equal(lifecycle.length, 2);
  assert.ok(lifecycle.every((candidate) => candidate.ghesVersion !== "3.16"));
});

test("GHES discovery issues dedupe exactly on an unchanged daily repeat run", async () => {
  let issueNumber = 200;
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

  const day1 = await runProductWatch({
    config: configV2,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: v2FixtureSources(),
    githubClient,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });
  assert.equal(day1.status, "success");
  assert.ok(day1.actions.some((action) => action.type === "create"));
  const reviewIssueCountAfterDay1 = issues.filter((issue) =>
    issue.labels.includes(configV2.state.reviewLabel)
  ).length;
  assert.ok(reviewIssueCountAfterDay1 > 0);

  const day2 = await runProductWatch({
    config: configV2,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: v2FixtureSources(),
    githubClient,
    now: () => new Date("2026-09-03T12:00:00Z"),
  });
  assert.equal(day2.status, "success");
  assert.ok(
    day2.actions.every((action) => action.type === "skip"),
    "an exact-repeat daily run must not create or update any issue",
  );
  assert.equal(
    issues.filter((issue) => issue.labels.includes(configV2.state.reviewLabel)).length,
    reviewIssueCountAfterDay1,
  );
});

test("a changed discovered-version entry updates its existing review issue rather than duplicating it", async () => {
  let issueNumber = 300;
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
    config: configV2,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: v2FixtureSources(),
    githubClient,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });
  assert.equal(first.status, "success");
  const reviewCountAfterFirst = issues.filter((issue) =>
    issue.labels.includes(configV2.state.reviewLabel)
  ).length;

  const changedReleaseNotes = ghesFixtures[
    "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes"
  ].replace(
    "GitHub Secret Protection secret scanning improvements.",
    "GitHub Secret Protection secret scanning improvements, including an updated default configuration.",
  );

  const second = await runProductWatch({
    config: configV2,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: v2FixtureSources({
      "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes": changedReleaseNotes,
    }),
    githubClient,
    now: () => new Date("2026-09-03T12:00:00Z"),
  });
  assert.equal(second.status, "success");
  assert.ok(second.actions.some((action) => action.type === "update"));
  assert.equal(
    issues.filter((issue) => issue.labels.includes(configV2.state.reviewLabel)).length,
    reviewCountAfterFirst,
    "a changed entry must update its existing issue rather than create a duplicate",
  );
});

test("a lifecycle/closing-down change to a tracked version updates its review issue", async () => {
  let issueNumber = 400;
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
    config: configV2,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: v2FixtureSources(),
    githubClient,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });
  assert.equal(first.status, "success");

  const second = await runProductWatch({
    config: configV2,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: v2FixtureSources({
      "ghes-release-index": ghesFixtures["ghes-release-index-lifecycle-changed"],
    }),
    githubClient,
    now: () => new Date("2026-09-03T12:00:00Z"),
  });
  assert.equal(second.status, "success");
  const lifecycleUpdate = second.actions.find((action) =>
    action.type === "update" && action.title.includes("3.21 lifecycle status")
  );
  assert.ok(lifecycleUpdate, "the 3.21 lifecycle candidate must be updated when its closing-down date changes");
});

test("schemaVersion 2 validation rejects a GHES-versioned source URL outside the allow-list", () => {
  const tampered = structuredClone(configV2);
  tampered.sources = tampered.sources.map((source) =>
    source.id === "ghes-release-index"
      ? {...source, url: "https://attacker.example.com/en/enterprise-server@3.21/admin/all-releases"}
      : source
  );
  assert.throws(() => validateConfig(tampered), /disallowed host/);
});
