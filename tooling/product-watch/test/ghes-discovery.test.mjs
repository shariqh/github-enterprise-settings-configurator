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

test("release-index parsing skips a preceding unrelated table and still finds the true releases table", () => {
  const source = {
    id: "ghes-release-index",
    label: "GitHub Enterprise Server all releases",
    url: "https://docs.github.com/en/enterprise-server@3.21/admin/all-releases",
    kind: "ghes-release-index",
    deployments: ["ghes"],
    ghesRelease: configV2.ghesRelease,
  };
  const {entries, versions} = parseGhesReleaseIndex(
    ghesFixtures["ghes-release-index-preceded-by-unrelated-table"],
    source,
  );
  assert.equal(versions.length, 3, "the real releases table is still found and fully parsed");
  assert.ok(versions.some((row) => row.version === "3.21"));
  assert.ok(versions.some((row) => row.version === "3.22"));
  assert.ok(entries.some((entry) => entry.sourceVersion === "3.21"));
});

test("release-index parsing fails closed when the releases table is missing or restructured", () => {
  const source = {
    id: "ghes-release-index",
    label: "GitHub Enterprise Server all releases",
    url: "https://docs.github.com/en/enterprise-server@3.21/admin/all-releases",
    kind: "ghes-release-index",
    deployments: ["ghes"],
    ghesRelease: configV2.ghesRelease,
  };
  assert.throws(
    () => parseGhesReleaseIndex(ghesFixtures["ghes-release-index-malformed"], source),
    /missing expected modeled version/,
  );
});

test("a malformed or restructured releases table is a source failure that never advances issue-backed state", async () => {
  const githubClient = {
    async listIssues() {
      throw new Error("must not be called: ingestion must fail before any GitHub read");
    },
    async ensureLabel() {
      throw new Error("must not be called: labels must not be ensured on a failed parse");
    },
    async createIssue() {
      throw new Error("must not be called: no issue may be created on a failed parse");
    },
    async updateIssue() {
      throw new Error("must not be called: state must not advance on a failed parse");
    },
  };

  const report = await runProductWatch({
    config: configV2,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: v2FixtureSources({
      "ghes-release-index": ghesFixtures["ghes-release-index-malformed"],
    }),
    githubClient,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });

  assert.equal(report.status, "partial-source-failure");
  assert.ok(report.errors.some((error) => error.sourceId === "ghes-release-index"));
  assert.equal(report.stateAdvanced, false);
  assert.equal(
    report.actions.length,
    0,
    "no issue actions may be planned when the releases table cannot be parsed",
  );
  assert.equal(
    report.candidates.some((candidate) => candidate.ghesCandidateType === GHES_RELEASE_KINDS.VERSION_DISCOVERED),
    false,
    "discovery must not run against an unparseable index",
  );
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

// Maps each configured static source's real URL to its fixture content, plus
// the templated discovered-version release-notes URL, so the redirect tests
// below can drive `runProductWatch` with `fixtureSources: null` and a fully
// custom `fetchImpl` -- this is required to actually exercise the runner's
// fetch call sites (`fetchText`/`fetchTextFromUrl`), which are bypassed
// entirely when `fixtureSources` is supplied.
function urlFixtureMap() {
  const byId = v2FixtureSources();
  const map = {};
  for (const source of configV2.sources) {
    map[source.url] = byId[source.id];
  }
  map["https://docs.github.com/en/enterprise-server@3.22/admin/release-notes"] =
    ghesFixtures["https://docs.github.com/en/enterprise-server@3.22/admin/release-notes"];
  return map;
}

test("a redirect response from the release-index source is not followed and fails closed without advancing state", async () => {
  const targetUrl = "https://docs.github.com/en/enterprise-server@3.21/admin/all-releases";
  const fixturesByUrl = urlFixtureMap();
  const callCounts = {};
  const fetchImpl = async (url, options) => {
    const key = String(url);
    callCounts[key] = (callCounts[key] ?? 0) + 1;
    assert.equal(options.redirect, "manual", `expected redirect: "manual" for ${key}`);
    if (key === targetUrl) {
      return {
        ok: false,
        status: 301,
        statusText: "Moved Permanently",
        text: async () => {
          throw new Error("must not read a redirect response body");
        },
      };
    }
    if (key in fixturesByUrl) {
      return {ok: true, status: 200, statusText: "OK", text: async () => fixturesByUrl[key]};
    }
    throw new Error(`Unexpected fetch for ${key}`);
  };

  const githubClient = {
    async listIssues() {
      throw new Error("must not be called: ingestion must fail before any GitHub read");
    },
    async ensureLabel() {
      throw new Error("must not be called");
    },
    async createIssue() {
      throw new Error("must not be called: state must not advance on a redirected source");
    },
    async updateIssue() {
      throw new Error("must not be called: state must not advance on a redirected source");
    },
  };

  const report = await runProductWatch({
    config: configV2,
    repository: "owner/repo",
    token: "not-used",
    dryRun: false,
    fixtureSources: null,
    fetchImpl,
    githubClient,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });

  assert.equal(report.status, "partial-source-failure");
  assert.ok(report.errors.some((error) => error.sourceId === "ghes-release-index"));
  assert.equal(
    callCounts[targetUrl],
    1,
    "a disallowed redirect must not be followed with a second request",
  );
  assert.equal(report.stateAdvanced, false);
});

test("a redirect response for a discovered version's release notes is not followed and defaults that version to unavailable", async () => {
  const rcUrl = "https://docs.github.com/en/enterprise-server@3.22/admin/release-notes";
  const fixturesByUrl = urlFixtureMap();
  const callCounts = {};
  const fetchImpl = async (url, options) => {
    const key = String(url);
    callCounts[key] = (callCounts[key] ?? 0) + 1;
    assert.equal(options.redirect, "manual", `expected redirect: "manual" for ${key}`);
    if (key === rcUrl) {
      return {
        ok: false,
        status: 302,
        statusText: "Found",
        text: async () => {
          throw new Error("must not read a redirect response body");
        },
      };
    }
    if (key in fixturesByUrl) {
      return {ok: true, status: 200, statusText: "OK", text: async () => fixturesByUrl[key]};
    }
    throw new Error(`Unexpected fetch for ${key}`);
  };

  const report = await runProductWatch({
    config: configV2,
    repository: "owner/repo",
    token: "",
    dryRun: true,
    fixtureSources: null,
    fetchImpl,
    now: () => new Date("2026-09-02T12:00:00Z"),
  });

  assert.equal(report.status, "dry-run");
  assert.equal(
    report.errors.length,
    0,
    "a per-version discovery redirect must not fail overall ingestion",
  );
  assert.equal(
    callCounts[rcUrl],
    1,
    "a disallowed redirect must not be followed with a second request",
  );
  const discovered = report.candidates.find(
    (candidate) => candidate.ghesCandidateType === GHES_RELEASE_KINDS.VERSION_DISCOVERED,
  );
  assert.ok(discovered, "the discovered version must still get a review candidate");
  assert.match(discovered.summary, /could not be retrieved/);
  assert.match(discovered.summary, /302 Found/);
});
